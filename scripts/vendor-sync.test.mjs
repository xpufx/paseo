/**
 * Deterministic tests for the install-smoke vendored-copy gate.
 *
 * The gate this file protects used to be a no-op: it ran the full write pass
 * and then `--check`, so `--check` only ever saw the tree the write pass had
 * just produced. A gate like that cannot be made red, which is the whole defect
 * (#630). These cases work on throwaway copies of the real plugin trees, induce
 * the actual defect (a hand-edited committed vendored copy), and assert the
 * shipped command sequence fails — plus assert install-smoke.yml still uses that
 * sequence, so the ordering cannot regress silently.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** A stand-in checkout: the real trees, minus everything vendor-sync never reads. */
function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-sync-"));
  fs.cpSync(path.join(ROOT, "plugins"), path.join(dir, "plugins"), { recursive: true });
  for (const rel of [
    "packages/paseo-plugin-helper/src",
    "packages/paseo-plugin-helper/package.json",
    "scripts/vendor-sync.mjs",
    "scripts/lib",
  ]) {
    fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
  }
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

/** The command sequence install-smoke.yml's vendor gate must be running. */
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

check("install-smoke.yml gates on the gated sequence, not a write pass", () => {
  const yml = fs.readFileSync(path.join(ROOT, ".forgejo/workflows/install-smoke.yml"), "utf-8");
  const step = yml.slice(yml.indexOf("Gate — vendored copy trees are publishable"));
  assert.ok(step.length > 0, "the vendor gate step is gone from install-smoke.yml");
  const body = step.slice(0, step.indexOf("\n      - name:", 1));
  const invocations = [...body.matchAll(/node scripts\/vendor-sync\.mjs([^\n]*)/g)].map((m) => m[1].trim());
  assert.deepEqual(invocations, GATE_SEQUENCE.map((a) => a.join(" ")),
    "the vendor gate must run --materialize-links then --check, nothing else");
  assert.match(body, /git diff --quiet -- plugins/,
    "the gate must assert the materialize step left the committed copies untouched");
});

process.exit(fail > 0 ? 1 : 0);
