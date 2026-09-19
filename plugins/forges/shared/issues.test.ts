import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { activeForgeForDirectory, classifyForgeLink, classifyForgeUrl, compactLabelValue, createRemoteSearchGate, darkenLabelColor, deriveForgeAccess, displayNameForDirectory, effectiveForgeHost, extractBareForgeIssueUrls, extractForgeIssueUrls, FORGE_WRITE_SCOPES, ForgeIssueSchema, forgeCapabilityFromRepo, forgeSettingsContract, forgeTargetsForWorkspace, forgeIssueLinkFromUrl, forgeWriteScopeList, isBoardAlertText, isValidForgeTarget, issueMatchesQuery, LABEL_VALUE_MAX_LENGTH, labelTextColor, liveScopesFromIssues, normalizeLabelColor, openIssuesContract, parseBoardAlert, parseForgeRemote, parseMarkdownLite, parseMarkdownLiteInline, paseoLabelScopes, paseoLabelSet, planLabelChip, planLabelSetInstall, rankIssues, resolveForgeRepo, resolveIssueSearchLayer, resolveForgeTarget, scopeOfLabel, SearchIssuesInputSchema, searchIssuesContract, createIssueContract, parseLabelList, splitScopedLabel, validateCreateIssueInput, workspaceNameKey, writeGateNotice, type ForgeIssue } from "./issues.ts";import { createForgeLabelResolver, forgePillLabel, type ForgePillRuntime } from "../client/pill-label.ts";

const ALIAS_REMOTE = "forge-alias:your-org/your-repo.git";
const REAL_HOST = "forge.example.com";

describe("parseForgeRemote accepted forms", () => {
  it("parses scp-like SSH-alias remotes", () => {
    assert.deepEqual(parseForgeRemote(ALIAS_REMOTE), {
      host: "forge-alias",
      owner: "your-org",
      repo: "your-repo",
    });
  });

  it("parses full ssh:// URLs", () => {
    assert.deepEqual(parseForgeRemote(`ssh://git@${REAL_HOST}:222/your-org/your-repo.git`), {
      host: REAL_HOST,
      owner: "your-org",
      repo: "your-repo",
    });
  });

  it("parses https URLs", () => {
    assert.deepEqual(parseForgeRemote(`https://${REAL_HOST}/your-org/your-repo.git`), {
      host: REAL_HOST,
      owner: "your-org",
      repo: "your-repo",
    });
  });

  it("rejects garbage input", () => {
    assert.equal(parseForgeRemote(null), null);
    assert.equal(parseForgeRemote(""), null);
    assert.equal(parseForgeRemote("not-a-remote"), null);
  });
});

describe("resolveForgeRepo precedence", () => {
  it("explicit full URL beats the git remote", () => {
    assert.deepEqual(
      resolveForgeRepo(`https://${REAL_HOST}/your-org/your-repo.git`, ALIAS_REMOTE),
      { host: REAL_HOST, repo: "your-org/your-repo" },
    );
  });

  it("explicit scp-like URL beats the git remote", () => {
    assert.deepEqual(
      resolveForgeRepo("git@forge.example.com:other/project.git", ALIAS_REMOTE),
      { host: "forge.example.com", repo: "other/project" },
    );
  });

  it("explicit bare owner/repo borrows the git-remote host", () => {
    assert.deepEqual(resolveForgeRepo("your-org/your-repo", ALIAS_REMOTE), {
      host: "forge-alias",
      repo: "your-org/your-repo",
    });
  });

  it("falls back to the git remote when no explicit value", () => {
    assert.deepEqual(resolveForgeRepo(undefined, ALIAS_REMOTE), {
      host: "forge-alias",
      repo: "your-org/your-repo",
    });
    assert.deepEqual(resolveForgeRepo("  ", ALIAS_REMOTE), {
      host: "forge-alias",
      repo: "your-org/your-repo",
    });
  });

  it("explicit wins even without a git remote", () => {
    assert.deepEqual(
      resolveForgeRepo(`https://${REAL_HOST}/your-org/your-repo`, null),
      { host: REAL_HOST, repo: "your-org/your-repo" },
    );
  });

  it("returns null when nothing resolves", () => {
    assert.equal(resolveForgeRepo(null, null), null);
    assert.equal(resolveForgeRepo("garbage!!!", undefined), null);
    assert.equal(resolveForgeRepo("your-org/your-repo", null), null);
  });
});

