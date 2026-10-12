// Ported regression coverage for the stale state/1-wip recovery sweep.
//
// Mirrors platform `scripts/forgejo-issues-check.test.py` fixture for fixture
// and expectation for expectation (#733). The Python suite stubs module-level
// functions with `unittest.mock.patch`; this suite passes the same stubs as the
// `IssuesCheckIo` dependency object, which is the same seam.
//
// Parity against the Python original itself is a separate, recorded exercise:
// see `docs/issues-check-parity.md`.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  STALE_WIP_LABEL,
  STALE_WIP_REMINDER_MARKER,
  STALE_WIP_SKIP_LABELS,
  TRIAGE_STATE_LABEL,
  createDefaultIssuesCheckIo,
  recoverStaleWipIssue,
  sweepStaleWipIssues,
  staleWipAge,
  classifyCandidate,
  isDispatchableCandidate,
  isActionable,
  hasStateLabel,
  needsStateTriage,
  normalizeStatelessIssue,
  runIssuesCheck,
  sweepStatelessIssues,
  renderIssuesCheckMarkdown,
  type ForgejoComment,
  type ForgejoIssue,
  type IssueSignature,
  type IssuesCheckIo,
  type IssuesCheckOutcome,
} from "./issues-check.js";

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);

function issue(number = 1, { labels, updatedAt = "2026-09-20T09:00:00Z", state = "open" }: {
  labels?: string[];
  updatedAt?: string;
  state?: string;
} = {}): ForgejoIssue {
  return {
    number,
    state,
    updated_at: updatedAt,
    labels: (labels ?? [STALE_WIP_LABEL, "kind/feature", "priority/2-normal"]).map((name) => ({ name })),
  };
}

interface CommandCall {
  command: string[];
  inputText?: string;
}

function fakeIo(comments: ForgejoComment[], runResult = true): {
  io: Pick<IssuesCheckIo, "getIssueComments" | "runStaleWipCommand">;
  calls: CommandCall[];
} {
  const calls: CommandCall[] = [];
  return {
    io: {
      getIssueComments: async () => comments,
      runStaleWipCommand: async (command, inputText) => {
        calls.push({ command, inputText });
        return runResult;
      },
    },
    calls,
  };
}

describe("stale WIP sweep (ported from forgejo-issues-check.test.py)", () => {
  it("only open stale WIP without suppressors qualifies", async () => {
    assert.notEqual(staleWipAge(issue(), NOW), null);
    assert.equal(staleWipAge(issue(1, { state: "closed" }), NOW), null);
    assert.equal(staleWipAge(issue(1, { labels: ["kind/feature"] }), NOW), null);
    for (const label of STALE_WIP_SKIP_LABELS) {
      assert.equal(staleWipAge(issue(1, { labels: [STALE_WIP_LABEL, label] }), NOW), null);
    }
  });

  it("threshold and invalid or future timestamps are safe", async () => {
    const almostTwoHours = new Date(NOW - (60 * 60 * 1000 + 59 * 60 * 1000)).toISOString().replace("Z", "+00:00");
    const { io } = fakeIo([]);
    assert.deepEqual(
      await sweepStaleWipIssues(io, "host", "org/repo", [issue(1, { updatedAt: almostTwoHours })], 2, { now: NOW }),
      [],
    );
    assert.equal(staleWipAge(issue(1, { updatedAt: "not-a-date" }), NOW), null);
    assert.equal(
      staleWipAge(issue(1, { updatedAt: new Date(NOW + 60 * 1000).toISOString().replace("Z", "+00:00") }), NOW),
      null,
    );
  });

  it("recovery comments once then changes only workflow labels", async () => {
    const { io, calls } = fakeIo([]);
    const result = await recoverStaleWipIssue(io, "host", "org/repo", issue());
    assert.equal(result.reminded, true);
    assert.equal(result.recovered, true);
    assert.equal(calls.length, 2);
    const commentBody = calls[0].inputText ?? "";
    assert.ok(commentBody.includes(STALE_WIP_REMINDER_MARKER));
    const labelsCommand = calls[1].command.join(" ");
    assert.ok(labelsCommand.includes("attention/orchestrator"));
    assert.ok(labelsCommand.includes("state/wip"));
    assert.ok(!labelsCommand.includes("kind/feature"));
    assert.ok(!labelsCommand.includes("priority/2-normal"));
  });

  it("comment command pipes JSON body through the teax api stdin sentinel", async () => {
    const { io, calls } = fakeIo([]);
    const result = await recoverStaleWipIssue(io, "host", "org/repo", issue());
    assert.equal(result.recovered, true);
    const commentCmd = calls[0].command;
    assert.equal(commentCmd[0], "teax");
    assert.equal(commentCmd[1], "api");
    assert.ok(commentCmd.includes("repos/org/repo/issues/1/comments"));
    assert.ok(commentCmd.includes("--data"));
    assert.ok(commentCmd.includes("@-"));
    assert.ok(!commentCmd.includes("--input"));
  });

  it("existing marker retries labels without duplicate comment", async () => {
    const { io, calls } = fakeIo([{ body: STALE_WIP_REMINDER_MARKER }]);
    const result = await recoverStaleWipIssue(io, "host", "org/repo", issue());
    assert.equal(result.reminded, false);
    assert.equal(result.recovered, true);
    assert.equal(calls.length, 1);
  });

  it("dry run does not write", async () => {
    const { io, calls } = fakeIo([]);
    const result = await recoverStaleWipIssue(io, "host", "org/repo", issue(), { dryRun: true });
    assert.equal(result.dry_run, true);
    assert.deepEqual(calls, []);
  });
});

