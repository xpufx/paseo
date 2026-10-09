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
  recoverStaleWipIssue,
  sweepStaleWipIssues,
  staleWipAge,
  type ForgejoComment,
  type ForgejoIssue,
  type IssuesCheckIo,
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
