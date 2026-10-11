import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { PluginServerContext, PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  normalizeTurnTelemetry,
  calculateFDSI,
  calculateWorkerROI,
  calculateOrchestratorVigilance,
  calculateToolThrashingIndex,
  calculateContextDecayRisk,
  type NormalizedTurnTelemetry,
  type RawTurnData,
  type RawTurnUsage,
} from "paseo-plugin-helper/server";
import type {
  UppidiModelTelemetryQueryInput,
  UppidiModelTelemetryQueryOutput,
  ModelTelemetrySummary,
  ModelCompositeIndices,
} from "../shared/contracts.js";

let telemetryStorePathOverride: string | null = null;

export function setTelemetryStorePathForTest(filePath: string | null): void {
  telemetryStorePathOverride = filePath;
}

export function defaultTelemetryStorePath(context?: any): string {
  const override = process.env.UPPIDI_FLEET_TELEMETRY_FILE?.trim();
  if (override) return override;

  if (typeof context === "string" && context.trim()) {
    const trimmed = context.trim();
    return trimmed.endsWith(".jsonl") ? trimmed : path.join(trimmed, "telemetry.jsonl");
  }

  if (context && typeof context === "object") {
    const storage = context.storage;
    if (typeof storage === "string" && storage.trim()) {
      const s = storage.trim();
      return s.endsWith(".jsonl") ? s : path.join(s, "telemetry.jsonl");
    }
    if (storage && typeof storage === "object") {
      if (typeof storage.path === "string" && storage.path.trim()) {
        const p = storage.path.trim();
        return p.endsWith(".jsonl") ? p : path.join(p, "telemetry.jsonl");
      }
      if (typeof storage.path === "function") {
        try {
          const res = storage.path("telemetry.jsonl");
          if (typeof res === "string" && res.trim()) {
            const p = res.trim();
            return p.endsWith(".jsonl") ? p : path.join(p, "telemetry.jsonl");
          }
        } catch {
          // Fall through
        }
      }
      if (typeof storage.dir === "string" && storage.dir.trim()) {
        return path.join(storage.dir.trim(), "telemetry.jsonl");
      }
    }
  }

  const pluginData = process.env.PASEO_PLUGIN_DATA?.trim();
  if (pluginData) {
    if (pluginData.endsWith("uppidi-fleet") || pluginData.endsWith("uppidi-fleet/")) {
      return path.join(pluginData, "telemetry.jsonl");
    }
    if (pluginData.endsWith("xpufx") || pluginData.endsWith("xpufx/")) {
      return path.join(pluginData, "uppidi-fleet", "telemetry.jsonl");
    }
    return path.join(pluginData, "xpufx", "uppidi-fleet", "telemetry.jsonl");
  }

  const home = process.env.HOME ?? os.homedir();
  return path.join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "telemetry.jsonl");
}

export function getTelemetryStorePath(context?: any): string {
  return telemetryStorePathOverride ?? defaultTelemetryStorePath(context);
}

/**
 * Appends a normalized turn telemetry record to the append-only streaming JSONL store.
 */
export async function appendTelemetryRecord(
  record: NormalizedTurnTelemetry,
  context?: any,
): Promise<void> {
  const filePath = getTelemetryStorePath(context);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const line = `${JSON.stringify(record)}\n`;
  await fs.appendFile(filePath, line, "utf8");
}

export interface ReadTelemetryFilter {
  provider?: string;
  model?: string;
  role?: string;
  since?: number;
  windowMs?: number;
  limit?: number;
}

/**
 * Reads records from the append-only JSONL streaming store with optional filtering.
 */
export async function readTelemetryRecords(
  filter?: ReadTelemetryFilter,
  context?: any,
): Promise<NormalizedTurnTelemetry[]> {
  const filePath = getTelemetryStorePath(context);
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }

  const lines = content.split("\n");
  const records: NormalizedTurnTelemetry[] = [];
  const now = Date.now();
  const minTime = filter?.windowMs ? now - filter.windowMs : filter?.since ?? 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as NormalizedTurnTelemetry;
      const recTime = Date.parse(rec.timestamp);
      if (Number.isFinite(recTime) && recTime < minTime) {
        continue;
      }
      if (filter?.provider && rec.provider && rec.provider.toLowerCase() !== filter.provider.toLowerCase()) {
        continue;
      }
      if (filter?.model && rec.model && rec.model.toLowerCase() !== filter.model.toLowerCase()) {
        continue;
      }
      if (filter?.role && rec.role && rec.role.toLowerCase() !== filter.role.toLowerCase()) {
        continue;
      }
      records.push(rec);
    } catch {
      // Ignore corrupted lines
    }
  }

  if (filter?.limit && filter.limit > 0 && records.length > filter.limit) {
    return records.slice(-filter.limit);
  }
  return records;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

