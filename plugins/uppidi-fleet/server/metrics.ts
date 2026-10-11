import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  CandidateModelMetrics,
  RollupReceipt,
  UppidiFleetMetricsInput,
  UppidiFleetMetricsOutput,
} from "../shared/contracts.js";

/** Durable per-daemon metrics receipt file (privacy-minimized, platform#18). */
export function defaultMetricsFilePath(context?: any): string {
  const override = process.env.UPPIDI_FLEET_METRICS_FILE?.trim();
  if (override) return override;

  if (typeof context === "string" && context.trim()) {
    const trimmed = context.trim();
    return trimmed.endsWith(".json") ? trimmed : path.join(trimmed, "metrics.json");
  }

  if (context && typeof context === "object") {
    const storage = context.storage;
    if (typeof storage === "string" && storage.trim()) {
      const s = storage.trim();
      return s.endsWith(".json") ? s : path.join(s, "metrics.json");
    }
    if (storage && typeof storage === "object") {
      if (typeof storage.path === "string" && storage.path.trim()) {
        const p = storage.path.trim();
        return p.endsWith(".json") ? p : path.join(p, "metrics.json");
      }
      if (typeof storage.path === "function") {
        try {
          const res = storage.path("metrics.json");
          if (typeof res === "string" && res.trim()) {
            const p = res.trim();
            return p.endsWith(".json") ? p : path.join(p, "metrics.json");
          }
        } catch (err) {
          console.warn(`[uppidi-fleet:metrics] storage provider failed:`, err);
        }
      }
      if (typeof storage.filePath === "string" && storage.filePath.trim()) {
        return storage.filePath.trim();
      }
      if (typeof storage.dir === "string" && storage.dir.trim()) {
        return path.join(storage.dir.trim(), "metrics.json");
      }
      if (typeof storage.getFilePath === "function") {
        try {
          const res = storage.getFilePath("metrics.json");
          if (typeof res === "string" && res.trim()) return res.trim();
        } catch (err) {
          console.warn(`[uppidi-fleet:metrics] storage provider failed:`, err);
        }
      }
    }
  }

  const pluginData = process.env.PASEO_PLUGIN_DATA?.trim();
  if (pluginData) {
    if (pluginData.endsWith("uppidi-fleet") || pluginData.endsWith("uppidi-fleet/")) {
      return path.join(pluginData, "metrics.json");
    }
    if (pluginData.endsWith("xpufx") || pluginData.endsWith("xpufx/")) {
      return path.join(pluginData, "uppidi-fleet", "metrics.json");
    }
    return path.join(pluginData, "xpufx", "uppidi-fleet", "metrics.json");
  }

  const home = process.env.HOME ?? os.homedir();
  return path.join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "metrics.json");
}

let metricsFilePathOverride: string | null = null;
let legacyMetricsFilePathOverride: string | null = null;

/** Legacy durable metrics receipt file path (~/.paseo/uppidi-fleet-metrics.json). */
export function legacyMetricsFilePath(): string {
  if (legacyMetricsFilePathOverride !== null) {
    return legacyMetricsFilePathOverride;
  }
  const home = process.env.HOME ?? os.homedir();
  return path.join(home, ".paseo", "uppidi-fleet-metrics.json");
}

/** Test hook: pin the receipt file, or pass null to restore the default. */
export function setMetricsFilePathForTest(filePath: string | null): void {
  metricsFilePathOverride = filePath;
}

/** Test hook: pin the legacy receipt file, or pass null to restore the default. */
export function setLegacyMetricsFilePathForTest(filePath: string | null): void {
  legacyMetricsFilePathOverride = filePath;
}

export function getMetricsFilePath(context?: any): string {
  return metricsFilePathOverride ?? defaultMetricsFilePath(context);
}

/** Rolling cap on stored receipts, oldest evicted first. */
export const MAX_ROLLUP_RECEIPTS = 500;

export const METRICS_PRIVACY_NOTICE =
  "Advisory minimized receipts only (platform#18 compliant: zero transcripts, prompts, or code stored).";

export const DEFAULT_TASK_PROFILES = [
  "surgical-bugfix",
  "multi-file-refactor",
  "architecture-triage",
  "operator-liaison",
];

