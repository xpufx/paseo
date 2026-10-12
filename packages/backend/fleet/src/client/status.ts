import type {
  DeterministicAgentState,
  AgentCategory,
  FleetAgentMetrics,
} from "./types.js";

export type StatusLightTone = "success" | "warning" | "danger";

export function getStatusLightTone(agent?: {
  status?: string | null;
  deterministicState?: DeterministicAgentState | string | null;
} | null): StatusLightTone {
  if (!agent) return "warning";

  const detState = String(agent.deterministicState ?? "").toLowerCase().trim();
  const status = String(agent.status ?? "").toLowerCase().trim();

  // 1. Red: error / failed / timeout / failure mode
  if (
    detState.startsWith("failed") ||
    status === "error" ||
    status === "failed" ||
    status === "failure" ||
    status === "timeout" ||
    status.includes("error") ||
    status.includes("fail")
  ) {
    return "danger";
  }

  // 2. Orange / Amber: idle / waiting / paused / ready / sleeping / blocked
  if (
    detState.startsWith("idle") ||
    detState === "sleeping" ||
    detState === "permission-prompt" ||
    detState === "attention-required" ||
    status === "idle" ||
    status === "waiting" ||
    status === "paused" ||
    status === "ready" ||
    status === "standby"
  ) {
    return "warning";
  }

  // 3. Green: working / running / executing
  if (
    detState === "working" ||
    detState === "running" ||
    status === "running" ||
    status === "busy" ||
    status === "working" ||
    status === "executing"
  ) {
    return "success";
  }

  return "warning";
}

export function getAgentCategoryIcon(category?: AgentCategory | string): string {
  switch (category) {
    case "front-desk":
      return "Inbox";
    case "orchestrator":
      return "Network";
    case "coding-agent":
    case "worker":
      return "Terminal";
    default:
      return "Bot";
  }
}

export interface DeterministicStateConfig {
  state: DeterministicAgentState;
  color: string;
  badgeVariant: "success" | "info" | "warning" | "danger" | "neutral";
  dotVariant: "success" | "info" | "warning" | "danger" | "neutral";
  stateIcon: string;
  categoryIcon: string;
  pulse: boolean;
  label: string;
}

export function getDeterministicStateConfig(
  state: DeterministicAgentState,
  category?: AgentCategory | string,
): DeterministicStateConfig {
  let color = "#6b7280";
  let badgeVariant: "success" | "info" | "warning" | "danger" | "neutral" = "neutral";
  let dotVariant: "success" | "info" | "warning" | "danger" | "neutral" = "neutral";
  let stateIcon = "HelpCircle";
  let pulse = false;
  let label = "Unknown";

  switch (state) {
    case "working":
      color = "#10b981";
      badgeVariant = "success";
      dotVariant = "success";
      stateIcon = "Bot";
      pulse = true;
      label = "Working";
      break;
    case "running":
      color = "#3b82f6";
      badgeVariant = "info";
      dotVariant = "info";
      stateIcon = "Play";
      pulse = false;
      label = "Running";
      break;
    case "sleeping":
      color = "#a855f7";
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "Moon";
      pulse = false;
      label = "Sleeping";
      break;
    case "idle:waiting":
      color = "#9ca3af";
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "Clock";
      pulse = false;
      label = "Waiting";
      break;
    case "idle:quota-exhausted":
      color = "#f59e0b";
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "Hourglass";
      pulse = false;
      label = "Quota Cooldown";
      break;
    case "permission-prompt":
      color = "#f59e0b";
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "ShieldAlert";
      pulse = true;
      label = "Permission Needed";
      break;
    case "attention-required":
      color = "#f59e0b";
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "BellRing";
      pulse = true;
      label = "Awaiting Input";
      break;
    case "failed:quota-exhausted":
      color = "#f97316";
      badgeVariant = "warning";
      dotVariant = "warning";
      stateIcon = "AlertTriangle";
      pulse = false;
      label = "Quota Exhausted";
      break;
    case "failed:spawn":
    case "failed:timeout":
    case "failed:error":
      color = "#ef4444";
      badgeVariant = "danger";
      dotVariant = "danger";
      stateIcon = "AlertOctagon";
      pulse = false;
      label = "Failed";
      break;
    case "unknown":
    default:
      color = "#6b7280";
      badgeVariant = "neutral";
      dotVariant = "neutral";
      stateIcon = "HelpCircle";
      pulse = false;
      label = "Unknown";
      break;
  }

  return {
    state,
    color,
    badgeVariant,
    dotVariant,
    stateIcon,
    categoryIcon: getAgentCategoryIcon(category),
    pulse,
    label,
  };
}

export type HealthGaugeKind = "context" | "turn" | "error";
export type HealthGaugeTone = "ok" | "warn" | "critical";

export interface HealthGaugeSegment {
  kind: HealthGaugeKind;
  ratio: number;
  tone: HealthGaugeTone;
}

export interface HealthGauge {
  segments: HealthGaugeSegment[];
  overall: HealthGaugeTone;
}

export function computeHealthGauge(
  metrics?: FleetAgentMetrics | null,
  lastError?: string | null,
  nowEpochMs: number = Date.now(),
): HealthGauge | null {
  const segments: HealthGaugeSegment[] = [];

  // 1. Context ratio
  if (metrics?.contextUsedTokens !== undefined && metrics?.contextMaxTokens !== undefined && metrics.contextMaxTokens > 0) {
    const ratio = Math.min(1, Math.max(0, metrics.contextUsedTokens / metrics.contextMaxTokens));
    let tone: HealthGaugeTone = "ok";
    if (ratio >= 0.9) tone = "critical";
    else if (ratio >= 0.75) tone = "warn";
    segments.push({ kind: "context", ratio, tone });
  }

  // 2. Active turn duration
  if (metrics?.activeTurnStartedAt) {
    const startMs = Date.parse(metrics.activeTurnStartedAt);
    if (!Number.isNaN(startMs)) {
      const elapsedSeconds = Math.max(0, (nowEpochMs - startMs) / 1000);
      // Normalized against a 10-minute turn threshold
      const ratio = Math.min(1, elapsedSeconds / 600);
      let tone: HealthGaugeTone = "ok";
      if (elapsedSeconds > 900) tone = "critical"; // > 15 mins
      else if (elapsedSeconds > 300) tone = "warn"; // > 5 mins
      segments.push({ kind: "turn", ratio, tone });
    }
  }

  // 3. Error state
  if (lastError && lastError.trim()) {
    segments.push({ kind: "error", ratio: 1.0, tone: "critical" });
  }

  if (segments.length === 0) return null;

  let overall: HealthGaugeTone = "ok";
  if (segments.some((s) => s.tone === "critical")) overall = "critical";
  else if (segments.some((s) => s.tone === "warn")) overall = "warn";

  return { segments, overall };
}
