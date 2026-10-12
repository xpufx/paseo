import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseForgeRemote,
  resolveForgeTarget,
  activeForgeForDirectory,
  forgeCapabilityFromRepo,
  parseAgentEnvelope,
  stripAgentEnvelopeFooter,
  parseMarkdownLite,
  parseMarkdownLiteInline,
  rankIssues,
  scopeOfLabel,
  liveScopesFromLabels,
  validateCreateIssueInput,
  type ForgeIssue,
} from "../shared/index.js";
import {
  ForgeGuard,
  NEGATIVE_PROBE_TTL_MS,
  ForgeClient,
  parseOriginUrl,
  parseGitDirPointer,
} from "../server/index.js";

describe("Taxonomy & Labels", () => {
  it("extracts scope from scoped label", () => {
    expect(scopeOfLabel("state/wip")).toBe("state");
    expect(scopeOfLabel("priority/1-high")).toBe("priority");
    expect(scopeOfLabel("plain-label")).toBeNull();
  });

  it("extracts live scopes from label list", () => {
    const labels = ["state/wip", "kind/bug", "state/done", "priority/urgent"];
    expect(liveScopesFromLabels(labels)).toEqual(["state", "kind", "priority"]);
  });

  it("ranks issues by priority and state", () => {
    const issues: ForgeIssue[] = [
      { number: 1, title: "Normal low", state: "open", labels: ["priority/low", "state/triage"], labelDetails: [], comments: 0 },
      { number: 2, title: "SOS wip", state: "open", labels: ["priority/sos", "state/wip"], labelDetails: [], comments: 0 },
      { number: 3, title: "High triage", state: "open", labels: ["priority/high", "state/triage"], labelDetails: [], comments: 0 },
    ];
    const ranked = rankIssues(issues);
    expect(ranked.map((i) => i.number)).toEqual([2, 3, 1]);
  });

  it("validates create issue input", () => {
    expect(validateCreateIssueInput({ title: "" })).toBe("Issue title must not be empty");
    expect(validateCreateIssueInput({ title: "Valid" })).toBeNull();
    expect(validateCreateIssueInput({ title: "Valid", labels: ["good", ""] })).toBe("Label must not be empty");
  });
});

describe("Agent Envelopes", () => {
  it("parses valid envelope footer", () => {
    const body = "Turn completed.\n\n---\n<sub>🤖 **Coding Agent** (`abc1234`) · `gpt-4o` · `owner/repo:main` · _2026-10-12T10:00:00Z_</sub>";
    const parsed = parseAgentEnvelope(42, body);
    expect(parsed).not.toBeNull();
    expect(parsed?.commentId).toBe(42);
    expect(parsed?.sessionTitle).toBe("Coding Agent");
    expect(parsed?.agentShortId).toBe("abc1234");
    expect(parsed?.model).toBe("gpt-4o");
    expect(parsed?.repo).toBe("owner/repo");
    expect(parsed?.branch).toBe("main");
  });

  it("strips envelope footer cleanly", () => {
    const body = "Turn completed.\n\n---\n<sub>🤖 **Coding Agent** (`abc1234`) · `gpt-4o` · `owner/repo:main` · _2026-10-12T10:00:00Z_</sub>";
    expect(stripAgentEnvelopeFooter(body)).toBe("Turn completed.");
  });
});

describe("MarkdownLite", () => {
  it("parses headings, paragraphs, and inline spans", () => {
    const md = "# Heading 1\n\nThis has **bold** and `code` and [link](https://example.com).";
    const blocks = parseMarkdownLite(md);
    expect(blocks.length).toBe(2);
    expect(blocks[0].kind).toBe("heading");
    expect(blocks[1].kind).toBe("paragraph");
  });

  it("parses fenced code blocks", () => {
    const md = "```ts\nconst x = 1;\n```";
    const blocks = parseMarkdownLite(md);
    expect(blocks).toEqual([
      { kind: "code", language: "ts", text: "const x = 1;" },
    ]);
  });
});

