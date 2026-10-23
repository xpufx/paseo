// Ported regression coverage for the stale state/1-wip recovery sweep.
//
// Mirrors platform `scripts/forgejo-issues-check.test.py` fixture for fixture
// and expectation for expectation (#733). The Python suite stubs module-level
// functions with `unittest.mock.patch`; this suite passes the same stubs as the
// `IssuesCheckIo` dependency object, which is the same seam.
//
// Parity against the Python original itself is a separate, recorded exercise:
// see `docs/issues-check-parity.md`.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setFetchForTest, setTokenResolverForTest } from "./forgejo-api.js";
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
  renderDecisionTraceComment,
  resolveAlertDestination,
  type AlertDestination,
  type DispatchCategory,
  type DecisionTrace,
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
  afterEach(() => {
    setFetchForTest(null);
    setTokenResolverForTest(null);
  });

  it("paginates across multiple pages until a partial page is returned", async () => {
    const requestedUrls: string[] = [];
    const page1Issues = Array.from({ length: 50 }, (_, i) => issue(i + 1));
    const page2Issues = Array.from({ length: 15 }, (_, i) => issue(i + 51));

    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async (input: any) => {
      const url = String(input);
      requestedUrls.push(url.replace(/^https?:\/\/[^/]+/, ""));
      if (url.includes("page=1")) {
        return { ok: true, status: 200, statusText: "OK", json: async () => page1Issues };
      }
      if (url.includes("page=2")) {
        return { ok: true, status: 200, statusText: "OK", json: async () => page2Issues };
      }
      return { ok: true, status: 200, statusText: "OK", json: async () => [] };
    });

    const io = createDefaultIssuesCheckIo();
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

    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async (input: any) => {
      requestedUrls.push(String(input).replace(/^https?:\/\/[^/]+/, ""));
      return { ok: true, status: 200, statusText: "OK", json: async () => page1Issues };
    });

    const io = createDefaultIssuesCheckIo();
    const result = await io.getOpenIssues("forge.example.com", "org/repo");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.issues.length, 10);
    assert.equal(requestedUrls.length, 1);
  });

  it("handles empty issues list gracefully", async () => {
    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => [] }));

    const io = createDefaultIssuesCheckIo();
    const result = await io.getOpenIssues("forge.example.com", "org/repo");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.issues.length, 0);
  });

  it("surfaces transport failure during pagination", async () => {
    setTokenResolverForTest(async () => "test-token");
    setFetchForTest(async (input: any) => {
      if (String(input).includes("page=1")) {
        return { ok: true, status: 200, statusText: "OK", json: async () => Array.from({ length: 50 }, (_, i) => issue(i + 1)) };
      }
      return { ok: false, status: 500, statusText: "Server Error", json: async () => ({ message: "network timeout" }) };
    });

    const io = createDefaultIssuesCheckIo();
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
    assert.equal(reviewResult.category, "review");
    assert.equal(reviewResult.is_dispatchable, false);
    assert.match(reviewResult.reason, /pre-flight hygiene audit required/i);

    // state/verify with attention/orchestrator: follow-up directed to Orchestrator
    const verifyOrchResult = classifyCandidate(testIssue, new Set(["state/verify", "attention/orchestrator"]));
    assert.equal(verifyOrchResult.category, "orchestrator_triage");
    assert.equal(verifyOrchResult.is_dispatchable, false);
    assert.match(verifyOrchResult.reason, /Requires Orchestrator triage/i);

    // state/verify with attention/user: awaiting operator verification
    const verifyUserResult = classifyCandidate(testIssue, new Set(["state/verify", "attention/user"]));
    assert.equal(verifyUserResult.category, "verification");
    assert.equal(verifyUserResult.is_dispatchable, false);
    assert.match(verifyUserResult.reason, /awaiting human operator acceptance/i);

    // state/verify alone: awaiting operator verification
    const verifyAloneResult = classifyCandidate(testIssue, new Set(["state/verify"]));
    assert.equal(verifyAloneResult.category, "verification");
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
      decisionTraces: [],
      rankedCandidates: [
        {
          number: 101,
          title: "PR ready for audit",
          labels: ["state/review"],
          priority_tuple: [2, 2, 2, "2026-10-01"],
          category: "review",
          is_dispatchable: false,
          reason: "Deliverable complete: worker completed implementation; Orchestrator pre-flight hygiene audit required",
        },
        {
          number: 102,
          title: "Merged deliverable awaiting verification",
          labels: ["state/verify", "attention/user"],
          priority_tuple: [2, 2, 2, "2026-10-01"],
          category: "verification",
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

// ---------------------------------------------------------------------------
// #1196: decouple attention/* from state/verify blocking.
// When the operator sets an attention/* signal it trumps lifecycle stage.
// ---------------------------------------------------------------------------
describe("#1196: attention/* overrides state/verify blocking", () => {
  it("isDispatchableCandidate returns true for state/verify + attention/agent (+ spec/approved)", () => {
    // Without attention/agent, state/verify alone is non-dispatchable.
    assert.equal(isDispatchableCandidate(new Set(["state/verify"])), false);
    // With attention/agent attached, the operator's hand-off signal lets a worker in.
    assert.equal(
      isDispatchableCandidate(new Set(["state/verify", "attention/agent", "spec/approved"])),
      true,
    );
  });

  it("isActionable(..., 'worker') returns true when attention/agent is present on state/verify", () => {
    // state/verify alone → not actionable for workers.
    assert.equal(isActionable(new Set(["state/verify"]), "worker"), false);
    // state/verify + attention/agent → actionable for workers (operator hand-off).
    assert.equal(
      isActionable(new Set(["state/verify", "attention/agent"]), "worker"),
      true,
    );
  });

  it("classifyCandidate returns orchestrator_triage for state/verify + attention/orchestrator", () => {
    const testIssue = issue(1196);
    const result = classifyCandidate(testIssue, new Set(["state/verify", "attention/orchestrator"]));
    assert.equal(result.category, "orchestrator_triage");
    assert.equal(result.is_dispatchable, false);
    assert.match(result.reason, /Requires Orchestrator triage/i);
  });
});

// ---------------------------------------------------------------------------
// #1364: kind/discussion, kind/idea excluded; unshaped state/triage not dispatchable.
// ---------------------------------------------------------------------------
describe("#1364: dispatchable candidate hardening", () => {
  it("excludes kind/discussion as a dispatchable candidate", () => {
    assert.equal(isDispatchableCandidate(new Set(["kind/discussion"])), false);
  });

  it("excludes kind/idea as a dispatchable candidate", () => {
    assert.equal(isDispatchableCandidate(new Set(["kind/idea"])), false);
  });

  it("excludes state/triage alone (unshaped ticket)", () => {
    assert.equal(isDispatchableCandidate(new Set(["state/triage"])), false);
  });

  it("makes state/triage dispatchable when shaped with spec/approved", () => {
    assert.equal(
      isDispatchableCandidate(new Set(["state/triage", "spec/approved"])),
      true,
    );
  });

  it("makes state/triage dispatchable when shaped with spec/checklist", () => {
    assert.equal(
      isDispatchableCandidate(new Set(["state/triage", "spec/checklist"])),
      true,
    );
  });

  it("still blocks state/triage without any shaping label", () => {
    assert.equal(isDispatchableCandidate(new Set(["state/triage", "kind/bug"])), false);
  });

  it("isActionable(..., 'worker') also excludes kind/discussion and kind/idea", () => {
    assert.equal(isActionable(new Set(["kind/discussion"]), "worker"), false);
    assert.equal(isActionable(new Set(["kind/idea"]), "worker"), false);
  });

  it("isActionable(..., 'worker') excludes unshaped state/triage", () => {
    assert.equal(isActionable(new Set(["state/triage"]), "worker"), false);
    assert.equal(isActionable(new Set(["state/triage", "spec/approved"]), "worker"), true);
  });
});

// ---------------------------------------------------------------------------
// #1415: structured decision tree tracing
// ---------------------------------------------------------------------------
describe("#1415: decision tree tracing", () => {
  function tracedIo(issues: ForgejoIssue[], cache: Record<string, IssueSignature> = {}): IssuesCheckIo {
    return {
      getOpenIssues: async () => ({ ok: true, issues }),
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => true,
      loadCache: async () => cache,
      saveCache: async () => {},
    };
  }

  function cachedSignature(issue: ForgejoIssue): IssueSignature {
    const rawLabels: unknown = issue.labels ?? [];
    const labels = (Array.isArray(rawLabels) ? rawLabels : [])
      .map((l) => (typeof l === "string" ? l : (l as { name?: unknown })?.name ?? ""))
      .filter((n): n is string => typeof n === "string")
      .sort();
    return {
      updated_at: issue.updated_at ?? "",
      labels,
      comments_count: issue.comments ?? 0,
    };
  }

  it("produces one trace per evaluated issue with number, title, and labels", async () => {
    const dispatchable: ForgejoIssue = {
      number: 2001,
      title: "Dispatchable feature",
      state: "open",
      updated_at: "2026-10-10T10:00:00Z",
      created_at: "2026-10-10T10:00:00Z",
      comments: 0,
      labels: [{ name: "kind/feature" }, { name: "priority/normal" }],
    };
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: true,
      io: tracedIo([dispatchable], { "2001": cachedSignature(dispatchable) }),
    });
    assert.equal(outcome.decisionTraces.length, 1);
    const trace = outcome.decisionTraces[0];
    assert.equal(trace.number, 2001);
    assert.equal(trace.title, "Dispatchable feature");
    assert.ok(trace.labels.includes("kind/feature"));
    assert.ok(trace.labels.includes("priority/normal"));
  });

  it("records the full guard sequence and matched rule for a dispatchable issue", async () => {
    const dispatchable: ForgejoIssue = {
      number: 2002,
      title: "Ready task",
      state: "open",
      updated_at: "2026-10-10T10:00:00Z",
      created_at: "2026-10-10T10:00:00Z",
      comments: 0,
      labels: [{ name: "kind/feature" }, { name: "priority/normal" }],
    };
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: true,
      io: tracedIo([dispatchable], { "2002": cachedSignature(dispatchable) }),
    });
    const trace = outcome.decisionTraces[0];
    assert.equal(trace.path, "actionable");
    assert.equal(trace.category, "dispatchable");
    assert.equal(trace.is_dispatchable, true);
    assert.equal(trace.matched_rule, "dispatchable");
    const rules = trace.guards.map((g) => g.rule);
    assert.ok(rules.includes("is-actionable"));
    assert.ok(rules.includes("hard-stop"));
    assert.ok(rules.includes("dispatchable"));
    assert.ok(rules.indexOf("is-actionable") < rules.indexOf("hard-stop"));
  });

  it("records the blocking guard for a non-actionable issue", async () => {
    const wip: ForgejoIssue = {
      number: 2003,
      title: "Work in progress",
      state: "open",
      updated_at: "2026-10-10T10:00:00Z",
      created_at: "2026-10-10T10:00:00Z",
      comments: 0,
      labels: [{ name: "state/wip" }, { name: "kind/feature" }],
    };
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: true,
      io: tracedIo([wip], { "2003": cachedSignature(wip) }),
    });
    const trace = outcome.decisionTraces[0];
    assert.equal(trace.path, "not-actionable");
    assert.equal(trace.is_dispatchable, false);
    assert.equal(trace.category, "not-actionable");
  });

  it("records the skip path for an attention/ignore issue", async () => {
    const ignored: ForgejoIssue = {
      number: 2004,
      title: "Ignored ticket",
      state: "open",
      updated_at: "2026-10-10T10:00:00Z",
      created_at: "2026-10-10T10:00:00Z",
      comments: 0,
      labels: [{ name: "attention/ignore" }],
    };
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: true,
      io: tracedIo([ignored]),
    });
    const trace = outcome.decisionTraces[0];
    assert.equal(trace.path, "skipped");
    assert.equal(trace.category, "skipped");
    assert.equal(trace.matched_rule, "attention-ignore");
  });

  it("records the new path for a first-seen issue", async () => {
    const fresh: ForgejoIssue = {
      number: 2005,
      title: "Brand new",
      state: "open",
      updated_at: "2026-10-10T10:00:00Z",
      created_at: "2026-10-10T10:00:00Z",
      comments: 0,
      labels: [{ name: "kind/bug" }],
    };
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: true,
      io: tracedIo([fresh]),
    });
    const trace = outcome.decisionTraces[0];
    assert.equal(trace.path, "new");
    assert.equal(trace.category, "new_unseen");
    assert.equal(trace.matched_rule, "new-first-seen");
  });

  it("records the feedback path for an issue with human feedback", async () => {
    const feedbackIssue: ForgejoIssue = {
      number: 2006,
      title: "Needs attention",
      state: "open",
      updated_at: "2026-10-10T10:00:00Z",
      created_at: "2026-10-10T10:00:00Z",
      comments: 1,
      labels: [{ name: "kind/feature" }],
    };
    const io: IssuesCheckIo = {
      getOpenIssues: async () => ({ ok: true, issues: [feedbackIssue] }),
      getLatestComments: async () => [{ user: { login: "alice" }, body: "please fix this" }],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => true,
      loadCache: async () => ({}),
      saveCache: async () => {},
    };
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: true,
      io,
    });
    const trace = outcome.decisionTraces[0];
    assert.equal(trace.path, "feedback");
    assert.equal(trace.category, "feedback");
    assert.equal(trace.matched_rule, "feedback-precedence");
  });

  it("records the unchanged path for an actionable issue with no delta", async () => {
    const stable: ForgejoIssue = {
      number: 2007,
      title: "Stable task",
      state: "open",
      updated_at: "2026-10-10T10:00:00Z",
      created_at: "2026-10-10T10:00:00Z",
      comments: 0,
      labels: [{ name: "kind/feature" }],
    };
    const outcome = await runIssuesCheck({
      hostname: "forge.test",
      repo: "org/repo",
      all: false,
      io: tracedIo([stable], { "2007": cachedSignature(stable) }),
    });
    const trace = outcome.decisionTraces[0];
    assert.equal(trace.path, "unchanged");
    assert.equal(trace.category, "unchanged");
  });

  it("renderDecisionTraceComment formats the breakdown as a Forgejo comment", () => {
    const trace: DecisionTrace = {
      number: 2001,
      title: "Dispatchable feature",
      labels: ["kind/feature", "priority/normal"],
      guards: [
        { rule: "is-actionable", description: "isActionable(role=orchestrator)", matched: true },
        { rule: "hard-stop", description: "Hard stop or ignore flags", matched: false },
        { rule: "dispatchable", description: "Natural autonomous dispatch (no blockers)", matched: true },
      ],
      path: "actionable",
      is_dispatchable: true,
      category: "dispatchable",
      reason: "Dispatchable task (unblocked, ready for autonomous execution)",
      matched_rule: "dispatchable",
    };
    const body = renderDecisionTraceComment(trace);
    assert.ok(body.includes("#2001"));
    assert.ok(body.includes("Dispatchable feature"));
    assert.ok(body.includes("kind/feature"));
    assert.ok(body.includes("`actionable`"));
    assert.ok(body.includes("`dispatchable`"));
    assert.ok(body.includes("[x] `is-actionable`"));
    assert.ok(body.includes("[ ] `hard-stop`"));
    assert.ok(body.includes("[x] `dispatchable`"));
    assert.ok(body.includes("#1415"));
  });
});