describe("multi-forge selection (issue #137)", () => {
  const DIR = "/work/paseo";
  const codeberg = "https://codeberg.org/your-org/your-repo";
  const forge = `https://${REAL_HOST}/your-org/your-repo`;

  it("lists configured targets plus the legacy remote, deduped and trimmed", () => {
    assert.deepEqual(
      forgeTargetsForWorkspace(
        {
          forgesByDirectory: { [DIR]: [codeberg, codeberg, "  your-org/other  "] },
          remotesByDirectory: { [DIR]: forge },
        },
        DIR,
      ),
      [codeberg, "your-org/other", forge],
    );
  });

  it("seeds the list from the legacy single remote", () => {
    assert.deepEqual(
      forgeTargetsForWorkspace(
        { forgesByDirectory: {}, remotesByDirectory: { [DIR]: forge } },
        DIR,
      ),
      [forge],
    );
  });

  it("returns no targets for a blank or unknown directory", () => {
    assert.deepEqual(
      forgeTargetsForWorkspace({ forgesByDirectory: {}, remotesByDirectory: {} }, DIR),
      [],
    );
    assert.deepEqual(forgeTargetsForWorkspace(undefined, DIR), []);
    assert.deepEqual(forgeTargetsForWorkspace({}, "  "), []);
  });

  it("explicit active selection wins absolutely", () => {
    assert.equal(
      activeForgeForDirectory(
        {
          activeForgeByDirectory: { [DIR]: codeberg },
          forgesByDirectory: { [DIR]: [codeberg, forge] },
          remotesByDirectory: { [DIR]: forge },
        },
        DIR,
      ),
      codeberg,
    );
  });

  it("a present-but-blank active entry means auto and suppresses the legacy remote", () => {
    assert.equal(
      activeForgeForDirectory(
        {
          activeForgeByDirectory: { [DIR]: "" },
          forgesByDirectory: {},
          remotesByDirectory: { [DIR]: forge },
        },
        DIR,
      ),
      null,
    );
  });

  it("falls back to the legacy remote only when no selection exists", () => {
    assert.equal(
      activeForgeForDirectory(
        {
          activeForgeByDirectory: {},
          forgesByDirectory: {},
          remotesByDirectory: { [DIR]: forge },
        },
        DIR,
      ),
      forge,
    );
    assert.equal(activeForgeForDirectory({}, DIR), null);
    assert.equal(activeForgeForDirectory(undefined, undefined), null);
  });

  it("uses an explicit target as-is and reports its source", () => {
    assert.deepEqual(resolveForgeTarget(codeberg, ALIAS_REMOTE), {
      ok: true,
      host: "codeberg.org",
      repo: "your-org/your-repo",
      source: "explicit",
    });
    assert.deepEqual(resolveForgeTarget("your-org/your-repo", ALIAS_REMOTE), {
      ok: true,
      host: "forge-alias",
      repo: "your-org/your-repo",
      source: "explicit",
    });
  });

  it("never silently derives past an invalid explicit selection", () => {
    const resolved = resolveForgeTarget("garbage!!!", ALIAS_REMOTE);
    assert.equal(resolved.ok, false);
    assert.match((resolved as { error: string }).error, /not a valid forge remote/);
    const bareWithoutHost = resolveForgeTarget("your-org/your-repo", null);
    assert.equal(bareWithoutHost.ok, false);
  });

  it("only derives from git when nothing is explicitly selected", () => {
    assert.deepEqual(resolveForgeTarget(undefined, ALIAS_REMOTE), {
      ok: true,
      host: "forge-alias",
      repo: "your-org/your-repo",
      source: "derived",
    });
    assert.deepEqual(resolveForgeTarget("  ", ALIAS_REMOTE), {
      ok: true,
      host: "forge-alias",
      repo: "your-org/your-repo",
      source: "derived",
    });
    const nothing = resolveForgeTarget(null, null);
    assert.equal(nothing.ok, false);
  });

  it("validates forge targets (remote URL or bare owner/repo)", () => {
    assert.equal(isValidForgeTarget(codeberg), true);
    assert.equal(isValidForgeTarget("your-org/your-repo"), true);
    assert.equal(isValidForgeTarget("git@codeberg.org:your-org/your-repo.git"), true);
    assert.equal(isValidForgeTarget("garbage!!!"), false);
    assert.equal(isValidForgeTarget(""), false);
    assert.equal(isValidForgeTarget(undefined), false);
  });
});

describe("settings display regression (issue #152)", () => {
  const DIR = "/work/project";
  const gitRemote = `ssh://git@${REAL_HOST}:222/your-org/your-repo.git`;
  const codeberg = "https://codeberg.org/your-org/your-repo";

  it("resolves the derived host in Auto mode without any issues payload", () => {
    // The persisted token is keyed by this host; it must not depend on the
    // issues RPC (which is absent here).
    assert.equal(effectiveForgeHost("", gitRemote), REAL_HOST);
    assert.equal(effectiveForgeHost(undefined, gitRemote), REAL_HOST);
    assert.equal(effectiveForgeHost("   ", gitRemote), REAL_HOST);
  });

  it("keeps an explicit forge selection's host authoritative", () => {
    assert.equal(effectiveForgeHost(codeberg, gitRemote), "codeberg.org");
  });

  it("borrows the derived host for a bare owner/repo selection", () => {
    assert.equal(effectiveForgeHost("your-org/your-repo", gitRemote), REAL_HOST);
  });

  it("falls back to the derived host when the selection is unparseable", () => {
    assert.equal(effectiveForgeHost("garbage!!!", gitRemote), REAL_HOST);
  });

  it("returns null only when neither the selection nor the remote yields a host", () => {
    assert.equal(effectiveForgeHost("", null), null);
    assert.equal(effectiveForgeHost("your-org/your-repo", null), null);
  });

  it("looks the stored name up by the exact workspace directory key", () => {
    const settings = { namesByDirectory: { [DIR]: "pas" } };
    assert.equal(displayNameForDirectory(settings, DIR, null), "pas");
    // No issues payload: the stored name still wins over a missing repo.
    assert.equal(displayNameForDirectory(settings, DIR, undefined), "pas");
    assert.equal(displayNameForDirectory(settings, "/other/workspace", "your-org/your-repo"), "your-org/your-repo");
    assert.equal(displayNameForDirectory({ namesByDirectory: {} }, DIR, null), null);
  });
});

describe("workspace name key (issue #160)", () => {
  const MAIN = "/work/project";
  const WORKTREE = "/work/project-worktrees/feature-x";

  it("keeps the main checkout keyed by its own directory", () => {
    assert.equal(workspaceNameKey(MAIN, MAIN), MAIN);
  });

  it("maps a worktree to its project/main-repo root", () => {
    assert.equal(workspaceNameKey(WORKTREE, MAIN), MAIN);
    assert.equal(workspaceNameKey(WORKTREE, undefined), WORKTREE);
  });

  it("normalizes trailing separators so read and write agree", () => {
    assert.equal(workspaceNameKey(`${MAIN}/`, undefined), MAIN);
    assert.equal(workspaceNameKey(`${WORKTREE}//`, `${MAIN}/`), MAIN);
  });

  it("returns an empty key when neither path is known", () => {
    assert.equal(workspaceNameKey(undefined, undefined), "");
    assert.equal(workspaceNameKey(null, null), "");
  });

  it("lets a worktree read the name written for the main checkout", () => {
    const settings = { namesByDirectory: { [MAIN]: "pas" } };
    const key = workspaceNameKey(WORKTREE, MAIN);
    assert.equal(displayNameForDirectory(settings, key, "your-org/your-repo"), "pas");
  });
});

describe("parseBoardAlert", () => {
  const sample = `[Autonomous Trigger] Forgejo Board Alert: New actionable items detected:
============================================================
FORGEJO BOARD ACTIONABLE DELTA DETECTED
============================================================
  - Issue #33: chore(release): evaluate readiness for github mirror
    Labels: format/1-ok, kind/chore, priority/2-normal
    Action: [NEW ISSUE FIRST-SEEN] Requires First-Look Ingestion`;
  it("detects board-alert dumps", () => {
    assert.equal(isBoardAlertText(sample), true);
    assert.equal(isBoardAlertText("hello world"), false);
  });
  it("parses issues into card data", () => {
    const parsed = parseBoardAlert(sample);
    assert.ok(parsed);
    assert.equal(parsed.issues.length, 1);
    assert.equal(parsed.issues[0].number, 33);
    assert.ok(parsed.issues[0].title.includes("github mirror"));
    assert.deepEqual(parsed.issues[0].labels, ["format/1-ok", "kind/chore", "priority/2-normal"]);
    assert.ok(parsed.issues[0].action.includes("FIRST-SEEN"));
  });
  it("returns null without issues", () => {
    assert.equal(parseBoardAlert("Forgejo Board Alert: nothing"), null);
  });
});

