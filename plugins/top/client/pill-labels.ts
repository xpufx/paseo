import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import { formatBytes, formatUptime } from "paseo-plugin-helper/shared";
import {
  isPillEnabled,
  legacyFlagView,
  METRIC_DEFINITIONS,
  type LiveUsage,
  type SystemResources,
  type TopSettings,
} from "../shared/resources";

/**
 * Agent usage record. The daemon populates `lastUsage` on agent snapshots but
 * `@getpaseo/plugin`'s PluginAgentSnapshot omits it; raw provider usage may
 * surface either the canonical AgentUsage names or their legacy aliases.
 */
export type AgentUsageSnapshot = LiveUsage & {
  cachedTokens?: number;
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  costUsd?: number;
};

export type TopAgentSnapshot = PluginAgentSnapshot & {
  lastUsage?: AgentUsageSnapshot | null;
};

export type PillItemType =
  | "cpu_ram"
  | "branch"
  | "worktree"
  | "agent_title"
  | "agent"
  | "agent_provider"
  | "agent_activity"
  | "agent_id"
  | "load"
  | "uptime"
  | "mcp"
  | "changes"
  | "tokens"
  | "tools"
  | "turns";

export interface SegmentSnapshot {
  data?: SystemResources;
  agent?: {
    title?: string | null;
    model?: string | null;
    provider?: string;
    status?: string;
    lastActivityAt?: string;
    lastUsage?: AgentUsageSnapshot | null;
  } | null;
  agentId?: string;
  worktreeLocationText?: string;
}

export interface TokenMetrics {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  totalTokens?: number;
  contextUsedTokens?: number;
  contextMaxTokens?: number;
  costUsd?: number;
}

