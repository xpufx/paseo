// Is the committed `packages/paseo-plugin-helper/dist/` what the current helper
// `src/` builds? (#682)
//
// `dist/` is not a local build output. The package's `files` ships it, so the
// tarball the world installs is the tree committed here — 72 tracked files that
// no `dist/`-shaped gitignore rule touches, on purpose. That makes every
// helper source edit owe two follow-ups (rebuild, restamp) and nothing checked
// either: #675 moved the conformance exemptions into `src/cli/` and left
// `dist/` holding the pre-#675 build, so the published helper never contained
// the change it shipped with. `doctor-live.mjs` compares mtimes, which a git
// clone does not preserve, and it is a local diagnostic no CI job runs.
//
// Two halves, deliberately different code paths:
//
//   buildHelperDist()  the write pass. Runs before anything is copied or
//                      restamped, so a stamp can never be produced against a
//                      stale or missing build.
//
//   checkHelperDist()  the check pass. Builds into a throwaway copy of the
//                      package *outside* the checkout and compares, so it
//                      answers "does the committed dist match src?" without
//                      writing a byte into the working tree. A `--check` that
//                      rebuilt `dist/` in place would be verifying its own
//                      output and would report green whatever was committed —
//                      the #630 defect, one level down.
//
// Both use the package's own `build` script, so there is exactly one definition
// of what the helper's build is. A build that cannot run is fatal in both
// halves and says so: a gate that cannot build its subject must not be able to
// report a pass.
//
// The comparison is byte-for-byte, which the helper's tsup build supports: two
// consecutive builds of an unchanged tree produce identical output, and the
// committed `dist/` is byte-identical to a fresh one. The build embeds no
// timestamp, no content hash and no absolute path. The one path-shaped thing it
// does embed is relative — a `.map`'s `sources` are written relative to the
// output directory, e.g. `../src/shared/rpc.ts` — which is exactly why the
// check builds a copy of the package rather than an arbitrary output dir: point
// tsup somewhere outside `packages/paseo-plugin-helper/` and every sourcemap
// picks up a different, machine-specific `sources` list and the comparison fails
// on a clean tree. Keeping the output directory a sibling of `src/` is what
// makes the copy byte-comparable.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { HELPER_ROOT } from "./helper-identity.mjs";

/** Never copied into the scratch package: the build's input, not its output. */
const NOT_COPIED = new Set(["dist", "node_modules", ".git"]);

/**
 * The package's own `build` script, run in `cwd`. Fatal on failure, with tsup's
 * own output attached — a half-built or absent `dist/` must never be mistaken
 * for a passing gate.
 */
function runHelperBuild(cwd, what) {
  const result = spawnSync("npm", ["run", "build"], { cwd, encoding: "utf8" });
  if (result.error) {
    console.error(`  helper build (${what}) could not start: ${result.error.message}`);
    console.error("  the helper dist freshness check cannot report a result without a build — failing loudly");
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`  helper build (${what}) failed with exit ${result.status}:`);
    for (const line of `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd().split("\n")) {
      console.error(`    ${line}`);
    }
    process.exit(1);
  }
}

/**
 * Build `dist/` in place, so the write pass cannot stamp, restamp or copy
 * against a stale build. Fails loudly; never best-effort.
 */
export function buildHelperDist(repoRoot) {
  const helperRoot = path.join(repoRoot, HELPER_ROOT);
  console.log(`building ${HELPER_ROOT}/dist before stamping anything against it`);
  runHelperBuild(helperRoot, "write pass");
}

/**
 * A scratch package: the helper's sources and build config, no committed
 * `dist/`, and the checkout's own `node_modules` reachable so the build resolves
 * the same toolchain and the same dependency versions it would in place. Built
 * at `<tmp>/packages/<name>` so the output directory is a sibling of `src/`,
 * which is what keeps the sourcemaps' relative `sources` byte-identical.
 */
function scratchPackage(repoRoot) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "helper-dist-check-"));
  fs.mkdirSync(path.join(tmp, "packages"), { recursive: true });
  const helperRoot = path.join(repoRoot, HELPER_ROOT);
  const dest = path.join(tmp, "packages", path.basename(helperRoot));
  fs.cpSync(helperRoot, dest, {
    recursive: true,
    filter: (src) => !NOT_COPIED.has(path.basename(src)),
  });
  fs.symlinkSync(path.join(repoRoot, "node_modules"), path.join(tmp, "node_modules"));
  return { tmp, dist: path.join(dest, "dist") };
}

/** Every file under `dir` as `relative/posix/path` -> absolute path, sorted. */
function fileList(dir) {
  const files = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(path.relative(dir, full).split(path.sep).join("/"), full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return files;
}

/** Byte offset of the first difference, or -1 when the buffers are equal. */
function firstDifference(a, b) {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : length;
}

/**
 * Compare two built trees byte for byte and return one line per divergence —
 * empty means identical. Names every file, not just a count, because "dist is
 * stale" without the path is not actionable.
 *
 * Pure with respect to the build: both directories are already on disk, so this
 * is testable against synthetic trees without paying for a tsup run.
 */
export function compareTrees(committedDir, freshDir, label = `${HELPER_ROOT}/dist`) {
  const committed = fileList(committedDir);
  const fresh = fileList(freshDir);
  const report = [];
  for (const rel of committed.keys()) {
    if (!fresh.has(rel)) {
      report.push(`  extra: ${label}/${rel} (committed, but a fresh build does not emit it)`);
    }
  }
  for (const rel of fresh.keys()) {
    if (!committed.has(rel)) {
      report.push(`  missing: ${label}/${rel} (a fresh build emits it, the committed tree does not have it)`);
    }
  }
  for (const [rel, file] of committed) {
    if (!fresh.has(rel)) continue;
    const a = fs.readFileSync(file);
    const b = fs.readFileSync(fresh.get(rel));
    if (a.equals(b)) continue;
    report.push(
      `  differs: ${label}/${rel} (committed ${a.length} B, fresh ${b.length} B, first difference at byte ${firstDifference(a, b)})`,
    );
  }
  return report;
}

/**
 * Does the committed `dist/` match a fresh build of the current `src/`? Returns
 * the divergence lines, or `[]` when it does. Builds the scratch copy, so the
 * checkout is never written to.
 */
export function checkHelperDist(repoRoot) {
  const committedDir = path.join(repoRoot, HELPER_ROOT, "dist");
  if (!fs.existsSync(committedDir)) {
    return [`${HELPER_ROOT}/dist does not exist — the package's published build is missing`];
  }

  const { tmp, dist: freshDir } = scratchPackage(repoRoot);
  try {
    runHelperBuild(path.dirname(freshDir), "check pass");
    return compareTrees(committedDir, freshDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