export const BASELINE_CANDIDATES: CandidateModelMetrics[] = [
  {
    model: "gemini-3.8-flash-low",
    provider: "antigravity-acp",
    configProfile: "default",
    overallPassRate: 93,
    totalTrials: 52,
    medianWallMs: 9700,
    recommendedRoles: ["front-desk", "orchestrator"],
    profiles: [
      {
        taskProfile: "surgical-bugfix",
        taskProfileLabel: "Surgical Bugfix",
        description: "Seeded defect with focused tests within bounded files and time",
        trialsCount: 15,
        passRate: 92,
        reworkRate: 8,
        medianWallMs: 8400,
        confidence: "high",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 1, checkFailure: 1 },
        advisory: "Fast and reliable for small-to-medium edits with quick unit test feedback",
      },
      {
        taskProfile: "multi-file-refactor",
        taskProfileLabel: "Multi-file Refactor",
        description: "Cross-file changes and type checks across monorepo packages",
        trialsCount: 11,
        passRate: 86,
        reworkRate: 14,
        medianWallMs: 21500,
        confidence: "high",
        failureBreakdown: { quota: 0, timeout: 1, toolFailure: 1, checkFailure: 1 },
        advisory: "Solid across monorepo packages; tight context window utilization",
      },
      {
        taskProfile: "architecture-triage",
        taskProfileLabel: "Architecture Triage",
        description: "Issue decomposition, taxonomy labeling, and checklist specs",
        trialsCount: 14,
        passRate: 97,
        reworkRate: 3,
        medianWallMs: 5200,
        confidence: "high",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 0, checkFailure: 1 },
        advisory: "Exceptional speed and label synthesis; ideal for board hygiene and triage",
      },
      {
        taskProfile: "operator-liaison",
        taskProfileLabel: "Operator Liaison",
        description: "Rapid triage intake, operator directive execution, concise summaries",
        trialsCount: 12,
        passRate: 98,
        reworkRate: 2,
        medianWallMs: 4100,
        confidence: "high",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 0, checkFailure: 0 },
        advisory: "Preferred for responsive front-desk triage and operator notifications",
      },
    ],
  },
  {
    model: "gpt-5.6-luna",
    provider: "codex",
    configProfile: "default",
    overallPassRate: 94,
    totalTrials: 48,
    medianWallMs: 18900,
    recommendedRoles: ["orchestrator", "coding-agent", "auditor"],
    profiles: [
      {
        taskProfile: "surgical-bugfix",
        taskProfileLabel: "Surgical Bugfix",
        description: "Seeded defect with focused tests within bounded files and time",
        trialsCount: 14,
        passRate: 96,
        reworkRate: 4,
        medianWallMs: 14200,
        confidence: "high",
        failureBreakdown: { quota: 1, timeout: 0, toolFailure: 0, checkFailure: 1 },
        advisory: "Precision diffs and high first-shot verification pass rate",
      },
      {
        taskProfile: "multi-file-refactor",
        taskProfileLabel: "Multi-file Refactor",
        description: "Cross-file changes and type checks across monorepo packages",
        trialsCount: 13,
        passRate: 94,
        reworkRate: 6,
        medianWallMs: 38000,
        confidence: "high",
        failureBreakdown: { quota: 1, timeout: 0, toolFailure: 0, checkFailure: 1 },
        advisory: "Excellent multi-package dependency awareness and type reconciliation",
      },
      {
        taskProfile: "architecture-triage",
        taskProfileLabel: "Architecture Triage",
        description: "Issue decomposition, taxonomy labeling, and checklist specs",
        trialsCount: 11,
        passRate: 95,
        reworkRate: 5,
        medianWallMs: 12100,
        confidence: "high",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 0, checkFailure: 1 },
        advisory: "Deep checklist and dependency verification",
      },
      {
        taskProfile: "operator-liaison",
        taskProfileLabel: "Operator Liaison",
        description: "Rapid triage intake, operator directive execution, concise summaries",
        trialsCount: 10,
        passRate: 91,
        reworkRate: 9,
        medianWallMs: 11400,
        confidence: "high",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 0, checkFailure: 1 },
        advisory: "Verbose and thorough; higher latency than flash models",
      },
    ],
  },
  {
    model: "deepseek-v4.1-flash",
    provider: "opencode",
    configProfile: "default",
    overallPassRate: 86,
    totalTrials: 36,
    medianWallMs: 14600,
    recommendedRoles: ["coding-agent"],
    profiles: [
      {
        taskProfile: "surgical-bugfix",
        taskProfileLabel: "Surgical Bugfix",
        description: "Seeded defect with focused tests within bounded files and time",
        trialsCount: 11,
        passRate: 89,
        reworkRate: 11,
        medianWallMs: 11800,
        confidence: "high",
        failureBreakdown: { quota: 2, timeout: 0, toolFailure: 1, checkFailure: 1 },
        advisory: "High coding aptitude; cost-effective workhorse for single-issue PRs",
      },
      {
        taskProfile: "multi-file-refactor",
        taskProfileLabel: "Multi-file Refactor",
        description: "Cross-file changes and type checks across monorepo packages",
        trialsCount: 9,
        passRate: 82,
        reworkRate: 18,
        medianWallMs: 28500,
        confidence: "moderate",
        failureBreakdown: { quota: 1, timeout: 1, toolFailure: 2, checkFailure: 2 },
        advisory: "Good with clear step-by-step instructions; occasional check retry needed",
      },
      {
        taskProfile: "architecture-triage",
        taskProfileLabel: "Architecture Triage",
        description: "Issue decomposition, taxonomy labeling, and checklist specs",
        trialsCount: 8,
        passRate: 88,
        reworkRate: 12,
        medianWallMs: 9300,
        confidence: "moderate",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 1, checkFailure: 2 },
        advisory: "Capable issue spec generation and checklist elaboration",
      },
      {
        taskProfile: "operator-liaison",
        taskProfileLabel: "Operator Liaison",
        description: "Rapid triage intake, operator directive execution, concise summaries",
        trialsCount: 8,
        passRate: 85,
        reworkRate: 15,
        medianWallMs: 8900,
        confidence: "moderate",
        failureBreakdown: { quota: 1, timeout: 0, toolFailure: 1, checkFailure: 1 },
        advisory: "Respects protocol; good secondary fallback",
      },
    ],
  },
  {
    model: "muse-spark-1.3",
    provider: "uppidi/opencode",
    configProfile: "default",
    overallPassRate: 81,
    totalTrials: 28,
    medianWallMs: 9400,
    recommendedRoles: ["auditor"],
    profiles: [
      {
        taskProfile: "surgical-bugfix",
        taskProfileLabel: "Surgical Bugfix",
        description: "Seeded defect with focused tests within bounded files and time",
        trialsCount: 8,
        passRate: 81,
        reworkRate: 19,
        medianWallMs: 7200,
        confidence: "moderate",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 2, checkFailure: 3 },
        advisory: "Very fast execution; best for cheap unit-test sweeps and lint checks",
      },
      {
        taskProfile: "multi-file-refactor",
        taskProfileLabel: "Multi-file Refactor",
        description: "Cross-file changes and type checks across monorepo packages",
        trialsCount: 6,
        passRate: 72,
        reworkRate: 28,
        medianWallMs: 18900,
        confidence: "low",
        failureBreakdown: { quota: 0, timeout: 2, toolFailure: 3, checkFailure: 4 },
        advisory: "Inconclusive on complex multi-package refactors; keep bounded",
      },
      {
        taskProfile: "architecture-triage",
        taskProfileLabel: "Architecture Triage",
        description: "Issue decomposition, taxonomy labeling, and checklist specs",
        trialsCount: 7,
        passRate: 84,
        reworkRate: 16,
        medianWallMs: 6100,
        confidence: "moderate",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 1, checkFailure: 2 },
        advisory: "Rapid format and taxonomy verification",
      },
      {
        taskProfile: "operator-liaison",
        taskProfileLabel: "Operator Liaison",
        description: "Rapid triage intake, operator directive execution, concise summaries",
        trialsCount: 7,
        passRate: 88,
        reworkRate: 12,
        medianWallMs: 5500,
        confidence: "moderate",
        failureBreakdown: { quota: 0, timeout: 0, toolFailure: 1, checkFailure: 1 },
        advisory: "Low latency helper for quick automated responses",
      },
    ],
  },
];

