import { describe, it, expect } from "vitest";
import {
  normalizeTurnTelemetry,
  calculateFDSI,
  calculateWorkerROI,
  calculateOrchestratorVigilance,
  calculateToolThrashingIndex,
  calculateContextDecayRisk,
  NormalizedTurnTelemetrySchema,
} from "../server/telemetry.js";

describe("normalizeTurnTelemetry", () => {
  it("normalizes standard turns and calculates tokens per second", () => {
    const raw = {
      turnId: "turn-123",
      agentId: "agent-abc",
      repo: "xpufx-org/paseo",
      role: "worker",
      model: "gemini-3.8-flash-low",
      provider: "antigravity-acp",
      durationMs: 2000,
      liveUsage: {
        inputTokens: 100,
        outputTokens: 200,
        cachedTokens: 50,
        reasoningTokens: 0,
        contextWindowUsedTokens: 1000,
        contextWindowMaxTokens: 8000,
        totalCostUsd: 0.005,
      },
      outcome: { kind: "completed" },
    };

    const normalized = normalizeTurnTelemetry(raw, 1700000000000);
    expect(NormalizedTurnTelemetrySchema.safeParse(normalized).success).toBe(true);
    expect(normalized.inputTokens).toBe(100);
    expect(normalized.outputTokens).toBe(200);
    expect(normalized.totalTokens).toBe(350);
    // TPS = 200 / 2.0 = 100 tok/sec
    expect(normalized.tokensPerSecond).toBe(100);
    expect(normalized.contextUtilizationPct).toBe(12.5);
    expect(normalized.isInterrupted).toBe(false);
    expect(normalized.finishReason).toBe("completed");
  });

  it("handles Claude nested iterations arrays properly", () => {
    const raw = {
      agentId: "agent-claude",
      durationMs: 3000,
      liveUsage: {
        iterations: [
          {
            input_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
            output_tokens: 80,
          },
          {
            input_tokens: 30,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 15,
            output_tokens: 70,
          },
        ],
      },
    };

    const normalized = normalizeTurnTelemetry(raw);
    expect(normalized.inputTokens).toBe(80);
    expect(normalized.cachedTokens).toBe(45); // (10+20) + (0+15)
    expect(normalized.outputTokens).toBe(150); // 80 + 70
    expect(normalized.tokensPerSecond).toBe(50); // 150 / 3
  });

  it("handles OpenCode reasoning tokens and includes them in TPS calculation", () => {
    const raw = {
      agentId: "agent-opencode",
      durationMs: 1000,
      liveUsage: {
        tokens: {
          input: 100,
          output: 40,
          reasoning: 60,
          cache_read: 20,
        },
      },
    };

    const normalized = normalizeTurnTelemetry(raw);
    expect(normalized.outputTokens).toBe(40);
    expect(normalized.reasoningTokens).toBe(60);
    expect(normalized.cachedTokens).toBe(20);
    // TPS includes output + reasoning: (40 + 60) / 1 = 100
    expect(normalized.tokensPerSecond).toBe(100);
  });

  it("normalizes interrupted and canceled turns without division-by-zero or skewed TPS", () => {
    const raw = {
      agentId: "agent-canceled",
      durationMs: 0,
      outcome: {
        kind: "canceled",
        reason: "interrupted",
      },
      liveUsage: {
        outputTokens: 50,
      },
    };

    const normalized = normalizeTurnTelemetry(raw);
    expect(normalized.isInterrupted).toBe(true);
    expect(normalized.finishReason).toBe("interrupted");
    expect(normalized.tokensPerSecond).toBe(0);
  });

  it("flags subscription $0 cost appropriately", () => {
    const raw = {
      agentId: "agent-sub",
      liveUsage: {
        inputTokens: 500,
        outputTokens: 200,
        totalCostUsd: 0,
      },
    };

    const normalized = normalizeTurnTelemetry(raw);
    expect(normalized.costUsd).toBe(0);
    expect(normalized.isSubscriptionZeroCost).toBe(true);
  });
});

describe("Composite Indices Calculations", () => {
  it("calculates FDSI (Front Desk Suitability Index)", () => {
    const fdsi = calculateFDSI({
      conciseness: 100,
      ttftLatencyMs: 500, // 0.5s
      turnLocks: 0,
      tokenBurnRatio: 1.2,
    });
    // denominator = 0.5 * 1 * 1.2 = 0.6; 100 / 0.6 = 166.67
    expect(fdsi).toBe(166.67);
  });

  it("calculates Worker ROI with churn ratio penalty", () => {
    const roiClean = calculateWorkerROI({
      netDeliverableValue: 1,
      totalTokens: 1000,
      wallClockTimeMs: 10000, // 10s
      reworkRounds: 0,
      linesAdded: 50,
      linesDeleted: 10,
      netChanges: 40, // churn ratio: (50+10)/40 = 1.5
    });
    expect(roiClean).toBeGreaterThan(0);

    const roiThrashed = calculateWorkerROI({
      netDeliverableValue: 1,
      totalTokens: 1000,
      wallClockTimeMs: 10000,
      reworkRounds: 2, // penalty
      linesAdded: 200,
      linesDeleted: 160,
      netChanges: 40, // high churn ratio: 360 / 40 = 9
    });
    expect(roiClean).toBeGreaterThan(roiThrashed);
  });

  it("calculates Orchestrator Vigilance Score", () => {
    const score = calculateOrchestratorVigilance({
      flawsCaught: 4,
      falsePositiveClaimsDebunked: 2,
      totalPRsAudited: 10,
    });
    expect(score).toBe(0.6);
  });

  it("calculates Tool Thrashing Index", () => {
    const cleanTraces = [
      { exitCode: 0, command: "ls" },
      { exitCode: 0, command: "git status" },
    ];
    expect(calculateToolThrashingIndex(cleanTraces)).toBe(0);

    const thrashingTraces = [
      { exitCode: 1, command: "npm test", isInspectionOrEdit: false },
      { exitCode: 1, command: "npm test", isInspectionOrEdit: false },
      { exitCode: 0, command: "cat file.ts", isInspectionOrEdit: true },
    ];
    // 1 transition was non-zero command followed by non-inspection command out of 2 total transitions
    expect(calculateToolThrashingIndex(thrashingTraces)).toBe(50);
  });

  it("calculates Context Decay & Amnesia Risk", () => {
    const traces = [
      { contextUtilizationPct: 60, failed: false },
      { contextUtilizationPct: 80, failed: false },
      { contextUtilizationPct: 90, failed: true },
      { contextUtilizationPct: 92, failed: true },
    ];
    // 3 high context turns (>75%), 2 of which failed -> 2/3 = 66.67%
    expect(calculateContextDecayRisk(traces)).toBe(66.67);
  });
});
