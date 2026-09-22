/**
 * Unit tests for the npm stage/publish flow (paseo#211).
 *
 * Run: node scripts/publish-npm.test.mjs
 *
 * Covers argument parsing, readiness classification, packed entry points, and
 * stage-manifest resolution (including the stale/missing refusals). Registry
 * publication remains outside this test suite.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseArgs, pluginIds, manifestFor, readiness, resolvePublishPlan, stagePackages } from "./publish-npm.mjs";

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  if (cond) {
    pass += 1;
    console.log("  ok  ", name);
  } else {
    fail += 1;
    console.log("  FAIL", name);
  }
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// --- parseArgs ---
check("defaults to dry-run", parseArgs([]).mode === "dry-run");
check("--stage selects stage mode", parseArgs(["--stage"]).mode === "stage");
check("--publish selects publish mode", parseArgs(["--publish"]).mode === "publish");
check("--clean-stage selects clean mode", parseArgs(["--clean-stage"]).mode === "clean");
check("--out=<dir> parsed", parseArgs(["--stage", "--out=/tmp/x"]).outDir === "/tmp/x");
check("--out <dir> parsed", parseArgs(["--stage", "--out", "/tmp/y"]).outDir === "/tmp/y");
check("default output is publish-stage", parseArgs(["--stage"]).outDir === "publish-stage");
check("--plugin splits on comma", JSON.stringify(parseArgs(["--stage", "--plugin=top,demo"]).plugins) === '["top","demo"]');
check("--otp parsed", parseArgs(["--publish", "--otp=123456"]).otp === "123456");
check("--from-dirs parsed", parseArgs(["--publish", "--from-dirs"]).fromDirs === true);
check("--dry-run parsed", parseArgs(["--publish", "--dry-run"]).dryRun === true);
check("--allow-dirty parsed", parseArgs(["--stage", "--allow-dirty"]).allowDirty === true);
check("--quiet parsed", parseArgs(["--stage", "--quiet"]).quiet === true);
check("--stage + --publish rejected", throws(() => parseArgs(["--stage", "--publish"])));
check("--publish + --clean-stage rejected", throws(() => parseArgs(["--publish", "--clean-stage"])));

// --- discovery + readiness ---
const ids = pluginIds();
check("discovers the 10 plugins", ids.length === 10 && ids.includes("top") && ids.includes("mcp-tools") && ids.includes("uppidi-forge") && ids.includes("wellbeing"));
const top = manifestFor("top");
check("top is READY", readiness(top).length === 0);
check("top publish name is scoped", top.publishAs === "@xpufx/paseo-top");
check("top is not private", top.isPrivate === false);
check("top has a version", typeof top.version === "string");
check("top files ship sources", top.files.includes("client") && top.files.includes("server") && top.files.includes("shared"));
check("top files ship source entry points", top.files.includes("index.client.tsx") && top.files.includes("index.server.ts"));
check("top files exclude tests", top.files.includes("!**/*.test.ts"));
check("private blocks readiness", readiness({ ...top, isPrivate: true }).some((p) => p.includes("private")));
check("missing version blocks readiness", readiness({ ...top, version: undefined }).some((p) => p.includes("version")));
check("missing required file blocks readiness", readiness({ ...top, missingRequired: ["LICENSE"] }).some((p) => p.includes("LICENSE")));

// --- resolvePublishPlan: staged tarballs win over dirs ---
function withTempStage(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publish-npm-test-"));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const demo = manifestFor("demo");
check("demo files ship source entry points", demo.files.includes("index.client.tsx") && demo.files.includes("index.server.ts"));
for (const id of ids) {
  const manifest = manifestFor(id);
  const sourceEntries = fs
    .readdirSync(manifest.dir)
    .filter((file) => /^(index\.client|index\.server)\.tsx?$/.test(file));
  check(
    `${id} package files ship all source entry points`,
    sourceEntries.length > 0 && sourceEntries.every((file) => manifest.pkg.files?.includes(file)),
  );
  const packed = JSON.parse(
    execFileSync("npm", ["pack", path.resolve(manifest.dir), "--json", "--dry-run"], { encoding: "utf8" }),
  )[0];
  const packedPaths = new Set(packed.files.map((file) => file.path));
  check(
    `${id} npm pack ships all source entry points`,
    sourceEntries.length > 0 && sourceEntries.every((file) => packedPaths.has(file)),
  );
}

// --- stagePackages: a restage clears all prior package output ---
withTempStage((dir) => {
  const dest = path.join(dir, "demo");
  fs.mkdirSync(path.join(dest, "package"), { recursive: true });
  fs.writeFileSync(path.join(dest, "package", "stale.js"), "stale");
  fs.writeFileSync(path.join(dest, "previous.tgz"), "stale");
  fs.writeFileSync(path.join(dest, "stale-note.txt"), "stale");
  const filename = "paseo-helper-demo-current.tgz";
  const staged = stagePackages([demo], {
    outDir: dir,
    pack: (_manifest, { destination }) => {
      fs.writeFileSync(path.join(destination, filename), "current");
      return { filename, shasum: "current-sha", integrity: "current-integrity", size: 7, unpackedSize: 7, files: [] };
    },
  });
  check("restage removes stale extracted and non-tarball output", JSON.stringify(fs.readdirSync(dest)) === JSON.stringify([filename]));
  check("restage records only the current tarball", staged.packages[0].tarball === path.join("demo", filename));
});

// --- resolvePublishPlan: staged tarballs win over dirs ---
withTempStage((dir) => {
  fs.mkdirSync(path.join(dir, "demo"), { recursive: true });
  fs.writeFileSync(path.join(dir, "demo", "demo.tgz"), "fake");
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      stagedAt: "2026-01-01T00:00:00Z",
      packages: [{ id: "demo", publishAs: "@xpufx/paseo-demo", version: demo.version, tarball: "demo/demo.tgz", shasum: "x" }],
    }),
  );
  const plan = resolvePublishPlan([demo], { outDir: dir, fromDirs: false });
  check("plan uses the staged tarball", plan[0].target === path.join(dir, "demo", "demo.tgz"));
  check("plan carries the staged version", plan[0].version === demo.version);
});

// --- resolvePublishPlan: stale version is refused ---
withTempStage((dir) => {
  fs.mkdirSync(path.join(dir, "demo"), { recursive: true });
  fs.writeFileSync(path.join(dir, "demo", "demo.tgz"), "fake");
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ packages: [{ id: "demo", version: "0.0.0-stale", tarball: "demo/demo.tgz" }] }),
  );
  check("stale staged version is refused", throws(() => resolvePublishPlan([demo], { outDir: dir, fromDirs: false })));
});

// --- resolvePublishPlan: missing tarball is refused ---
withTempStage((dir) => {
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ packages: [{ id: "demo", version: demo.version, tarball: "demo/gone.tgz" }] }),
  );
  check("missing staged tarball is refused", throws(() => resolvePublishPlan([demo], { outDir: dir, fromDirs: false })));
});

// --- resolvePublishPlan: no stage falls back to plugin dirs ---
withTempStage((dir) => {
  const plan = resolvePublishPlan([demo], { outDir: dir, fromDirs: false });
  check("no stage falls back to the plugin dir", plan[0].dir === path.resolve(demo.dir));
});

// --- resolvePublishPlan: --from-dirs ignores a present stage ---
withTempStage((dir) => {
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ packages: [] }));
  const plan = resolvePublishPlan([demo], { outDir: dir, fromDirs: true });
  check("--from-dirs uses the plugin dir", plan[0].dir === path.resolve(demo.dir));
  check("--from-dirs has no tarball target", plan[0].target === undefined);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
