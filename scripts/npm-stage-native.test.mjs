/** Deterministic unit tests for the npm-native stage → verify → 2fado notify path. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  approvalGuidance,
  assertApprovable,
  classifyOutcome,
  formatOutcomeTable,
  hasStagedVersion,
  isNotFoundError,
  isPlaceholderVersion,
  isPublishedVersion,
  localTarballPath,
  main,
  notificationSummary,
  outcomeCounts,
  PLACEHOLDER_VERSION,
  preflightNotifyDaemon,
  shouldFailBatch,
  stagePackage,
  stagePackages,
  stagingSummary,
  verifyMain,
  verifyStagedPackages,
  writeStagingOutcomes,
} from "./npm-stage-native.mjs";

let pass = 0;
let fail = 0;
const check = (name, condition) => {
  if (condition) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.error(`  FAIL ${name}`); }
};
const entry = { publishAs: "@xpufx/paseo-demo", version: "1.2.3", tarball: "publish-stage/demo/demo.tgz" };
/** The shape publish-npm.mjs actually writes: tarball relative to the stage dir. */
const stageEntry = { publishAs: "@xpufx/paseo-demo", version: "1.2.3", tarball: "demo/demo.tgz" };
const notFound = () => new Error("npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@xpufx%2fpaseo-demo - Not found");

/** Silence the expected warnings these cases emit. */
const quiet = (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
};
const quietAll = (fn) => {
  const log = console.log;
  const warn = console.warn;
  const error = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try { return fn(); } finally { console.log = log; console.warn = warn; console.error = error; }
};

/**
 * A fake npm whose `stage list` and `view` responses are consumed in order (the
 * last entry repeats). A response that is an Error is thrown, so tests can pin
 * both the definitive-404 path and auth/network failures.
 */
function fakeNpm({ stageLists = [[]], published = [notFound()], publishError, notifyError, preflightError } = {}) {
  const calls = [];
  let listIndex = 0;
  let viewIndex = 0;
  const next = (seq, index) => (index < seq.length ? seq[index] : seq[seq.length - 1]);
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === "2fado") {
      if (args[0] === "list" && preflightError) throw preflightError;
      if (args[0] === "notify" && notifyError) throw notifyError;
      return "[]";
    }
    if (args[0] === "stage" && args[1] === "list") return JSON.stringify(next(stageLists, listIndex++) ?? []);
    if (args[0] === "view") {
      const value = next(published, viewIndex++);
      if (value instanceof Error) throw value;
      return JSON.stringify(value ?? []);
    }
    if (args[0] === "stage" && args[1] === "publish") {
      if (publishError) throw publishError;
      return "";
    }
    return "";
  };
  return { run, calls };
}

{
  const calls = [];
  const ok = preflightNotifyDaemon({ run: (command, args) => calls.push([command, args]) });
  check("preflight uses supported 2fado list", JSON.stringify(calls) === JSON.stringify([["2fado", ["list"]]]));
  check("available preflight reports true", ok === true);
}

{
  const calls = [];
  let threw = false;
  try {
    preflightNotifyDaemon({
      run: (command, args) => { calls.push([command, args]); throw new Error("2fado daemon unavailable"); },
    });
  } catch {
    threw = true;
  }
  check("missing preflight throws error by default", threw);
  check("missing preflight only probes", JSON.stringify(calls) === JSON.stringify([["2fado", ["list"]]]));
}

{
  const calls = [];
  const ok = quiet(() => preflightNotifyDaemon({
    run: (command, args) => { calls.push([command, args]); throw new Error("2fado daemon unavailable"); },
    allowNoNotify: true,
  }));
  check("missing preflight with allowNoNotify reports false", ok === false);
  check("missing preflight with allowNoNotify probes", JSON.stringify(calls) === JSON.stringify([["2fado", ["list"]]]));
}

