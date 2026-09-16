import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { activeForgeForDirectory, deriveForgejoAccess, extractBareForgejoIssueUrls, extractForgejoIssueUrls, forgeTargetsForWorkspace, isBoardAlertText, isValidForgeTarget, liveScopesFromIssues, parseBoardAlert, parseForgejoRemote, parseMarkdownLite, parseMarkdownLiteInline, paseoLabelSet, rankIssues, resolveForgejoRepo, resolveForgeTarget, scopeOfLabel } from "./issues.ts";

const ALIAS_REMOTE = "mrs-forge:xpufx/paseo.git";
const REAL_HOST = "forge.mrs.aager.de";

describe("parseForgejoRemote accepted forms", () => {
  it("parses scp-like SSH-alias remotes", () => {
    assert.deepEqual(parseForgejoRemote(ALIAS_REMOTE), {
      host: "mrs-forge",
      owner: "xpufx",
      repo: "paseo",
    });
  });

  it("parses full ssh:// URLs", () => {
    assert.deepEqual(parseForgejoRemote(`ssh://git@${REAL_HOST}:222/xpufx/paseo.git`), {
      host: REAL_HOST,
      owner: "xpufx",
      repo: "paseo",
    });
  });

  it("parses https URLs", () => {
    assert.deepEqual(parseForgejoRemote(`https://${REAL_HOST}/xpufx/paseo.git`), {
      host: REAL_HOST,
      owner: "xpufx",
      repo: "paseo",
    });
  });

  it("rejects garbage input", () => {
    assert.equal(parseForgejoRemote(null), null);
    assert.equal(parseForgejoRemote(""), null);
    assert.equal(parseForgejoRemote("not-a-remote"), null);
  });
});

describe("resolveForgejoRepo precedence", () => {
  it("explicit full URL beats the git remote", () => {
    assert.deepEqual(
      resolveForgejoRepo(`https://${REAL_HOST}/xpufx/paseo.git`, ALIAS_REMOTE),
      { host: REAL_HOST, repo: "xpufx/paseo" },
    );
  });

  it("explicit scp-like URL beats the git remote", () => {
    assert.deepEqual(
      resolveForgejoRepo("git@forge.example.com:other/project.git", ALIAS_REMOTE),
      { host: "forge.example.com", repo: "other/project" },
    );
  });

  it("explicit bare owner/repo borrows the git-remote host", () => {
    assert.deepEqual(resolveForgejoRepo("xpufx/paseo", ALIAS_REMOTE), {
      host: "mrs-forge",
      repo: "xpufx/paseo",
    });
  });

  it("falls back to the git remote when no explicit value", () => {
    assert.deepEqual(resolveForgejoRepo(undefined, ALIAS_REMOTE), {
      host: "mrs-forge",
      repo: "xpufx/paseo",
    });
    assert.deepEqual(resolveForgejoRepo("  ", ALIAS_REMOTE), {
      host: "mrs-forge",
      repo: "xpufx/paseo",
    });
  });

  it("explicit wins even without a git remote", () => {
    assert.deepEqual(
      resolveForgejoRepo(`https://${REAL_HOST}/xpufx/paseo`, null),
      { host: REAL_HOST, repo: "xpufx/paseo" },
    );
  });

  it("returns null when nothing resolves", () => {
    assert.equal(resolveForgejoRepo(null, null), null);
    assert.equal(resolveForgejoRepo("garbage!!!", undefined), null);
    assert.equal(resolveForgejoRepo("xpufx/paseo", null), null);
  });
});

describe("multi-forge selection (issue #137)", () => {
  const DIR = "/work/paseo";
  const codeberg = "https://codeberg.org/xpufx/paseo";
  const forge = `https://${REAL_HOST}/xpufx/paseo`;

  it("lists configured targets plus the legacy remote, deduped and trimmed", () => {
    assert.deepEqual(
      forgeTargetsForWorkspace(
        {
          forgesByDirectory: { [DIR]: [codeberg, codeberg, "  xpufx/other  "] },
          remotesByDirectory: { [DIR]: forge },
        },
        DIR,
      ),
      [codeberg, "xpufx/other", forge],
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
      repo: "xpufx/paseo",
      source: "explicit",
    });
    assert.deepEqual(resolveForgeTarget("xpufx/paseo", ALIAS_REMOTE), {
      ok: true,
      host: "mrs-forge",
      repo: "xpufx/paseo",
      source: "explicit",
    });
  });

  it("never silently derives past an invalid explicit selection", () => {
    const resolved = resolveForgeTarget("garbage!!!", ALIAS_REMOTE);
    assert.equal(resolved.ok, false);
    assert.match((resolved as { error: string }).error, /not a valid forge remote/);
    const bareWithoutHost = resolveForgeTarget("xpufx/paseo", null);
    assert.equal(bareWithoutHost.ok, false);
  });

  it("only derives from git when nothing is explicitly selected", () => {
    assert.deepEqual(resolveForgeTarget(undefined, ALIAS_REMOTE), {
      ok: true,
      host: "mrs-forge",
      repo: "xpufx/paseo",
      source: "derived",
    });
    assert.deepEqual(resolveForgeTarget("  ", ALIAS_REMOTE), {
      ok: true,
      host: "mrs-forge",
      repo: "xpufx/paseo",
      source: "derived",
    });
    const nothing = resolveForgeTarget(null, null);
    assert.equal(nothing.ok, false);
  });

  it("validates forge targets (remote URL or bare owner/repo)", () => {
    assert.equal(isValidForgeTarget(codeberg), true);
    assert.equal(isValidForgeTarget("xpufx/paseo"), true);
    assert.equal(isValidForgeTarget("git@codeberg.org:xpufx/paseo.git"), true);
    assert.equal(isValidForgeTarget("garbage!!!"), false);
    assert.equal(isValidForgeTarget(""), false);
    assert.equal(isValidForgeTarget(undefined), false);
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
  });
});