export interface RollupAgentMetrics {
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  cachedTokens?: number;
  inputTokens?: number;
  costUsd?: number;
  activeTurnStartedAt?: string;
}

/**
 * Minimal raw-agent projection the watchdog tick can hand to the aggregator.
 * Accepts either the mapped `metrics` block (#560/#571) or the daemon-native
 * `lastUsage`/`activeTurn` payload, so the rollup is testable without the
 * full `UppidiAgent` pipeline and stays free of transcript data.
 */
export interface RollupAgentInput {
  provider?: string | null;
  model?: string | null;
  deterministicState?: string | null;
  status?: string | null;
  metrics?: RollupAgentMetrics | null;
  lastUsage?: {
    contextWindowUsedTokens?: number;
    contextWindowMaxTokens?: number;
    cachedInputTokens?: number;
    inputTokens?: number;
    totalCostUsd?: number;
  } | null;
  activeTurn?: { startedAt?: string | null } | null;
}

export interface ModelRollup {
  provider: string;
  model: string;
  agentCount: number;
  turnsCompleted: number;
  medianContextUtilizationPct: number;
  cacheHitRatioPct: number;
  costUsd: number;
  errorCount: number;
  medianTurnDurationMs: number;
}

export interface AppendRollupResult {
  ok: boolean;
  skipped: boolean;
  receiptsWritten: number;
  receiptCount: number;
  filePath: string;
  error?: string;
}