export function formatCompactTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return val >= 10 ? `${Math.round(val)}M` : `${parseFloat(val.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return val >= 10 ? `${Math.round(val)}k` : `${parseFloat(val.toFixed(1))}k`;
  }
  return `${Math.round(n)}`;
}

export function extractTokenMetrics(snap: SegmentSnapshot): TokenMetrics | null {
  const live = snap.data?.liveUsage;
  const last = snap.data?.lastTurn;
  const agentUsage = snap.agent?.lastUsage;

  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  const inputTokens =
    num(live?.inputTokens) ??
    num(last?.inputTokens) ??
    num(agentUsage?.inputTokens);

  const outputTokens =
    num(live?.outputTokens) ??
    num(last?.outputTokens) ??
    num(agentUsage?.outputTokens);

  const cachedTokens =
    num(live?.cachedInputTokens) ??
    num(last?.cachedTokens) ??
    num(last?.cachedInputTokens) ??
    num(agentUsage?.cachedInputTokens) ??
    num(agentUsage?.cachedTokens);

  const contextUsedTokens =
    num(live?.contextWindowUsedTokens) ??
    num(last?.contextUsedTokens) ??
    num(agentUsage?.contextWindowUsedTokens) ??
    num(agentUsage?.contextUsedTokens);

  const contextMaxTokens =
    num(live?.contextWindowMaxTokens) ??
    num(last?.contextMaxTokens) ??
    num(agentUsage?.contextWindowMaxTokens) ??
    num(agentUsage?.contextMaxTokens);

  const costUsd =
    num(live?.totalCostUsd) ??
    num(last?.costUsd) ??
    num(agentUsage?.totalCostUsd) ??
    num(agentUsage?.costUsd);

  const totalTokens =
    inputTokens != null || outputTokens != null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    cachedTokens === undefined &&
    contextUsedTokens === undefined &&
    contextMaxTokens === undefined &&
    costUsd === undefined
  ) {
    return null;
  }

  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    totalTokens,
    contextUsedTokens,
    contextMaxTokens,
    costUsd,
  };
}

export function formatTokensLabel(
  metrics: TokenMetrics | null,
  prefix: string | undefined = "tok",
): string {
  if (!metrics) {
    return prefix ? `${prefix} --` : "--";
  }

  // 1. Both context used and max: "58k/1M"
  if (
    metrics.contextUsedTokens != null &&
    metrics.contextMaxTokens != null &&
    metrics.contextMaxTokens > 0
  ) {
    return `${formatCompactTokens(metrics.contextUsedTokens)}/${formatCompactTokens(metrics.contextMaxTokens)}`;
  }

  // 2. Context used without max (when no total tokens or total is 0): "58k ctx"
  if (
    metrics.contextUsedTokens != null &&
    metrics.contextUsedTokens > 0 &&
    (metrics.totalTokens == null || metrics.totalTokens === 0)
  ) {
    return `${formatCompactTokens(metrics.contextUsedTokens)} ctx`;
  }

  // 3. Total tokens (input + output): "888 tok", "58k tok"
  if (metrics.totalTokens != null && metrics.totalTokens > 0) {
    return `${formatCompactTokens(metrics.totalTokens)} tok`;
  }

  // 4. Context used fallback: "58k ctx"
  if (metrics.contextUsedTokens != null && metrics.contextUsedTokens > 0) {
    return `${formatCompactTokens(metrics.contextUsedTokens)} ctx`;
  }

  return prefix ? `${prefix} --` : "--";
}

export function formatIdlePillLabel(
  status: string | undefined,
  isoString: string | null | undefined,
): string {
  if (status === "running") return "active";
  if (!isoString) return status || "--";
  const time = new Date(isoString).getTime();
  if (isNaN(time)) return "--";
  const diffMs = Math.max(0, Date.now() - time);
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `idle ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `idle ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `idle ${hours}h`;
  const days = Math.floor(hours / 24);
  return `idle ${days}d`;
}

export function formatSegmentIcon(item: PillItemType, snap?: SegmentSnapshot): string {
  if (item === "agent_activity") {
    return snap?.agent?.status === "running" ? "Activity" : "Clock";
  }
  const def = METRIC_DEFINITIONS.find((d) => d.id === item);
  return def?.icon ?? "Activity";
}

/**
 * Theme-independent color slot for one piece of a pill segment. The renderer
 * maps these to concrete theme colors so the composer pill (host-rendered) and
 * the in-product pill fallback share one description of the same metric.
 */
export type SegmentTone =
  | "foreground"
  | "muted"
  | "accent"
  | "success"
  | "danger"
  | "warning"
  | "cpu"
  | "mem"
  | "none";

/**
 * One pill metric split into its visual pieces. `describeSegment` is the single
 * source of truth: `formatSegmentLabel` flattens it to the host label string and
 * the pill renderer lays it out, so label text and inline rendering cannot drift.
 */
export interface SegmentDescriptor {
  icon: string;
  /** "none" keeps the inline icon hidden (the metric is text-only in-pill). */
  iconTone: SegmentTone;
  /** Leading glyph, e.g. the MCP health dot. Excluded from the flat label. */
  leading?: string;
  leadingTone?: SegmentTone;
  prefix?: string;
  prefixTone?: SegmentTone;
  text: string;
  tone: SegmentTone;
  separator?: string;
  trailing?: string;
  trailingTone?: SegmentTone;
}

export function describeSegment(
  item: PillItemType,
  snap: SegmentSnapshot = {},
): SegmentDescriptor {
  const { data, agent, agentId, worktreeLocationText } = snap;
  const def = METRIC_DEFINITIONS.find((d) => d.id === item);
  const icon = formatSegmentIcon(item, snap);
  const prefix = def?.shortLabel ? `${def.shortLabel} ` : "";
  switch (item) {
    case "branch":
      return { icon, iconTone: "accent", text: data?.branch ?? "--", tone: "foreground" };
    case "worktree":
      return {
        icon,
        iconTone: "accent",
        text: worktreeLocationText || "--",
        tone: "foreground",
      };
    case "agent_title":
      return { icon, iconTone: "accent", text: agent?.title ?? "Agent", tone: "foreground" };
    case "agent":
      return {
        icon,
        iconTone: "accent",
        text: agent?.model || agent?.provider || "Agent",
        tone: "foreground",
      };
    case "agent_provider":
      return {
        icon,
        iconTone: "accent",
        text: agent?.provider ?? "Provider",
        tone: "foreground",
      };
    case "agent_activity": {
      const running = agent?.status === "running";
      return {
        icon,
        iconTone: running ? "success" : "muted",
        text: formatIdlePillLabel(agent?.status, agent?.lastActivityAt),
        tone: running ? "success" : "foreground",
      };
    }
    case "agent_id":
      return {
        icon,
        iconTone: "accent",
        text: agentId && agentId.length > 7 ? agentId.slice(0, 7) : agentId ?? "--",
        tone: "foreground",
      };
    case "load":
      return {
        icon,
        iconTone: "none",
        prefix,
        prefixTone: "muted",
        text: data?.loadAvg?.[0] !== undefined ? data.loadAvg[0].toFixed(2) : "--",
        tone: "cpu",
      };
    case "uptime":
      return {
        icon,
        iconTone: "none",
        prefix,
        prefixTone: "muted",
        text: data?.uptimeSeconds ? formatUptime(data.uptimeSeconds) : "--",
        tone: "foreground",
      };
    case "mcp": {
      const mcp = data?.mcp;
      const live = mcp && !mcp.isStale;
      const leadingTone: SegmentTone = live
        ? mcp.down > 0
          ? "danger"
          : mcp.degraded > 0 || mcp.healthy !== mcp.total
            ? "warning"
            : "success"
        : "muted";
      return {
        icon,
        iconTone: "none",
        leading: live ? "●" : "○",
        leadingTone,
        text: mcp ? `${mcp.healthy}/${mcp.total} MCP` : "MCP -",
        tone: "foreground",
      };
    }
    case "changes": {
      const last = data?.lastTurn;
      const hasData = last && (last.gitInsertions != null || last.gitDeletions != null);
      return {
        icon,
        iconTone: "none",
        prefix,
        prefixTone: "muted",
        text: hasData ? `+${last.gitInsertions ?? 0}/-${last.gitDeletions ?? 0}` : "--",
        tone: "foreground",
      };
    }
    case "tokens": {
      const metrics = extractTokenMetrics(snap);
      if (!metrics) {
        return {
          icon,
          iconTone: "none",
          prefix,
          prefixTone: "muted",
          text: formatTokensLabel(metrics, ""),
          tone: "muted",
        };
      }
      return {
        icon,
        iconTone: "none",
        text: formatTokensLabel(metrics, ""),
        tone: "foreground",
      };
    }
    case "tools": {
      const last = data?.lastTurn;
      const hasData = last && last.toolCalls != null;
      return {
        icon,
        iconTone: "none",
        prefix,
        prefixTone: "muted",
        text: hasData
          ? `${last.toolCalls}${last.toolErrors ? ` (${last.toolErrors} err)` : ""}`
          : "--",
        tone: "foreground",
      };
    }
    case "turns": {
      const last = data?.lastTurn;
      return {
        icon,
        iconTone: "none",
        prefix,
        prefixTone: "muted",
        text: last?.turnCount != null ? `${last.turnCount}` : "--",
        tone: "foreground",
      };
    }
    case "cpu_ram":
    default: {
      const ram =
        data?.memoryUsedBytes !== undefined
          ? formatBytes(data.memoryUsedBytes, { compact: true, decimals: 1 })
          : "--";
      const cpu = data?.cpuUsagePercent !== undefined ? `${data.cpuUsagePercent}%` : "--";
      return {
        icon,
        iconTone: "none",
        text: cpu,
        tone: "cpu",
        separator: " · ",
        trailing: ram,
        trailingTone: "mem",
      };
    }
  }
}

export function formatSegmentLabel(item: PillItemType, snap: SegmentSnapshot): string {
  const d = describeSegment(item, snap);
  return `${d.prefix ?? ""}${d.text}${d.separator ?? ""}${d.trailing ?? ""}`;
}

export function enabledItemsForSettings(settings: TopSettings): PillItemType[] {
  const flags = legacyFlagView(settings);
  const items: PillItemType[] = [];
  const hasAnyEnabled =
    flags.showCpuRam ||
    flags.showBranch ||
    flags.showWorktree ||
    flags.showAgentTitle ||
    flags.showAgent ||
    flags.showAgentProvider ||
    flags.showAgentActivity ||
    flags.showAgentId ||
    flags.showLoad ||
    flags.showUptime ||
    flags.showMcp;
  if (flags.showCpuRam || !hasAnyEnabled) items.push("cpu_ram");
  if (flags.showBranch) items.push("branch");
  if (flags.showWorktree) items.push("worktree");
  if (flags.showAgentTitle) items.push("agent_title");
  if (flags.showAgent) items.push("agent");
  if (flags.showAgentProvider) items.push("agent_provider");
  if (flags.showAgentActivity) items.push("agent_activity");
  if (flags.showAgentId) items.push("agent_id");
  if (flags.showLoad) items.push("load");
  if (flags.showUptime) items.push("uptime");
  if (flags.showMcp) items.push("mcp");
  if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.changes)) {
    items.push("changes");
  }
  if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.tokens)) {
    items.push("tokens");
  }
  if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.tools)) {
    items.push("tools");
  }
  if (settings.metricSurfaces && isPillEnabled(settings.metricSurfaces.turns)) {
    items.push("turns");
  }
  return items;
}

const cycleIndexByAgent = new Map<string, number>();

export function nextCycleItem(agentId: string, items: PillItemType[]): PillItemType | undefined {
  if (items.length === 0) return undefined;
  const current = cycleIndexByAgent.get(agentId) ?? 0;
  const item = items[current % items.length];
  cycleIndexByAgent.set(agentId, (current + 1) % items.length);
  return item;
}

export function resetCycleState(): void {
  cycleIndexByAgent.clear();
}

export function buildAllLabel(items: PillItemType[], snap: SegmentSnapshot): string {
  return items.map((item) => formatSegmentLabel(item, snap)).join(" | ");
}