describe("markdown-lite parser (issue #136)", () => {
  it("parses headings, emphasis, links, and inline code", () => {
    const blocks = parseMarkdownLite(
      "## Fix it\n\nUse **bold** and *italic* with `code` and [label](https://example.com/x).",
    );
    assert.equal(blocks[0]?.kind, "heading");
    assert.equal((blocks[0] as { level: number }).level, 2);
    const para = blocks[1];
    assert.equal(para?.kind, "paragraph");
    const kinds = (para as { spans: { kind: string }[] }).spans.map((span) => span.kind);
    assert.deepEqual(kinds, ["text", "bold", "text", "italic", "text", "code", "text", "link", "text"]);
    const link = (para as { spans: { kind: string }[] }).spans.find((span) => span.kind === "link") as unknown as { text: string; url: string };
    assert.equal(link.text, "label");
    assert.equal(link.url, "https://example.com/x");
  });

  it("groups unordered and ordered list lines", () => {
    const blocks = parseMarkdownLite("- [a](https://example.com/a)\n- plain\n\n1. first\n2. second");
    assert.equal(blocks.length, 2);
    assert.deepEqual([blocks[0]?.kind, blocks[1]?.kind], ["list", "list"]);
    const first = blocks[0] as unknown as { ordered: boolean; items: unknown[][] };
    const second = blocks[1] as unknown as { ordered: boolean; items: unknown[][] };
    assert.equal(first.ordered, false);
    assert.equal(first.items.length, 2);
    assert.equal(second.ordered, true);
    assert.equal(second.items.length, 2);
  });

  it("keeps fenced code blocks with language intact", () => {
    const blocks = parseMarkdownLite("before\n\n```ts\nconst x = 1;\n```\n\nafter");
    assert.deepEqual(blocks.map((block) => block.kind), ["paragraph", "code", "paragraph"]);
    const code = blocks[1] as unknown as { text: string; language?: string };
    assert.equal(code.language, "ts");
    assert.ok(code.text.includes("const x = 1;"));
  });

  it("leaves unmatched markers as plain text", () => {
    const spans = parseMarkdownLiteInline("a **broken and `x");
    assert.ok(spans.every((span) => span.kind === "text"));
  });
});

describe("live label sync + ranking (issue #122)", () => {
  it("derives scopes from board labels", () => {
    assert.equal(scopeOfLabel("state/1-wip"), "state");
    assert.equal(scopeOfLabel("no-scope"), null);
    assert.deepEqual(
      liveScopesFromIssues([
        { labels: ["state/1-wip", "priority/1-high"] },
        { labels: ["custom/x", "state/2-review"] },
      ]),
      ["state", "priority", "custom"],
    );
  });
  it("ranks SOS before backburner, triage before done", () => {
    const ranked = rankIssues([
      { labels: ["priority/4-backburner", "state/0-triage"], updatedAt: "2026-09-14T00:00:00Z" },
      { labels: ["priority/0-SOS", "state/0-triage"], updatedAt: "2026-09-14T00:00:00Z" },
      { labels: ["priority/0-SOS", "state/4-done"], updatedAt: "2026-09-14T00:00:00Z" },
    ]);
    assert.deepEqual(
      ranked.map((issue) => issue.labels[0]),
      ["priority/0-SOS", "priority/0-SOS", "priority/4-backburner"],
    );
    assert.equal(ranked[0].labels[1], "state/0-triage");
  });
  it("ships the paseo taxonomy as optional install data", () => {
    const set = paseoLabelSet();
    assert.ok(set.some((def) => def.name === "state/1-wip" && def.exclusive));
    assert.ok(set.some((def) => def.name === "attention/1-agent"));
    assert.deepEqual(paseoLabelScopes(), ["state", "priority", "attention", "spec"]);
  });
});

describe("optional label-set install planning (issue #121.3)", () => {
  const names = (labels: { name: string }[]) => labels.map((label) => label.name);

  it("merge creates every missing label and skips the ones present", () => {
    const plan = planLabelSetInstall(
      [{ id: 1, name: "state/1-wip" }, { id: 2, name: "bug" }],
      "merge",
    );
    assert.deepEqual(plan.remove, []);
    assert.ok(plan.skip.includes("state/1-wip"));
    assert.ok(names(plan.create).includes("state/0-triage"));
    assert.ok(names(plan.create).includes("spec/2-approved"));
    assert.ok(!names(plan.create).includes("state/1-wip"));
  });

  it("replace removes only conflicting labels in our scopes", () => {
    const plan = planLabelSetInstall(
      [
        { id: 5, name: "state/ready-for-review" },
        { id: 6, name: "state/1-wip" },
        { id: 7, name: "priority/urgent" },
        { id: 8, name: "bug" },
        { id: 9, name: "kind/feature" },
      ],
      "replace",
    );
    assert.deepEqual(
      plan.remove.map((label) => label.name).sort(),
      ["priority/urgent", "state/ready-for-review"],
    );
    // Our own already-present label is kept, not deleted and recreated.
    assert.ok(plan.skip.includes("state/1-wip"));
    // Unrelated scopes and unscoped labels are never touched.
    assert.ok(!plan.remove.some((label) => label.name === "bug"));
    assert.ok(!plan.remove.some((label) => label.name === "kind/feature"));
  });

  it("merge never deletes a foreign conflicting label", () => {
    const plan = planLabelSetInstall([{ id: 1, name: "state/ready-for-review" }], "merge");
    assert.deepEqual(plan.remove, []);
    assert.ok(names(plan.create).includes("state/1-wip"));
  });
});

