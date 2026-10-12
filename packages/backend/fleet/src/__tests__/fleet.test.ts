import { describe, expect, it } from "vitest";
import {
  categorizeAgent,
  isCodingAgentCategory,
  deriveLifecycleState,
  deriveDeterministicState,
  extractAttributedWork,
  extractAgentWorktree,
  extractAgentProject,
  inheritProjectFromParents,
  buildAgentTree,
  detectTurnConcurrencyLock,
  detectCancellationTimeout,
  detectStaleErrorGhosting,
  detectProviderQuotaExhaustion,
  detectIdlePostErrorAmnesia,
  detectZombieHungTurn,
  detectRepetitiveToolLoop,
  assessAgentHealth,
  planWatchdogRecovery,
  canonicalRepoKey,
  candidateRepoKeys,
  resolveCanonicalRepo,
  isRepoMatching,
  canonicalDescriptorsToRegistry,
  resolveWorkspaceForRepo,
  normalizeRawAgent,
  DEFAULT_PROJECT,
} from "../index.js";

describe("@xpufx/backend-fleet", () => {
  describe("Agent Categorization and Work Extraction", () => {
    it("categorizes agent names correctly", () => {
      expect(categorizeAgent("Front Desk Liaison")).toBe("front-desk");
      expect(categorizeAgent("Repo Orchestrator")).toBe("orchestrator");
      expect(categorizeAgent("Worker Agent 42")).toBe("coding-agent");
      expect(isCodingAgentCategory("coding-agent")).toBe(true);
      expect(isCodingAgentCategory("worker")).toBe(true);
      expect(isCodingAgentCategory("orchestrator")).toBe(false);
    });

    it("extracts attributed work from titles, names, and labels", () => {
      const work1 = extractAttributedWork({
        id: "ag-1",
        title: "Fix issue #456 in payments",
        cwd: "/home/user/worktrees/123/refactor-456-payment-flow",
      });
      expect(work1?.issue).toBe(456);
      expect(work1?.slug).toBe("456-payment-flow");

      const work2 = extractAttributedWork({
        id: "ag-2",
        labels: { branch: "feat/jwt-auth" },
      });
      expect(work2?.branch).toBe("feat/jwt-auth");
    });

    it("extracts worktrees accurately", () => {
      expect(extractAgentWorktree({ cwd: "/home/user/.paseo/worktrees/abc/refactor-12-ui" })).toBe("refactor-12-ui");
      expect(extractAgentWorktree({ cwd: "/home/user/code/my-repo" })).toBe("my-repo");
      expect(extractAgentWorktree({ labels: { branch: "fix/bug-1" } })).toBe("fix/bug-1");
    });

    it("extracts project identity with priority", () => {
      const map = { ws1: "xpufx-org/paseo" };
      expect(extractAgentProject({ project: "custom/repo" }, undefined, map)).toBe("forge.mrs.uppidi.com/custom/repo");
      expect(extractAgentProject({ workspaceId: "ws1" }, undefined, map)).toBe("forge.mrs.uppidi.com/xpufx-org/paseo");
      expect(extractAgentProject({ labels: { repo: "other/repo" } }, undefined, map)).toBe("forge.mrs.uppidi.com/other/repo");
      expect(extractAgentProject({}, "parent/repo", map)).toBe("forge.mrs.uppidi.com/parent/repo");
      expect(extractAgentProject({}, undefined, map)).toBe(DEFAULT_PROJECT);
    });

    it("inherits projects from parents", () => {
      const agents: any[] = [
        { id: "parent", project: "forge.mrs.uppidi.com/org/repo" },
        { id: "child", parentId: "parent", project: DEFAULT_PROJECT },
      ];
      inheritProjectFromParents(agents);
      expect(agents[1].project).toBe("forge.mrs.uppidi.com/org/repo");
    });
  });

  describe("Deterministic State Engine", () => {
    it("handles pending permissions with highest precedence", () => {
      const state = deriveDeterministicState(
        {
          id: "ag-perm",
          status: "running",
          pendingPermissions: [{ id: "p1", title: "Write File", input: { file_path: "/tmp/foo" } }],
        },
        null,
      );
      expect(state.state).toBe("permission-prompt");
      expect(state.detail).toContain("Write File (/tmp/foo)");
    });

    it("handles errors and quota exhaustion", () => {
      const quotaState = deriveDeterministicState(
        {
          id: "ag-quota",
          status: "error",
          lastError: "Rate limit reached (429: Too many requests)",
        },
        null,
      );
      expect(quotaState.state).toBe("failed:quota-exhausted");

      const errorState = deriveDeterministicState(
        {
          id: "ag-err",
          status: "error",
          lastError: "SyntaxError: Unexpected token",
        },
        null,
      );
      expect(errorState.state).toBe("failed:error");
    });

    it("identifies working vs running agents", () => {
      const working = deriveDeterministicState(
        { id: "ag-w", status: "running" },
        { issue: 123, slug: "auth-refactor" },
      );
      expect(working.state).toBe("working");
      expect(working.detail).toBe("#123 (auth-refactor)");

      const running = deriveDeterministicState(
        { id: "ag-r", status: "running" },
        null,
      );
      expect(running.state).toBe("running");
    });

    it("projects deterministic state onto canonical lifecycle state", () => {
      expect(deriveLifecycleState("permission-prompt")).toBe("waiting_for_input");
      expect(deriveLifecycleState("attention-required")).toBe("waiting_for_input");
      expect(deriveLifecycleState("working")).toBe("running");
      expect(deriveLifecycleState("running")).toBe("running");
      expect(deriveLifecycleState("failed:error")).toBe("errored");
      expect(deriveLifecycleState("idle:waiting")).toBe("idle");
      expect(deriveLifecycleState("sleeping")).toBe("idle");
    });
  });

  describe("Watchdog Anomaly Classifier", () => {
    it("detects turn concurrency locks", () => {
      expect(detectTurnConcurrencyLock("error", "foreground turn is already active")).toBe(true);
      expect(detectTurnConcurrencyLock("running", "foreground turn is already active")).toBe(false);
      expect(detectTurnConcurrencyLock("error", "Unrelated error")).toBe(false);
    });

    it("detects stale error ghosting", () => {
      expect(detectStaleErrorGhosting("idle", "some old error")).toBe(true);
      expect(detectStaleErrorGhosting("running", "some old error")).toBe(true);
      expect(detectStaleErrorGhosting("error", "some old error")).toBe(false);
      expect(detectStaleErrorGhosting("idle", "")).toBe(false);
    });

    it("detects zombie hung turns", () => {
      const now = Date.now();
      const hourAgo = new Date(now - 3600 * 1000).toISOString();
      const fiveMinAgo = new Date(now - 300 * 1000).toISOString();

      expect(detectZombieHungTurn("running", hourAgo, now, 1800)).toBe(true);
      expect(detectZombieHungTurn("running", fiveMinAgo, now, 1800)).toBe(false);
      expect(detectZombieHungTurn("idle", hourAgo, now, 1800)).toBe(false);
    });

    it("detects provider quota exhaustion", () => {
      expect(detectProviderQuotaExhaustion("429 rate limit exceeded")).toBe(true);
      expect(detectProviderQuotaExhaustion("Model quota exceeded")).toBe(true);
      expect(detectProviderQuotaExhaustion("fetch failed: connection reset")).toBe(false);
    });

    it("detects repetitive tool loops", () => {
      const timeline = [
        { type: "tool_call", name: "read", detail: { filePath: "/etc/hosts" } },
        { type: "tool_call", name: "read", detail: { filePath: "/etc/hosts" } },
        { type: "tool_call", name: "read", detail: { filePath: "/etc/hosts" } },
      ];
      expect(detectRepetitiveToolLoop(timeline, 3)).toBe(3);
      expect(detectRepetitiveToolLoop(timeline, 4)).toBe(0);
    });

    it("fuses signals in assessAgentHealth and plans recovery", () => {
      const assessment = assessAgentHealth(
        "agent-1",
        { status: "error", lastError: "foreground turn is already active" },
        null,
        Date.now(),
      );
      expect(assessment.healthy).toBe(false);
      expect(assessment.taxonomy).toContain("TURN_CONCURRENCY_LOCK");

      const plan = planWatchdogRecovery(assessment.taxonomy);
      expect(plan.stop).toBe(true);
      expect(plan.clearError).toBe(true);
      expect(plan.steer).toBe(true);
      expect(plan.blockedReason).toBe(null);
    });
  });

  describe("Repository Coordinates and Identity", () => {
    it("normalizes and canonicalizes repository keys", () => {
      expect(canonicalRepoKey("xpufx-org/paseo")).toBe("forge.mrs.uppidi.com/xpufx-org/paseo");
      expect(canonicalRepoKey("github.com/xpufx/paseo")).toBe("github.com/xpufx/paseo");
      expect(candidateRepoKeys("xpufx-org/paseo")).toContain("forge.mrs.uppidi.com/xpufx-org/paseo");
    });

    it("resolves canonical repos accurately", () => {
      const res = resolveCanonicalRepo("xpufx-org/paseo");
      expect(res?.key).toBe("forge.mrs.uppidi.com/xpufx-org/paseo");
      expect(res?.compact).toBe("xpufx-org/paseo");
    });

    it("matches repositories across formats", () => {
      expect(isRepoMatching("xpufx-org/paseo", "forge.mrs.uppidi.com/xpufx-org/paseo.git")).toBe(true);
      expect(isRepoMatching("paseo", "xpufx-org/paseo")).toBe(true);
      expect(isRepoMatching("other", "xpufx-org/paseo")).toBe(false);
    });
  });

  describe("Workspace Registry and Resolution", () => {
    it("converts canonical descriptors to registry and matches", () => {
      const descriptors = [
        {
          id: "ws-1",
          cwd: "/home/user/code/paseo",
          projectRootPath: "/home/user/code/paseo",
          projectId: "proj-1",
          projectDisplayName: "xpufx-org/paseo",
          project: { projectKey: "forge.mrs.uppidi.com/xpufx-org/paseo" },
        },
      ];

      const { workspaces, projects } = canonicalDescriptorsToRegistry(descriptors);
      expect(workspaces.length).toBe(1);
      expect(projects.length).toBe(1);

      const matched = resolveWorkspaceForRepo("xpufx-org/paseo", {
        workspacesData: workspaces,
        projectsData: projects,
      });
      expect(matched?.workspaceId).toBe("ws-1");
      expect(matched?.cwd).toBe("/home/user/code/paseo");
    });
  });

  describe("Agent Tree Building", () => {
    it("builds a hierarchical tree from flat agents", () => {
      const agents: any[] = [
        normalizeRawAgent({ id: "root-1", name: "Front Desk" }),
        normalizeRawAgent({ id: "orch-1", name: "Repo Orchestrator", parentId: "root-1" }),
        normalizeRawAgent({ id: "worker-1", name: "Worker 1", parentId: "orch-1" }),
      ];

      const tree = buildAgentTree(agents);
      expect(tree.length).toBe(1);
      expect(tree[0].agent.id).toBe("root-1");
      expect(tree[0].children.length).toBe(1);
      expect(tree[0].children[0].agent.id).toBe("orch-1");
      expect(tree[0].children[0].children.length).toBe(1);
      expect(tree[0].children[0].children[0].agent.id).toBe("worker-1");
    });
  });
});