/**
 * Computes sliding window model telemetry aggregations and composite indices.
 */
export function aggregateModelTelemetry(
  records: readonly NormalizedTurnTelemetry[],
  window: "7d" | "30d" | "all" = "7d",
): ModelTelemetrySummary[] {
  const groups = new Map<string, NormalizedTurnTelemetry[]>();

  for (const rec of records) {
    const provider = rec.provider || "unknown";
    const model = rec.model || "unknown";
    const roleKey = rec.role ? `::${rec.role}` : "";
    const key = `${provider}::${model}${roleKey}`;
    const list = groups.get(key) ?? [];
    list.push(rec);
    groups.set(key, list);
  }

  const summaries: ModelTelemetrySummary[] = [];

  for (const group of groups.values()) {
    if (group.length === 0) continue;
    const latest = group[group.length - 1]!;
    const provider = latest.provider || "unknown";
    const model = latest.model || "unknown";
    const role = latest.role || undefined;

    let turnsCompleted = 0;
    let turnsFailed = 0;
    let turnsInterrupted = 0;
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let reasoningTokens = 0;
    let costUsd = 0;

    const tpsList: number[] = [];
    const durations: number[] = [];
    const contextUtilList: number[] = [];

    // For composite index calculation
    let netChanges = 0;
    let linesAdded = 0;
    let linesDeleted = 0;
    const toolCallTraces: Array<{ exitCode?: number; isInspectionOrEdit?: boolean }> = [];
    const contextTraces: Array<{ contextUtilizationPct: number; failed: boolean }> = [];

    for (const rec of group) {
      if (rec.finishReason === "failed") {
        turnsFailed++;
      } else if (rec.isInterrupted) {
        turnsInterrupted++;
      } else {
        turnsCompleted++;
      }

      totalTokens += rec.totalTokens;
      inputTokens += rec.inputTokens;
      outputTokens += rec.outputTokens;
      cachedTokens += rec.cachedTokens;
      reasoningTokens += rec.reasoningTokens;
      costUsd += rec.costUsd;

      if (!rec.isInterrupted && rec.tokensPerSecond > 0) {
        tpsList.push(rec.tokensPerSecond);
      }
      durations.push(rec.durationMs);
      if (rec.contextMaxTokens > 0) {
        contextUtilList.push(rec.contextUtilizationPct);
      }

      linesAdded += rec.gitInsertions;
      linesDeleted += rec.gitDeletions;
      netChanges += rec.gitInsertions - rec.gitDeletions;

      contextTraces.push({
        contextUtilizationPct: rec.contextUtilizationPct,
        failed: rec.finishReason === "failed",
      });

      if (rec.toolCallsCount > 0) {
        // Approximate traces from counts
        for (let t = 0; t < rec.toolCallsCount; t++) {
          const isError = t < rec.toolErrorsCount;
          toolCallTraces.push({
            exitCode: isError ? 1 : 0,
            isInspectionOrEdit: false,
          });
        }
      }
    }

    const cacheDenominator = cachedTokens + inputTokens;
    const cacheHitRatioPct = cacheDenominator > 0 ? round2((cachedTokens / cacheDenominator) * 100) : 0;
    const medianTPS = round2(median(tpsList));
    const medianDur = Math.round(median(durations));
    const medianContext = round2(median(contextUtilList));

    // Composite Indices calculations
    const fdsi = calculateFDSI({
      conciseness: outputTokens > 0 ? round2((group.length * 1000) / outputTokens) : 50,
      ttftLatencyMs: medianDur > 0 ? Math.min(2000, medianDur / 5) : 500,
      turnLocks: turnsInterrupted,
      tokenBurnRatio: outputTokens > 0 ? round2(totalTokens / outputTokens) : 1.5,
    });

    const workerRoi = calculateWorkerROI({
      netDeliverableValue: Math.max(1, turnsCompleted),
      totalTokens,
      wallClockTimeMs: group.reduce((acc, r) => acc + r.durationMs, 0),
      reworkRounds: turnsFailed,
      linesAdded,
      linesDeleted,
      netChanges,
    });

    const orchestratorVigilance = calculateOrchestratorVigilance({
      flawsCaught: turnsFailed,
      falsePositiveClaimsDebunked: turnsInterrupted,
      totalPRsAudited: group.length,
    });

    const toolThrashingIndex = calculateToolThrashingIndex(toolCallTraces);
    const contextDecayRisk = calculateContextDecayRisk(contextTraces);

    const compositeIndices: ModelCompositeIndices = {
      fdsi,
      workerRoi,
      orchestratorVigilance,
      toolThrashingIndex,
      contextDecayRisk,
    };

    summaries.push({
      provider,
      model,
      role,
      window,
      turnsCompleted,
      turnsFailed,
      turnsInterrupted,
      totalTokens,
      inputTokens,
      outputTokens,
      cachedTokens,
      reasoningTokens,
      medianTokensPerSecond: medianTPS,
      medianTurnDurationMs: medianDur,
      medianContextUtilizationPct: medianContext,
      cacheHitRatioPct,
      costUsd: round4(costUsd),
      compositeIndices,
      lastTurnAt: latest.timestamp,
    });
  }

  return summaries.sort((a, b) =>
    a.provider === b.provider ? a.model.localeCompare(b.model) : a.provider.localeCompare(b.provider),
  );
}

