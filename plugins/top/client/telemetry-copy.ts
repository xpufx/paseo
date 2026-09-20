import { formatBytes, formatUptime } from "paseo-plugin-helper/shared";
import { formatCompactTokens, type TopAgentSnapshot } from "./pill-labels";
import type { TopTimelineTelemetryData } from "../shared/resources";

export interface TelemetryCopyInput {
  data: TopTimelineTelemetryData;
  liveUsage?: TopAgentSnapshot["lastUsage"] | null;
  timeLabel?: string;
}

function outcomeLabel(kind: TopTimelineTelemetryData["outcomeKind"]): string {
  switch (kind) {
    case "completed":
      return "Turn Completed";
    case "failed":
      return "Turn Failed";
    case "canceled":
      return "Turn Canceled";
    default:
      return "Turn Ended";
  }
}

function shortAgentId(agentId: string | undefined): string | undefined {
  if (!agentId) return undefined;
  return agentId.length > 7 ? agentId.slice(0, 7) : agentId;
}

/**
 * Plain-text digest of a styled timeline card. Web's copy handler only rebuilds
 * selections inside `[data-testid="assistant-message"]`, so a plugin/timeline
 * item's selection copies nothing (xpufx-org/paseo#278). This produces the
 * clipboard payload for the card's explicit Copy control instead.
 */
export function buildTelemetryCopyText({ data, liveUsage, timeLabel }: TelemetryCopyInput): string {
  const inputTokens = data.inputTokens ?? liveUsage?.inputTokens;
  const outputTokens = data.outputTokens ?? liveUsage?.outputTokens;
  const cachedTokens =
    data.cachedTokens ??
    data.cachedInputTokens ??
    liveUsage?.cachedInputTokens ??
    liveUsage?.cachedTokens;
  const contextUsedTokens =
    data.contextUsedTokens ??
    liveUsage?.contextWindowUsedTokens ??
    liveUsage?.contextUsedTokens;
  const contextMaxTokens =
    data.contextMaxTokens ??
    liveUsage?.contextWindowMaxTokens ??
    liveUsage?.contextMaxTokens;
  const costUsd = data.costUsd ?? liveUsage?.totalCostUsd ?? liveUsage?.costUsd;

  const lines: string[] = [outcomeLabel(data.outcomeKind)];

  const time = timeLabel ?? data.timestamp;
  if (time) lines.push(time);

  // `turnId` is normally an opaque id, but some providers use the source
  // issue URL. Keep it as a labeled reference: it is useful context, but it
  // must never become the whole clipboard payload.
  if (data.turnId) lines.push(`Reference ${data.turnId}`);

  const id = shortAgentId(data.agentId);
  if (id) lines.push(`Agent ${id}`);

  if (data.agentTitle) lines.push(`Title ${data.agentTitle}`);

  const model = data.agentModel ?? undefined;
  const provider = data.agentProvider ?? undefined;
  if (model || provider) {
    lines.push(`${model ?? "model --"} (${provider ?? "default"})`);
  }

  if (data.branch) lines.push(`Branch ${data.branch}`);
  if (data.worktree) lines.push(`Worktree ${data.worktree}`);

  // These are the first row of the rendered card body. Keep their labels and
  // formatting aligned with the card so Copy is a human-readable export of
  // what the operator sees, rather than just an identifier or URL.
  lines.push(`CPU ${data.cpuPercent}%`);
  lines.push(`RAM ${formatBytes(data.memUsedBytes)} (${data.memPercent}%)`);
  lines.push(`Load ${data.loadAvg1m.toFixed(2)}`);

  const totalTokens =
    inputTokens != null || outputTokens != null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined;

  if (contextUsedTokens != null && contextMaxTokens != null && contextMaxTokens > 0) {
    const percent = Math.round((contextUsedTokens / contextMaxTokens) * 100);
    lines.push(`Tokens ${formatCompactTokens(contextUsedTokens)}/${formatCompactTokens(contextMaxTokens)} (${percent}% ctx)`);
  } else if (totalTokens != null) {
    lines.push(`Tokens ${inputTokens ?? 0} in / ${outputTokens ?? 0} out (${totalTokens} total)`);
  } else if (contextUsedTokens != null) {
    lines.push(`Tokens ${formatCompactTokens(contextUsedTokens)} ctx`);
  }

  if (cachedTokens != null) lines.push(`Cache ${cachedTokens.toLocaleString()}`);
  if (costUsd != null) {
    lines.push(`Cost $${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`);
  }

  if (data.durationMs != null) lines.push(`Duration ${(data.durationMs / 1000).toFixed(1)}s`);
  if (data.toolCalls != null) {
    lines.push(`Tools ${data.toolCalls}${data.toolErrors ? ` (${data.toolErrors} err)` : ""}`);
  }
  if (data.turnCount != null) lines.push(`Turns ${data.turnCount}`);
  if (data.uptimeSeconds) lines.push(`Uptime ${formatUptime(data.uptimeSeconds)}`);
  if (data.mcpTotal != null) lines.push(`MCP ${data.mcpHealthy ?? 0}/${data.mcpTotal}`);

  if (data.gitFilesChanged != null || data.gitInsertions != null || data.gitDeletions != null) {
    const files = data.gitFilesChanged ?? 0;
    lines.push(files > 0 ? `Changes ±${files} files +${data.gitInsertions ?? 0}/-${data.gitDeletions ?? 0}` : "Changes none");
  }

  if (data.outcomeError) lines.push(`Error ${data.outcomeError}`);

  return lines.join("\n");
}
