/** Deterministic unit tests for the doctor reload → 2fado notify path. */
import { notifyReloadOutcome, reloadNotifyEnabled, reloadNotifySummary } from "./reload-notify.mjs";

let pass = 0;
let fail = 0;
const check = (name, condition) => {
  if (condition) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.error(`  FAIL ${name}`); }
};

{
  const reloaded = ["top", "x-comms"];
  const failed = ["slash"];
  check("summary lists reloaded and failed", reloadNotifySummary({ reloaded, failed, repoHead: "abc1234" }) === "Paseo reloaded top, x-comms; failed: slash @ abc1234");
  check("summary is empty with nothing reloaded", reloadNotifySummary({ reloaded: [], failed: [] }) === "");
}

check("opt-out gate honors PASEO_RELOAD_NOTIFY=0", reloadNotifyEnabled({ PASEO_RELOAD_NOTIFY: "0" }) === false);
check("gate defaults to enabled", reloadNotifyEnabled({}) === true);

{
  const calls = [];
  const ok = await notifyReloadOutcome({
    reloaded: ["top"],
    failed: [],
    repoHead: "abc1234",
    env: {},
    run: (command, args) => calls.push([command, args]),
  });
  check("enabled run sends one notify", ok === true && JSON.stringify(calls) === JSON.stringify([["2fado", ["notify", "--link", "http://localhost:3000", "--summary", "Paseo reloaded top @ abc1234"]]]));
}

{
  const calls = [];
  const ok = await notifyReloadOutcome({
    reloaded: [],
    failed: ["slash"],
    repoHead: "abc1234",
    env: { PASEO_RELOAD_NOTIFY_LINK: "https://forge.example/runs/42", TWOFADO_NOTIFY_BIN: "twofado-wrapper" },
    run: (command, args) => calls.push([command, args]),
  });
  check("failed reloads notify with env link and bin", ok === true && JSON.stringify(calls) === JSON.stringify([["twofado-wrapper", ["notify", "--link", "https://forge.example/runs/42", "--summary", "Paseo failed: slash @ abc1234"]]]));
}

{
  const calls = [];
  const ok = await notifyReloadOutcome({ reloaded: [], failed: [], repoHead: "abc1234", env: {}, run: (command, args) => calls.push([command, args]) });
  check("no-op run sends nothing", ok === false && calls.length === 0);
}

{
  const calls = [];
  const ok = await notifyReloadOutcome({ reloaded: ["top"], failed: [], repoHead: "abc1234", env: { PASEO_RELOAD_NOTIFY: "0" }, run: (command, args) => calls.push([command, args]) });
  check("opt-out sends nothing", ok === false && calls.length === 0);
}

{
  const ok = await notifyReloadOutcome({ reloaded: ["top"], failed: [], repoHead: "abc1234", env: {}, run: () => { throw new Error("2fado daemon unavailable"); } });
  check("daemon failure never throws", ok === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);