describe("repo access state matrix (issue #152)", () => {
  const cases: Array<{
    name: string;
    input: { repoPublic: boolean | null; tokenPresent: boolean; tokenValid: boolean | null };
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
      const access = deriveForgejoAccess(testCase.input);
      assert.equal(access.visibility, testCase.visibility);
      assert.equal(access.auth, testCase.auth);
      assert.equal(access.canEdit, testCase.canEdit);
    });
  }

  it("enables edits for a public repo holding a valid token (the third state)", () => {
    const access = deriveForgejoAccess({ repoPublic: true, tokenPresent: true, tokenValid: true });
    assert.equal(access.canEdit, true);
    assert.equal(access.visibilityLabel, "public");
    assert.equal(access.authLabel, "Authenticated");
    assert.equal(access.authVariant, "success");
  });

  it("keeps edit capability when visibility cannot be probed but the token is valid", () => {
    const access = deriveForgejoAccess({ repoPublic: null, tokenPresent: true, tokenValid: true });
    assert.equal(access.visibility, "unknown");
    assert.equal(access.visibilityLabel, null);
    assert.equal(access.canEdit, true);
  });

  it("treats a present-but-unprobed token as unverified and read-only", () => {
    const access = deriveForgejoAccess({ repoPublic: false, tokenPresent: true, tokenValid: null });
    assert.equal(access.auth, "unknown");
    assert.equal(access.canEdit, false);
    assert.equal(access.authVariant, "warning");
  });

  it("stays read-only with no probes at all", () => {
    const access = deriveForgejoAccess();
    assert.equal(access.visibility, "unknown");
    assert.equal(access.auth, "anonymous");
    assert.equal(access.canEdit, false);
  });

  it("keeps chips and summary consistent for one derived state", () => {
    const access = deriveForgejoAccess({ repoPublic: true, tokenPresent: true, tokenValid: false });
    assert.equal(access.visibilityLabel, "public");
    assert.equal(access.authLabel, "Token rejected");
    assert.equal(access.authVariant, "danger");
    assert.match(access.summary, /^Public repo/);
    assert.match(access.summary, /rejected/);
  });
});

describe("extractBareForgejoIssueUrls quoted-content guard (issue #143)", () => {
  const url = (n: number) => `https://${REAL_HOST}/oktay/2fado/issues/${n}`;
  it("extracts bare prose links", () => {
    const links = extractBareForgejoIssueUrls(`See ${url(33)} for details`);
    assert.deepEqual(links.map((link) => link.number), [33]);
  });
  it("skips markdown-linked URLs rendered inline by the card", () => {
    const links = extractBareForgejoIssueUrls(`Pulse explore: [Issue #144 (forge.mrs)](${url(144)}) — done`);
    assert.deepEqual(links, []);
  });
  it("ignores fenced code blocks", () => {
    const links = extractBareForgejoIssueUrls(`Example:\n\`\`\`\n${url(33)}\n\`\`\`\nDone`);
    assert.deepEqual(links, []);
  });
  it("ignores inline code spans", () => {
    const links = extractBareForgejoIssueUrls(`Run \`${url(33)}\` to fetch`);
    assert.deepEqual(links, []);
  });
  it("keeps bare prose links next to tables and markdown links", () => {
    const links = extractBareForgejoIssueUrls(
      `See ${url(42)} first\n\n| [#33](${url(33)}) | mirror readiness |\n`,
    );
    assert.deepEqual(links.map((link) => link.number), [42]);
  });
});

describe("extractForgejoIssueUrls comment anchors (issue #154)", () => {
  const url = (n: number) => `https://${REAL_HOST}/xpufx/paseo/issues/${n}`;

  it("keeps the #issuecomment anchor in the url and exposes its id", () => {
    const links = extractBareForgejoIssueUrls(`See ${url(152)}#issuecomment-99001 for details`);
    assert.equal(links.length, 1);
    assert.equal(links[0].number, 152);
    assert.equal(links[0].commentId, 99001);
    assert.ok(links[0].url.endsWith("#issuecomment-99001"));
  });

  it("leaves non-anchored urls unchanged without a commentId", () => {
    const links = extractBareForgejoIssueUrls(`See ${url(152)} for details`);
    assert.equal(links.length, 1);
    assert.equal(links[0].url, url(152));
    assert.equal(links[0].commentId, undefined);
  });

  it("populates the anchor through the non-bare extractor too", () => {
    const links = extractForgejoIssueUrls(`${url(152)}#issuecomment-99001`);
    assert.equal(links[0].commentId, 99001);
    assert.equal(links[0].url, `${url(152)}#issuecomment-99001`);
  });

  it("still skips markdown-linked anchored urls as bare rows", () => {
    const links = extractBareForgejoIssueUrls(`[comment](${url(152)}#issuecomment-99001)`);
    assert.deepEqual(links, []);
  });
});
