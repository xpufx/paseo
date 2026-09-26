// Detector for the authoring-time leak: a committed test or fixture file that
// carries an absolute home path belonging to a real person.
//
// The case for a second gate, in front of the PII preflight, is in #627. The
// preflight is a backstop -- it answers "is this safe to publish" and fires on
// main, in a red job, after the merge. It works (#622 is why /home/<user> is not
// in the tree), but it cannot tell you at 11pm the difference between "is this
// safe" and "did you paste this off your terminal". A guard that answers the
// second question is cheaper, runs before the commit, and can name the file and
// line. This module is that guard's logic; the suite that drives it is
// scripts/fixture-home-paths.test.mjs.
//
// Design notes that matter more than the regex:
//
//   * No literal is baked in. The whole point is to work on any machine and in
//     CI, where the home path is a different one. The rule is structural: a
//     `/home/<segment>` or `/Users/<segment>` whose segment is not a recognised
//     generic placeholder is a finding. The preflight keeps its own hardcoded
//     names -- the two gates deliberately overlap, because "somebody else's
//     home directory" is the leak this one exists to catch and the preflight's
//     list can only ever name the few users it was told about.
//
//   * Scope is test and fixture files, not the published tree. A committed
//     fixture is where a real path gets pasted (you copy a worktree path out of
//     your own terminal into a payload), and it is also the only place the
//     author can fix the mistake by editing one line. Flagging application code
//     here would put a second, differently-worded PII rule in front of the
//     preflight on the same paths, and the first one to cry wolf gets deleted.
//
//   * Generated trees are skipped. `dist` and `vendor/` hold copies of files
//     that are themselves scanned, so a finding there is a stale-build bug whose
//     remedy is "rebuild", not "edit this line" -- and the preflight already
//     reads the shipped bytes, dist included, which is where that answer belongs.
//
// This module deliberately has no side effects and no repo-root knowledge beyond
// what it is handed, so the suite can point it at a scratch tree and prove it
// actually fires.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The recognised generic home-directory placeholders. A `/home/<segment>` or
 * `/Users/<segment>` whose segment is in here is a stand-in someone chose on
 * purpose; anything else is treated as a real account.
 *
 * Three groups, in descending order of how well they are earned:
 *
 *   1. Already in this repo's tests. These are not a policy, they are a record
 *      of what the tree actually contains -- removing one fails the tree scan
 *      below, which is the direction of the check that matters.
 *   2. Headless homes. A CI runner or a container base image is not a person, so
 *      a path under one leaks nothing. Kept separate because that is a
 *      categorically different argument from "this is a made-up name".
 *   3. The words an author reaches for first when told to use a placeholder.
 *      Not in the tree yet, but every one is a word no account would plausibly
 *      use, so allowing them costs nothing and saves an edit.
 *
 * The line the list is drawn on: a stand-in spelled like a plausible first name
 * is not a stand-in, it is a leak waiting for the next person to guess whose.
 * Every entry is on the safe side of that, and that is also why the list stays
 * short -- each allowlisted segment is a segment a real path can hide behind.
 *
 * The set is closed-world. An unrecognised segment is a finding, not a pass, so
 * adding a placeholder is a deliberate edit here rather than something a fixture
 * can opt into by existing.
 *
 * Runs of dots are placeholders by form and are handled in `isGeneric` instead
 * of listed here, so `(e.g. /home/...)` in a comment needs no entry.
 *
 * This file is itself scanned, so the table cannot carry a real-looking example
 * even as documentation. That is deliberate: a guard that exempts its own
 * source has a hole exactly where the one string it is most tempted to paste
 * would go.
 */
export const GENERIC_HOME_SEGMENTS = new Set([
  // 1. In the tree today.
  "user", // 32 uses: the fleet contracts, agents, issues, the helper's own tests
  "dev-user", // 12 uses: the #624 scrub's replacement, and the #621 fleet fixtures
  "dev", // forges/shared/issues.test.ts
  "x", // top/client/telemetry-copy.test.ts
  "u", // x-comms/shared/auth-fields.test.ts

  // 2. Headless homes -- no person behind them.
  "runner",
  "node",
  "ubuntu",
  "ci",

  // 3. First-choice placeholder words.
  "test",
  "testuser",
  "test-user",
  "example",
  "sample",
  "yourname",
  "your-user",
  "username",
  "someone",
  "me",
]);

/**
 * Matches an absolute home path, capturing the account segment.
 *
 * The lookbehind is load-bearing and is what keeps the rule honest. A home path
 * is a *path root component*, so it may only be preceded by something that cannot
 * be part of a path segment. Without it the rule matches on substrings and
 * invents findings in three places this repo legitimately has them:
 * `/fake/home/.paseo/...` (x-comms injection fixtures, a deliberately fake root),
 * `test-home/` (the /var/test-home prefix, where there is no `/home/` component
 * at all), and prose like `s/home/foo`.
 *
 * `\b`-style boundaries would be wrong here: `/` and `h` are both word
 * characters' opposites in ways that make `\b` fire in exactly the middle of the
 * substrings above.
 */