/** Median of a numeric sample; 0 for an empty sample. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseSeconds(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function resolveMetrics(agent: RollupAgentInput): RollupAgentMetrics | null {
  if (agent.metrics && typeof agent.metrics === "object") return agent.metrics;
  const usage = agent.lastUsage;
  if (!usage || typeof usage !== "object") return null;
  const resolved: RollupAgentMetrics = {};
  const contextUsedTokens = finite(usage.contextWindowUsedTokens);
  const contextMaxTokens = finite(usage.contextWindowMaxTokens);
  const cachedTokens = finite(usage.cachedInputTokens);
  const inputTokens = finite(usage.inputTokens);
  const costUsd = finite(usage.totalCostUsd);
  const activeTurnStartedAt =
    typeof agent.activeTurn?.startedAt === "string" ? agent.activeTurn.startedAt : undefined;
  if (contextUsedTokens !== undefined) resolved.contextUsedTokens = contextUsedTokens;
  if (contextMaxTokens !== undefined) resolved.contextMaxTokens = contextMaxTokens;
  if (cachedTokens !== undefined) resolved.cachedTokens = cachedTokens;
  if (inputTokens !== undefined) resolved.inputTokens = inputTokens;
  if (costUsd !== undefined) resolved.costUsd = costUsd;
  if (activeTurnStartedAt !== undefined) resolved.activeTurnStartedAt = activeTurnStartedAt;
  return Object.keys(resolved).length > 0 ? resolved : null;
}

function resolveDeterministicState(agent: RollupAgentInput): string {
  const state = agent.deterministicState?.trim();
  if (state) return state;
  const status = String(agent.status ?? "").toLowerCase();
  if (status === "error") return "failed:error";
  if (status === "idle") return "idle:waiting";
  if (status === "running") return "running";
  return "unknown";
}

/** True when the agent carries any usable metric signal for a model rollup. */
export function isMetricsBearing(agent: RollupAgentInput): boolean {
  if (!agent.model || !String(agent.model).trim()) return false;
  const metrics = resolveMetrics(agent);
  if (!metrics) return false;
  return (
    metrics.contextUsedTokens !== undefined ||
    metrics.contextMaxTokens !== undefined ||
    metrics.cachedTokens !== undefined ||
    metrics.inputTokens !== undefined ||
    metrics.costUsd !== undefined ||
    metrics.activeTurnStartedAt !== undefined
  );
}

/**
 * Pure per-provider/model rollup over live agents (#560). Groups only
 * metrics-bearing agents; a settled agent (`idle:*`/`sleeping`) with no active
 * turn counts as a completed turn, `failed:*` states count as errors. Context
 * utilisation and cache ratio are per-agent percentages reduced by median.
 */
