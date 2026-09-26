/**
 * Deterministic tests for the CI vendored-copy gate.
 *
 * The gate this file protects used to be a no-op: it ran the full write pass
 * and then `--check`, so `--check` only ever saw the tree the write pass had
 * just produced. A gate like that cannot be made red, which is the whole defect
 * (#630). These cases work on throwaway copies of the real plugin trees, induce
 * the actual defect (a hand-edited committed vendored copy), and assert the
 * shipped command sequence fails — plus assert CI still runs that sequence, so
 * the ordering cannot regress silently.
 *
 * The same reasoning covers the tracked helper `dist/` (#682): it is a publish
 * artifact nothing verified, and #675 shipped a build that predated its own
 * source edit. The cases below induce exactly that — a helper `src/` edit with
 * no rebuild — and assert `--check` fails on it, names the file, and leaves the
 * stale bytes exactly where they were. A check that rebuilt `dist/` in place
 * would report green here, because it would be verifying its own output.
 *
 * Which workflow runs the gate is deliberately not pinned here. It lived in
 * install-smoke.yml, inside a 0.8/0.9 matrix, so a pure repo check that depends
 * on no Paseo version ran twice per PR (#686); it now runs once in
 * test-suites.yml, a required check. What must stay true is the part that
 * matters: CI runs the sequence, exactly once, and not from a matrix.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareTrees } from "./lib/helper-dist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0;
let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fail += 1;
    console.error(`  FAIL ${name}\n       ${err.message.split("\n")[0]}`);
  }
};

// A committed vendored copy small enough to edit one value in, chosen because
// it is copied verbatim from helper src and present in several plugin trees.
const SAMPLE = "plugins/demo/client/vendor/paseo-plugin-helper/components/AttentionBeacon.tsx";
const SAMPLE_EDIT = ["    borderRadius: 12,", "    borderRadius: 47,"];

// The tracked helper dist/ and the src it must be built from (#682). The edit
// lands in a formatted return string, so it survives minification into every
// dist/cli.* artifact rather than being stripped as a comment.
const HELPER_DIST = "packages/paseo-plugin-helper/dist";
const HELPER_SRC_SAMPLE = "packages/paseo-plugin-helper/src/cli/conformance-exemptions.ts";
const HELPER_SRC_EDIT = [
  "  return `[EXEMPT ] ${exemption.ruleId} — ${exemption.reason}`;",
  "  return `[EXEMPT ] ${exemption.ruleId} — STALE ${exemption.reason}`;",
];

/** Content digest of a tree: sorted relative paths, then their bytes. */
function fingerprint(dir) {
  const hash = crypto.createHash("sha256");
  const files = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  for (const file of files.sort()) {
    hash.update(path.relative(dir, file).split(path.sep).join("/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}

/** The #675 failure shape: a helper source edit that dist/ never saw. */
function induceStaleHelperDist(dir) {
  const file = path.join(dir, HELPER_SRC_SAMPLE);
  const before = fs.readFileSync(file, "utf-8");
  assert.ok(before.includes(HELPER_SRC_EDIT[0]), `fixture lost ${HELPER_SRC_EDIT[0].trim()} — pick another sample`);
  fs.writeFileSync(file, before.replace(HELPER_SRC_EDIT[0], HELPER_SRC_EDIT[1]));
}

/** A stand-in checkout: the real trees, minus everything vendor-sync never reads. */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-sync-"));
  fs.cpSync(path.join(ROOT, "plugins"), path.join(dir, "plugins"), { recursive: true });
  // The whole helper package, committed dist included. --check proves the
  // committed dist is what src builds (#682), so a stand-in carrying neither a
  // dist nor a build config could only ever report "missing", and one carrying
  // src without tsup would report a build failure. node_modules is symlinked,
  // not copied: the fixture's build must resolve the same tsup and the same
  // dependency versions the real checkout would.
  fs.cpSync(
    path.join(ROOT, "packages/paseo-plugin-helper"),
    path.join(dir, "packages/paseo-plugin-helper"),
    { recursive: true }
  );
  for (const rel of ["scripts/vendor-sync.mjs", "scripts/lib"]) {
    fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
  }
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}

const run = (dir, ...args) => spawnSync(process.execPath, [path.join(dir, "scripts/vendor-sync.mjs"), ...args], {
  cwd: dir,
  encoding: "utf-8",
});

/** Introduce the real defect: a committed vendored copy edited by hand. */
function induceDrift(dir) {
  const file = path.join(dir, SAMPLE);
  const before = fs.readFileSync(file, "utf-8");
  assert.ok(before.includes(SAMPLE_EDIT[0]), `fixture lost ${SAMPLE_EDIT[0].trim()} — pick another sample`);
  fs.writeFileSync(file, before.replace(SAMPLE_EDIT[0], SAMPLE_EDIT[1]));
}

/** The command sequence CI's vendor gate must be running. */
const GATE_SEQUENCE = [
  ["--materialize-links"],
  ["--check"],
];

const sequence = (dir) => GATE_SEQUENCE.map((args) => run(dir, ...args));

check("pristine checkout passes the gate", () => {
  const dir = makeFixture();
  for (const r of sequence(dir)) {
    assert.equal(r.status, 0, `gate step ${r.args?.join(" ")} failed: ${r.stdout}${r.stderr}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

check("a hand-edited committed vendored copy fails the gate", () => {
  const dir = makeFixture();
  induceDrift(dir);
  const results = sequence(dir);
  const failure = results.find((r) => r.status !== 0);
  assert.ok(failure, `gate stayed green on drift:\n${results.map((r) => r.stdout + r.stderr).join("")}`);
  assert.match(failure.stdout, /vendor trees drifted/);
  assert.ok(failure.stdout.includes(SAMPLE), `failure did not name the drifted file:\n${failure.stdout}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

check("--check alone fails on a hand-edited committed vendored copy", () => {
  const dir = makeFixture();
  induceDrift(dir);
  const r = run(dir, "--check");
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /drift/);
  fs.rmSync(dir, { recursive: true, force: true });
});

check("--check writes nothing (a passing check leaves the tree untouched)", () => {
  const dir = makeFixture();
  const before = fs.readFileSync(path.join(dir, SAMPLE), "utf-8");
  assert.equal(run(dir, "--check").status, 0);
  assert.equal(fs.readFileSync(path.join(dir, SAMPLE), "utf-8"), before);
  fs.rmSync(dir, { recursive: true, force: true });
});

check("the retired sequence (write pass, then --check) cannot see drift — why the order matters", () => {
  const dir = makeFixture();
  induceDrift(dir);
  const write = run(dir);
  const check = run(dir, "--check");
  assert.equal(write.status, 0);
  assert.match(write.stdout, /vendor trees updated/, "the write pass silently repaired the drift");
  assert.equal(check.status, 0, "if this now fails, --check repaired the tree too and the write pass is redundant");
  assert.match(check.stdout, /vendor trees in sync/);
  fs.rmSync(dir, { recursive: true, force: true });
});

check("--materialize-links leaves a stale committed copy stale, so --check can still see it", () => {
  const dir = makeFixture();
  induceDrift(dir);
  const before = fs.readFileSync(path.join(dir, SAMPLE), "utf-8");
  const materialize = run(dir, "--materialize-links");
  assert.equal(materialize.status, 0, materialize.stderr);
  assert.match(materialize.stdout, /nothing to materialize/);
  assert.equal(
    fs.readFileSync(path.join(dir, SAMPLE), "utf-8"),
    before,
    "--materialize-links rewrote a committed copy — the gate's drift evidence is gone"
  );
  assert.equal(run(dir, "--check").status, 1, "--check no longer reports the drift");
  fs.rmSync(dir, { recursive: true, force: true });
});

check("--materialize-links materializes a legacy dev symlink into a real copy (#146)", () => {
  const dir = makeFixture();
  const dest = path.join(dir, "plugins/top/client/vendor/paseo-plugin-helper");
  const elsewhere = path.join(dir, "elsewhere/paseo-plugin-helper");
  fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
  fs.renameSync(dest, elsewhere);
  fs.symlinkSync("../../../../elsewhere/paseo-plugin-helper", dest);
  assert.ok(fs.lstatSync(dest).isSymbolicLink());

  const materialize = run(dir, "--materialize-links");
  assert.equal(materialize.status, 0, materialize.stderr);
  assert.match(materialize.stdout, /materialized 1 legacy dev symlink/);
  assert.ok(!fs.lstatSync(dest).isSymbolicLink(), "the symlink survived materialization");
  assert.equal(fs.lstatSync(dest).isDirectory(), true, "the materialized dest is not a real directory");

  const sample = path.join(dest, "components/AttentionBeacon.tsx");
  assert.ok(fs.existsSync(sample), "materialized tree is partial — no component copy");
  assert.ok(
    fs.readFileSync(sample, "utf-8").includes('from "../../../../shared/vendor/paseo-plugin-helper/types"'),
    "materialized copy lost its cross-tree specifier rewrite"
  );
  assert.equal(run(dir, "--check").status, 0, "a freshly materialized tree must pass --check");

  // The same tree with the write pass instead: identical outcome, so nothing
  // the dev-facing command does is lost by the gate not using it.
  const other = makeFixture();
  const otherDest = path.join(other, "plugins/top/client/vendor/paseo-plugin-helper");
  fs.mkdirSync(path.join(other, "elsewhere"), { recursive: true });
  fs.renameSync(otherDest, path.join(other, "elsewhere/paseo-plugin-helper"));
  fs.symlinkSync("../../../../elsewhere/paseo-plugin-helper", otherDest);
  assert.equal(run(other).status, 0);
  const walk = (root, d = root) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(root, path.join(d, e.name)) : [path.relative(root, path.join(d, e.name))]);
  assert.deepEqual(walk(dest).sort(), walk(otherDest).sort(), "materialize and write produced different trees");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

check("--materialize-links is rejected alongside --check", () => {
  const dir = makeFixture();
  const r = run(dir, "--materialize-links", "--check");
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}`);
  assert.match(r.stderr, /mutually exclusive/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// #682 — the tracked helper dist/ is the published build, and nothing checked it
// ---------------------------------------------------------------------------
//
// Split by what each case is actually about. `compareTrees` is pure once both
// trees exist, so every shape question — a differing file, a leftover, a deleted
// artifact — is settled against synthetic trees for free. Only the wiring
// (does a real src edit with no rebuild actually turn the gate red, and does the
// check stay out of the tracked tree) needs a real build, and that is the
// expensive part, so it runs twice and not ten times.

/** Two throwaway trees, each mapping relative path -> contents. */
function makeTrees(specs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helper-dist-compare-"));
  for (const [rel, contents] of Object.entries(specs)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return dir;
}

check("compareTrees reports a differing file by name, size and first difference", () => {
  const committed = makeTrees({ "cli.js": "aaaa", "index.js": "same" });
  const fresh = makeTrees({ "cli.js": "aabb", "index.js": "same" });
  const report = compareTrees(committed, fresh, "dist");
  assert.equal(report.length, 1, `expected one divergence, got:\n${report.join("\n")}`);
  assert.match(report[0], /differs: dist\/cli\.js/);
  assert.match(report[0], /committed 4 B, fresh 4 B, first difference at byte 2/);
  fs.rmSync(committed, { recursive: true, force: true });
  fs.rmSync(fresh, { recursive: true, force: true });
});

check("compareTrees reports a leftover artifact the build no longer emits", () => {
  // The shape a file-name-only comparison would miss.
  const committed = makeTrees({ "index.js": "same", "gone-from-the-build.js": "old" });
  const fresh = makeTrees({ "index.js": "same" });
  const report = compareTrees(committed, fresh, "dist");
  assert.equal(report.length, 1, `expected one divergence, got:\n${report.join("\n")}`);
  assert.match(report[0], /extra: dist\/gone-from-the-build\.js/);
  fs.rmSync(committed, { recursive: true, force: true });
  fs.rmSync(fresh, { recursive: true, force: true });
});

check("compareTrees reports an artifact the build emits and the tree lacks", () => {
  const committed = makeTrees({ "index.js": "same" });
  const fresh = makeTrees({ "index.js": "same", "never-committed.js": "new" });
  const report = compareTrees(committed, fresh, "dist");
  assert.equal(report.length, 1, `expected one divergence, got:\n${report.join("\n")}`);
  assert.match(report[0], /missing: dist\/never-committed\.js/);
  fs.rmSync(committed, { recursive: true, force: true });
  fs.rmSync(fresh, { recursive: true, force: true });
});

check("compareTrees reports nothing for two byte-identical trees", () => {
  const spec = { "index.js": "same", "client/index.js": "same too" };
  const committed = makeTrees(spec);
  const fresh = makeTrees(spec);
  assert.deepEqual(compareTrees(committed, fresh, "dist"), []);
  fs.rmSync(committed, { recursive: true, force: true });
  fs.rmSync(fresh, { recursive: true, force: true });
});

check("a helper src edit with no rebuild fails --check, naming the file and leaving it stale", () => {
  // The #675 failure shape, end to end: one build, two assertions. Naming the
  // file is half the contract — the other half is that the bytes are still
  // there afterwards. A --check that rebuilt dist/ in place would report green
  // here, because it would be verifying the tree it had just written (#630, one
  // level down).
  const dir = makeFixture();
  induceStaleHelperDist(dir);
  const before = fingerprint(path.join(dir, HELPER_DIST));
  const r = run(dir, "--check");
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /helper dist is stale/);
  assert.ok(
    r.stdout.includes(`${HELPER_DIST}/cli.js`),
    `the failure did not name the stale dist file:\n${r.stdout}`
  );
  assert.equal(
    fingerprint(path.join(dir, HELPER_DIST)),
    before,
    "--check rebuilt dist/ in place, so it verified the tree it had just written"
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

check("a passing --check writes nothing into the committed helper dist", () => {
  const dir = makeFixture();
  const before = fingerprint(path.join(dir, HELPER_DIST));
  assert.equal(run(dir, "--check").status, 0);
  assert.equal(
    fingerprint(path.join(dir, HELPER_DIST)),
    before,
    "a passing --check left changes in the committed dist"
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

check("the write pass builds the dist, so it cannot stamp or copy against a stale build", () => {
  const dir = makeFixture();
  induceStaleHelperDist(dir);
  const before = fingerprint(path.join(dir, HELPER_DIST));
  const write = run(dir);
  assert.equal(write.status, 0, write.stdout + write.stderr);
  assert.match(write.stdout, /building packages\/paseo-plugin-helper\/dist before stamping/);
  assert.notEqual(fingerprint(path.join(dir, HELPER_DIST)), before, "the write pass did not rebuild the dist");
  assert.equal(run(dir, "--check").status, 0, "the rebuilt dist does not match the edited src");
  fs.rmSync(dir, { recursive: true, force: true });
});

check("a helper build that cannot run fails the check loudly instead of passing", () => {
  // A gate that cannot build its subject must not be able to report a pass: a
  // missing toolchain is a red gate, never a skipped one (#569 precedent).
  const dir = makeFixture();
  fs.rmSync(path.join(dir, "node_modules"), { force: true });
  fs.mkdirSync(path.join(dir, "node_modules"));
  const r = run(dir, "--check");
  assert.notEqual(r.status, 0, `an unbuildable helper was reported as in sync:\n${r.stdout}${r.stderr}`);
  assert.match(
    `${r.stdout}${r.stderr}`,
    /helper build \(check pass\) (failed|could not start)/,
    `the build failure was not reported:\n${r.stdout}${r.stderr}`
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// #686 — the gate is CI's, not one workflow's: assert it runs, not where
// ---------------------------------------------------------------------------

const WORKFLOW_DIRS = [".forgejo/workflows", ".github/workflows"];

/**
 * Every CI workflow as runnable lines. Comment lines are dropped, so a gate
 * cannot be "found" in prose — the parse below sees the same text a runner
 * would, and a workflow that only mentions `vendor-sync.mjs` in a comment does
 * not count as running it.
 */
function ciWorkflows() {
  const workflows = [];
  for (const dir of WORKFLOW_DIRS) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).sort()) {
      if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
      workflows.push({
        file: `${dir}/${name}`,
        lines: fs
          .readFileSync(path.join(full, name), "utf-8")
          .split("\n")
          .filter((line) => !line.trim().startsWith("#")),
      });
    }
  }
  return workflows;
}

/**
 * The YAML step containing `index`: from its `- name:` to the next step at the
 * same indent.
 */
function stepAround(lines, index) {
  let from = index;
  while (from > 0 && !/^\s*-\s+\S/.test(lines[from])) from -= 1;
  const indent = lines[from].match(/^(\s*)/)[0];
  let to = from + 1;
  while (to < lines.length && !new RegExp(`^${indent}- `).test(lines[to])) to += 1;
  return lines.slice(from, to).join("\n");
}

/** The job containing `index`: its job key up to the next one. */
function jobAround(lines, index) {
  let from = index;
  while (from > 0 && !/^\s{2}\S/.test(lines[from])) from -= 1;
  let to = from + 1;
  while (to < lines.length && !/^\s{2}\S/.test(lines[to])) to += 1;
  return lines.slice(from, to).join("\n");
}

check("CI runs the vendor gate once, as --materialize-links then --check, outside a matrix", () => {
  const workflows = ciWorkflows();
  const gate = [];
  const selfTest = [];
  for (const { file, lines } of workflows) {
    lines.forEach((line, index) => {
      // Matched anywhere on a runnable line, so `run: node scripts/…` and a
      // line inside a `run: |` block count the same: what matters is that a
      // runner executes the command, not how the step spells it.
      if (/node scripts\/vendor-sync\.test\.mjs\s*$/.test(line)) selfTest.push({ file, lines, index });
      const match = line.match(/node scripts\/vendor-sync\.mjs([^\n]*)/);
      if (match) gate.push({ file, lines, index, args: match[1].trim() });
    });
  }

  // Once, and only the two modes that can fail: a write pass here would make
  // --check verify the tree it had just written (#630), and a second workflow
  // running the gate is the duplication #686 removed coming back.
  assert.deepEqual(
    gate.map((g) => g.args),
    GATE_SEQUENCE.map((a) => a.join(" ")),
    `CI must run the vendor gate exactly once, as ${GATE_SEQUENCE.map((a) => a.join(" ")).join(" then ")} and nothing else; found ${JSON.stringify(gate.map((g) => `${g.file}: ${g.args}`))}`
  );

  // The gate's own tests move with it, or the wiring above is the only thing
  // left checking that --check can go red at all.
  assert.ok(
    selfTest.some((t) => t.file === gate[0].file),
    `no workflow runs scripts/vendor-sync.test.mjs alongside the gate (${gate[0].file})`
  );

  const step = stepAround(gate[0].lines, gate[0].index);
  assert.match(step, /git diff --quiet -- plugins/,
    "the gate must assert the materialize step left the committed copies untouched");
  assert.match(step, /git ls-files -s/,
    "the gate must still reject a committed symlink under a vendored helper path (#146)");

  // The reason the gate moved: it depends on no Paseo version, so a matrix
  // multiplies it per lane — twice per PR while it sat in install-smoke.yml
  // (#686), and the helper build inside --check with it (#685).
  assert.doesNotMatch(
    jobAround(gate[0].lines, gate[0].index),
    /^\s*matrix:/m,
    "the vendor gate must not sit in a matrix job: it is a pure repo check, so a matrix only runs it once per Paseo version"
  );
});

process.exit(fail > 0 ? 1 : 0);