export const HOME_PATH_RE =
  /(?<![A-Za-z0-9._\-/])\/(?:home|Users)\/([A-Za-z0-9._-]+)/g;

/** A segment that is nothing but dots is path syntax, not a login. */
function isGeneric(segment) {
  return GENERIC_HOME_SEGMENTS.has(segment) || /^\.+$/.test(segment);
}

/**
 * Every real-home-path finding in `text`, in file order. `file` is only used to
 * label the results. Line numbers are 1-based, columns 1-based.
 *
 * A path can appear more than once on a line, and a line can hold more than one
 * distinct path; all of them are reported, because a fixture that leaked one
 * path has usually pasted a whole worktree path and stopping at the first would
 * under-report the fix.
 */
export function findRealHomePaths(text, file = "<text>") {
  const findings = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    // The regex is global, so lastIndex has to be reset per line or the second
    // line of a two-line match would resume mid-string and miss every hit.
    HOME_PATH_RE.lastIndex = 0;
    let m;
    while ((m = HOME_PATH_RE.exec(lines[i])) !== null) {
      if (isGeneric(m[1])) continue;
      findings.push({
        file,
        line: i + 1,
        column: m.index + 1,
        path: m[0],
        segment: m[1],
      });
    }
  }
  return findings;
}

/**
 * Directory names that mark their whole subtree as test or fixture material.
 * A file under one of these is in scope whatever it is called, which is how
 * `client/testing/fleet-fixtures.ts` (#621) and `src/__tests__/...` (#624) are
 * reached.
 */
export const FIXTURE_DIR_SEGMENTS = new Set([
  "test",
  "tests",
  "__tests__",
  "testing",
  "testdata",
  "fixtures",
  "__fixtures__",
  "__snapshots__",
]);

/** Extensions a fixture's payload can plausibly be written in. */
const SCANNED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
]);

/**
 * Trees the guard does not read. Mirrors scripts/declared-tooling.test.mjs's
 * set (so the two repo-wide walkers agree on what "the tree" means) and adds the
 * generated and machine-local directories this repo's .gitignore already
 * excludes -- the walk is over the filesystem, not over `git ls-files`, because
 * an untracked new fixture is exactly the case that must fail.
 */
export const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".vitest",
  "publish-stage",
  // Vendored helper copies: byte copies of scanned sources, kept in sync by
  // `vendor-sync.mjs --check`.
  "vendor",
  // gitignored, machine-local
  ".paseo",
  ".serena",
  ".verify-tmp",
  "scratch",
  "state",
  "bin",
]);

/** True when a repo-relative, slash-separated path is test or fixture material. */
export function isFixturePath(relPath) {
  const segments = relPath.split("/");
  if (segments.slice(0, -1).some((s) => FIXTURE_DIR_SEGMENTS.has(s))) return true;
  const name = segments[segments.length - 1];
  const dot = name.lastIndexOf(".");
  if (dot === -1 || !SCANNED_EXTENSIONS.has(name.slice(dot))) return false;
  const stem = name.slice(0, dot);
  // `foo.test.ts`, `foo.spec.tsx`, and `fleet-fixtures.ts` outside any fixture
  // directory.
  return (
    stem.endsWith(".test") ||
    stem.endsWith(".spec") ||
    /(^|[-_.])fixtures?([-_.]|$)/.test(stem)
  );
}

function walk(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // `plugins/uppidi-forge` is a committed alias symlink to `uppidi-fleet`.
    // Following it would scan one tree twice under two paths and report every
    // finding twice.
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Every fixture file under `root`, as repo-relative slash-separated paths,
 * sorted so a finding list is stable between runs.
 */
export function fixtureFiles(root) {
  return walk(root, [])
    .map((abs) => relative(root, abs).split(sep).join("/"))
    .filter(isFixturePath)
    .sort();
}

/**
 * The guard itself: read every fixture file under `root` and return the
 * real-home-path findings in it, each labelled with its repo-relative path and
 * line. An unreadable or non-UTF-8 file is a finding of its own rather than a
 * skipped file -- a guard that quietly ignores a file it cannot read is a guard
 * with a hole in exactly the place it cannot report.
 */
export function scanFixtureTree(root) {
  const findings = [];
  for (const rel of fixtureFiles(root)) {
    let text;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch (err) {
      findings.push({ file: rel, line: 0, column: 0, path: "", segment: "", unreadable: String(err) });
      continue;
    }
    findings.push(...findRealHomePaths(text, rel));
  }
  return findings;
}

/** One line per finding, naming the file, the line, and the path. */
export function describeFinding(f) {
  if (f.unreadable) return `${f.file}: unreadable by the fixture guard (${f.unreadable})`;
  return `${f.file}:${f.line}:${f.column}  ${f.path}  (home segment "${f.segment}")`;
}