export function computeModelRollups(
  agents: Iterable<RollupAgentInput>,
  now: number,
): ModelRollup[] {
  const groups = new Map<string, { provider: string; model: string; agents: RollupAgentInput[] }>();

  for (const agent of agents) {
    if (!isMetricsBearing(agent)) continue;
    const model = String(agent.model).trim();
    const provider = agent.provider?.trim() || "unknown";
    const key = `${provider}::${model}`;
    const group = groups.get(key) ?? { provider, model, agents: [] };
    group.agents.push(agent);
    groups.set(key, group);
  }

  const rollups: ModelRollup[] = [];
  for (const { provider, model, agents: group } of groups.values()) {
    const contextUtilization: number[] = [];
    const cacheRatios: number[] = [];
    const turnDurations: number[] = [];
    let turnsCompleted = 0;
    let errorCount = 0;
    let costUsd = 0;

    for (const agent of group) {
      const metrics = resolveMetrics(agent)!;
      const state = resolveDeterministicState(agent);

      const used = finite(metrics.contextUsedTokens);
      const max = finite(metrics.contextMaxTokens);
      if (used !== undefined && max !== undefined && max > 0) {
        contextUtilization.push((used / max) * 100);
      }

      const cached = finite(metrics.cachedTokens);
      const input = finite(metrics.inputTokens);
      const cacheDenominator = (cached ?? 0) + (input ?? 0);
      if (cached !== undefined && cacheDenominator > 0) {
        cacheRatios.push((cached / cacheDenominator) * 100);
      }

      costUsd += finite(metrics.costUsd) ?? 0;

      const startedAtMs = parseSeconds(metrics.activeTurnStartedAt);
      if (startedAtMs !== null) {
        turnDurations.push(Math.max(0, now - startedAtMs));
      }

      const settled = state === "sleeping" || state.startsWith("idle:");
      if (settled && metrics.activeTurnStartedAt === undefined) turnsCompleted += 1;

      if (state.startsWith("failed:")) errorCount += 1;
    }

    rollups.push({
      provider,
      model,
      agentCount: group.length,
      turnsCompleted,
      medianContextUtilizationPct: round2(median(contextUtilization)),
      cacheHitRatioPct: round2(median(cacheRatios)),
      costUsd: round2(costUsd),
      errorCount,
      medianTurnDurationMs: Math.round(median(turnDurations)),
    });
  }

  return rollups.sort((a, b) =>
    a.provider === b.provider ? a.model.localeCompare(b.model) : a.provider.localeCompare(b.provider),
  );
}

/**
 * Derives `CandidateModelMetrics`-compatible rows from accumulated receipts
 * (#560/#373). Trials are completed turns; the pass rate is the completion rate
 * net of `failed:*` errors. Task-profile breakdowns are intentionally absent —
 * minimized receipts cannot attribute a turn to a task class without pulling in
 * transcript data (platform#18).
 */
export function deriveCandidatesFromReceipts(receipts: readonly RollupReceipt[]): CandidateModelMetrics[] {
  const groups = new Map<string, RollupReceipt[]>();
  for (const receipt of receipts) {
    const key = `${receipt.provider}::${receipt.model}`;
    const list = groups.get(key) ?? [];
    list.push(receipt);
    groups.set(key, list);
  }

  const candidates: CandidateModelMetrics[] = [];
  for (const group of groups.values()) {
    const latest = group[group.length - 1]!;
    const turnsCompleted = group.reduce((acc, r) => acc + r.turnsCompleted, 0);
    const errorCount = group.reduce((acc, r) => acc + r.errorCount, 0);
    const costUsd = group.reduce((acc, r) => acc + r.costUsd, 0);
    const overallPassRate =
      turnsCompleted > 0
        ? Math.max(0, Math.min(100, Math.round(((turnsCompleted - errorCount) / turnsCompleted) * 100)))
        : 0;

    candidates.push({
      model: latest.model,
      provider: latest.provider,
      configProfile: "default",
      overallPassRate,
      totalTrials: turnsCompleted,
      medianWallMs: Math.round(median(group.map((r) => r.medianTurnDurationMs))),
      recommendedRoles: [],
      profiles: [],
      medianContextUtilizationPct: round2(median(group.map((r) => r.medianContextUtilizationPct))),
      cacheHitRatioPct: round2(median(group.map((r) => r.cacheHitRatioPct))),
      costUsd: round2(costUsd),
      errorCount,
      turnsCompleted,
      agentCount: Math.max(...group.map((r) => r.agentCount)),
      receiptCount: group.length,
      lastReceiptAt: latest.ts,
    });
  }

  return candidates.sort((a, b) =>
    a.provider === b.provider ? a.model.localeCompare(b.model) : a.provider.localeCompare(b.provider),
  );
}