describe("repo access state matrix (issue #152)", () => {
  const cases: Array<{
    name: string;
    input: {
      repoPublic: boolean | null;
      tokenPresent: boolean;
      tokenValid: boolean | null;
      repoWritePermission?: boolean | null;
    };
    visibility: string;
    auth: string;
    canEdit: boolean;
  }> = [
    {
      name: "public x no token",
      input: { repoPublic: true, tokenPresent: false, tokenValid: null },
      visibility: "public",
      auth: "anonymous",
      canEdit: false,
    },
    {
      name: "public x valid token (edits enabled)",
      input: { repoPublic: true, tokenPresent: true, tokenValid: true },
      visibility: "public",
      auth: "authenticated",
      canEdit: true,
    },
    {
      name: "public x invalid token",
      input: { repoPublic: true, tokenPresent: true, tokenValid: false },
      visibility: "public",
      auth: "invalid-token",
      canEdit: false,
    },
    {
      name: "private x no token",
      input: { repoPublic: false, tokenPresent: false, tokenValid: null },
      visibility: "private",
      auth: "anonymous",
      canEdit: false,
    },
    {
      name: "private x valid token",
      input: { repoPublic: false, tokenPresent: true, tokenValid: true },
      visibility: "private",
      auth: "authenticated",
      canEdit: true,
    },
    {
      name: "private x invalid token",
      input: { repoPublic: false, tokenPresent: true, tokenValid: false },
      visibility: "private",
      auth: "invalid-token",
      canEdit: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const access = deriveForgeAccess(testCase.input);
      assert.equal(access.visibility, testCase.visibility);
      assert.equal(access.auth, testCase.auth);
      assert.equal(access.canEdit, testCase.canEdit);
    });
  }

  it("enables edits for a public repo holding a valid token (the third state)", () => {
    const access = deriveForgeAccess({ repoPublic: true, tokenPresent: true, tokenValid: true });
    assert.equal(access.canEdit, true);
    assert.equal(access.visibilityLabel, "public");
    assert.equal(access.authLabel, "Authenticated");
    assert.equal(access.authVariant, "success");
  });

  it("keeps edit capability when visibility cannot be probed but the token is valid", () => {
    const access = deriveForgeAccess({ repoPublic: null, tokenPresent: true, tokenValid: true });
    assert.equal(access.visibility, "unknown");
    assert.equal(access.visibilityLabel, null);
    assert.equal(access.canEdit, true);
  });

  it("treats a present-but-unprobed token as unverified and read-only", () => {
    const access = deriveForgeAccess({ repoPublic: false, tokenPresent: true, tokenValid: null });
    assert.equal(access.auth, "unknown");
    assert.equal(access.canEdit, false);
    assert.equal(access.authVariant, "warning");
  });

  it("stays read-only with no probes at all", () => {
    const access = deriveForgeAccess();
    assert.equal(access.visibility, "unknown");
    assert.equal(access.auth, "anonymous");
    assert.equal(access.canEdit, false);
  });

  it("keeps chips and summary consistent for one derived state", () => {
    const access = deriveForgeAccess({ repoPublic: true, tokenPresent: true, tokenValid: false });
    assert.equal(access.visibilityLabel, "public");
    assert.equal(access.authLabel, "Token rejected");
    assert.equal(access.authVariant, "danger");
    assert.match(access.summary, /^Public repo/);
    assert.match(access.summary, /rejected/);
  });
});

describe("write capability derivation (issue #193)", () => {
  it("disables edits when a valid token cannot push, naming the scopes", () => {
    const access = deriveForgeAccess({
      repoPublic: true,
      tokenPresent: true,
      tokenValid: true,
      repoWritePermission: false,
    });
    assert.equal(access.auth, "lacks-write-scope");
    assert.equal(access.canEdit, false);
    assert.equal(access.authLabel, "Token lacks write scope");
    assert.equal(access.authVariant, "warning");
    assert.match(access.summary, /lacks write scope|cannot push/);
    assert.match(access.summary, /write:issue/);
    assert.equal(access.requiredScopes, "read:user, read:repository, write:issue");
  });

  it("enables edits for a valid token the repo reports as write-capable", () => {
    const access = deriveForgeAccess({
      repoPublic: false,
      tokenPresent: true,
      tokenValid: true,
      repoWritePermission: true,
    });
    assert.equal(access.auth, "authenticated");
    assert.equal(access.canEdit, true);
    assert.equal(access.authVariant, "success");
  });

  it("falls back to token validity when the host returns no permissions", () => {
    const access = deriveForgeAccess({
      repoPublic: true,
      tokenPresent: true,
      tokenValid: true,
      repoWritePermission: null,
    });
    assert.equal(access.auth, "authenticated");
    assert.equal(access.canEdit, true);
  });

  it("does not claim write scope for an anonymous or rejected token", () => {
    const anonymous = deriveForgeAccess({ repoPublic: true, tokenPresent: false });
    assert.equal(anonymous.auth, "anonymous");
    assert.equal(anonymous.canEdit, false);
    const rejected = deriveForgeAccess({
      repoPublic: true,
      tokenPresent: true,
      tokenValid: false,
      repoWritePermission: false,
    });
    assert.equal(rejected.auth, "invalid-token");
    assert.equal(rejected.canEdit, false);
  });
});

describe("forgeCapabilityFromRepo permission mapping (issue #193)", () => {
  it("maps Forgejo/GitHub permissions.push and permissions.admin", () => {
    assert.equal(forgeCapabilityFromRepo({ permissions: { push: true, admin: false } }), true);
    assert.equal(forgeCapabilityFromRepo({ permissions: { push: false, admin: true } }), true);
    assert.equal(forgeCapabilityFromRepo({ permissions: { push: false, admin: false } }), false);
  });

  it("maps GitLab access_level with Developer (30) as the write threshold", () => {
    assert.equal(forgeCapabilityFromRepo({ access_level: 40 }), true);
    assert.equal(forgeCapabilityFromRepo({ access_level: 30 }), true);
    assert.equal(forgeCapabilityFromRepo({ access_level: 20 }), false);
    assert.equal(forgeCapabilityFromRepo({ access_level: 10 }), false);
  });

  it("returns null when the payload carries no recognizable permission object", () => {
    assert.equal(forgeCapabilityFromRepo({ permissions: {} }), null);
    assert.equal(forgeCapabilityFromRepo({}), null);
    assert.equal(forgeCapabilityFromRepo(null), null);
    assert.equal(forgeCapabilityFromRepo("nope"), null);
  });

  it("exposes one scope list per forge family", () => {
    assert.equal(forgeWriteScopeList("forgejo"), "read:user, read:repository, write:issue");
    assert.ok(FORGE_WRITE_SCOPES.github.includes("repo"));
    assert.ok(FORGE_WRITE_SCOPES.gitlab.includes("api"));
  });
});

