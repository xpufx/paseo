import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleUppidiFleetMetrics,
  loadFleetMetrics,
  appendRollupReceipt,
  computeModelRollups,
  deriveCandidatesFromReceipts,
  isMetricsBearing,
  median,
  setMetricsFilePathForTest,
  MAX_ROLLUP_RECEIPTS,
  DEFAULT_TASK_PROFILES,
  BASELINE_CANDIDATES,
} from "./metrics.js";
import { RollupReceiptSchema } from "../shared/contracts.js";

const NOW = Date.parse("2026-09-25T12:00:00.000Z");

function agent(overrides: Record<string, any> = {}) {
  return {
    provider: "opencode",
    model: "deepseek-v4.1-flash",
    deterministicState: "idle:waiting",
    ...overrides,
  };
}

describe("metric rollup math (#560)", () => {
  it("computes the median of a numeric sample (even/odd/empty)", () => {
    assert.equal(median([]), 0);
    assert.equal(median([3]), 3);
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  it("groups by provider+model and reduces context, cache, cost, errors, turns", () => {
    const agents = [
      agent({
        metrics: {
          contextUsedTokens: 50,
          contextMaxTokens: 100,
          cachedTokens: 80,
          inputTokens: 20,
          costUsd: 1.5,
          activeTurnStartedAt: "2026-09-25T11:59:00.000Z",
        },
      }),
      agent({
        metrics: {
          contextUsedTokens: 90,
          contextMaxTokens: 100,
          cachedTokens: 50,
          inputTokens: 50,
          costUsd: 2.5,
        },
      }),
      agent({ deterministicState: "failed:timeout", metrics: { contextUsedTokens: 10, contextMaxTokens: 100, costUsd: 3 } }),
    ];

    const [rollup] = computeModelRollups(agents, NOW);
    assert.equal(rollup.provider, "opencode");
    assert.equal(rollup.model, "deepseek-v4.1-flash");
    assert.equal(rollup.agentCount, 3);
    // agent 2 is settled with no active turn; agent 1 is active, agent 3 failed
    assert.equal(rollup.turnsCompleted, 1);
    assert.equal(rollup.errorCount, 1);
    assert.equal(rollup.costUsd, 7);
    // context utilizations: 50, 90, 10 -> median 50
    assert.equal(rollup.medianContextUtilizationPct, 50);
    // cache ratios: 80%, 50%; third has no tokens -> ignored -> median 65
    assert.equal(rollup.cacheHitRatioPct, 65);
    // one active turn started 60s before NOW
    assert.equal(rollup.medianTurnDurationMs, 60_000);
  });

  it("derives the active-turn duration from daemon-native lastUsage/activeTurn", () => {
    const agents = [
      agent({
        metrics: null,
        lastUsage: { contextWindowUsedTokens: 25, contextWindowMaxTokens: 100, totalCostUsd: 0.25 },
        activeTurn: { startedAt: "2026-09-25T11:58:00.000Z" },
      }),
    ];
    const [rollup] = computeModelRollups(agents, NOW);
    assert.equal(rollup.medianContextUtilizationPct, 25);
    assert.equal(rollup.medianTurnDurationMs, 120_000);
    assert.equal(rollup.turnsCompleted, 0);
  });

  it("ignores agents without a model or metric signal", () => {
    const agents = [
      agent({ model: null, metrics: { contextUsedTokens: 1 } }),
      agent({ metrics: null, lastUsage: null }),
      agent({ metrics: {} }),
    ];
    assert.equal(computeModelRollups(agents, NOW).length, 0);
    for (const a of agents) assert.equal(isMetricsBearing(a as any), false);
  });
});

describe("rollup receipt writer (#560)", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-metrics-"));
    filePath = join(tempDir, "uppidi-fleet-metrics.json");
    setMetricsFilePathForTest(filePath);
  });

  afterEach(() => {
    setMetricsFilePathForTest(null);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends receipts and derived candidates round-tripping through the schema", async () => {
    const res = await appendRollupReceipt(NOW, [
      agent({ metrics: { contextUsedTokens: 40, contextMaxTokens: 100, costUsd: 1 } }),
      agent({ metrics: { contextUsedTokens: 60, contextMaxTokens: 100, costUsd: 2 } }),
    ]);
    assert.equal(res.ok, true);
    assert.equal(res.skipped, false);
    assert.equal(res.receiptsWritten, 1);
    assert.equal(res.receiptCount, 1);

    const persisted = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(persisted.receipts.length, 1);
    assert.equal(persisted.candidates.length, 1);
    const parsedReceipt = RollupReceiptSchema.parse(persisted.receipts[0]);
    assert.equal(parsedReceipt.model, "deepseek-v4.1-flash");
    assert.equal(parsedReceipt.medianContextUtilizationPct, 50);
    assert.equal(parsedReceipt.costUsd, 3);

    const loaded = await loadFleetMetrics();
    assert.equal(loaded.dataSource, "empirical");
    assert.equal(loaded.modelCount, 1);
    assert.equal(loaded.totalEvaluatedTrials, 2);
  });

  it("skips when the cooldown gate is closed and when no agent bears metrics", async () => {
    const gated = await appendRollupReceipt(NOW, [agent({ metrics: { costUsd: 1 } })], () => false);
    assert.equal(gated.skipped, true);
    assert.equal(existsSync(filePath), false);

    const empty = await appendRollupReceipt(NOW, [agent({ metrics: null })], () => true);
    assert.equal(empty.skipped, true);
    assert.equal(existsSync(filePath), false);
  });

  it("caps stored receipts at MAX_ROLLUP_RECEIPTS, evicting oldest first", async () => {
    // Seed a full file of synthetic receipts.
    const seeded = Array.from({ length: MAX_ROLLUP_RECEIPTS }, (_, i) => ({
      ts: new Date(NOW + i).toISOString(),
      provider: "opencode",
      model: "m",
      turnsCompleted: 1,
      agentCount: 1,
      medianContextUtilizationPct: 0,
      cacheHitRatioPct: 0,
      costUsd: 0,
      errorCount: 0,
      medianTurnDurationMs: 0,
    }));
    writeFileSync(filePath, JSON.stringify({ receipts: seeded }), "utf8");

    const res = await appendRollupReceipt(NOW, [agent({ metrics: { costUsd: 9 } })]);
    assert.equal(res.receiptCount, MAX_ROLLUP_RECEIPTS);
    const persisted = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(persisted.receipts.length, MAX_ROLLUP_RECEIPTS);
    assert.equal(persisted.receipts[0].ts, seeded[1].ts);
  });
});