interface PersistedMetricsFile {
  version?: number;
  updatedAt?: string;
  taskProfiles?: string[];
  privacyNotice?: string;
  receipts?: RollupReceipt[];
  candidates?: CandidateModelMetrics[];
}

/**
 * Migrates legacy ~/.paseo/uppidi-fleet-metrics.json to the target metrics file
 * if the legacy file exists and the target file does not yet exist.
 * Returns true if migration was performed, false otherwise.
 */
export async function migrateLegacyMetrics(
  targetPath: string = getMetricsFilePath(),
  legacyPath: string = legacyMetricsFilePath(),
): Promise<boolean> {
  if (targetPath === legacyPath) return false;
  try {
    try {
      await fs.access(targetPath);
      return false;
    } catch {
      // Expected ENOENT: the target does not exist yet, so fall through and
      // migrate the legacy file below. Only a non-ENOENT failure is worth
      // surfacing, and fs.access cannot distinguish them — the migrate step
      // reports a real failure if the legacy read/write throws.
    }

    const legacyRaw = await fs.readFile(legacyPath, "utf-8");
    const parsed = JSON.parse(legacyRaw);
    if (!parsed || typeof parsed !== "object") return false;

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, legacyRaw, "utf8");
    await fs.rename(tmp, targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveOrMigrateMetrics(targetPath: string): Promise<PersistedMetricsFile | null> {
  try {
    const raw = await fs.readFile(targetPath, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as PersistedMetricsFile) : null;
  } catch (err: any) {
    if (err && err.code !== "ENOENT") {
      return null;
    }
  }

  const legacyPath = legacyMetricsFilePathOverride ?? (metricsFilePathOverride ? null : legacyMetricsFilePath());
  if (!legacyPath || targetPath === legacyPath) {
    return null;
  }

  try {
    const legacyRaw = await fs.readFile(legacyPath, "utf-8");
    const parsed = JSON.parse(legacyRaw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, legacyRaw, "utf8");
      await fs.rename(tmp, targetPath);
    } catch {
      // Fallback to parsed legacy data smoothly if writing to targetPath fails
    }

    return parsed as PersistedMetricsFile;
  } catch {
    return null;
  }
}

async function readMetricsFile(context?: any): Promise<PersistedMetricsFile | null> {
  const filePath = getMetricsFilePath(context);
  return resolveOrMigrateMetrics(filePath);
}

/**
 * Appends one minimized rollup receipt per provider/model and rewrites the
 * derived candidate matrix. Gated by `cooldownGate` (the watchdog cooldown) and
 * a no-op when no agent carries metrics. Receipts are capped at
 * {@link MAX_ROLLUP_RECEIPTS}, oldest first.
 */
export async function appendRollupReceipt(
  now: number,
  agents: Iterable<RollupAgentInput>,
  cooldownGate?: () => boolean,
  context?: any,
): Promise<AppendRollupResult> {
  const filePath = getMetricsFilePath(context);
  if (cooldownGate && !cooldownGate()) {
    return { ok: true, skipped: true, receiptsWritten: 0, receiptCount: 0, filePath };
  }

  const rollups = computeModelRollups(agents, now);
  if (rollups.length === 0) {
    return { ok: true, skipped: true, receiptsWritten: 0, receiptCount: 0, filePath };
  }

  const existing = await readMetricsFile(context);
  const priorReceipts = Array.isArray(existing?.receipts) ? existing!.receipts! : [];
  const ts = new Date(now).toISOString();
  const newReceipts: RollupReceipt[] = rollups.map((rollup) => ({ ts, ...rollup }));
  const receipts = [...priorReceipts, ...newReceipts].slice(-MAX_ROLLUP_RECEIPTS);
  const candidates = deriveCandidatesFromReceipts(receipts);

  const persisted: PersistedMetricsFile = {
    version: existing?.version ?? 1,
    updatedAt: ts,
    taskProfiles: existing?.taskProfiles ?? DEFAULT_TASK_PROFILES,
    privacyNotice: existing?.privacyNotice ?? METRICS_PRIVACY_NOTICE,
    receipts,
    candidates,
  };

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.${now}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");
    await fs.rename(tmp, filePath);
  } catch (err: any) {
    return {
      ok: false,
      skipped: false,
      receiptsWritten: 0,
      receiptCount: priorReceipts.length,
      filePath,
      error: err?.message || String(err),
    };
  }

  return {
    ok: true,
    skipped: false,
    receiptsWritten: newReceipts.length,
    receiptCount: receipts.length,
    filePath,
  };
}

