import test from "node:test";
import assert from "node:assert/strict";
import { buildTelemetryCopyText } from "./telemetry-copy";
import type { TopTimelineTelemetryData } from "../shared/resources";

const base: TopTimelineTelemetryData = {
  turnId: null,
  agentId: "abcdef1234567890",
  outcomeKind: "completed",
  timestamp: "2026-09-19T17:00:00.000Z",
  cpuPercent: 12,
  memUsedBytes: 1024 ** 3,
  memTotalBytes: 8 * 1024 ** 3,
  memPercent: 12.5,
  loadAvg1m: 0.42,
};

test("copy text leads with the turn outcome and short agent id", () => {
  const text = buildTelemetryCopyText({ data: base, timeLabel: "17:00:00" });
  assert.match(text, /^Turn Completed\n17:00:00\nAgent abcdef1/);
});

test("copy text includes model/provider, branch and worktree", () => {
  const text = buildTelemetryCopyText({
    data: {
      ...base,
      agentModel: "claude-sonnet",
      agentProvider: "anthropic",
      branch: "main",
      worktree: "/home/x/worktrees/foo",
    },
  });
  assert.match(text, /claude-sonnet \(anthropic\)/);
  assert.match(text, /Branch main/);
  assert.match(text, /Worktree \/home\/x\/worktrees\/foo/);
});

test("copy text summarizes context window usage with percent", () => {
  const text = buildTelemetryCopyText({
    data: { ...base, contextUsedTokens: 58000, contextMaxTokens: 1000000 },
  });
  assert.match(text, /Tokens 58k\/1M \(6% ctx\)/);
});

test("copy text falls back to input/output totals when context max is absent", () => {
  const text = buildTelemetryCopyText({
    data: { ...base, inputTokens: 1200, outputTokens: 340 },
  });
  assert.match(text, /Tokens 1200 in \/ 340 out \(1540 total\)/);
});

test("copy text merges live usage when the item snapshot omits metrics", () => {
  const text = buildTelemetryCopyText({
    data: base,
    liveUsage: {
      inputTokens: 500,
      outputTokens: 100,
      cachedInputTokens: 2048,
      totalCostUsd: 0.0042,
      contextWindowUsedTokens: 58000,
      contextWindowMaxTokens: 1000000,
    },
  });
  assert.match(text, /Tokens 58k\/1M/);
  assert.match(text, /Cache 2,048/);
  assert.match(text, /Cost \$0\.0042/);
});

test("copy text omits optional sections that have no data", () => {
  const text = buildTelemetryCopyText({ data: base });
  assert.doesNotMatch(text, /Tokens/);
  assert.doesNotMatch(text, /Cache/);
  assert.doesNotMatch(text, /Cost/);
  assert.doesNotMatch(text, /Tools/);
  assert.doesNotMatch(text, /Changes/);
});

test("copy text carries failed outcome and error detail", () => {
  const text = buildTelemetryCopyText({
    data: { ...base, outcomeKind: "failed", outcomeError: "provider timeout" },
  });
  assert.match(text, /^Turn Failed/);
  assert.match(text, /Error provider timeout/);
});

test("copy text reports tool calls, turns, duration and changes when present", () => {
  const text = buildTelemetryCopyText({
    data: {
      ...base,
      durationMs: 1234,
      toolCalls: 7,
      toolErrors: 2,
      turnCount: 9,
      gitFilesChanged: 3,
      gitInsertions: 40,
      gitDeletions: 5,
    },
  });
  assert.match(text, /Duration 1\.2s/);
  assert.match(text, /Tools 7 \(2 err\)/);
  assert.match(text, /Turns 9/);
  assert.match(text, /Changes ±3 files \+40\/-5/);
});