/**
 * Telemetry Tap Options.
 */
export interface TelemetryTapOptions {
  onRecord?: (record: NormalizedTurnTelemetry) => void;
  context?: any;
}

/**
 * Sets up in-process turn telemetry listeners on the Paseo plugin server.
 */
export function setupTelemetryTap(
  server: PluginServerContext,
  options?: TelemetryTapOptions,
): () => void {
  const turnStartTimes = new Map<string, number>();
  const turnGitBefore = new Map<string, { insertions: number; deletions: number; filesChanged: number }>();
  const lastKnownUsage = new Map<string, RawTurnUsage>();

  const unsubs: Array<() => void> = [];

  if (typeof (server as any).on === "function") {
    // 1. Turn started
    const unsubStart = server.on("agent.turn_started", (event: any) => {
      if (!event?.agent?.id) return;
      turnStartTimes.set(event.agent.id, Date.now());
      if (event.agent.lastUsage) {
        lastKnownUsage.set(event.agent.id, event.agent.lastUsage);
      }
    });
    if (typeof unsubStart === "function") unsubs.push(unsubStart);

    // 2. Usage updated (ACP asynchronous context meter)
    try {
      const unsubUsage = (server as any).on("agent.usage_updated", (event: any) => {
        if (!event?.agent?.id) return;
        const usage = event.usage ?? event.agent?.lastUsage;
        if (usage) {
          lastKnownUsage.set(event.agent.id, usage);
        }
      });
      if (typeof unsubUsage === "function") unsubs.push(unsubUsage);
    } catch {
      // Ignored: agent.usage_updated is not a supported lifecycle event in this Paseo release
    }

    // 3. Turn ended
    const unsubEnd = server.on("agent.turn_ended", async (event: any, ctx: any) => {
      if (!event?.agent?.id) return;
      const agentId = event.agent.id;
      const startTime = turnStartTimes.get(agentId);
      const durationMs = startTime ? Date.now() - startTime : undefined;
      turnStartTimes.delete(agentId);

      const cachedUsage = lastKnownUsage.get(agentId);
      const effectiveUsage = (event.agent as any)?.lastUsage ?? cachedUsage ?? null;

      const rawData: RawTurnData = {
        turnId: event.turnId ?? null,
        agentId,
        repo: (event.agent as any)?.repo ?? null,
        role: (event.agent as any)?.role ?? null,
        model: event.agent.model ?? null,
        provider: event.agent.provider ?? null,
        outcome: event.outcome ?? { kind: "completed" },
        durationMs,
        timeline: event.timeline,
        liveUsage: effectiveUsage,
        gitBefore: turnGitBefore.get(agentId) ?? null,
      };

      try {
        const record = normalizeTurnTelemetry(rawData);
        await appendTelemetryRecord(record, options?.context ?? ctx);
        if (options?.onRecord) {
          options.onRecord(record);
        }
      } catch (err) {
        console.warn(`[uppidi-fleet:telemetry] Failed to record turn telemetry:`, err);
      }
    });
    if (typeof unsubEnd === "function") unsubs.push(unsubEnd);
  }

  return () => {
    for (const unsub of unsubs) {
      try {
        unsub();
      } catch {
        // Ignore
      }
    }
    turnStartTimes.clear();
    turnGitBefore.clear();
    lastKnownUsage.clear();
  };
}

/**
 * RPC Handler: uppidi-fleet.model-telemetry-query
 */
export async function handleUppidiModelTelemetryQuery(
  input: UppidiModelTelemetryQueryInput,
  context?: PluginHandlerContext,
): Promise<UppidiModelTelemetryQueryOutput> {
  const window = input.window ?? "7d";
  const windowMs =
    window === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : window === "30d"
        ? 30 * 24 * 60 * 60 * 1000
        : undefined;

  const records = await readTelemetryRecords(
    {
      provider: input.provider,
      model: input.model,
      role: input.role,
      windowMs,
    },
    context,
  );

  const models = aggregateModelTelemetry(records, window);

  return {
    ok: true,
    window,
    models,
    recordsCount: records.length,
    updatedAt: new Date().toISOString(),
  };
}
