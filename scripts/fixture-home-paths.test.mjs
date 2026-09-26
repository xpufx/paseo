/**
 * The authoring-time half of the PII story (#627).
 *
 * The preflight answers "is this safe to publish". It is a backstop, it works,
 * and it is not what this file is: it fires on main, in a red job, an hour after
 * the merge, and its pattern list is a short set of names somebody remembered
 * to add. Neither shape is a problem for that gate -- a gate that runs late and
 * knows a few names is still a gate -- but neither can tell you, at the moment
 * you are writing a fixture, that the worktree path you just pasted off your
 * own terminal is your own worktree path.
 *
 * That is the question this suite answers instead, and the reason it exists is
 * in #624's postmortem: the pre-flight for that leak reviewed diff scope, both
 * test counts and the tarball contents, confirmed the unrelated surface file
 * was untouched, and missed the path, because the check that would have caught
 * it had been run once earlier in the session on a different PR and not
 * repeated. A check you demonstrably forget once needs automating.
 *
 * So this is deliberately the cheap one, and deliberately earlier:
 *
 *   - it runs in `npm test`, not only in CI, so it fires before the commit
 *     rather than after the merge;
 *   - it needs no network, no cross-repo checkout and no private pattern file,
 *     because it carries no literal: the rule is structural (a home path under
 *     either root whose segment is not a recognised generic placeholder), so it
 *     behaves identically on every developer's machine and in CI, where the home
 *     path in question is not this one;
 *   - it names the file, the line and the offending path, because a guard that
 *     says only "something is wrong somewhere" is one nobody trusts the second
 *     time it fires.
 *
 * It is not a replacement for the preflight and must never be used as one. The
 * two tripwires at the bottom of this file keep the preflight wired and
 * fail-closed, and keep this check wired into the suite, because the failure mode
 * of a redundant guard is not that it misses a leak -- it is that somebody
 * deletes the slower one and then this one quietly stops running.
 *
 * Scope is test and fixture files, not the published tree. A committed fixture
 * is where a real path gets pasted, and it is the only such file the author can
 * fix by editing one line. The reasoning is spelled out in
 * scripts/lib/fixture-home-paths.mjs; the short version is that a second PII
 * rule reading the same paths as the preflight, with different wording, is a
 * rule that trains people to disable it.
 *
 * This file is itself in the guard's scope, so the sample paths below are
 * assembled from a split root prefix rather than written out -- a literal
 * real-looking path in the suite that proves the guard fires would be found by
 * the guard, which is the right answer and an unhelpful place to learn it. This
 * is the same trick worktree-install's client/render.test.ts uses for its own
 * preflight check, and it means nothing is exempt, this file included. Account
 * names are written literally: a bare name is not a home path, only a name
 * following a home root is.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GENERIC_HOME_SEGMENTS,
  describeFinding,
  findRealHomePaths,
  fixtureFiles,
  isFixturePath,
  scanFixtureTree,
} from "./lib/fixture-home-paths.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
const INSTALL_SMOKE = readFileSync(
  join(REPO_ROOT, ".forgejo", "workflows", "install-smoke.yml"),
  "utf8",
);

const FIXTURE_FILES = fixtureFiles(REPO_ROOT);

/** The two absolute home roots, split so this file does not carry the shape. */
const LINUX_ROOT = ["/hom", "e/"].join("");
const MAC_ROOT = ["/Us", "ers/"].join("");

/** A path under a home root. `account` is what makes it a finding. */
const home = (root, account, tail = "") => `${root}${account}${tail}`;

/** An account that is deliberately not in the placeholder table. */
const REAL_ACCOUNT = "averyplausibleuser";