export interface FleetMetrics {
  candidates: CandidateModelMetrics[];
  taskProfiles: string[];
  totalEvaluatedTrials: number;
  privacyNotice: string;
  dataSource: "empirical" | "empty";
  modelCount: number;
}

/**
 * Serves the empirical matrix from the receipt file. The checked-in baseline
 * matrix is retired as served data: a missing/empty/unparsable file yields an
 * explicit empty state rather than placeholder models (#560/#373, platform#18).
 */
export async function loadFleetMetrics(context?: any): Promise<FleetMetrics> {
  const parsed = await readMetricsFile(context);
  const receipts = Array.isArray(parsed?.receipts) ? parsed!.receipts! : [];
  const candidates =
    receipts.length > 0
      ? deriveCandidatesFromReceipts(receipts)
      : Array.isArray(parsed?.candidates) && parsed!.candidates!.length > 0
        ? parsed!.candidates!
        : [];

  const taskProfiles =
    Array.isArray(parsed?.taskProfiles) && parsed!.taskProfiles!.length > 0
      ? parsed!.taskProfiles!
      : DEFAULT_TASK_PROFILES;
  const privacyNotice = parsed?.privacyNotice || METRICS_PRIVACY_NOTICE;

  if (candidates.length === 0) {
    return {
      candidates: [],
      taskProfiles,
      totalEvaluatedTrials: 0,
      privacyNotice,
      dataSource: "empty",
      modelCount: 0,
    };
  }

  const totalEvaluatedTrials = candidates.reduce((acc, c) => acc + (c.totalTrials ?? 0), 0);
  return {
    candidates,
    taskProfiles,
    totalEvaluatedTrials,
    privacyNotice,
    dataSource: "empirical",
    modelCount: candidates.length,
  };
}

export async function handleUppidiFleetMetrics(
  input: UppidiFleetMetricsInput,
  context?: PluginHandlerContext
): Promise<UppidiFleetMetricsOutput> {
  const { candidates, taskProfiles, totalEvaluatedTrials, privacyNotice, dataSource, modelCount } =
    await loadFleetMetrics(context);

  let filtered = candidates;
  if (input.model) {
    filtered = filtered.filter(
      (c) => c.model.toLowerCase() === input.model?.toLowerCase()
    );
  }

  if (input.taskProfile) {
    filtered = filtered.map((c) => ({
      ...c,
      profiles: c.profiles.filter(
        (p) => p.taskProfile.toLowerCase() === input.taskProfile?.toLowerCase()
      ),
    }));
  }

  return {
    ok: true,
    candidates: filtered,
    taskProfiles,
    totalEvaluatedTrials,
    privacyNotice,
    dataSource,
    modelCount,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Computes 7-day, 30-day, or all-time sliding window aggregations from in-process telemetry records (#1173).
 */
export async function computeSlidingAggregations(
  window: "7d" | "30d" | "all" = "7d",
  context?: any,
): Promise<import("../shared/contracts.js").ModelTelemetrySummary[]> {
  const { readTelemetryRecords, aggregateModelTelemetry } = await import("./telemetry.js");
  const windowMs =
    window === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : window === "30d"
        ? 30 * 24 * 60 * 60 * 1000
        : undefined;

  const records = await readTelemetryRecords({ windowMs }, context);
  return aggregateModelTelemetry(records, window);
}