// ---------------------------------------------------------------------------
// #1414: Formal declarative matrix of dispatchability and triage rules
// ---------------------------------------------------------------------------
describe("declarative dispatchability and triage matrix (#1414)", () => {
  interface MatrixFixture {
    id: string;
    labels: string[];
    expectedDispatchable: boolean;
    expectedCategory: string;
    expectedAlert: AlertDestination;
    description: string;
  }

  const MATRIX_FIXTURES: MatrixFixture[] = [
    // 1. Hard stop and ignore flags
    {
      id: "R-STOP-1",
      labels: ["flag/stop-work"],
      expectedDispatchable: false,
      expectedCategory: "ignored",
      expectedAlert: "silent",
      description: "flag/stop-work halts all work immediately",
    },
    {
      id: "R-STOP-1-override-sos",
      labels: ["flag/stop-work", "priority/sos", "spec/approved"],
      expectedDispatchable: false,
      expectedCategory: "ignored",
      expectedAlert: "silent",
      description: "flag/stop-work overrides priority/sos",
    },
    {
      id: "R-STOP-2",
      labels: ["flag/wont-do"],
      expectedDispatchable: false,
      expectedCategory: "ignored",
      expectedAlert: "silent",
      description: "flag/wont-do marks ticket abandoned",
    },
    {
      id: "R-STOP-3",
      labels: ["attention/ignore"],
      expectedDispatchable: false,
      expectedCategory: "ignored",
      expectedAlert: "silent",
      description: "attention/ignore suppresses sweeps",
    },
    {
      id: "R-STOP-4",
      labels: ["state/done"],
      expectedDispatchable: false,
      expectedCategory: "ignored",
      expectedAlert: "silent",
      description: "state/done indicates completed issue",
    },

    // 2. User attention
    {
      id: "R-USER-1",
      labels: ["attention/user"],
      expectedDispatchable: false,
      expectedCategory: "user_attention",
      expectedAlert: "Orchestrator",
      description: "attention/user gates execution on human input",
    },
    {
      id: "R-USER-1-with-spec",
      labels: ["attention/user", "spec/approved"],
      expectedDispatchable: false,
      expectedCategory: "user_attention",
      expectedAlert: "Orchestrator",
      description: "attention/user gates execution even when spec is approved",
    },

    // 3. Active execution (WIP)
    {
      id: "R-WIP-1",
      labels: ["state/wip"],
      expectedDispatchable: false,
      expectedCategory: "wip",
      expectedAlert: "silent",
      description: "state/wip indicates active execution by a worker",
    },
    {
      id: "R-WIP-1-with-agent",
      labels: ["state/wip", "attention/agent"],
      expectedDispatchable: false,
      expectedCategory: "wip",
      expectedAlert: "silent",
      description: "state/wip is not dispatchable even with attention/agent",
    },

    // 4. Deliverable PR review
    {
      id: "R-REV-1",
      labels: ["state/review"],
      expectedDispatchable: false,
      expectedCategory: "review",
      expectedAlert: "Orchestrator",
      description: "state/review indicates implementation complete, PR audit required",
    },
    {
      id: "R-REV-1-with-orchestrator",
      labels: ["state/review", "attention/orchestrator"],
      expectedDispatchable: false,
      expectedCategory: "review",
      expectedAlert: "Orchestrator",
      description: "state/review with attention/orchestrator routes to PR audit",
    },

    // 5. Merged deliverable verification
    {
      id: "R-VER-1",
      labels: ["state/verify", "attention/agent"],
      expectedDispatchable: true,
      expectedCategory: "dispatchable",
      expectedAlert: "silent",
      description: "state/verify with attention/agent is dispatchable for agent verification",
    },
    {
      id: "R-VER-1-blocked",
      labels: ["state/verify", "attention/agent", "dep/blocked"],
      expectedDispatchable: false,
      expectedCategory: "blocked",
      expectedAlert: "Orchestrator",
      description: "state/verify with attention/agent is blocked if dependency is blocked",
    },
    {
      id: "R-VER-2",
      labels: ["state/verify", "attention/orchestrator"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "state/verify with attention/orchestrator routes to Orchestrator triage",
    },
    {
      id: "R-VER-3",
      labels: ["state/verify"],
      expectedDispatchable: false,
      expectedCategory: "verification",
      expectedAlert: "Orchestrator",
      description: "state/verify alone awaits operator/live verification",
    },
    {
      id: "R-VER-3-user",
      labels: ["state/verify", "attention/user"],
      expectedDispatchable: false,
      expectedCategory: "verification",
      expectedAlert: "Orchestrator",
      description: "state/verify with attention/user awaits operator verification",
    },

    // 6. Dependency and upstream blockers
    {
      id: "R-DEP-1",
      labels: ["dep/blocked"],
      expectedDispatchable: false,
      expectedCategory: "blocked",
      expectedAlert: "Orchestrator",
      description: "dep/blocked stops autonomous dispatch",
    },
    {
      id: "R-DEP-2",
      labels: ["upstream/blocked"],
      expectedDispatchable: false,
      expectedCategory: "blocked",
      expectedAlert: "Orchestrator",
      description: "upstream/blocked stops autonomous dispatch",
    },
    {
      id: "R-DEP-1-with-approved-spec",
      labels: ["dep/blocked", "spec/approved"],
      expectedDispatchable: false,
      expectedCategory: "blocked",
      expectedAlert: "Orchestrator",
      description: "dep/blocked blocks ticket even if spec is approved",
    },

    // 7. Scope decomposition
    {
      id: "R-DEC-1",
      labels: ["size/chunk"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "size/chunk requires Orchestrator decomposition",
    },
    {
      id: "R-DEC-2",
      labels: ["linked/needs-split"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "linked/needs-split requires Orchestrator decomposition",
    },

    // 8. Pre-code shaping
    {
      id: "R-SHP-1",
      labels: ["spec/needed"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "spec/needed requires Orchestrator technical shaping",
    },

    // 9. Front Desk routing
    {
      id: "R-FD-1",
      labels: ["attention/frontdesk"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Front Desk",
      description: "attention/frontdesk routes to Front Desk",
    },
    {
      id: "R-FD-1-with-bug",
      labels: ["attention/frontdesk", "kind/bug"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Front Desk",
      description: "attention/frontdesk routes to Front Desk even on bugs",
    },

    // 10. Orchestrator explicit triage
    {
      id: "R-ORCH-1",
      labels: ["attention/orchestrator"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "attention/orchestrator routes to Orchestrator triage",
    },
    {
      id: "R-ORCH-1-with-spec",
      labels: ["attention/orchestrator", "spec/approved"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "attention/orchestrator routes to Orchestrator even if spec is approved",
    },

    // 11. Non-actionable kinds
    {
      id: "R-KIND-1",
      labels: ["kind/discussion"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "kind/discussion requires discussion/triage, not code dispatch",
    },
    {
      id: "R-KIND-2",
      labels: ["kind/idea"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "kind/idea requires shaping, not code dispatch",
    },

    // 12. Unshaped vs shaped triage
    {
      id: "R-TRI-1",
      labels: ["state/triage"],
      expectedDispatchable: false,
      expectedCategory: "orchestrator_triage",
      expectedAlert: "Orchestrator",
      description: "state/triage without spec is unshaped",
    },
    {
      id: "R-TRI-2",
      labels: ["state/triage", "spec/approved"],
      expectedDispatchable: true,
      expectedCategory: "dispatchable",
      expectedAlert: "silent",
      description: "state/triage with spec/approved is dispatchable",
    },
    {
      id: "R-TRI-3",
      labels: ["state/triage", "spec/checklist"],
      expectedDispatchable: true,
      expectedCategory: "dispatchable",
      expectedAlert: "silent",
      description: "state/triage with spec/checklist is dispatchable",
    },

    // 13. Dispatchable tasks
    {
      id: "R-DISP-1",
      labels: ["kind/feature", "spec/approved"],
      expectedDispatchable: true,
      expectedCategory: "dispatchable",
      expectedAlert: "silent",
      description: "kind/feature with spec/approved is dispatchable",
    },
    {
      id: "R-DISP-2",
      labels: ["kind/bug"],
      expectedDispatchable: true,
      expectedCategory: "dispatchable",
      expectedAlert: "silent",
      description: "unblocked kind/bug is dispatchable",
    },
    {
      id: "R-DISP-3",
      labels: ["attention/agent", "kind/feature"],
      expectedDispatchable: true,
      expectedCategory: "dispatchable",
      expectedAlert: "silent",
      description: "attention/agent on unblocked feature is dispatchable",
    },

    // 14. SOS Emergency Priority
    {
      id: "R-SOS-1",
      labels: ["priority/sos", "kind/feature", "spec/approved"],
      expectedDispatchable: true,
      expectedCategory: "sos",
      expectedAlert: "Orchestrator",
      description: "priority/sos on dispatchable feature is dispatchable with category sos",
    },
    {
      id: "R-SOS-2",
      labels: ["priority/sos", "state/review"],
      expectedDispatchable: false,
      expectedCategory: "sos",
      expectedAlert: "Orchestrator",
      description: "priority/sos on state/review requires urgent PR audit",
    },
    {
      id: "R-SOS-3",
      labels: ["priority/sos", "state/verify"],
      expectedDispatchable: false,
      expectedCategory: "sos",
      expectedAlert: "Orchestrator",
      description: "priority/sos on state/verify requires urgent operator acceptance",
    },
    {
      id: "R-SOS-4",
      labels: ["priority/sos", "attention/frontdesk"],
      expectedDispatchable: false,
      expectedCategory: "sos",
      expectedAlert: "Front Desk",
      description: "priority/sos with attention/frontdesk routes emergency alert to Front Desk",
    },
  ];

  for (const fixture of MATRIX_FIXTURES) {
    it(`evaluates ${fixture.id}: ${fixture.description}`, () => {
      const labelSet = new Set(fixture.labels);
      const testIssue = issue(1414, { labels: fixture.labels });

      // 1. Dispatchability algebra
      const isDisp = isDispatchableCandidate(labelSet);
      assert.equal(
        isDisp,
        fixture.expectedDispatchable,
        `isDispatchableCandidate failed for [${fixture.labels.join(", ")}] (${fixture.description})`,
      );

      // 2. Candidate classification
      const classification = classifyCandidate(testIssue, labelSet);
      assert.equal(
        classification.is_dispatchable,
        fixture.expectedDispatchable,
        `classifyCandidate is_dispatchable failed for [${fixture.labels.join(", ")}]`,
      );
      assert.equal(
        classification.category,
        fixture.expectedCategory,
        `classifyCandidate category failed for [${fixture.labels.join(", ")}]`,
      );

      // 3. Alert destination resolution
      const alertDest = resolveAlertDestination(classification.category, labelSet);
      assert.equal(
        alertDest,
        fixture.expectedAlert,
        `resolveAlertDestination failed for [${fixture.labels.join(", ")}]`,
      );
    });
  }
});