describe("fleet metrics file contract (#560 / #373 / platform#18)", () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-metrics-empty-"));
    filePath = join(tempDir, "uppidi-fleet-metrics.json");
    setMetricsFilePathForTest(filePath);
  });

  afterEach(() => {
    setMetricsFilePathForTest(null);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns an explicit empty state when the file is absent (baseline retired)", async () => {
    const data = await loadFleetMetrics();
    assert.equal(data.dataSource, "empty");
    assert.deepEqual(data.candidates, []);
    assert.equal(data.totalEvaluatedTrials, 0);
    assert.equal(data.modelCount, 0);
    assert.deepEqual(data.taskProfiles, DEFAULT_TASK_PROFILES);
    assert.ok(data.privacyNotice.includes("platform#18"));

    const res = await handleUppidiFleetMetrics({}, {} as any);
    assert.equal(res.ok, true);
    assert.equal(res.candidates.length, 0);
    assert.equal(res.dataSource, "empty");
    assert.equal(res.modelCount, 0);
  });

  it("returns an explicit empty state for an empty/unparsable file", async () => {
    writeFileSync(filePath, JSON.stringify({ receipts: [], candidates: [] }), "utf8");
    const data = await loadFleetMetrics();
    assert.equal(data.dataSource, "empty");
    assert.deepEqual(data.candidates, []);

    writeFileSync(filePath, "{ not json", "utf8");
    const broken = await loadFleetMetrics();
    assert.equal(broken.dataSource, "empty");
    assert.deepEqual(broken.candidates, []);
  });

  it("never serves the retired baseline matrix as a fallback", async () => {
    const data = await loadFleetMetrics();
    assert.notEqual(data.candidates, BASELINE_CANDIDATES);
    assert.equal(data.candidates.length, 0);
  });

  it("serves persisted empirical receipts with additive rollup fields", async () => {
    await appendRollupReceipt(NOW, [
      agent({ model: "m-a", metrics: { contextUsedTokens: 30, contextMaxTokens: 100, costUsd: 1 } }),
      agent({ model: "m-b", provider: "codex", metrics: { contextUsedTokens: 70, contextMaxTokens: 100, costUsd: 2 } }),
    ]);

    const res = await handleUppidiFleetMetrics({}, {} as any);
    assert.equal(res.dataSource, "empirical");
    assert.equal(res.modelCount, 2);
    assert.equal(res.totalEvaluatedTrials, 2);
    const a = res.candidates.find((c) => c.model === "m-a");
    assert.ok(a);
    assert.equal(a!.medianContextUtilizationPct, 30);
    assert.equal(a!.costUsd, 1);
    assert.equal(a!.receiptCount, 1);
    assert.ok(a!.lastReceiptAt);
  });

  it("supports filtering empirical candidates by model and task profile", async () => {
    await appendRollupReceipt(NOW, [
      agent({ model: "m-a", metrics: { costUsd: 1 } }),
      agent({ model: "m-b", provider: "codex", metrics: { costUsd: 2 } }),
    ]);
    const byModel = await handleUppidiFleetMetrics({ model: "m-a" }, {} as any);
    assert.equal(byModel.candidates.length, 1);
    assert.equal(byModel.candidates[0].model, "m-a");

    const byProfile = await handleUppidiFleetMetrics({ taskProfile: "surgical-bugfix" }, {} as any);
    assert.equal(byProfile.candidates.length, 2);
    for (const c of byProfile.candidates) assert.equal(c.profiles.length, 0);
  });

  it("derives pass rate net of failed-state errors", () => {
    const receipts = [
      {
        ts: new Date(NOW).toISOString(),
        provider: "opencode",
        model: "m",
        turnsCompleted: 4,
        agentCount: 3,
        medianContextUtilizationPct: 0,
        cacheHitRatioPct: 0,
        costUsd: 0,
        errorCount: 1,
        medianTurnDurationMs: 0,
      },
    ];
    const [candidate] = deriveCandidatesFromReceipts(receipts);
    assert.equal(candidate.overallPassRate, 75);
    assert.equal(candidate.totalTrials, 4);
    assert.equal(candidate.errorCount, 1);
  });
});
