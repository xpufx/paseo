/**
 * Unit tests for the numberless label migration planner (paseo#1007).
 *
 * Run: node scripts/migrate-numberless-labels.test.mjs
 */
import { LABEL_MIGRATIONS, parseLabels, planMigration } from "./migrate-numberless-labels.mjs";

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

check("no numeric labels means no plan", planMigration(["state/wip", "kind/bug"]) === null);
check("empty labels means no plan", planMigration([]) === null);

const state = planMigration(["state/1-wip", "kind/bug"]);
check("maps numeric state", state.add.join(",") === "state/wip" && state.remove.join(",") === "state/1-wip");

const multi = planMigration(["attention/0-orchestrator", "priority/0-SOS", "state/2-review"]);
check("maps several scopes at once", multi.add.join(",") === "attention/orchestrator,priority/sos,state/review");
check("removes every numeric label found", multi.remove.join(",") === "attention/0-orchestrator,priority/0-SOS,state/2-review");

const already = planMigration(["state/1-wip", "state/wip"]);
check("does not re-add a numberless label already present", already.add.length === 0 && already.remove.join(",") === "state/1-wip");

check("parses the space-separated teax labels field", parseLabels("a/b c/d").join("|") === "a/b|c/d");
check("blank labels field parses to empty", parseLabels(undefined).length === 0);

check(
  "every mapping target is numberless",
  Object.values(LABEL_MIGRATIONS).every((name) => !/\/\d/.test(name)),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
