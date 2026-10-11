import { z } from "zod";

/**
 * Raw usage structure as emitted by various Paseo agent engines and providers.
 */
export interface RawTurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  contextWindowUsedTokens?: number;
  contextWindowMaxTokens?: number;
  totalCostUsd?: number;
  /** Claude Code SDK nested iterations array */
  iterations?: Array<{
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  }>;
  /** OpenCode / ACP tokens object */
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache_read?: number;
  };
  [key: string]: unknown;
}

export interface RawTurnOutcome {
  kind: "completed" | "failed" | "canceled" | string;
  error?: { message: string; code?: string };
  reason?: string;
  stopReason?: string;
}

export interface RawTurnData {
  turnId?: string | null;
  agentId: string;
  repo?: string | null;
  role?: string | null;
  model?: string | null;
  provider?: string | null;
  outcome?: RawTurnOutcome;
  durationMs?: number;
  timeline?: readonly unknown[];
  liveUsage?: RawTurnUsage | null;
  gitBefore?: { insertions: number; deletions: number; filesChanged: number } | null;
  gitAfter?: { insertions: number; deletions: number; filesChanged: number } | null;
}

export const NormalizedTurnTelemetrySchema = z.object({
  turnId: z.string().nullable(),
  agentId: z.string(),
  repo: z.string().nullable(),
  role: z.string().nullable(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  timestamp: z.string(),
  durationMs: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedTokens: z.number(),
  reasoningTokens: z.number(),
  totalTokens: z.number(),
  tokensPerSecond: z.number(),
  contextUsedTokens: z.number(),
  contextMaxTokens: z.number(),
  contextUtilizationPct: z.number(),
  costUsd: z.number(),
  toolCallsCount: z.number(),
  toolErrorsCount: z.number(),
  finishReason: z.string(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  gitInsertions: z.number(),
  gitDeletions: z.number(),
  gitFilesChanged: z.number(),
  isInterrupted: z.boolean(),
  isSubscriptionZeroCost: z.boolean().optional(),
});

export type NormalizedTurnTelemetry = z.infer<typeof NormalizedTurnTelemetrySchema>;

function finite(val: unknown, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/**
 * Normalizes vendor/provider quirks into a canonical TurnTelemetry record:
 * - Claude nested iterations array accumulation
 * - OpenCode isolated reasoning tokens
 * - ACP asynchronous context meter readings
 * - Interrupted / canceled turn normalization (prevents division by zero)
 * - Subscription $0 cost normalization
 */
export function normalizeTurnTelemetry(
  raw: RawTurnData,
  now = Date.now(),
): NormalizedTurnTelemetry {
  const usage = raw.liveUsage;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let reasoningTokens = 0;
  let contextUsedTokens = 0;
  let contextMaxTokens = 0;
  let costUsd = 0;

  if (usage) {
    if (Array.isArray(usage.iterations) && usage.iterations.length > 0) {
      // Claude nested iterations normalization
      let iterInput = 0;
      let iterOutput = 0;
      let iterCache = 0;
      for (const iter of usage.iterations) {
        iterInput += finite(iter.input_tokens);
        iterCache += finite(iter.cache_read_input_tokens) + finite(iter.cache_creation_input_tokens);
        iterOutput += finite(iter.output_tokens);
      }
      inputTokens = iterInput;
      cachedTokens = iterCache;
      outputTokens = iterOutput;
    } else {
      inputTokens = finite(usage.inputTokens ?? usage.tokens?.input);
      outputTokens = finite(usage.outputTokens ?? usage.tokens?.output);
      cachedTokens = finite(usage.cachedTokens ?? usage.cachedInputTokens ?? usage.tokens?.cache_read);
      reasoningTokens = finite(usage.reasoningTokens ?? usage.tokens?.reasoning);
    }

    if (reasoningTokens === 0 && usage.tokens?.reasoning) {
      reasoningTokens = finite(usage.tokens.reasoning);
    }

    contextUsedTokens = finite(usage.contextWindowUsedTokens);
    contextMaxTokens = finite(usage.contextWindowMaxTokens);
    costUsd = finite(usage.totalCostUsd);
  }

  // Count timeline tool calls and tool errors if timeline is provided
  let toolCallsCount = 0;
  let toolErrorsCount = 0;
  if (Array.isArray(raw.timeline)) {
    for (const item of raw.timeline) {
      if (!item || typeof item !== "object") continue;
      const type = (item as any).type;
      if (type === "tool_call" || type === "tool_use" || (item as any).toolCall) {
        toolCallsCount++;
        if ((item as any).isError || (item as any).error || (item as any).status === "error") {
          toolErrorsCount++;
        }
      }
    }
  }

  // Interrupted / canceled normalization
  const kind = raw.outcome?.kind ?? "completed";
  const stopReason = raw.outcome?.stopReason ?? (raw.outcome as any)?.reason;
  const isInterrupted =
    kind === "canceled" ||
    stopReason === "cancelled" ||
    stopReason === "interrupted" ||
    raw.outcome?.reason === "canceled" ||
    raw.outcome?.reason === "interrupted";

  let finishReason = isInterrupted ? "interrupted" : kind;
  if (kind === "failed") finishReason = "failed";

  const durationMs = Math.max(0, finite(raw.durationMs));
  const durationSec = durationMs / 1000;

  // Generation velocity (TPS): sum output + reasoning (OpenCode isolation rule)
  // Interrupted turns with 0 duration or incomplete payloads yield 0 TPS to avoid skewed averages
  const generationTokens = outputTokens + reasoningTokens;
  const tokensPerSecond =
    !isInterrupted && durationSec > 0.05 && generationTokens > 0
      ? round2(generationTokens / durationSec)
      : 0;

  const contextUtilizationPct =
    contextMaxTokens > 0 ? round2(Math.min(100, (contextUsedTokens / contextMaxTokens) * 100)) : 0;

  // Git churn diff
  let gitInsertions = 0;
  let gitDeletions = 0;
  let gitFilesChanged = 0;
  if (raw.gitAfter) {
    const before = raw.gitBefore;
    gitInsertions = Math.max(0, raw.gitAfter.insertions - (before?.insertions ?? 0));
    gitDeletions = Math.max(0, raw.gitAfter.deletions - (before?.deletions ?? 0));
    gitFilesChanged = raw.gitAfter.filesChanged;
  }

  const isSubscriptionZeroCost = costUsd === 0 && (inputTokens > 0 || outputTokens > 0);

  return {
    turnId: raw.turnId ?? null,
    agentId: raw.agentId,
    repo: raw.repo ?? null,
    role: raw.role ?? null,
    model: raw.model ?? null,
    provider: raw.provider ?? null,
    timestamp: new Date(now).toISOString(),
    durationMs,
    inputTokens,
    outputTokens,
    cachedTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens + cachedTokens + reasoningTokens,
    tokensPerSecond,
    contextUsedTokens,
    contextMaxTokens,
    contextUtilizationPct,
    costUsd: round2(costUsd),
    toolCallsCount,
    toolErrorsCount,
    finishReason,
    stopReason: stopReason ? String(stopReason) : undefined,
    errorMessage: raw.outcome?.error?.message,
    gitInsertions,
    gitDeletions,
    gitFilesChanged,
    isInterrupted,
    isSubscriptionZeroCost,
  };
}

/**
 * 1. Front Desk Suitability Index (FDSI)
 * FDSI = Conversational Conciseness / (TTFT Latency * (Turn Locks + 1) * Token Burn Ratio)
 */
export interface FDSIInput {
  conciseness: number;
  ttftLatencyMs: number;
  turnLocks: number;
  tokenBurnRatio: number;
}

export function calculateFDSI(input: FDSIInput): number {
  const conciseness = Math.max(0, input.conciseness);
  const ttftSec = Math.max(0.001, input.ttftLatencyMs / 1000);
  const locksFactor = Math.max(1, input.turnLocks + 1);
  const burnRatio = Math.max(1.0, input.tokenBurnRatio);

  const denominator = ttftSec * locksFactor * burnRatio;
  return round2(conciseness / denominator);
}

/**
 * 2. Worker Implementation ROI (Cost & Churn per Merged PR)
 * Worker ROI = (Net Deliverable Value / (Total Tokens * Wall Clock Time * (Rework Rounds + 1))) / ChurnRatio
 */
export interface WorkerROIInput {
  netDeliverableValue: number;
  totalTokens: number;
  wallClockTimeMs: number;
  reworkRounds: number;
  linesAdded: number;
  linesDeleted: number;
  netChanges: number;
}

export function calculateWorkerROI(input: WorkerROIInput): number {
  const deliverable = Math.max(0, input.netDeliverableValue);
  const tokens = Math.max(1, input.totalTokens);
  const wallClockSec = Math.max(1, input.wallClockTimeMs / 1000);
  const rework = Math.max(1, input.reworkRounds + 1);

  const netChanges = Math.max(1, Math.abs(input.netChanges));
  const totalChurn = Math.max(netChanges, input.linesAdded + input.linesDeleted);
  const churnRatio = Math.max(1.0, totalChurn / netChanges);

  const rawRoi = (deliverable * 1_000_000) / (tokens * wallClockSec * rework);
  return round2(rawRoi / churnRatio);
}

/**
 * 3. Orchestrator Audit Vigilance Score
 * Vigilance = (Flaws Caught in Pre-Flight + False-Positive Claims Debunked) / Total PRs Audited
 */
export interface OrchestratorVigilanceInput {
  flawsCaught: number;
  falsePositiveClaimsDebunked: number;
  totalPRsAudited: number;
}

export function calculateOrchestratorVigilance(input: OrchestratorVigilanceInput): number {
  const totalAudits = Math.max(1, input.totalPRsAudited);
  const signals = Math.max(0, input.flawsCaught + input.falsePositiveClaimsDebunked);
  return round2(signals / totalAudits);
}

/**
 * 4. Tool Thrashing / Loop Index
 * Frequency of non-zero exit codes (rc != 0) followed immediately by another command
 * without intervening file inspections or edits.
 */
export interface ToolCallTrace {
  command?: string;
  exitCode?: number;
  isInspectionOrEdit?: boolean;
}

export function calculateToolThrashingIndex(traces: readonly ToolCallTrace[]): number {
  if (traces.length < 2) return 0;

  let thrashedSequences = 0;
  let totalCommandTransitions = 0;

  for (let i = 0; i < traces.length - 1; i++) {
    const curr = traces[i]!;
    const next = traces[i + 1]!;

    if (curr.exitCode !== undefined) {
      totalCommandTransitions++;
      if (curr.exitCode !== 0 && !curr.isInspectionOrEdit && !next.isInspectionOrEdit) {
        thrashedSequences++;
      }
    }
  }

  if (totalCommandTransitions === 0) return 0;
  return round2((thrashedSequences / totalCommandTransitions) * 100);
}

/**
 * 5. Context Decay & Amnesia Risk
 * Correlation between context utilization (> 75%) and subsequent turn failures, tool loops, or repetitive questions.
 */
export interface ContextTurnTrace {
  contextUtilizationPct: number;
  failed: boolean;
  hasToolLoop?: boolean;
}

export function calculateContextDecayRisk(turns: readonly ContextTurnTrace[]): number {
  if (turns.length === 0) return 0;

  const highContextTurns = turns.filter((t) => t.contextUtilizationPct > 75);
  if (highContextTurns.length === 0) return 0;

  const failuresUnderHighContext = highContextTurns.filter(
    (t) => t.failed || t.hasToolLoop,
  ).length;

  return round2((failuresUnderHighContext / highContextTurns.length) * 100);
}