describe("extractBareForgeIssueUrls quoted-content guard (issue #143)", () => {
  const url = (n: number) => `https://${REAL_HOST}/other-org/other-repo/issues/${n}`;
  it("extracts bare prose links", () => {
    const links = extractBareForgeIssueUrls(`See ${url(33)} for details`);
    assert.deepEqual(links.map((link) => link.number), [33]);
  });
  it("skips markdown-linked URLs rendered inline by the card", () => {
    const links = extractBareForgeIssueUrls(`Pulse explore: [Issue #144 (forge.example.com)](${url(144)}) — done`);
    assert.deepEqual(links, []);
  });
  it("ignores fenced code blocks", () => {
    const links = extractBareForgeIssueUrls(`Example:\n\`\`\`\n${url(33)}\n\`\`\`\nDone`);
    assert.deepEqual(links, []);
  });
  it("ignores inline code spans", () => {
    const links = extractBareForgeIssueUrls(`Run \`${url(33)}\` to fetch`);
    assert.deepEqual(links, []);
  });
  it("keeps bare prose links next to tables and markdown links", () => {
    const links = extractBareForgeIssueUrls(
      `See ${url(42)} first\n\n| [#33](${url(33)}) | mirror readiness |\n`,
    );
    assert.deepEqual(links.map((link) => link.number), [42]);
  });
});

describe("extractForgeIssueUrls comment anchors (issue #154)", () => {
  const url = (n: number) => `https://${REAL_HOST}/your-org/your-repo/issues/${n}`;

  it("keeps the #issuecomment anchor in the url and exposes its id", () => {
    const links = extractBareForgeIssueUrls(`See ${url(152)}#issuecomment-99001 for details`);
    assert.equal(links.length, 1);
    assert.equal(links[0].number, 152);
    assert.equal(links[0].commentId, 99001);
    assert.ok(links[0].url.endsWith("#issuecomment-99001"));
  });

  it("leaves non-anchored urls unchanged without a commentId", () => {
    const links = extractBareForgeIssueUrls(`See ${url(152)} for details`);
    assert.equal(links.length, 1);
    assert.equal(links[0].url, url(152));
    assert.equal(links[0].commentId, undefined);
  });

  it("populates the anchor through the non-bare extractor too", () => {
    const links = extractForgeIssueUrls(`${url(152)}#issuecomment-99001`);
    assert.equal(links[0].commentId, 99001);
    assert.equal(links[0].url, `${url(152)}#issuecomment-99001`);
  });

  it("still skips markdown-linked anchored urls as bare rows", () => {
    const links = extractBareForgeIssueUrls(`[comment](${url(152)}#issuecomment-99001)`);
    assert.deepEqual(links, []);
  });
});

describe("cross-repo link classification (issue #108)", () => {
  const active = { host: REAL_HOST, repo: "your-org/your-repo" };
  const link = (host: string, owner: string, repo: string) => ({ host, owner, repo });
  const urlFor = (n: number) => `https://${REAL_HOST}/your-org/your-repo/issues/${n}`;

  it("marks a link local when host and owner/repo match the active forge", () => {
    assert.equal(classifyForgeLink(link(REAL_HOST, "your-org", "your-repo"), active), "local");
  });

  it("marks a different repo on the same host foreign (foreign-by-repo)", () => {
    assert.equal(classifyForgeLink(link(REAL_HOST, "other-org", "other-repo"), active), "foreign");
  });

  it("marks the same repo on a different host foreign (foreign-by-host)", () => {
    assert.equal(classifyForgeLink(link("codeberg.org", "your-org", "your-repo"), active), "foreign");
  });

  it("marks an unknown host foreign even when the repo path matches", () => {
    assert.equal(classifyForgeLink(link("unknown.forge", "your-org", "your-repo"), active), "foreign");
  });

  it("treats an unresolvable active target as foreign rather than local", () => {
    assert.equal(classifyForgeLink(link(REAL_HOST, "your-org", "your-repo"), null), "foreign");
    assert.equal(
      classifyForgeLink(link(REAL_HOST, "your-org", "your-repo"), { host: null, repo: null }),
      "foreign",
    );
    assert.equal(classifyForgeLink(link(REAL_HOST, "your-org", "your-repo"), { repo: "your-org/your-repo" }), "foreign");
  });

  it("matches host and repo case-insensitively and ignores a host port", () => {
    assert.equal(classifyForgeLink(link(REAL_HOST.toUpperCase(), "YOUR-ORG", "Your-Repo"), active), "local");
    assert.equal(
      classifyForgeLink(link(REAL_HOST, "your-org", "your-repo"), { host: `${REAL_HOST}:3000`, repo: "your-org/your-repo" }),
      "local",
    );
  });

  it("reuses the extraction, comment anchor and all, without regressing commentId", () => {
    const anchored = forgeIssueLinkFromUrl(`${urlFor(152)}#issuecomment-99001`);
    assert.ok(anchored);
    assert.equal(anchored.commentId, 99001);
    assert.equal(anchored.url, `${urlFor(152)}#issuecomment-99001`);
    assert.equal(classifyForgeLink(anchored, active), "local");
  });

  it("classifies URLs and leaves non-issue URLs unmarked", () => {
    assert.equal(classifyForgeUrl(urlFor(152), active), "local");
    assert.equal(classifyForgeUrl(`https://codeberg.org/other-org/other-repo/issues/9`, active), "foreign");
    assert.equal(classifyForgeUrl("https://forge.example.com/owner/repo/pulls/7", active), null);
    assert.equal(classifyForgeUrl("https://example.com/docs", active), null);
    assert.equal(classifyForgeUrl(undefined, active), null);
  });
});

describe("composer pill label (issue #162)", () => {
  it("shows the workspace display name while the count is unknown", () => {
    assert.equal(forgePillLabel({ displayName: "tea", count: null }), "tea");
    assert.equal(forgePillLabel({ displayName: "tea" }), "tea");
  });

  it("shows name · count once the count resolves", () => {
    assert.equal(forgePillLabel({ displayName: "tea", count: 3 }), "tea · 3");
    assert.equal(forgePillLabel({ displayName: "tea", count: 1 }), "tea · 1");
  });

  it("falls back to the bare count without a display name", () => {
    assert.equal(forgePillLabel({ count: 1 }), "1 issue");
    assert.equal(forgePillLabel({ count: 4 }), "4 issues");
  });

  it("never emits the old 'iss' placeholder", () => {
    for (const input of [{}, { count: null }, { displayName: "" }, { displayName: "   " }]) {
      assert.equal(forgePillLabel(input), "...");
      assert.notEqual(forgePillLabel(input), "iss");
    }
  });

  it("renders an ellipsis while the first fetch is in flight", () => {
    assert.equal(forgePillLabel({ displayName: "tea", count: 3, loading: true }), "...");
  });
});