describe("Remote coordinates", () => {
  it("parses HTTPS and SSH remote URLs", () => {
    const https = parseForgeRemote("https://forge.example.com/org/repo.git");
    expect(https).toEqual({ host: "forge.example.com", owner: "org", repo: "repo" });

    const scp = parseForgeRemote("git@forge.example.com:org/repo.git");
    expect(scp).toEqual({ host: "forge.example.com", owner: "org", repo: "repo" });

    const ssh = parseForgeRemote("ssh://git@forge.example.com:222/org/repo.git");
    expect(ssh).toEqual({ host: "forge.example.com", owner: "org", repo: "repo" });
  });

  it("resolves forge targets from explicit and derived sources", () => {
    const derived = resolveForgeTarget(undefined, "https://forge.example.com/org/repo.git");
    expect(derived).toEqual({ ok: true, host: "forge.example.com", repo: "org/repo", source: "derived" });

    const explicit = resolveForgeTarget("https://custom.forge/other/repo.git", "https://forge.example.com/org/repo.git");
    expect(explicit).toEqual({ ok: true, host: "custom.forge", repo: "other/repo", source: "explicit" });

    const bare = resolveForgeTarget("org/other-repo", "https://forge.example.com/org/repo.git");
    expect(bare).toEqual({ ok: true, host: "forge.example.com", repo: "org/other-repo", source: "explicit" });
  });

  it("reads stored forge selection for directory", () => {
    const settings = {
      activeForgeByDirectory: {
        "/workspaces/app": "https://forge.example.com/org/app.git",
      },
    };
    expect(activeForgeForDirectory(settings, "/workspaces/app")).toBe("https://forge.example.com/org/app.git");
    expect(activeForgeForDirectory(settings, "/workspaces/unknown")).toBeNull();
  });

  it("checks write capability from repo permissions payload", () => {
    expect(forgeCapabilityFromRepo({ permissions: { push: true } })).toBe(true);
    expect(forgeCapabilityFromRepo({ permissions: { push: false, admin: false } })).toBe(false);
    expect(forgeCapabilityFromRepo({ access_level: 30 })).toBe(true);
    expect(forgeCapabilityFromRepo({ access_level: 20 })).toBe(false);
    expect(forgeCapabilityFromRepo({})).toBeNull();
  });
});

describe("Server: Git Origin parsing", () => {
  it("parses origin url from config string", () => {
    const config = `[core]\n\tbare = false\n[remote "origin"]\n\turl = ssh://git@forge.example.com/org/repo.git\n`;
    expect(parseOriginUrl(config)).toBe("ssh://git@forge.example.com/org/repo.git");
    expect(parseOriginUrl(`[remote "upstream"]\n\turl = foo`)).toBeNull();
  });

  it("parses gitdir pointer from worktree .git file", () => {
    expect(parseGitDirPointer("gitdir: /path/to/.git/worktrees/wt1\n")).toBe("/path/to/.git/worktrees/wt1");
    expect(parseGitDirPointer("random content")).toBeNull();
  });
});

describe("Server: ForgeGuard", () => {
  it("caches positive verdicts indefinitely and negative verdicts with TTL", () => {
    let clock = 1000;
    const guard = new ForgeGuard({ now: () => clock });
    expect(guard.cachedProbe("host.com")).toBeNull();

    guard.recordProbe("host.com", false);
    expect(guard.cachedProbe("host.com")).toBe(false);

    clock += NEGATIVE_PROBE_TTL_MS + 1;
    expect(guard.cachedProbe("host.com")).toBeNull();

    guard.recordProbe("host.com", true);
    clock += 10_000_000;
    expect(guard.cachedProbe("host.com")).toBe(true);
  });

  it("logs quietly with backoff", () => {
    const guard = new ForgeGuard();
    expect(guard.skipLogLevel("host.com")).toBe("info");
    expect(guard.skipLogLevel("host.com")).toBe("debug");

    expect(guard.failureLogLevel("host.com", "repo")).toBe("warn");
    expect(guard.failureLogLevel("host.com", "repo")).toBe("debug");
    guard.noteSuccess("host.com", "repo");
    expect(guard.failureLogLevel("host.com", "repo")).toBe("warn");
  });
});

describe("Server: ForgeClient", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(response: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(response(url, init));
    }) as typeof fetch;
  }

  it("probes forge host version", async () => {
    stubFetch((url) => {
      expect(url).toBe("https://forge.example.com/api/v1/version");
      return new Response(JSON.stringify({ version: "1.21.0+forgejo" }), { status: 200 });
    });
    const client = new ForgeClient({ host: "forge.example.com" });
    expect(await client.isForgeHost()).toBe(true);
  });

  it("lists issues with label normalization", async () => {
    stubFetch((url) => {
      expect(url).toContain("/api/v1/repos/org/repo/issues");
      return new Response(
        JSON.stringify([
          {
            number: 10,
            title: "Issue 10",
            state: "open",
            labels: [{ name: "priority/high", color: "ff0000" }],
          },
        ]),
        { status: 200 },
      );
    });
    const client = new ForgeClient({ host: "forge.example.com" });
    const result = await client.listIssues("org/repo");
    expect(result?.issues.length).toBe(1);
    expect(result?.issues[0].title).toBe("Issue 10");
    expect(result?.issues[0].labels).toEqual(["priority/high"]);
    expect(result?.issues[0].labelDetails).toEqual([{ name: "priority/high", color: "ff0000" }]);
  });
});
