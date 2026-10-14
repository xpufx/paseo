import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ToolRegistry,
  registerAgentSession,
  _clearAllSessions,
} from "../server/tools.js";
import {
  PR_TOOLS,
  CI_TOOLS,
  ALL_MCP_TOOLS,
  PrListInputSchema,
  PrViewInputSchema,
  PrCreateInputSchema,
  PrDiffInputSchema,
  PrMergeInputSchema,
  CiLogsInputSchema,
  PrListOutputSchema,
  PrViewOutputSchema,
  PrCreateOutputSchema,
  PrDiffOutputSchema,
  PrMergeOutputSchema,
  CiLogsOutputSchema,
} from "../shared/tools.js";

describe("PR Tool Schemas", () => {
  it("defines all 5 PR tool schemas", () => {
    const names = PR_TOOLS.map((t) => t.name);
    expect(names).toContain("pr_list");
    expect(names).toContain("pr_view");
    expect(names).toContain("pr_create");
    expect(names).toContain("pr_diff");
    expect(names).toContain("pr_merge");
    expect(PR_TOOLS.length).toBe(5);
  });

  it("validates pr_list input with defaults", () => {
    const valid = PrListInputSchema.parse({});
    expect(valid.state).toBe("open");
    expect(valid.page).toBe(1);
    expect(valid.author).toBeUndefined();
    expect(valid.branch).toBeUndefined();
  });

  it("validates pr_list input with state filter", () => {
    const valid = PrListInputSchema.parse({ state: "merged", page: 3 });
    expect(valid.state).toBe("merged");
    expect(valid.page).toBe(3);
  });

  it("rejects pr_list with invalid state", () => {
    const result = PrListInputSchema.safeParse({ state: "invalid" });
    expect(result.success).toBe(false);
  });

  it("validates pr_view input", () => {
    const valid = PrViewInputSchema.parse({ pullRequestNumber: 42 });
    expect(valid.pullRequestNumber).toBe(42);
  });

  it("rejects pr_view without pullRequestNumber", () => {
    const result = PrViewInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("validates pr_create input", () => {
    const valid = PrCreateInputSchema.parse({
      title: "Add new feature",
      headBranch: "feature/new",
      baseBranch: "main",
    });
    expect(valid.title).toBe("Add new feature");
    expect(valid.draft).toBe(false);
  });

  it("validates pr_create with draft flag", () => {
    const valid = PrCreateInputSchema.parse({
      title: "WIP feature",
      headBranch: "wip/feature",
      baseBranch: "develop",
      draft: true,
    });
    expect(valid.draft).toBe(true);
  });

  it("rejects pr_create with empty title", () => {
    const result = PrCreateInputSchema.safeParse({
      title: "",
      headBranch: "feature",
      baseBranch: "main",
    });
    expect(result.success).toBe(false);
  });

  it("rejects pr_create without headBranch", () => {
    const result = PrCreateInputSchema.safeParse({
      title: "Feature",
      baseBranch: "main",
    });
    expect(result.success).toBe(false);
  });

  it("validates pr_diff input", () => {
    const valid = PrDiffInputSchema.parse({ pullRequestNumber: 7 });
    expect(valid.pullRequestNumber).toBe(7);
  });

  it("rejects pr_diff without pullRequestNumber", () => {
    const result = PrDiffInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("validates pr_merge input with defaults", () => {
    const valid = PrMergeInputSchema.parse({ pullRequestNumber: 10 });
    expect(valid.pullRequestNumber).toBe(10);
    expect(valid.squash).toBe(true);
    expect(valid.title).toBe("");
    expect(valid.commitMsg).toBe("");
  });

  it("validates pr_merge with custom title and commit message", () => {
    const valid = PrMergeInputSchema.parse({
      pullRequestNumber: 10,
      title: "Merged via MCP",
      commitMsg: "Detailed merge description",
      squash: false,
    });
    expect(valid.title).toBe("Merged via MCP");
    expect(valid.commitMsg).toBe("Detailed merge description");
    expect(valid.squash).toBe(false);
  });

  it("rejects pr_merge without pullRequestNumber", () => {
    const result = PrMergeInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("CI Tool Schemas", () => {
  it("defines ci_logs tool", () => {
    expect(CI_TOOLS.length).toBe(1);
    expect(CI_TOOLS[0].name).toBe("ci_logs");
  });

  it("validates ci_logs input", () => {
    const valid = CiLogsInputSchema.parse({ runId: 12345 });
    expect(valid.runId).toBe(12345);
    expect(valid.stepId).toBeUndefined();
    expect(valid.page).toBe(1);
  });

  it("validates ci_logs with stepId", () => {
    const valid = CiLogsInputSchema.parse({ runId: 12345, stepId: 3 });
    expect(valid.stepId).toBe(3);
  });

  it("rejects ci_logs without runId", () => {
    const result = CiLogsInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("Tool Counts", () => {
  it("ALL_MCP_TOOLS contains 13 tools (5 ticket + 2 fleet + 5 PR + 1 CI)", () => {
    expect(ALL_MCP_TOOLS.length).toBe(13);
    const names = ALL_MCP_TOOLS.map((t) => t.name);
    for (const expected of [
      "ticket_list", "ticket_view", "ticket_create", "ticket_comment", "ticket_edit",
      "fleet_status", "fleet_queue_inspect",
      "pr_list", "pr_view", "pr_create", "pr_diff", "pr_merge",
      "ci_logs",
    ]) {
      expect(names).toContain(expected);
    }
  });
});

describe("ToolRegistry — PR & CI Tools", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    _clearAllSessions();
    registry = new ToolRegistry({ sessionTtlMs: 60_000 });
  });

  afterEach(() => {
    _clearAllSessions();
  });

  it("returns all 13 tool definitions", () => {
    const tools = registry.getTools();
    expect(tools.length).toBe(13);
    const names = tools.map((t) => t.name);
    for (const expected of [
      "pr_list", "pr_view", "pr_create", "pr_diff", "pr_merge", "ci_logs",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("each PR tool has required fields", () => {
    const tools = registry.getTools();
    for (const tool of tools) {
      if (["pr_list", "pr_view", "pr_create", "pr_diff", "pr_merge"].includes(tool.name)) {
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
      }
    }
  });

  it("each CI tool has required fields", () => {
    const tools = registry.getTools();
    for (const tool of tools) {
      if (tool.name === "ci_logs") {
        expect(typeof tool.name).toBe("string");
        expect(typeof tool.description).toBe("string");
        expect(tool.inputSchema).toBeDefined();
        expect(tool.outputSchema).toBeDefined();
      }
    }
  });

  it("rejects pr_list calls without session", async () => {
    const result = await registry.callTool("pr_list", {}, undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Session validation failed");
  });

  it("accepts pr_list with valid session", async () => {
    registerAgentSession("pr-sess-1", "pr-agent-1");
    const result = await registry.callTool("pr_list", { state: "open" }, "pr-sess-1");
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("rejects pr_list with invalid state", async () => {
    registerAgentSession("pr-sess-2", "pr-agent-2");
    const result = await registry.callTool("pr_list", { state: "bogus" }, "pr-sess-2");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid pr_list input");
  });

  it("accepts pr_view with valid session", async () => {
    registerAgentSession("pr-sess-3", "pr-agent-3");
    const result = await registry.callTool("pr_view", { pullRequestNumber: 5 }, "pr-sess-3");
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("rejects pr_view without pullRequestNumber", async () => {
    registerAgentSession("pr-sess-4", "pr-agent-4");
    const result = await registry.callTool("pr_view", {}, "pr-sess-4");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid pr_view input");
  });

  it("accepts pr_create with valid session", async () => {
    registerAgentSession("pr-sess-5", "pr-agent-5");
    const result = await registry.callTool(
      "pr_create",
      { title: "New PR", headBranch: "feat-x", baseBranch: "main" },
      "pr-sess-5"
    );
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("rejects pr_create with empty title", async () => {
    registerAgentSession("pr-sess-6", "pr-agent-6");
    const result = await registry.callTool(
      "pr_create",
      { title: "", headBranch: "feat-x", baseBranch: "main" },
      "pr-sess-6"
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid pr_create input");
  });

  it("accepts pr_diff with valid session", async () => {
    registerAgentSession("pr-sess-7", "pr-agent-7");
    const result = await registry.callTool("pr_diff", { pullRequestNumber: 3 }, "pr-sess-7");
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("accepts pr_merge with valid session", async () => {
    registerAgentSession("pr-sess-8", "pr-agent-8");
    const result = await registry.callTool(
      "pr_merge",
      { pullRequestNumber: 3, squash: true },
      "pr-sess-8"
    );
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("accepts ci_logs with valid session", async () => {
    registerAgentSession("ci-sess-1", "ci-agent-1");
    const result = await registry.callTool("ci_logs", { runId: 999 }, "ci-sess-1");
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("rejects ci_logs without runId", async () => {
    registerAgentSession("ci-sess-2", "ci-agent-2");
    const result = await registry.callTool("ci_logs", {}, "ci-sess-2");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid ci_logs input");
  });
});

describe("Output Schema Parsing", () => {
  it("parses PrListOutput with default values", () => {
    const parsed = PrListOutputSchema.parse({
      repo: "test-repo",
      host: "forge.example.com",
      pullRequests: [],
    });
    expect(parsed.repo).toBe("test-repo");
    expect(parsed.host).toBe("forge.example.com");
    expect(parsed.pullRequests).toEqual([]);
    expect(parsed.page).toBe(1);
    expect(parsed.hasMore).toBe(false);
  });

  it("parses PrViewOutput with full data", () => {
    const parsed = PrViewOutputSchema.parse({
      repo: "test-repo",
      host: "forge.example.com",
      pr: {
        number: 10,
        title: "Test PR",
        state: "open",
        labels: [],
        labelDetails: [],
        headBranch: "feature",
        baseBranch: "main",
        author: "dev@example.com",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:00:00Z",
        mergedAt: null,
        closedAt: null,
        mergeable: true,
        mergeCommitSha: null,
        comments: 0,
        reviewComments: 0,
        commits: 1,
        additions: 10,
        deletions: 2,
        changedFiles: 3,
      },
      reviewComments: [],
      fetchedAt: "2025-01-01T00:00:00Z",
    });
    expect(parsed.pr?.number).toBe(10);
    expect(parsed.pr?.mergeable).toBe(true);
  });

  it("parses PrCreateOutput", () => {
    const parsed = PrCreateOutputSchema.parse({
      repo: "test-repo",
      host: "forge.example.com",
      number: 42,
      url: "https://forge.example.com/test-repo/pulls/42",
    });
    expect(parsed.number).toBe(42);
  });

  it("parses PrDiffOutput", () => {
    const parsed = PrDiffOutputSchema.parse({
      repo: "test-repo",
      pullRequestNumber: 42,
      diff: "diff --git a/file.txt b/file.txt\n+new line\n",
    });
    expect(parsed.diff).toContain("+new line");
  });

  it("parses PrMergeOutput", () => {
    const parsed = PrMergeOutputSchema.parse({
      repo: "test-repo",
      pullRequestNumber: 42,
      merged: true,
      mergeCommitSha: "abc123def456",
    });
    expect(parsed.merged).toBe(true);
    expect(parsed.mergeCommitSha).toBe("abc123def456");
  });

  it("parses CiLogsOutput", () => {
    const parsed = CiLogsOutputSchema.parse({
      repo: "test-repo",
      host: "forge.example.com",
      run: {
        id: 1,
        runId: 100,
        name: "CI Build",
        status: "completed",
        conclusion: "success",
        createdAt: "2025-01-01T00:00:00Z",
        updatedAt: "2025-01-01T00:05:00Z",
        triggeredBy: "push",
        ref: "refs/heads/main",
        workflowName: "build.yml",
        steps: [],
        url: "https://forge.example.com/test-repo/actions/runs/100",
      },
      stepLog: null,
      steps: [],
    });
    expect(parsed.run?.workflowName).toBe("build.yml");
    expect(parsed.run?.conclusion).toBe("success");
  });
});