describe("forge pill label resolver (issue #162)", () => {
  const WORKSPACE_ID = "ws-1";
  const DIRECTORY = "/home/dev/tea";
  const ROOT = "/home/dev/tea";

  interface RuntimeStub {
    settings?: unknown;
    issues?: unknown;
    issuesError?: Error;
    now?: () => number;
    rpcCalls?: { settings: number; issues: number };
  }

  function runtimeFor(stub: RuntimeStub = {}): ForgePillRuntime {
    const calls = stub.rpcCalls ?? { settings: 0, issues: 0 };
    return {
      now: stub.now,
      resolveWorkspace: async (workspaceId) =>
        workspaceId === WORKSPACE_ID ? { directory: DIRECTORY, projectRootPath: ROOT } : null,
      rpc: async (contract) => {
        if (contract === forgeSettingsContract.get) {
          calls.settings += 1;
          return stub.settings ?? { namesByDirectory: { [ROOT]: "tea" } };
        }
        if (contract === openIssuesContract) {
          calls.issues += 1;
          if (stub.issuesError) throw stub.issuesError;
          return (
            stub.issues ?? {
              repo: "org/tea",
              issues: [],
              openIssueCount: 3,
              error: undefined,
            }
          );
        }
        throw new Error("unexpected contract");
      },
    };
  }

  it("resolves name · count without any modal or React mount", async () => {
    const resolver = createForgeLabelResolver(runtimeFor());
    assert.equal(await resolver.resolve({ agentId: "agent-1", workspaceId: WORKSPACE_ID }), "tea · 3");
  });

  it("falls back to the stored display name when the count is unknown, never 'iss'", async () => {
    const resolver = createForgeLabelResolver(
      runtimeFor({
        issues: { repo: "org/tea", issues: [], openIssueCount: null, error: "forge unreachable" },
      }),
    );
    const label = await resolver.resolve({ agentId: "agent-1", workspaceId: WORKSPACE_ID });
    assert.equal(label, "tea");
    assert.notEqual(label, "iss");
  });

  it("uses the ellipsis when nothing resolves, never 'iss'", async () => {
    const resolver = createForgeLabelResolver(
      runtimeFor({
        settings: { namesByDirectory: {} },
        issues: { repo: null, issues: [], openIssueCount: null, error: "forge unreachable" },
      }),
    );
    const label = await resolver.resolve({ agentId: "agent-1", workspaceId: WORKSPACE_ID });
    assert.equal(label, "...");
    assert.notEqual(label, "iss");
  });

  it("keeps a cached count within the TTL and refetches once it ages out", async () => {
    let clock = 1_000;
    const calls = { settings: 0, issues: 0 };
    const resolver = createForgeLabelResolver(runtimeFor({ rpcCalls: calls, now: () => clock }));
    await resolver.resolve({ agentId: "agent-1", workspaceId: WORKSPACE_ID });
    assert.equal(calls.issues, 1);

    clock += 5_000;
    await resolver.resolve({ agentId: "agent-2", workspaceId: WORKSPACE_ID });
    assert.equal(calls.issues, 1, "a second agent on the same workspace reuses the cached count");

    clock += 30_000;
    await resolver.resolve({ agentId: "agent-1", workspaceId: WORKSPACE_ID });
    assert.equal(calls.issues, 2, "the count refetches after the TTL");
  });

  it("shares one settings fetch across agents", async () => {
    const calls = { settings: 0, issues: 0 };
    const resolver = createForgeLabelResolver(runtimeFor({ rpcCalls: calls }));
    await resolver.resolve({ agentId: "agent-1", workspaceId: WORKSPACE_ID });
    await resolver.resolve({ agentId: "agent-2", workspaceId: WORKSPACE_ID });
    assert.equal(calls.settings, 1);
  });
});

describe("live remote search contract (issue #139)", () => {
  it("registers under the generic forge.* namespace with query defaulting a page", () => {
    assert.equal(searchIssuesContract.name, "forge.search-issues");
    const parsed = SearchIssuesInputSchema.parse({ query: "crash" });
    assert.equal(parsed.query, "crash");
    assert.equal(parsed.page, 1);
    assert.throws(() => SearchIssuesInputSchema.parse({}));
  });
});

describe("createRemoteSearchGate", () => {
  it("accepts only the newest generation", () => {
    const gate = createRemoteSearchGate();
    const first = gate.begin();
    const second = gate.begin();
    assert.equal(gate.accept(first), false);
    assert.equal(gate.accept(second), true);
  });

  it("lets the initial generation through", () => {
    const gate = createRemoteSearchGate();
    assert.equal(gate.accept(gate.begin()), true);
  });
});

describe("issueMatchesQuery", () => {
  const issue: ForgeIssue = {
    number: 190,
    title: "Meta issue tracker",
    state: "open",
    labels: ["state/1-wip"],
    labelDetails: [],
  };

  it("matches numbers by prefix and titles/labels by substring", () => {
    assert.equal(issueMatchesQuery(issue, "#19"), true);
    assert.equal(issueMatchesQuery(issue, "190"), true);
    assert.equal(issueMatchesQuery(issue, "tracker"), true);
    assert.equal(issueMatchesQuery(issue, "state/1"), true);
    assert.equal(issueMatchesQuery(issue, "absent"), false);
  });

  it("strips surrounding quotes so quoted and unquoted queries filter identically", () => {
    for (const quoted of ['"meta"', "'meta'", '  "meta"  ', '""meta""']) {
      assert.equal(issueMatchesQuery(issue, quoted), issueMatchesQuery(issue, "meta"), quoted);
    }
    assert.equal(issueMatchesQuery(issue, '"meta"'), true);
    assert.equal(issueMatchesQuery(issue, "'tracker'"), true);
    // Stripping quotes must not make a genuinely absent term match.
    assert.equal(issueMatchesQuery(issue, '"nope"'), false);
  });

  it("matches every issue for an empty or quote-only query", () => {
    assert.equal(issueMatchesQuery(issue, ""), true);
    assert.equal(issueMatchesQuery(issue, '""'), true);
  });
});