{
  const ok = quiet(() => preflightNotifyDaemon({
    run: () => { throw new Error("2fado daemon unavailable"); },
    env: { TWOFADO_NOTIFY_OPTIONAL: "1" },
  }));
  check("missing preflight with TWOFADO_NOTIFY_OPTIONAL reports false", ok === false);
}

{
  const { run, calls } = fakeNpm({
    stageLists: [[], [{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]],
    published: [notFound()],
    preflightError: new Error("2fado daemon unavailable"),
  });
  let result;
  quiet(() => { result = stagePackages({ packages: [entry] }, { run, link: "https://forge.example/runs/42", allowNoNotify: true }); });
  check("unavailable daemon does not block staging when opt-out passed", result?.[0]?.outcome === "staged");
  check("unavailable daemon skips notify", !calls.some(([command, args]) => command === "2fado" && args[0] === "notify"));
}

{
  // Decoupled by default: staging never probes the notify daemon, so a missing
  // 2fado CLI cannot fail the stage even without an explicit opt-out (#990).
  const { run, calls } = fakeNpm({
    stageLists: [[], [{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]],
    published: [notFound()],
    preflightError: new Error("2fado daemon unavailable"),
  });
  let result;
  quiet(() => { result = stagePackages({ packages: [entry] }, { run, link: "https://forge.example/runs/42" }); });
  check("staging succeeds without notify by default", result?.[0]?.outcome === "staged");
  check("staging never probes 2fado by default", !calls.some(([command]) => command === "2fado"));
}

{
  // Opt-in notification is best-effort: an unreachable daemon warns but the
  // stage still succeeds.
  const { run } = fakeNpm({
    stageLists: [[], [{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]],
    published: [notFound()],
    preflightError: new Error("2fado daemon unavailable"),
  });
  let result;
  quiet(() => { result = stagePackages({ packages: [entry] }, { run, notify: true, link: "https://forge.example/runs/42" }); });
  check("opt-in notify with missing daemon still stages", result?.[0]?.outcome === "staged");
}

{
  // Genuine stage: the intended version shows up in the staging area after publish.
  const { run, calls } = fakeNpm({
    stageLists: [[], [{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]],
    published: [notFound()],
  });
  const result = stagePackage(entry, { run, link: "https://forge.example/runs/42" });
  check("genuine stage reports staged", result.outcome === "staged");
  check("genuine stage verifies against the staging area", calls.filter(([command, args]) => command === "npm" && args[0] === "stage" && args[1] === "list").length === 2);
  check("genuine stage publishes to npm stage", calls.some(([command, args]) => command === "npm" && args[0] === "stage" && args[1] === "publish"));
  check("genuine stage emits one 2fado notify", calls.filter(([command, args]) => command === "2fado" && args[0] === "notify").length === 1);
  check("genuine stage notify carries the version summary", calls.some(([command, args]) => command === "2fado" && args[0] === "notify" && args.includes(notificationSummary(entry.publishAs, entry.version))));
}

{
  // The bug: npm exits 0 but only the 0.0.0-stage placeholder reaches the registry.
  const { run, calls } = fakeNpm({
    stageLists: [[], [{ packageName: entry.publishAs, version: PLACEHOLDER_VERSION, id: "stage-0" }]],
    published: [notFound()],
  });
  let result;
  quiet(() => { result = stagePackage(entry, { run, link: "https://forge.example/runs/42" }); });
  check("placeholder-only stage reports placeholder", result.outcome === "placeholder");
  check("placeholder-only stage still attempted publish", calls.some(([command, args]) => command === "npm" && args[0] === "stage" && args[1] === "publish"));
  check("placeholder-only stage never notifies approval", !calls.some(([command, args]) => command === "2fado" && args[0] === "notify"));
}

{
  // A placeholder can also be detected from published versions rather than the stage list.
  const { run } = fakeNpm({
    stageLists: [[], []],
    published: [notFound(), [PLACEHOLDER_VERSION]],
  });
  let result;
  quiet(() => { result = stagePackage(entry, { run, link: "https://forge.example/runs/42" }); });
  check("placeholder-only stage detected from npm view", result.outcome === "placeholder");
}

{
  const { run, calls } = fakeNpm({ stageLists: [[{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]] });
  const result = stagePackage(entry, { run, link: "https://forge.example/runs/42" });
  check("already-staged reports skipped", result.outcome === "skipped" && result.detail === "already staged");
  check("already-staged does not publish or notify", calls.length === 1);
}

{
  const { run, calls } = fakeNpm({ stageLists: [[]], published: [["0.1.0", entry.version]] });
  const result = stagePackage(entry, { run, link: "https://forge.example/runs/42" });
  check("already-published reports skipped", result.outcome === "skipped" && result.detail === "already published");
  check("already-published does not publish", !calls.some(([command, args]) => command === "npm" && args[0] === "stage" && args[1] === "publish"));
}

{
  // A non-404 npm view failure is not "not published": it must surface.
  const { run } = fakeNpm({ stageLists: [[]], published: [new Error("npm error code E401 Unauthorized")] });
  let threw = false;
  try { stagePackage(entry, { run, link: "https://forge.example/runs/42" }); } catch { threw = true; }
  check("npm view auth failure surfaces from stagePackage", threw);
}

{
  const { run } = fakeNpm({ stageLists: [[]], published: [new Error("npm error network request to https://registry.npmjs.org failed")] });
  const results = stagePackages({ packages: [entry] }, { run, notify: false, link: "https://forge.example/runs/42" });
  check("npm view network failure is collected as failed", results[0].outcome === "failed");
  check("all-failed batch fails", shouldFailBatch(results) === true);
}

{
  // A definitive 404 means never published, which is still stageable.
  const { run, calls } = fakeNpm({
    stageLists: [[], [{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]],
    published: [new Error("npm error 404 Not Found - GET https://registry.npmjs.org/@xpufx%2fpaseo-demo - Not found")],
  });
  const result = stagePackage(entry, { run, link: "https://forge.example/runs/42" });
  check("definitive 404 still stages", result.outcome === "staged");
  check("definitive 404 reaches npm stage publish", calls.some(([command, args]) => command === "npm" && args[0] === "stage" && args[1] === "publish"));
}

{
  // One bad package must not hide a good one, and the batch must not throw.
  const good = { publishAs: "@xpufx/paseo-good", version: "2.0.0", tarball: "good/good.tgz" };
  const bad = { publishAs: "@xpufx/paseo-bad", version: "2.0.0", tarball: "bad/bad.tgz" };
  const staged = new Set();
  const run = (command, args) => {
    if (command === "2fado") return "[]";
    if (args[0] === "stage" && args[1] === "list") {
      const pkg = args[2];
      return JSON.stringify(staged.has(pkg) ? [{ packageName: pkg, version: "2.0.0", id: `stage-${pkg}` }] : []);
    }
    if (args[0] === "view") {
      if (args[1] === bad.publishAs) throw new Error("npm error code E500 registry exploded");
      throw notFound();
    }
    if (args[0] === "stage" && args[1] === "publish") { staged.add(args[2].includes("good") ? good.publishAs : bad.publishAs); return ""; }
    return "";
  };
  let results;
  quiet(() => { results = stagePackages({ packages: [bad, good] }, { run, notify: false, link: "https://forge.example/runs/42" }); });
  check("batch collects a per-package failure", results[0].outcome === "failed");
  check("batch continues past a failure", results[1].outcome === "staged");
  check("mixed batch fails on errors", shouldFailBatch(results) === true);
}

{
  const { run, calls } = fakeNpm({
    stageLists: [[]],
    published: [notFound()],
    publishError: new Error("npm stage publish failed"),
  });
  let threw = false;
  try { stagePackage(entry, { run, link: "https://forge.example/runs/42" }); } catch { threw = true; }
  check("failed stage propagates from stagePackage", threw);
  check("failed stage does not notify", !calls.some(([command, args]) => command === "2fado" && args[0] === "notify"));
}

{
  const { run } = fakeNpm({
    stageLists: [[], [{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]],
    published: [notFound()],
    notifyError: new Error("2fado notify failed"),
  });
  let result;
  let threw = false;
  quiet(() => {
    try { result = stagePackage(entry, { run, link: "https://forge.example/runs/42" }); }
    catch { threw = true; }
  });
  check("failed notify does not fail staging", !threw && result?.outcome === "staged");
}

{
  check("bare relative tarball is rooted", localTarballPath("demo/pkg.tgz") === "./demo/pkg.tgz");
  check("dot-prefixed tarball is preserved", localTarballPath("./demo/pkg.tgz") === "./demo/pkg.tgz");
  check("parent-relative tarball is preserved", localTarballPath("../shared/pkg.tgz") === "../shared/pkg.tgz");
  check("absolute tarball is preserved", localTarballPath("/tmp/stage/pkg.tgz") === "/tmp/stage/pkg.tgz");
  check("stage-relative tarball resolves under the manifest dir", localTarballPath("demo/pkg.tgz", "/w/publish-stage") === "/w/publish-stage/demo/pkg.tgz");
}

{
  // The manifest publish-npm.mjs writes records tarballs relative to the stage
  // dir, so a baseDir must reach npm or every stage dies on ENOENT.
  const { run, calls } = fakeNpm({
    stageLists: [[], [{ packageName: stageEntry.publishAs, version: stageEntry.version, id: "stage-1" }]],
    published: [notFound()],
  });
  const result = stagePackage(stageEntry, { run, link: "https://forge.example/runs/42", baseDir: "/w/publish-stage" });
  check("stage-relative manifest entry stages", result.outcome === "staged");
  const publish = calls.find(([command, args]) => command === "npm" && args[0] === "stage" && args[1] === "publish");
  check("stage-relative manifest entry publishes an absolute tarball", publish[1][2] === path.join("/w/publish-stage", stageEntry.tarball));
}

check("published matching is exact", isPublishedVersion(["1.2.3"], "1.2.4") === false);
check("duplicate matching is exact", hasStagedVersion([{ packageName: entry.publishAs, version: "1.2.4" }], entry.publishAs, entry.version) === false);
check("E404 is a not-found error", isNotFoundError(new Error("npm error code E404")) === true);
check("404 Not Found is a not-found error", isNotFoundError(new Error("404 Not Found - GET https://registry.npmjs.org/x")) === true);
check("E401 is not a not-found error", isNotFoundError(new Error("npm error code E401 Unauthorized")) === false);
check("network failure is not a not-found error", isNotFoundError(new Error("npm error network request failed")) === false);
check("placeholder version is detected", isPlaceholderVersion(PLACEHOLDER_VERSION) === true);
check("real version is not a placeholder", isPlaceholderVersion("1.2.3") === false);

{
  let refused = false;
  try { assertApprovable([{ packageName: entry.publishAs, version: PLACEHOLDER_VERSION }], entry.version); } catch { refused = true; }
  check("approving a placeholder is refused", refused);
  check("approving the real staged version is allowed", assertApprovable([{ packageName: entry.publishAs, version: entry.version }], entry.version) === true);
  check("approval guidance refuses a placeholder stage", approvalGuidance([{ packageName: entry.publishAs, version: PLACEHOLDER_VERSION }], entry.version).approvable === false);
  check("approval guidance names the real approve command", approvalGuidance([{ packageName: entry.publishAs, version: entry.version, id: "stage-9" }], entry.version).message === "npm stage approve stage-9 (2FA)");
}

{
  const counts = outcomeCounts([{ outcome: "staged" }, { outcome: "placeholder" }, { outcome: "failed" }, { outcome: "skipped" }]);
  check("outcome counts tally each outcome", counts.staged === 1 && counts.placeholder === 1 && counts.failed === 1 && counts.skipped === 1);
  check("outcome table renders a markdown header", formatOutcomeTable([{ packageName: "p", version: "1", outcome: "staged", detail: "ok" }]).startsWith("| package |"));
  check("empty batch never fails", shouldFailBatch([]) === false);
  check("all-placeholder batch fails", shouldFailBatch([{ outcome: "placeholder" }]) === true);
  check("a single skip keeps the batch green", shouldFailBatch([{ outcome: "skipped" }]) === false);
}

{
  // #1002: an already-published version is live, so verification must not look
  // for it in the staging area.
  const { run, calls } = fakeNpm({ stageLists: [[]] });
  const manifest = {
    packages: [entry],
    staging: { packages: [{ publishAs: entry.publishAs, version: entry.version, outcome: "skipped_already_published" }] },
  };
  const result = verifyStagedPackages(manifest, { run });
  check("already-published package verifies as skipped", result.skipped.length === 1 && result.failed.length === 0);
  check("already-published package never queries the stage list", calls.length === 0);
  check("all-skipped run has nothing to verify", result.verified.length === 0);
}

{
  // Mixed batch: only the staged package is checked against the registry.
  const staged = { publishAs: "@xpufx/paseo-staged", version: "2.0.0" };
  const published = { publishAs: "@xpufx/paseo-published", version: "1.0.0" };
  const { run, calls } = fakeNpm({ stageLists: [[{ packageName: staged.publishAs, version: staged.version, id: "stage-1" }]] });
  const manifest = {
    packages: [staged, published],
    staging: { packages: [
      { publishAs: staged.publishAs, version: staged.version, outcome: "staged" },
      { publishAs: published.publishAs, version: published.version, outcome: "skipped_already_published" },
    ] },
  };
  const result = verifyStagedPackages(manifest, { run });
  check("mixed batch verifies the staged package", result.verified.length === 1 && result.verified[0].publishAs === staged.publishAs);
  check("mixed batch skips the published package", result.skipped.length === 1 && result.failed.length === 0);
  check("mixed batch only queries the staged package", calls.length === 1 && calls[0][1][2] === staged.publishAs);
}

{
  // A genuinely staged package must still fail if it is absent from the registry.
  const { run } = fakeNpm({ stageLists: [[]] });
  const manifest = {
    packages: [entry],
    staging: { packages: [{ publishAs: entry.publishAs, version: entry.version, outcome: "staged" }] },
  };
  const result = verifyStagedPackages(manifest, { run });
  check("staged package missing from the registry fails", result.failed.length === 1 && result.verified.length === 0);
}

{
  // A staging failure or placeholder is fatal here too, even though the stage
  // step would already have reded the job.
  const { run } = fakeNpm({ stageLists: [[]] });
  const manifest = {
    packages: [entry],
    staging: { packages: [{ publishAs: entry.publishAs, version: entry.version, outcome: "failed" }] },
  };
  const result = verifyStagedPackages(manifest, { run });
  check("failed staging outcome fails verification", result.failed.length === 1);
}

{
  // No staging record (legacy manifest): verify rather than assume success.
  const { run } = fakeNpm({ stageLists: [[{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]] });
  const result = verifyStagedPackages({ packages: [entry] }, { run });
  check("manifest without a staging record still verifies", result.verified.length === 1);
}

{
  const results = [
    { outcome: "staged", packageName: entry.publishAs, version: entry.version, detail: "verified in the npm staging area" },
    { outcome: "skipped", packageName: "@xpufx/live", version: "1.0.0", detail: "already published" },
    { outcome: "skipped", packageName: "@xpufx/old", version: "1.0.0", detail: "already staged" },
    { outcome: "placeholder", packageName: "@xpufx/ph", version: "1.0.0", detail: "only placeholder" },
    { outcome: "failed", packageName: "@xpufx/bad", version: "1.0.0", detail: "boom" },
  ];
  const summary = stagingSummary(results, new Date("2026-01-01T00:00:00Z"));
  check("staging summary classifies each outcome", summary.counts.staged === 1 && summary.counts.skipped_already_published === 1 && summary.counts.skipped_already_staged === 1 && summary.counts.placeholder === 1 && summary.counts.failed === 1);
  check("staging summary records the completion time", summary.completedAt === "2026-01-01T00:00:00.000Z");
  check("classifyOutcome maps published skip", classifyOutcome({ outcome: "skipped", detail: "already published" }) === "skipped_already_published");
  check("classifyOutcome maps already-staged skip", classifyOutcome({ outcome: "skipped", detail: "already staged" }) === "skipped_already_staged");
}

{
  // writeStagingOutcomes is additive: the packed package list survives.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "npm-stage-manifest-"));
  const manifestPath = path.join(tmp, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ stagedAt: "x", gitBranch: "main", packages: [entry] }));
  const summary = writeStagingOutcomes(manifestPath, [{ outcome: "skipped", packageName: entry.publishAs, version: entry.version, detail: "already published" }]);
  const written = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  check("staging outcomes are additive to the manifest", written.packages.length === 1 && written.gitBranch === "main");
  check("staging outcomes are persisted", written.staging?.packages?.[0]?.outcome === "skipped_already_published" && summary.counts.skipped_already_published === 1);
  fs.rmSync(tmp, { recursive: true, force: true });
}

{
  // End-to-end all-skipped: verifyMain exits zero and never invokes npm.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "npm-stage-verify-"));
  const manifestPath = path.join(tmp, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    packages: [entry],
    staging: { packages: [{ publishAs: entry.publishAs, version: entry.version, outcome: "skipped_already_published" }] },
  }));
  const fakeNpmPath = path.join(tmp, "npm");
  fs.writeFileSync(fakeNpmPath, "#!/bin/sh\necho 'npm must not be called' >&2\nexit 3\n");
  fs.chmodSync(fakeNpmPath, 0o755);
  const savedExit = process.exitCode;
  let exit;
  try {
    process.exitCode = 0;
    quietAll(() => verifyMain([`--verify-manifest=${manifestPath}`], { NPM_STAGE_NPM_BIN: fakeNpmPath }));
    exit = process.exitCode;
  } finally {
    process.exitCode = savedExit;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check("all-skipped verify exits zero", exit === 0);
}

{
  // End-to-end: main() must exit non-zero when npm view fails for every package.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "npm-stage-native-test-"));
  const manifestPath = path.join(tmp, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ packages: [entry] }));
  const fakeNpmPath = path.join(tmp, "npm");
  fs.writeFileSync(fakeNpmPath, [
    "#!/usr/bin/env node",
    'const a = process.argv.slice(2);',
    'if (a[0] === "stage" && a[1] === "list") { process.stdout.write("[]"); }',
    'else if (a[0] === "view") { process.stderr.write("npm error code E401 Unauthorized\\n"); process.exit(1); }',
    'else { process.stdout.write(""); }',
  ].join("\n"));
  fs.chmodSync(fakeNpmPath, 0o755);
  const savedExit = process.exitCode;
  let exit;
  try {
    quietAll(() => main([`--manifest=${manifestPath}`, "--skip-notify"], {
      NPM_STAGE_NPM_BIN: fakeNpmPath,
      TWOFADO_NOTIFY_BIN: path.join(tmp, "missing-2fado"),
      GITHUB_SERVER_URL: "https://forge.example.com",
      GITHUB_REPOSITORY: "xpufx-org/paseo",
      GITHUB_RUN_ID: "42",
    }));
    exit = process.exitCode;
  } finally {
    process.exitCode = savedExit;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check("no package staged exits non-zero", exit === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