describe("getOpenIssues pagination (#1195)", () => {
  it("paginates across multiple pages until a partial page is returned", async () => {
    const requestedUrls: string[] = [];
    const page1Issues = Array.from({ length: 50 }, (_, i) => issue(i + 1));
    const page2Issues = Array.from({ length: 15 }, (_, i) => issue(i + 51));

    const runner = async (args: string[]) => {
      const url = args[1];
      requestedUrls.push(url);
      if (url.includes("page=1")) {
        return { code: 0, stdout: JSON.stringify(page1Issues), stderr: "" };
      }
      if (url.includes("page=2")) {
        return { code: 0, stdout: JSON.stringify(page2Issues), stderr: "" };
      }
      return { code: 0, stdout: "[]", stderr: "" };
    };

    const io = createDefaultIssuesCheckIo(runner);
    const result = await io.getOpenIssues("forge.example.com", "org/repo");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.issues.length, 65);
    assert.equal(requestedUrls.length, 2);
    assert.ok(requestedUrls[0].includes("limit=50&page=1"));
    assert.ok(requestedUrls[1].includes("limit=50&page=2"));
  });

  it("stops immediately if the first page has fewer than limit items", async () => {
    const requestedUrls: string[] = [];
    const page1Issues = Array.from({ length: 10 }, (_, i) => issue(i + 1));

    const runner = async (args: string[]) => {
      requestedUrls.push(args[1]);
      return { code: 0, stdout: JSON.stringify(page1Issues), stderr: "" };
    };

    const io = createDefaultIssuesCheckIo(runner);
    const result = await io.getOpenIssues("forge.example.com", "org/repo");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.issues.length, 10);
    assert.equal(requestedUrls.length, 1);
  });

  it("handles empty issues list gracefully", async () => {
    const runner = async () => ({ code: 0, stdout: "[]", stderr: "" });
    const io = createDefaultIssuesCheckIo(runner);
    const result = await io.getOpenIssues("forge.example.com", "org/repo");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.issues.length, 0);
  });

  it("surfaces transport failure during pagination", async () => {
    const runner = async (args: string[]) => {
      if (args[1].includes("page=1")) {
        return { code: 0, stdout: JSON.stringify(Array.from({ length: 50 }, (_, i) => issue(i + 1))), stderr: "" };
      }
      return { code: 1, stdout: "", stderr: "network timeout" };
    };

    const io = createDefaultIssuesCheckIo(runner);
    const result = await io.getOpenIssues("forge.example.com", "org/repo");

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.error.includes("failed on page 2"));
  });
});

// ---------------------------------------------------------------------------
// #733 regression guard: the Python checker is ported, not referenced.
// ---------------------------------------------------------------------------

// Assembled from parts so this guard file never itself spells the path it
// forbids.
const RETIRED_SCRIPT = ["forgejo", "issues-check"].join("-");
const GUARD_PATTERNS: Array<{ pattern: RegExp; why: string }> = [
  { pattern: new RegExp(`bin/${RETIRED_SCRIPT}`), why: "external checker path (~/bin/<checker>)" },
  { pattern: new RegExp(`["']bin["']\\s*,\\s*["']${RETIRED_SCRIPT}["']`), why: 'join(..., "bin", <checker>)' },
];