describe("resolveIssueSearchLayer", () => {
  const issue = (number: number): ForgeIssue => ({
    number,
    title: `issue ${number}`,
    state: "open",
    labels: [],
    labelDetails: [],
  });
  const clientIssues = [issue(1)];
  const remoteIssues = [issue(2)];

  it("renders the instant client filter while no current remote result exists", () => {
    assert.deepEqual(
      resolveIssueSearchLayer({
        query: "ab",
        remoteEnabled: true,
        remoteQuery: null,
        remoteIssues: null,
        remoteError: null,
        clientIssues,
      }),
      { issues: clientIssues, source: "client" },
    );
  });

  it("renders the remote list once it matches the active query", () => {
    assert.deepEqual(
      resolveIssueSearchLayer({
        query: "ab",
        remoteEnabled: true,
        remoteQuery: "ab",
        remoteIssues,
        remoteError: null,
        clientIssues,
      }),
      { issues: remoteIssues, source: "remote" },
    );
  });

  it("discards a stale remote result from an earlier keystroke", () => {
    assert.deepEqual(
      resolveIssueSearchLayer({
        query: "abc",
        remoteEnabled: true,
        remoteQuery: "ab",
        remoteIssues,
        remoteError: null,
        clientIssues,
      }),
      { issues: clientIssues, source: "client" },
    );
  });

  it("never renders remote results for a failed search or with the toggle off", () => {
    const failed = resolveIssueSearchLayer({
      query: "ab",
      remoteEnabled: true,
      remoteQuery: "ab",
      remoteIssues,
      remoteError: "forge unreachable",
      clientIssues,
    });
    assert.equal(failed.source, "client");
    const disabled = resolveIssueSearchLayer({
      query: "ab",
      remoteEnabled: false,
      remoteQuery: "ab",
      remoteIssues,
      remoteError: null,
      clientIssues,
    });
    assert.equal(disabled.source, "client");
  });
});

describe("label color metadata (issue #182)", () => {
  it("preserves name/color/description and the names view", () => {
    const parsed = ForgeIssueSchema.parse({
      number: 7,
      title: "chips",
      state: "open",
      labels: ["state/1-wip", "priority/1-high"],
      labelDetails: [
        { name: "state/1-wip", color: "e11d48", description: "In progress" },
        { name: "priority/1-high", color: "d93f0b" },
      ],
    });
    assert.deepEqual(parsed.labels, ["state/1-wip", "priority/1-high"]);
    assert.deepEqual(parsed.labelDetails[0], {
      name: "state/1-wip",
      color: "e11d48",
      description: "In progress",
    });
    assert.equal(parsed.labelDetails[1].color, "d93f0b");
  });

  it("defaults labelDetails to empty when an older payload omits it", () => {
    const parsed = ForgeIssueSchema.parse({
      number: 8,
      title: "no metadata",
      state: "open",
      labels: ["kind/bug"],
    });
    assert.deepEqual(parsed.labelDetails, []);
    assert.deepEqual(parsed.labels, ["kind/bug"]);
  });

  it("normalizes hex colors with and without the leading hash", () => {
    assert.equal(normalizeLabelColor("e11d48"), "#e11d48");
    assert.equal(normalizeLabelColor("#E11D48"), "#e11d48");
    assert.equal(normalizeLabelColor("0f0"), "#00ff00");
  });

  it("returns null for missing or malformed colors", () => {
    assert.equal(normalizeLabelColor(undefined), null);
    assert.equal(normalizeLabelColor(""), null);
    assert.equal(normalizeLabelColor("not-a-color"), null);
    assert.equal(normalizeLabelColor("12345"), null);
  });

  it("picks black text on light backgrounds and white on dark ones", () => {
    assert.equal(labelTextColor("ffffff"), "#000000");
    assert.equal(labelTextColor("f9d0c4"), "#000000");
    assert.equal(labelTextColor("000000"), "#ffffff");
    assert.equal(labelTextColor("1d76db"), "#ffffff");
  });

  it("has no text color without a usable background", () => {
    assert.equal(labelTextColor(undefined), null);
    assert.equal(labelTextColor("nope"), null);
  });

  it("splits scoped label names on the first slash", () => {
    assert.deepEqual(splitScopedLabel("attention/2-user"), {
      scope: "attention",
      value: "2-user",
    });
    assert.deepEqual(splitScopedLabel("scope/sub/item"), {
      scope: "scope",
      value: "sub/item",
    });
  });

  it("treats unscoped and edge-slash names as unscoped", () => {
    assert.equal(splitScopedLabel("kind"), null);
    assert.equal(splitScopedLabel("trailing/"), null);
    assert.equal(splitScopedLabel("/leading"), null);
    assert.equal(splitScopedLabel(""), null);
  });

  it("derives Forgejo's darker scope shade from the label color", () => {
    assert.equal(darkenLabelColor("b60205"), "#a50205");
    assert.equal(darkenLabelColor("1d76db"), "#1b70cf");
    assert.equal(darkenLabelColor("#FFFFFF"), "#ebebeb");
  });

  it("keeps the darkened shade bounded and null without a usable color", () => {
    // Pure black cannot darken; the factor clamps to zero rather than NaN.
    assert.equal(darkenLabelColor("000000"), "#000000");
    assert.equal(darkenLabelColor(undefined), null);
    assert.equal(darkenLabelColor("nope"), null);
  });

  it("plans a two-tone pill for a scoped label with a usable color", () => {
    assert.deepEqual(planLabelChip({ name: "attention/2-user", color: "b60205" }), {
      kind: "scoped",
      scope: { text: "attention", background: "#a50205", textColor: "#ffffff" },
      value: { text: "2-user", background: "#b60205", textColor: "#ffffff" },
    });
  });

  it("splits scoped names unconditionally, with or without a usable color", () => {
    assert.deepEqual(planLabelChip({ name: "state/3-verify" }), {
      kind: "scoped",
      scope: { text: "state" },
      value: { text: "3-verify" },
    });
    assert.deepEqual(planLabelChip({ name: "state/3-verify", color: "nope" }), {
      kind: "scoped",
      scope: { text: "state" },
      value: { text: "3-verify" },
    });
  });

  it("plans a single solid pill for an unscoped label", () => {
    assert.deepEqual(planLabelChip({ name: "bug", color: "f9d0c4" }), {
      kind: "single",
      half: { text: "bug", background: "#f9d0c4", textColor: "#000000" },
    });
  });

  it("falls back to the neutral chip without a usable color", () => {
    assert.deepEqual(planLabelChip({ name: "bug" }), {
      kind: "single",
      half: { text: "bug" },
    });
    assert.deepEqual(planLabelChip({ name: "bug", color: "nope" }), {
      kind: "single",
      half: { text: "bug" },
    });
  });

  it("compacts a chip half so scoped labels share a wrap line", () => {
    assert.equal(LABEL_VALUE_MAX_LENGTH, 10);
    assert.equal(compactLabelValue("0-orchestrator"), "0-orchest…");
    assert.equal(compactLabelValue("4-backburner"), "4-backbur…");
    // A value at or under the cap passes through untouched.
    assert.equal(compactLabelValue("1-wip"), "1-wip");
    assert.equal(compactLabelValue(""), "");
  });

  it("ellipsizes the value half while the scope half stays whole", () => {
    assert.deepEqual(planLabelChip({ name: "attention/0-orchestrator", color: "b60205" }), {
      kind: "scoped",
      scope: { text: "attention", background: "#a50205", textColor: "#ffffff" },
      value: { text: "0-orchest…", background: "#b60205", textColor: "#ffffff" },
    });
  });

  it("compacts a long unscoped name as a single pill", () => {
    assert.deepEqual(planLabelChip({ name: "needs-reproduction" }), {
      kind: "single",
      half: { text: "needs-rep…" },
    });
  });

  it("never leaves a slash in a planned pill", () => {
    for (const name of ["state/3-verify", "attention/2-user", "kind"]) {
      const plan = planLabelChip({ name });
      const halves = plan.kind === "scoped" ? [plan.scope, plan.value] : [plan.half];
      for (const half of halves) {
        assert.ok(!half.text.includes("/"), `${name} planned a raw slash segment`);
      }
    }
  });
});

