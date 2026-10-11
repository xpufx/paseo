import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  setTelemetryStorePathForTest,
  appendTelemetryRecord,
  readTelemetryRecords,
  aggregateModelTelemetry,
  setupTelemetryTap,
  handleUppidiModelTelemetryQuery,
} from "./telemetry.js";
import { computeSlidingAggregations } from "./metrics.js";
import type { NormalizedTurnTelemetry } from "paseo-plugin-helper/server";
import { UppidiModelTelemetryQueryOutputSchema } from "../shared/contracts.js";

describe("uppidi-fleet in-process telemetry tap and metrics rollup (#1173)", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "uppidi-telemetry-test-"));
    testFile = path.join(tempDir, "telemetry.jsonl");
    setTelemetryStorePathForTest(testFile);
  });

  afterEach(async () => {
    setTelemetryStorePathForTest(null);
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("appendTelemetryRecord and readTelemetryRecords maintain append-only JSONL streaming store", async () => {
    const rec1: NormalizedTurnTelemetry = {
      turnId: "turn-1",
      agentId: "agent-1",
      repo: "xpufx-org/paseo",
      role: "worker",
      model: "gemini-3.8-flash-low",
      provider: "antigravity-acp",
      timestamp: new Date(Date.now() - 5000).toISOString(),
      durationMs: 2000,
      inputTokens: 100,
      outputTokens: 200,
      cachedTokens: 50,
      reasoningTokens: 0,
      totalTokens: 350,
      tokensPerSecond: 100,
      contextUsedTokens: 1000,
      contextMaxTokens: 8000,
      contextUtilizationPct: 12.5,
      costUsd: 0.002,
      toolCallsCount: 2,
      toolErrorsCount: 0,
      finishReason: "completed",
      gitInsertions: 10,
      gitDeletions: 2,
      gitFilesChanged: 1,
      isInterrupted: false,
    };

    const rec2: NormalizedTurnTelemetry = {
      turnId: "turn-2",
      agentId: "agent-2",
      repo: "xpufx-org/paseo",
      role: "orchestrator",
      model: "gpt-5.6-luna",
      provider: "codex",
      timestamp: new Date().toISOString(),
      durationMs: 4000,
      inputTokens: 200,
      outputTokens: 400,
      cachedTokens: 100,
      reasoningTokens: 50,
      totalTokens: 750,
      tokensPerSecond: 112.5,
      contextUsedTokens: 2000,
      contextMaxTokens: 16000,
      contextUtilizationPct: 12.5,
      costUsd: 0.015,
      toolCallsCount: 4,
      toolErrorsCount: 1,
      finishReason: "failed",
      gitInsertions: 0,
      gitDeletions: 0,
      gitFilesChanged: 0,
      isInterrupted: false,
    };

    await appendTelemetryRecord(rec1);
    await appendTelemetryRecord(rec2);

    const all = await readTelemetryRecords();
    assert.equal(all.length, 2);
    assert.equal(all[0]?.turnId, "turn-1");
    assert.equal(all[1]?.turnId, "turn-2");

    const filteredModel = await readTelemetryRecords({ model: "gemini-3.8-flash-low" });
    assert.equal(filteredModel.length, 1);
    assert.equal(filteredModel[0]?.model, "gemini-3.8-flash-low");

    const filteredProvider = await readTelemetryRecords({ provider: "codex" });
    assert.equal(filteredProvider.length, 1);
    assert.equal(filteredProvider[0]?.provider, "codex");
  });

  test("aggregateModelTelemetry calculates sliding summaries and composite indices", () => {
    const records: NormalizedTurnTelemetry[] = [
      {
        turnId: "t1",
        agentId: "a1",
        repo: "xpufx-org/paseo",
        role: "worker",
        model: "gemini-3.8-flash-low",
        provider: "antigravity-acp",
        timestamp: new Date().toISOString(),
        durationMs: 2000,
        inputTokens: 100,
        outputTokens: 200,
        cachedTokens: 50,
        reasoningTokens: 0,
        totalTokens: 350,
        tokensPerSecond: 100,
        contextUsedTokens: 1000,
        contextMaxTokens: 8000,
        contextUtilizationPct: 12.5,
        costUsd: 0.002,
        toolCallsCount: 3,
        toolErrorsCount: 0,
        finishReason: "completed",
        gitInsertions: 50,
        gitDeletions: 10,
        gitFilesChanged: 2,
        isInterrupted: false,
      },
      {
        turnId: "t2",
        agentId: "a2",
        repo: "xpufx-org/paseo",
        role: "worker",
        model: "gemini-3.8-flash-low",
        provider: "antigravity-acp",
        timestamp: new Date().toISOString(),
        durationMs: 1000,
        inputTokens: 50,
        outputTokens: 100,
        cachedTokens: 25,
        reasoningTokens: 0,
        totalTokens: 175,
        tokensPerSecond: 100,
        contextUsedTokens: 1200,
        contextMaxTokens: 8000,
        contextUtilizationPct: 15,
        costUsd: 0.001,
        toolCallsCount: 1,
        toolErrorsCount: 0,
        finishReason: "completed",
        gitInsertions: 20,
        gitDeletions: 5,
        gitFilesChanged: 1,
        isInterrupted: false,
      },
    ];

    const summaries = aggregateModelTelemetry(records, "7d");
    assert.equal(summaries.length, 1);
    const s = summaries[0]!;
    assert.equal(s.model, "gemini-3.8-flash-low");
    assert.equal(s.provider, "antigravity-acp");
    assert.equal(s.turnsCompleted, 2);
    assert.equal(s.turnsFailed, 0);
    assert.equal(s.totalTokens, 525);
    assert.equal(s.medianTokensPerSecond, 100);
    assert.equal(s.costUsd, 0.003);
    assert.ok(s.compositeIndices.fdsi > 0);
    assert.ok(s.compositeIndices.workerRoi > 0);
    assert.equal(s.compositeIndices.orchestratorVigilance, 0);
  });

  test("setupTelemetryTap listens to agent lifecycle turns and appends to store", async () => {
    const handlers: Record<string, (event: any, ctx?: any) => void> = {};
    const fakeServer: any = {
      on: (event: string, handler: any) => {
        handlers[event] = handler;
        return () => {
          delete handlers[event];
        };
      },
    };

    let recordEmitted: NormalizedTurnTelemetry | null = null;
    const cleanup = setupTelemetryTap(fakeServer, {
      onRecord: (rec) => {
        recordEmitted = rec;
      },
    });

    assert.ok(handlers["agent.turn_started"]);
    assert.ok(handlers["agent.turn_ended"]);

    handlers["agent.turn_started"]!({
      agent: {
        id: "test-agent-1",
        provider: "opencode",
        model: "deepseek-v4.1-flash",
      },
    });

    await handlers["agent.turn_ended"]!({
      turnId: "turn-tap-1",
      agent: {
        id: "test-agent-1",
        provider: "opencode",
        model: "deepseek-v4.1-flash",
        lastUsage: {
          inputTokens: 500,
          outputTokens: 300,
          totalCostUsd: 0.004,
        },
      },
      outcome: { kind: "completed" },
    });

    assert.ok(recordEmitted !== null);
    const emitted: NormalizedTurnTelemetry = recordEmitted!;
    assert.equal(emitted.agentId, "test-agent-1");
    assert.equal(emitted.model, "deepseek-v4.1-flash");
    assert.equal(emitted.inputTokens, 500);

    const stored = await readTelemetryRecords();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.turnId, "turn-tap-1");

    cleanup();
    assert.equal(Object.keys(handlers).length, 0);
  });

  test("handleUppidiModelTelemetryQuery exposes RPC query matching composite index schemas", async () => {
    const rec: NormalizedTurnTelemetry = {
      turnId: "turn-rpc",
      agentId: "agent-rpc",
      repo: "xpufx-org/paseo",
      role: "auditor",
      model: "muse-spark-1.3",
      provider: "uppidi/opencode",
      timestamp: new Date().toISOString(),
      durationMs: 1500,
      inputTokens: 200,
      outputTokens: 150,
      cachedTokens: 50,
      reasoningTokens: 0,
      totalTokens: 400,
      tokensPerSecond: 100,
      contextUsedTokens: 500,
      contextMaxTokens: 4000,
      contextUtilizationPct: 12.5,
      costUsd: 0.001,
      toolCallsCount: 1,
      toolErrorsCount: 0,
      finishReason: "completed",
      gitInsertions: 0,
      gitDeletions: 0,
      gitFilesChanged: 0,
      isInterrupted: false,
    };
    await appendTelemetryRecord(rec);

    const res = await handleUppidiModelTelemetryQuery({ window: "7d" });
    assert.equal(res.ok, true);
    assert.equal(res.recordsCount, 1);
    assert.equal(res.models.length, 1);
    assert.equal(res.models[0]?.model, "muse-spark-1.3");
    assert.ok(UppidiModelTelemetryQueryOutputSchema.safeParse(res).success);
  });

  test("computeSlidingAggregations in metrics.ts reads sliding aggregations", async () => {
    const rec: NormalizedTurnTelemetry = {
      turnId: "turn-metric",
      agentId: "agent-m",
      repo: "xpufx-org/paseo",
      role: "worker",
      model: "gemini-3.8-flash-low",
      provider: "antigravity-acp",
      timestamp: new Date().toISOString(),
      durationMs: 2000,
      inputTokens: 100,
      outputTokens: 200,
      cachedTokens: 50,
      reasoningTokens: 0,
      totalTokens: 350,
      tokensPerSecond: 100,
      contextUsedTokens: 1000,
      contextMaxTokens: 8000,
      contextUtilizationPct: 12.5,
      costUsd: 0.002,
      toolCallsCount: 1,
      toolErrorsCount: 0,
      finishReason: "completed",
      gitInsertions: 10,
      gitDeletions: 0,
      gitFilesChanged: 1,
      isInterrupted: false,
    };
    await appendTelemetryRecord(rec);

    const summaries = await computeSlidingAggregations("7d");
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.model, "gemini-3.8-flash-low");
  });
});