/** Build a throwaway tree, hand it to `run`, delete it either way. */
function withScratchTree(write, run) {
  const scratch = mkdtempSync(join(tmpdir(), "fixture-home-guard-"));
  try {
    write(scratch);
    return run(scratch);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the detector

test("every recognised placeholder shape is accepted, under both home roots", () => {
  // Each entry is here because an author is entitled to use it without an edit.
  // Both roots are exercised because a Linux-only rule is a Linux-user rule in
  // disguise: the first macOS developer to paste a real path walks past it.
  const broken = [];
  for (const root of [LINUX_ROOT, MAC_ROOT]) {
    for (const segment of GENERIC_HOME_SEGMENTS) {
      if (findRealHomePaths(home(root, segment, "/work")).length > 0) {
        broken.push(`${root}${segment}/ is allow-listed but still reported`);
      }
    }
  }
  assert.deepEqual(
    broken,
    [],
    "an allow-listed segment the detector rejects is a hole in the table, and the author cannot use the placeholder they were told to use",
  );
});

test("a home path that is not a placeholder is reported, under both home roots", () => {
  // These are the shapes a terminal hands you: your own login, a colleague's,
  // and a first-name stand-in that reads exactly like a real account. None is in
  // the table, so all of them must be findings.
  const cases = [
    [home(LINUX_ROOT, REAL_ACCOUNT, "/code/paseo"), "a linux login"],
    [home(MAC_ROOT, REAL_ACCOUNT, "/code/paseo"), "a macos login"],
    [home(LINUX_ROOT, "somebody-else", "/worktree"), "a colleague's login"],
    [home(LINUX_ROOT, "firstname", "/worktree"), "a first-name stand-in that reads like a real account"],
  ];
  for (const [text, why] of cases) {
    assert.ok(
      findRealHomePaths(text).length > 0,
      `${text} (${why}) must be a finding; a placeholder table that admits it has stopped guarding anything`,
    );
  }
});

test("a home path is only a home path at a path boundary", () => {
  // Each of these is a substring rather than a path root component, and the repo
  // has all of them on purpose. Without the boundary the rule invents findings
  // in the middle of words and in the fake roots the x-comms injection fixtures
  // use, and the first false positive costs the guard its credibility.
  const accepted = [
    `stableServerPath(${JSON.stringify(home("/fake/", "", ".paseo/paseo-x-comms"))})`, // deliberately fake root
    `join(base, "${LINUX_ROOT}", "elsewhere")`,
    `s${LINUX_ROOT}fixture`,
    `docs mention ${LINUX_ROOT}... as a shape`,
    `(e.g. ${LINUX_ROOT}...)`,
    `the path ${LINUX_ROOT}../etc is not a home directory`,
    "/var/test-home/code/paseo", // the fleet's non-home-root placeholder root
    "/var/test-home/.paseo/worktrees/2h0dw6vb/fix-530",
    "/opt/Paseo/Paseo",
  ];
  for (const text of accepted) {
    assert.deepEqual(
      findRealHomePaths(text).map((f) => f.path),
      [],
      `${text} carries no real home path and must not be reported`,
    );
  }
});

test("a finding names the file, the line and the column", () => {
  const text = [
    `const ok = "${home(LINUX_ROOT, "user", "/x")}";`,
    "const leak = [",
    `  "${home(LINUX_ROOT, REAL_ACCOUNT, "/.paseo/worktrees/abc")}",`,
    "];",
    `const also = "${home(MAC_ROOT, "otheruser", "/y")}";`,
  ].join("\n");
  const findings = findRealHomePaths(text, "some/fixture.ts");
  assert.deepEqual(
    findings.map((f) => [f.line, f.column, f.segment]),
    [
      [3, 4, REAL_ACCOUNT],
      [5, 15, "otheruser"],
    ],
    "both leaks are reported, each on the line and column it is on",
  );
  assert.match(describeFinding(findings[0]), /^some\/fixture\.ts:3:4 {2}\/home\//);
});

// ------------------------------------------------- the guard actually fires

test("the guard fires on a planted violation and reports where it is", () => {
  // The proof that runs on every single run, not once by hand. A guard whose
  // only evidence is that the tree is clean cannot tell clean from broken:
  // delete the regex, keep the walker, and a "passing" guard is indistinguishable
  // from this one. So the violation is planted in a scratch tree in the shape a
  // real paste has -- a worktree path on its own line, with a real-looking login
  // -- and the same entry point the tree scan uses has to find it, in a file
  // whose sibling line carries an allowed placeholder.
  const findings = withScratchTree(
    (root) => {
      const dir = join(root, "plugins", "probe", "client", "testing");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "fleet-fixtures.ts"),
        [
          "export const WIDE_WORKTREE =",
          `  "${home(LINUX_ROOT, "dev-user", "/.paseo/worktrees/2h0dw6vb/fix-621")}";`,
          "export const MINE =",
          `  "${home(LINUX_ROOT, REAL_ACCOUNT, "/.paseo/worktrees/2h0dw6vb/fix-999")}";`,
          "",
        ].join("\n"),
      );
    },
    (root) => scanFixtureTree(root),
  );

  assert.deepEqual(
    findings.map((f) => [f.file, f.line, f.column, f.segment]),
    [["plugins/probe/client/testing/fleet-fixtures.ts", 4, 4, REAL_ACCOUNT]],
    "the planted path is reported with its file, line and column, and the placeholder beside it is not",
  );
  assert.match(
    describeFinding(findings[0]),
    new RegExp(`^plugins/probe/client/testing/fleet-fixtures\\.ts:4:4 {2}/home/`),
    "the human-readable finding is the one an author reads in CI output",
  );
});

test("the guard reads test and fixture files only", () => {
  // The scope boundary, asserted rather than assumed. A fixture is what the
  // author pastes into; `server/agents.ts` is a doc example the preflight already
  // rules on with a pattern list this repo is not allowed to contain, and
  // `vendor/` and `dist/` are byte copies of files that are themselves scanned.
  // If this test ever needs loosening, that is a decision to make on purpose.
  const findings = withScratchTree(
    (root) => {
      const leak = `const home = "${home(LINUX_ROOT, REAL_ACCOUNT)}";\n`;
      mkdirSync(join(root, "plugins", "probe", "server", "vendor", "paseo-plugin-helper"), {
        recursive: true,
      });
      mkdirSync(join(root, "packages", "helper", "dist", "testing"), { recursive: true });
      mkdirSync(join(root, "plugins", "probe", "shared"), { recursive: true });
      writeFileSync(join(root, "plugins", "probe", "server", "agents.ts"), leak); // application code
      writeFileSync(join(root, "plugins", "probe", "index.client.tsx"), leak); // entry point
      writeFileSync(join(root, "plugins", "probe", "shared", "contracts.ts"), leak); // shared code
      writeFileSync(join(root, "plugins", "probe", "server", "agents.test.ts"), leak); // in scope
      writeFileSync(
        join(root, "plugins", "probe", "server", "vendor", "paseo-plugin-helper", "index.ts"),
        leak,
      );
      writeFileSync(join(root, "packages", "helper", "dist", "testing", "mock.js"), leak);
    },
    (root) => scanFixtureTree(root),
  );
  assert.deepEqual(
    findings.map((f) => f.file),
    ["plugins/probe/server/agents.test.ts"],
    "only test and fixture files are in scope; application code, entry points, shared code and generated trees are not",
  );
});

test("a committed symlinked plugin is scanned once, not twice", () => {
  // `plugins/uppidi-forge` is a committed alias for `uppidi-fleet`. Following it
  // would report every finding in the fleet tree twice under two paths, which
  // trains people to read past duplicates -- and the day a real finding lands,
  // the second copy is the one they scroll past.
  assert.ok(
    FIXTURE_FILES.some((f) => f.startsWith("plugins/uppidi-fleet/")),
    "the fleet tree must be in scope, or this test proves nothing",
  );
  assert.deepEqual(
    FIXTURE_FILES.filter((f) => f.startsWith("plugins/uppidi-forge/")),
    [],
    "plugins/uppidi-forge is a symlink alias and must stay out of the sweep",
  );
});

test("fixture discovery is not vacuous: the leak sites from #621 and #624 are in scope", () => {
  // Both halves of the #624 scrub, named as files. If discovery narrows -- a
  // renamed directory, a new extension rule, a scope that quietly stops
  // covering `packages/` -- this fails before the guard can silently stop
  // covering the exact files that leaked.
  assert.ok(
    FIXTURE_FILES.length > 100,
    `expected the fixture suite to be large, found ${FIXTURE_FILES.length} files`,
  );
  for (const known of [
    "plugins/uppidi-fleet/client/testing/fleet-fixtures.ts", // #621, the file #624 scrubbed
    "packages/paseo-plugin-helper/src/__tests__/narrow-viewport-contract.test.tsx", // #624, the other half
    "plugins/x-comms/mcp/test/protocol.test.mjs", // the mcp/ tree the issue names
    "plugins/worktree-install/client/render.test.ts", // the pre-existing in-repo guard
  ]) {
    assert.ok(FIXTURE_FILES.includes(known), `${known} must be scanned by the guard`);
  }
});

test("the classifier reads the names it claims to read", () => {
  const cases = [
    ["plugins/uppidi-fleet/client/testing/fleet-fixtures.ts", true],
    ["plugins/uppidi-fleet/client/mobile-layout.test.ts", true],
    ["plugins/uppidi-fleet/client/surface.test.tsx", true],
    ["plugins/uppidi-fleet/server/agents.spec.ts", true],
    ["packages/paseo-plugin-helper/src/__tests__/formatters.test.ts", true],
    ["plugins/uppidi-fleet/server/agents.ts", false],
    ["plugins/uppidi-fleet/index.client.tsx", false],
    ["plugins/uppidi-fleet/shared/contracts.ts", false],
    ["plugins/uppidi-fleet/README.md", false],
  ];
  for (const [path, want] of cases) {
    assert.equal(isFixturePath(path), want, `${path} classification`);
  }
});

// ------------------------------------------------------------------ the tree

test("no committed test or fixture file carries a real home path (#627)", () => {
  const offenders = scanFixtureTree(REPO_ROOT).map(
    (f) =>
      `${describeFinding(f)}\n         a committed fixture must not carry a real home directory. ` +
      `Replace the account with one of the generic placeholders in ` +
      `scripts/lib/fixture-home-paths.mjs (GENERIC_HOME_SEGMENTS) and keep the rest of the ` +
      `path, including its length: a realistic fixture at a realistic length is the point. ` +
      `See #624 for what a pasted terminal path costs.`,
  );
  assert.deepEqual(offenders, []);
});

// -------------------------------------------------------------- the tripwires

test("this check is wired into the normal test suite, not only into CI", () => {
  // The issue's third checkbox, and the whole reason this guard beats the
  // preflight: it has to run where the fixture is written. A script that exists
  // and is not called is a guard nobody has, and nothing else in the tree would
  // notice it going quiet.
  const testScript = PKG.scripts?.test ?? "";
  assert.match(
    testScript,
    /check:fixture-home-paths/,
    `npm test must run this guard, got: ${testScript}`,
  );
  assert.equal(
    PKG.scripts?.["check:fixture-home-paths"],
    "node --test scripts/fixture-home-paths.test.mjs",
    "the check must be a plain local test run, with no network and no cross-repo dependency",
  );
  // First in the chain: it is the cheapest check in the suite and the one whose
  // failure the author is about to create, so it should not sit behind twelve
  // workspaces' worth of typechecking and layout sweeps.
  assert.ok(
    testScript.indexOf("check:fixture-home-paths") < testScript.indexOf("check:helper-resolution"),
    "the fixture guard should run before the slower sweeps, not after them",
  );
});

test("the PII preflight is still wired and still fails closed (#627)", () => {
  // This guard is an earlier check *in front of* the preflight. If the two ever
  // stop coexisting, the preflight is what got deleted -- it is the slower, less
  // specific of the two, and the one that reads the shipped bytes. It also lives
  // in another repository, so nothing in this tree would notice it vanishing
  // except a test that says so.
  assert.match(
    INSTALL_SMOKE,
    /pii-preflight\.sh/,
    "the preflight must still be invoked; #627 adds a check in front of it, it does not replace it",
  );
  assert.match(
    INSTALL_SMOKE,
    /if \[ ! -x \.platform-tools\/bin\/pii-preflight\.sh \]/,
    "a missing preflight tool must still fail the job closed (#569)",
  );
  assert.match(
    INSTALL_SMOKE,
    /--path 'plugins\/\*' --path 'packages\/\*'/,
    "the preflight must still scan the whole publish surface",
  );
});
