/** Deterministic unit tests for the npm-native stage → 2fado notify path. */
import path from "node:path";
import { hasStagedVersion, localTarballPath, notificationSummary, preflightNotifyDaemon, stagePackage, stagePackages } from "./npm-stage-native.mjs";

let pass = 0;
let fail = 0;
const check = (name, condition) => {
  if (condition) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.error(`  FAIL ${name}`); }
};
const entry = { publishAs: "@xpufx/paseo-demo", version: "1.2.3", tarball: "publish-stage/demo/demo.tgz" };
/** The shape publish-npm.mjs actually writes: tarball relative to the stage dir. */
const stageEntry = { publishAs: "@xpufx/paseo-demo", version: "1.2.3", tarball: "demo/demo.tgz" };

/** Silence the expected warnings these cases emit. */
const quiet = (fn) => {
  const warn = console.warn;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
};

{
  const calls = [];
  const ok = preflightNotifyDaemon({ run: (command, args) => calls.push([command, args]) });
  check("preflight uses supported 2fado list", JSON.stringify(calls) === JSON.stringify([["2fado", ["list"]]]));
  check("available preflight reports true", ok === true);
}

{
  const calls = [];
  const ok = quiet(() => preflightNotifyDaemon({
    run: (command, args) => { calls.push([command, args]); throw new Error("2fado daemon unavailable"); },
  }));
  check("missing preflight reports false", ok === false);
  check("missing preflight only probes", JSON.stringify(calls) === JSON.stringify([["2fado", ["list"]]]));
}

{
  const calls = [];
  let threw = false;
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === "2fado" && args[0] === "list") throw new Error("2fado daemon unavailable");
    return command === "npm" && args[1] === "list" ? "[]" : "";
  };
  let result;
  quiet(() => {
    try { result = stagePackages({ packages: [entry] }, { run, link: "https://forge.example/runs/42" }); }
    catch { threw = true; }
  });
  check("unavailable daemon does not block staging", !threw && result?.[0]?.outcome === "staged");
  check("unavailable daemon skips notify", !calls.some(([command, args]) => command === "2fado" && args[0] === "notify"));
}

{
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === "2fado") return "[]";
    return args[1] === "list" ? "[]" : "";
  };
  const result = stagePackage(entry, { run, link: "https://forge.example/runs/42" });
  check("success reports staged", result.outcome === "staged");
  check("success publishes to npm stage", JSON.stringify(calls[1]) === JSON.stringify(["npm", ["stage", "publish", `./${entry.tarball}`, "--access", "public"]]));
  check("success emits one 2fado notify", JSON.stringify(calls[2]) === JSON.stringify(["2fado", ["notify", "--link", "https://forge.example/runs/42", "--summary", notificationSummary(entry.publishAs, entry.version)]]));
}

{
  const calls = [];
  const run = (command, args) => {
    calls.push([command, args]);
    if (command === "2fado") throw new Error("2fado notify failed");
    return args[1] === "list" ? "[]" : "";
  };
  let result;
  let threw = false;
  quiet(() => {
    try { result = stagePackage(entry, { run, link: "https://forge.example/runs/42" }); }
    catch { threw = true; }
  });
  check("failed notify does not fail staging", !threw && result?.outcome === "staged");
  check("failed notify still ran npm stage", calls.some(([command, args]) => command === "npm" && args[1] === "publish"));
}

{
  const calls = [];
  const result = stagePackage(entry, {
    run: (command, args) => { calls.push([command, args]); return JSON.stringify([{ packageName: entry.publishAs, version: entry.version, id: "stage-1" }]); },
    link: "https://forge.example/runs/42",
  });
  check("duplicate reports skipped", result.outcome === "skipped");
  check("duplicate does not publish or notify", calls.length === 1);
}

{
  const calls = [];
  let threw = false;
  try {
    stagePackage(entry, {
      run: (command, args) => { calls.push([command, args]); if (args[1] === "list") return "[]"; throw new Error("npm stage publish failed"); },
      link: "https://forge.example/runs/42",
    });
  } catch { threw = true; }
  check("failed stage propagates failure", threw);
  check("failed stage does not notify", calls.length === 2 && calls.every(([command]) => command === "npm"));
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
  const calls = [];
  const run = (command, args) => { calls.push([command, args]); return args[1] === "list" ? "[]" : ""; };
  const result = stagePackage(stageEntry, { run, link: "https://forge.example/runs/42", baseDir: "/w/publish-stage" });
  check("stage-relative manifest entry stages", result.outcome === "staged");
  check("stage-relative manifest entry publishes an absolute tarball", calls[1][1][2] === path.join("/w/publish-stage", stageEntry.tarball));
}

check("duplicate matching is exact", hasStagedVersion([{ packageName: entry.publishAs, version: "1.2.4" }], entry.publishAs, entry.version) === false);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
