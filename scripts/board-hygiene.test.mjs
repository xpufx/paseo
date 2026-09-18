/**
 * Unit tests for board-hygiene detection logic (paseo#217).
 *
 * Run: node scripts/board-hygiene.test.mjs
 *
 * These cover the two rules and — importantly — the labels that must NOT be
 * flagged. `flag/security`, `flag/evergreen`, `upstream/*`, `kind/*` and
 * `target/*` are classifications, not action signals; a closed issue keeping
 * them is correct (the rule applied throughout the #217 cleanup).
 */
import { openRoutingGaps, closedStaleLabels, orchestratorParked } from "./board-hygiene.mjs";

const mk = (number, title, labels) => ({ number, title, labels: labels.map((name) => ({ name })) });

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

// --- open, unrouted ---
check("flags open with no attention", openRoutingGaps([mk(1, "x", ["kind/bug", "state/1-wip"])]).length === 1);
check("flags open with no state", openRoutingGaps([mk(2, "x", ["kind/bug", "attention/2-user"])]).length === 1);
check("flags open missing both", openRoutingGaps([mk(3, "x", ["kind/bug"])]).length === 1);
check("passes fully-routed open", openRoutingGaps([mk(4, "x", ["attention/2-user", "state/3-verify"])]).length === 0);
check("names the missing labels", openRoutingGaps([mk(5, "x", ["kind/bug"])])[0].missing.length === 2);

// --- closed, stale action signals ---
check("flags closed attention/1-agent", closedStaleLabels([mk(6, "x", ["attention/1-agent", "state/4-done"])]).length === 1);
check("flags closed attention/2-user", closedStaleLabels([mk(7, "x", ["attention/2-user"])]).length === 1);
check("flags closed dep/blocked", closedStaleLabels([mk(8, "x", ["dep/blocked"])]).length === 1);
check("flags closed priority/0-SOS", closedStaleLabels([mk(9, "x", ["priority/0-SOS"])]).length === 1);
check("flags closed flag/stop-work", closedStaleLabels([mk(10, "x", ["flag/stop-work"])]).length === 1);
check("flags closed non-terminal state", closedStaleLabels([mk(11, "x", ["state/3-verify"])]).length === 1);
check("flags closed format/0-needed", closedStaleLabels([mk(12, "x", ["format/0-needed"])]).length === 1);
check("passes properly closed", closedStaleLabels([mk(13, "x", ["attention/3-ignore", "state/4-done"])]).length === 0);
check("passes closed with no labels", closedStaleLabels([mk(14, "x", [])]).length === 0);

// --- classifications must survive closure ---
check("keeps flag/security", closedStaleLabels([mk(15, "x", ["flag/security", "state/4-done"])]).length === 0);
check("keeps flag/evergreen", closedStaleLabels([mk(16, "x", ["flag/evergreen"])]).length === 0);
check("keeps upstream/0-explore", closedStaleLabels([mk(17, "x", ["upstream/0-explore"])]).length === 0);
check("keeps kind/target", closedStaleLabels([mk(18, "x", ["kind/bug", "target/top", "state/4-done"])]).length === 0);

// --- parked on attention/0-orchestrator (idle window) ---
const NOW = Date.parse("2026-09-18T08:00:00Z");
const idle = (h) => new Date(NOW - h * 3600_000).toISOString();
const mkAt = (number, labels, updated) => ({ number, title: "x", labels: labels.map((name) => ({ name })), updated_at: updated });

check("flags 0-orchestrator idle > 2h", orchestratorParked([mkAt(20, ["attention/0-orchestrator"], idle(3))], NOW).length === 1);
check("does not flag 0-orchestrator idle < 2h", orchestratorParked([mkAt(21, ["attention/0-orchestrator"], idle(1))], NOW).length === 0);
check("boundary: exactly 2h is not yet flagged", orchestratorParked([mkAt(22, ["attention/0-orchestrator"], idle(2))], NOW).length === 0);
check("ignores 1-agent even if stale", orchestratorParked([mkAt(23, ["attention/1-agent"], idle(9))], NOW).length === 0);
check("ignores 2-user even if stale", orchestratorParked([mkAt(24, ["attention/2-user"], idle(9))], NOW).length === 0);
check("reports idle minutes", orchestratorParked([mkAt(25, ["attention/0-orchestrator"], idle(5))], NOW)[0].idleMinutes >= 299);
check("skips unparseable updated_at", orchestratorParked([mkAt(26, ["attention/0-orchestrator"], "not-a-date")], NOW).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