const GUARD_SKIP_DIRS = new Set(["docs", "images", "screenshots", "node_modules"]);
const GUARD_SOURCE_EXT = /\.(?:[cm]?[jt]sx?)$/;

function listPluginSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (GUARD_SKIP_DIRS.has(entry)) continue;
      listPluginSources(full, out);
    } else if (GUARD_SOURCE_EXT.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("external checker retirement guard (#733)", () => {
  it("no plugin source re-references the retired Python script path", () => {
// The marker constant legitimately carries the script name as a comment
// protocol string (`forgejo-issues-check:stale-wip-reminder`); only the
// executable *path* forms are regressions.
    const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
    const sources = listPluginSources(pluginDir);
    assert.ok(sources.length > 0, "guard found no plugin sources to scan");
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const { pattern, why } of GUARD_PATTERNS) {
        assert.ok(!pattern.test(text), `${file} re-references the retired checker path (${why})`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// #1263: the board-state cache must not hide an unconsumed candidate forever.
// A delta pass skips an unchanged signature; the full (`all: true`)
// reconciliation pass re-emits it so the sweep can re-deliver it.
// ---------------------------------------------------------------------------
describe("full board reconciliation re-emits cached candidates (#1263)", () => {
  const attentionIssue: ForgejoIssue = {
    number: 1020,
    title: "Unconsumed attention ticket",
    state: "open",
    updated_at: "2026-10-06T17:11:38Z",
    created_at: "2026-10-06T17:11:38Z",
    comments: 0,
    labels: [
      { name: "attention/orchestrator" },
      { name: "kind/feature" },
      { name: "priority/high" },
    ],
  };
  // Byte-matches the signature runIssuesCheck persists for `attentionIssue`,
  // so the cache reports the ticket as seen and unchanged.
  const cachedSignature: IssueSignature = {
    updated_at: "2026-10-06T17:11:38Z",
    labels: ["attention/orchestrator", "kind/feature", "priority/high"],
    comments_count: 0,
  };
  const cachedIo = (): IssuesCheckIo => ({
    getOpenIssues: async () => ({ ok: true, issues: [attentionIssue] }),
    getLatestComments: async () => [],
    getIssueComments: async () => [],
    runStaleWipCommand: async () => true,
    loadCache: async () => ({ "1020": cachedSignature }),
    saveCache: async () => {},
  });

  it("delta pass skips an unchanged cached attention/orchestrator ticket", async () => {
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: false,
      io: cachedIo(),
    });
    assert.equal(outcome.rankedCandidates.length, 0);
  });

  it("reconciliation pass re-emits the unchanged attention/orchestrator ticket", async () => {
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: true,
      io: cachedIo(),
    });
    assert.equal(outcome.rankedCandidates.length, 1);
    assert.equal(outcome.rankedCandidates[0].number, 1020);
    assert.ok(outcome.rankedCandidates[0].labels.includes("attention/orchestrator"));
    assert.equal(outcome.exitCode, 1);
  });
});

describe("state/verify vs state/review separation (#1194)", () => {
  it("classifyCandidate differentiates state/review (pre-flight PR) from state/verify (merged deliverable)", () => {
    const testIssue = issue(100);

    // state/review: pre-flight PR verification
    const reviewResult = classifyCandidate(testIssue, new Set(["state/review", "attention/orchestrator"]));
    assert.equal(reviewResult.category, "verification");
    assert.equal(reviewResult.is_dispatchable, false);
    assert.match(reviewResult.reason, /pre-flight hygiene audit required/i);

    // state/verify with attention/orchestrator: follow-up directed to Orchestrator
    const verifyOrchResult = classifyCandidate(testIssue, new Set(["state/verify", "attention/orchestrator"]));
    assert.equal(verifyOrchResult.category, "orchestrator_triage");
    assert.equal(verifyOrchResult.is_dispatchable, false);
    assert.match(verifyOrchResult.reason, /Requires Orchestrator triage/i);

    // state/verify with attention/user: awaiting operator verification
    const verifyUserResult = classifyCandidate(testIssue, new Set(["state/verify", "attention/user"]));
    assert.equal(verifyUserResult.category, "operator_verify");
    assert.equal(verifyUserResult.is_dispatchable, false);
    assert.match(verifyUserResult.reason, /awaiting human operator acceptance/i);

    // state/verify alone: awaiting operator verification
    const verifyAloneResult = classifyCandidate(testIssue, new Set(["state/verify"]));
    assert.equal(verifyAloneResult.category, "operator_verify");
    assert.equal(verifyAloneResult.is_dispatchable, false);
    assert.match(verifyAloneResult.reason, /awaiting human operator acceptance/i);
  });

  it("handles priority/sos with state/review vs state/verify", () => {
    const testIssue = issue(200);

    // SOS with state/review
    const sosReview = classifyCandidate(testIssue, new Set(["priority/sos", "state/review"]));
    assert.equal(sosReview.category, "sos");
    assert.equal(sosReview.is_dispatchable, false);
    assert.match(sosReview.reason, /pre-flight PR audit required/i);

    // SOS with state/verify and attention/orchestrator
    const sosVerifyOrch = classifyCandidate(testIssue, new Set(["priority/sos", "state/verify", "attention/orchestrator"]));
    assert.equal(sosVerifyOrch.category, "sos");
    assert.equal(sosVerifyOrch.is_dispatchable, false);
    assert.match(sosVerifyOrch.reason, /Orchestrator triage required/i);

    // SOS with state/verify alone
    const sosVerify = classifyCandidate(testIssue, new Set(["priority/sos", "state/verify"]));
    assert.equal(sosVerify.category, "sos");
    assert.equal(sosVerify.is_dispatchable, false);
    assert.match(sosVerify.reason, /awaiting operator verification/i);
  });

  it("isDispatchableCandidate treats both state/verify and state/review as non-dispatchable", () => {
    assert.equal(isDispatchableCandidate(new Set(["state/review"])), false);
    assert.equal(isDispatchableCandidate(new Set(["state/verify"])), false);
    assert.equal(isDispatchableCandidate(new Set(["kind/feature"])), true);
  });

  it("isActionable treats both state/verify and state/review as actionable for orchestrator but not worker", () => {
    assert.equal(isActionable(new Set(["state/review"]), "orchestrator"), true);
    assert.equal(isActionable(new Set(["state/verify"]), "orchestrator"), true);
    assert.equal(isActionable(new Set(["state/review"]), "worker"), false);
    assert.equal(isActionable(new Set(["state/verify"]), "worker"), false);
  });

  it("renderIssuesCheckMarkdown places state/review in pre-flight audit and state/verify in operator acceptance", () => {
    const outcome: IssuesCheckOutcome = {
      exitCode: 1,
      staleWipRecovery: [],
      stateTriage: [],
      savedState: {},
      rankedCandidates: [
        {
          number: 101,
          title: "PR ready for audit",
          labels: ["state/review"],
          priority_tuple: [2, 2, 2, "2026-10-01"],
          category: "verification",
          is_dispatchable: false,
          reason: "Deliverable complete: worker completed implementation; Orchestrator pre-flight hygiene audit required",
        },
        {
          number: 102,
          title: "Merged deliverable awaiting verification",
          labels: ["state/verify", "attention/user"],
          priority_tuple: [2, 2, 2, "2026-10-01"],
          category: "operator_verify",
          is_dispatchable: false,
          reason: "Merged deliverable: awaiting human operator acceptance / live verification",
        },
        {
          number: 103,
          title: "Merged deliverable needing triage",
          labels: ["state/verify", "attention/orchestrator"],
          priority_tuple: [2, 2, 2, "2026-10-01"],
          category: "orchestrator_triage",
          is_dispatchable: false,
          reason: "Requires Orchestrator triage / investigation (state/verify follow-up directed by operator)",
        },
      ],
    };

    const md = renderIssuesCheckMarkdown(outcome, {
      hostname: "forge.example.com",
      repo: "org/repo",
      role: "orchestrator",
      staleWipHours: 2,
      dryRun: false,
    });

    assert.ok(md.includes("## DELIVERABLE VERIFICATION - READY FOR PRE-FLIGHT AUDIT (1)"));
    assert.ok(md.includes("[#101]"));
    assert.ok(md.includes("## OPERATOR ACCEPTANCE - AWAITING LIVE VERIFICATION (1)"));
    assert.ok(md.includes("[#102]"));
    assert.ok(md.includes("## ORCHESTRATOR REASONING & TRIAGE (1)"));
    assert.ok(md.includes("[#103]"));
  });
});


describe("attention/orchestrator classification and state/triage hygiene (#1264)", () => {
  it("isDispatchableCandidate blocks orchestrator, front-desk, and spec/needed", () => {
    assert.equal(isDispatchableCandidate(new Set(["attention/orchestrator"])), false);
    assert.equal(isDispatchableCandidate(new Set(["attention/frontdesk"])), false);
    assert.equal(isDispatchableCandidate(new Set(["spec/needed"])), false);
    // Without one of these blockers the ticket remains autonomously dispatchable.
    assert.equal(isDispatchableCandidate(new Set(["spec/approved"])), true);
    assert.equal(isDispatchableCandidate(new Set(["attention/agent"])), true);
  });

  it("classifyCandidate triages attention/orchestrator before the dispatchable fallthrough", () => {
    const result = classifyCandidate(
      issue(300),
      new Set(["attention/orchestrator", "spec/approved", "target/uppidi-fleet"]),
    );
    assert.equal(result.category, "orchestrator_triage");
    assert.equal(result.is_dispatchable, false);
    assert.match(result.reason, /Requires Orchestrator triage/i);
  });

  it("classifyCandidate routes attention/frontdesk to triage, not a coding worker", () => {
    const result = classifyCandidate(issue(301), new Set(["attention/frontdesk"]));
    assert.equal(result.category, "orchestrator_triage");
    assert.equal(result.is_dispatchable, false);
    assert.match(result.reason, /Front Desk/i);
  });

  it("hasStateLabel and needsStateTriage read canonical and legacy state labels", () => {
    assert.equal(hasStateLabel(new Set(["state/wip"])), true);
    assert.equal(hasStateLabel(new Set(["state/0-triage"])), true);
    assert.equal(hasStateLabel(new Set(["kind/feature"])), false);

    assert.equal(needsStateTriage(issue(1, { labels: ["kind/feature"] })), true);
    assert.equal(needsStateTriage(issue(1, { labels: ["state/triage"] })), false);
    assert.equal(needsStateTriage(issue(1, { labels: ["state/0-triage"] })), false);
    assert.equal(needsStateTriage(issue(1, { labels: ["kind/feature"], state: "closed" })), false);
  });

  it("sweepStatelessIssues files only state-less open issues", async () => {
    const { io, calls } = fakeIo([]);
    const results = await sweepStatelessIssues(io, "host", "org/repo", [
      issue(1, { labels: ["kind/feature"] }),
      issue(2, { labels: ["state/triage"] }),
      issue(3, { labels: ["state/0-triage"] }),
      issue(4, { labels: ["kind/feature"], state: "closed" }),
    ]);
    assert.deepEqual(results, [{ number: 1, filed: true, dry_run: false }]);
    assert.equal(calls.length, 1);
    const cmd = calls[0].command.join(" ");
    assert.ok(cmd.includes("issue edit 1"));
    assert.ok(cmd.includes("--add-label state/triage"));
    assert.ok(!cmd.includes("--remove-label"));
  });

  it("normalizeStatelessIssue dry run writes nothing", async () => {
    const { io, calls } = fakeIo([]);
    const result = await normalizeStatelessIssue(io, "host", "org/repo", issue(7, { labels: ["kind/feature"] }), {
      dryRun: true,
    });
    assert.deepEqual(result, { number: 7, filed: true, dry_run: true });
    assert.deepEqual(calls, []);
  });

  it("runIssuesCheck wires the state-triage sweep and honours normalizeState: false", async () => {
    const stateless = issue(1, { labels: ["kind/feature"] });
    const triaged = issue(2, { labels: ["state/triage", "kind/bug"] });
    const makeIo = (commands: string[][]): IssuesCheckIo => ({
      getOpenIssues: async () => ({ ok: true, issues: [stateless, triaged] }),
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async (command) => {
        commands.push(command);
        return true;
      },
      loadCache: async () => ({}),
      saveCache: async () => {},
    });

    const commands: string[][] = [];
    const outcome = await runIssuesCheck({
      hostname: "host",
      repo: "org/repo",
      io: makeIo(commands),
      sweepStaleWip: false,
      now: NOW,
    });
    assert.deepEqual(outcome.stateTriage, [{ number: 1, filed: true, dry_run: false }]);
    assert.equal(commands.length, 1);
    assert.ok(commands[0].join(" ").includes("--add-label state/triage"));

    const skippedCommands: string[][] = [];
    const skipped = await runIssuesCheck({
      hostname: "host",
      repo: "org/repo",
      io: makeIo(skippedCommands),
      sweepStaleWip: false,
      normalizeState: false,
      now: NOW,
    });
    assert.deepEqual(skipped.stateTriage, []);
    assert.equal(skippedCommands.length, 0);
  });
});
