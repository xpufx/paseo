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
  normalizeRepoKey,
  resolveCanonicalRepo,
  isRepoMatching,
  canonicalDescriptorsToRegistry,
  resolveWorkspaceForRepo,
  normalizeRawAgent,
  DEFAULT_PROJECT,
  buildWorkspaceProjectMapFromRegistry,
  readFleetRoster,
  registerFleetHandlers,
  fleetRosterContract,
  archiveAgentContract,
  resolveGitRootCommit,
  resolveGitRootCommitSync,
  canonicalProjectKey,
  formatProjectDisplay,
  formatProjectOptionLabel,
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

    it("derives canonical universal project identity with git-root and non-git sentinel", () => {
      const gitRoot = resolveGitRootCommitSync(process.cwd());
      expect(typeof gitRoot).toBe("string");
      expect(gitRoot?.length).toBe(40);

      const pKey = canonicalProjectKey(process.cwd());
      expect(pKey).toBe(`git-root:${gitRoot}`);

      const nonGitKey = canonicalProjectKey("/non-existent/directory/for/testing/1371");
      expect(nonGitKey.startsWith("non-git:")).toBe(true);
      expect(nonGitKey.length).toBe("non-git:".length + 16);

      // Preserves already canonical keys
      expect(canonicalProjectKey("git-root:5d9c889a1c69e5bcb33cf338269ddf6fc24c6581")).toBe(
        "git-root:5d9c889a1c69e5bcb33cf338269ddf6fc24c6581"
      );
      expect(canonicalProjectKey("non-git:1234567890abcdef")).toBe("non-git:1234567890abcdef");
    });

    it("formats project display with distinct repo name and pills", () => {
      const display = formatProjectDisplay({
        projectKey: "git-root:5d9c889a1c69e5bcb33cf338269ddf6fc24c6581",
        repo: "xpufx-org/paseo",
      });
      expect(display.primaryName).toBe("paseo");
      expect(display.orgPill).toBe("xpufx-org");
      expect(display.rootShaPill).toBe("#5d9c889");

      const label = formatProjectOptionLabel("forge.mrs.uppidi.com/xpufx-org/platform");
      expect(label).toBe("platform (xpufx-org)");

      const rawSha = formatProjectDisplay("git-root:5d9c889a1c69e5bcb33cf338269ddf6fc24c6581");
      expect(rawSha.primaryName).toBe("5d9c889");
      expect(rawSha.rootShaPill).toBe("#5d9c889");
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
    });
  });

  describe("Daemon RPC Roster & Server Handlers", () => {
    it("builds workspace-to-project map in-memory without filesystem access", () => {
      const map = buildWorkspaceProjectMapFromRegistry(
        [
          {
            workspaceId: "ws-99",
            projectId: "p-99",
            cwd: "/repos/app",
            displayName: "app-workspace",
          },
        ],
        [
          {
            projectId: "p-99",
            displayName: "my-org/my-app",
            projectKey: "remote:forge.mrs.uppidi.com/my-org/my-app",
          },
        ]
      );
      expect(map["ws-99"]).toBe("forge.mrs.uppidi.com/my-org/my-app");
    });

    it("maps workspace to canonical git-root project and human-readable display name", () => {
      const map = buildWorkspaceProjectMapFromRegistry(
        [
          {
            workspaceId: "ws-1",
            projectId: "git-root:5d9c889a1c69e5bcb33cf338269ddf6fc24c6581",
            cwd: "/home/user/code/paseo",
            displayName: "paseo-workspace",
          },
        ],
        [
          {
            projectId: "git-root:5d9c889a1c69e5bcb33cf338269ddf6fc24c6581",
            displayName: "xpufx-org/paseo",
            projectKey: "remote:forge.mrs.uppidi.com/xpufx-org/paseo",
          },
        ]
      );
      expect(map["ws-1"]).toBe("forge.mrs.uppidi.com/xpufx-org/paseo");
    });

    it("resolves workspace project mapping from display name or rootPath directly", () => {
      const mapFromWs = buildWorkspaceProjectMapFromRegistry(
        [
          {
            workspaceId: "ws-2",
            projectId: "git-root:abc1234567890abcdef1234567890abcdef12",
            cwd: "/repos/my-repo",
            displayName: "my-custom-display",
          },
        ],
        [
          {
            projectId: "git-root:abc1234567890abcdef1234567890abcdef12",
          },
        ]
      );
      expect(mapFromWs["ws-2"]).toBe("my-custom-display");

      const mapFromRoot = buildWorkspaceProjectMapFromRegistry(
        [
          {
            workspaceId: "ws-3",
            projectId: "git-root:def1234567890abcdef1234567890abcdef12",
            cwd: "/repos/my-repo",
          },
        ],
        [
          {
            projectId: "git-root:def1234567890abcdef1234567890abcdef12",
            rootPath: "/repos/my-repo",
          },
        ]
      );
      expect(mapFromRoot["ws-3"]).toBe("my-repo");
    });

    it("reads roster purely via daemon SDK without disk scraping", async () => {
      const mockContext = {
        paseo: {
          agents: {
            list: async () => ({
              entries: [
                {
                  id: "agent-101",
                  name: "Front Desk Liaison",
                  status: "running",
                  workspaceId: "ws-1",
                },
                {
                  id: "agent-102",
                  name: "Repo Orchestrator",
                  status: "idle",
                  workspaceId: "ws-1",
                  labels: { "paseo.parent-agent-id": "agent-101" },
                },
              ],
            }),
          },
          workspaces: {
            list: async () => ({
              entries: [
                {
                  id: "ws-1",
                  cwd: "/workspace/my-repo",
                  projectDisplayName: "xpufx-org/paseo",
                },
              ],
            }),
          },
        },
      };

      const roster = await readFleetRoster(mockContext, {
        enrolledRepos: ["xpufx-org/paseo"],
      });

      expect(roster.ok).toBe(true);
      expect(roster.totalCount).toBe(2);
      expect(roster.runningCount).toBe(1);
      expect(roster.idleCount).toBe(1);
      expect(roster.frontDesk.length).toBe(1);
      expect(roster.orchestrators.length).toBe(1);
      expect(roster.tree.length).toBe(1);
      expect(roster.tree[0].agent.id).toBe("agent-101");
      expect(roster.tree[0].children[0].agent.id).toBe("agent-102");
    });

    it("registers canonical fleet RPC handlers on server context", async () => {
      const registered: Record<string, Function> = {};
      const mockServer = {
        handle: (contract: any, handler: Function) => {
          registered[contract.name] = handler;
        },
      };

      let archiveCalled = false;
      registerFleetHandlers(mockServer, {
        onArchiveAgent: async (input) => {
          archiveCalled = true;
          return { ok: true };
        },
      });

      expect(typeof registered["fleet.roster"]).toBe("function");
      expect(registered["fleet.agents"]).toBeUndefined();
      expect(registered["uppidi-fleet.agents"]).toBeUndefined();
      expect(typeof registered["fleet.archive-agent"]).toBe("function");
      expect(typeof registered["fleet.create-front-desk"]).toBe("function");

      const archiveRes = await registered["fleet.archive-agent"]({ agentId: "ag-1" }, {});
      expect(archiveRes).toEqual({ ok: true });
      expect(archiveCalled).toBe(true);
    });
  });
});