// The pill module is the single render path: every label surface routes through
// LabelChip/LabelChipList, and no site splits or prints a raw label name.
describe("label render path", () => {
  const clientDir = [
    join(process.cwd(), "client"),
    join(process.cwd(), "plugins", "forges", "client"),
  ].find((dir) => existsSync(dir));
  assert.ok(clientDir, "forges client directory not found");
  const sources = new Map(
    readdirSync(clientDir)
      .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
      .map((file) => [file, readFileSync(join(clientDir, file), "utf8")]),
  );

  it("splits scoped names only inside the pill module", () => {
    for (const [file, source] of sources) {
      if (file === "label-chip.tsx") continue;
      assert.doesNotMatch(source, /splitScopedLabel/, `${file} splits labels itself`);
    }
  });

  it("routes every label list through LabelChip", () => {
    for (const file of ["issues-pill.tsx", "board-alert.tsx"]) {
      assert.match(sources.get(file) ?? "", /LabelChip/, `${file} must render labels via LabelChip`);
    }
  });

  it("never renders a raw label name", () => {
    for (const [file, source] of sources) {
      assert.doesNotMatch(source, />\s*\{label\.name\}\s*</, `${file} renders a raw label name`);
      assert.doesNotMatch(
        source,
        /<Badge[^>]*label=\{[^}]*label\.name[^}]*\}/,
        `${file} badges a raw label name`,
      );
    }
  });
});

describe("create issue contract + validation (issue #200)", () => {
  it("requires a non-empty title", () => {
    assert.equal(validateCreateIssueInput({}), "Issue title must not be empty");
    assert.equal(validateCreateIssueInput({ title: "" }), "Issue title must not be empty");
    assert.equal(validateCreateIssueInput({ title: "   " }), "Issue title must not be empty");
  });

  it("accepts a title with an optional body and labels", () => {
    assert.equal(validateCreateIssueInput({ title: "Add ticket path" }), null);
    assert.equal(
      validateCreateIssueInput({ title: "Add ticket path", body: "why", labels: ["kind/feature"] }),
      null,
    );
  });

  it("rejects an over-long title/body and malformed labels", () => {
    assert.equal(validateCreateIssueInput({ title: "x".repeat(201) }), "Issue title is too long");
    assert.equal(
      validateCreateIssueInput({ title: "ok", body: "x".repeat(10001) }),
      "Issue description is too long",
    );
    assert.equal(validateCreateIssueInput({ title: "ok", labels: [""] }), "Label must not be empty");
    assert.equal(validateCreateIssueInput({ title: "ok", labels: "kind" }), "Labels must be a list");
  });

  it("parses the composer's free-text labels into clean, unique names", () => {
    assert.deepEqual(parseLabelList("kind/feature, target/forges"), ["kind/feature", "target/forges"]);
    assert.deepEqual(parseLabelList(" a ,, a , b "), ["a", "b"]);
    assert.deepEqual(parseLabelList(""), []);
    assert.deepEqual(parseLabelList(null), []);
  });

  it("registers the write verb under the forge namespace", () => {
    assert.equal(createIssueContract.name, "forge.create-issue");
  });
});

describe("create issue gate (issue #200)", () => {
  it("enables the composer only for an accepted, write-scoped token", () => {
    const editable = deriveForgeAccess({ repoPublic: true, tokenPresent: true, tokenValid: true });
    assert.equal(editable.canEdit, true);
    const readOnly = deriveForgeAccess({
      repoPublic: true,
      tokenPresent: true,
      tokenValid: true,
      repoWritePermission: false,
    });
    assert.equal(readOnly.canEdit, false);
    const anonymous = deriveForgeAccess({ repoPublic: true, tokenPresent: false });
    assert.equal(anonymous.canEdit, false);
  });

  it("shows the #193 scope hint for an under-scoped token instead of an opaque failure", () => {
    const access = deriveForgeAccess({
      repoPublic: true,
      tokenPresent: true,
      tokenValid: true,
      repoWritePermission: false,
    });
    const notice = writeGateNotice(access, "creating issues");
    assert.match(notice, /lacks write scope/);
    assert.match(notice, /write:issue/);
    assert.match(notice, /creating issues/);
  });

  it("falls back to the access summary for every other read-only state", () => {
    const anonymous = deriveForgeAccess({ repoPublic: true, tokenPresent: false });
    assert.match(writeGateNotice(anonymous, "creating issues"), /No token saved/);
  });
});
