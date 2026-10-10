import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useAgent, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  HostBadge,
  HostCollapsible,
  HostCopyButton,
  HostLayoutProvider,
  HostProgressBar,
  HostRow,
  HostStack,
  HostThemeProvider,
  HostVital,
  getStatusColor,
} from "./host-ui";
import { usePluginSettings } from "paseo-plugin-helper/core";
import {
  formatBytes,
  formatUptime,
  resolveMetricStatus,
  truncatePath,
} from "paseo-plugin-helper/shared";
import { buildTelemetryCopyText } from "./telemetry-copy";
import {
  isTimelineEnabled,
  isMcpSurfaceEnabled,
  topSettingsContract,
  TIMELINE_RENDERED_METRICS,
  CPU_THRESHOLDS,
  MEM_THRESHOLDS,
  type MetricId,
  type TopTimelineTelemetryData,
} from "../shared/resources";
import {
  formatCompactTokens,
  formatTurnTokensPerSecond,
  type TopAgentSnapshot,
} from "./pill-labels";

export { TIMELINE_RENDERED_METRICS };

export function TopTimelineTelemetryCard({
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<TopTimelineTelemetryData>) {
  const data = item.data;
  const compact = layout?.compact ?? false;
  const [isExpanded, setIsExpanded] = useState(false);
  const liveUsage = useAgent(data.agentId, (a: TopAgentSnapshot) => a.lastUsage);
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
  const costUsd =
    data.costUsd ?? liveUsage?.totalCostUsd ?? liveUsage?.costUsd;
  const { settings } = usePluginSettings(topSettingsContract);
  const surfaces = settings.metricSurfaces;
  const show = (id: MetricId) => !surfaces || isTimelineEnabled(surfaces[id]);
  const showMcp = isMcpSurfaceEnabled(settings, "timeline", data.mcpInstalled, data.mcpRunning);

  const outcomeConfig = useMemo(() => {
    switch (data.outcomeKind) {
      case "completed":
        return {
          icon: "CheckCircle2",
          color: theme.colors.statusSuccess,
          label: "Turn Completed",
        };
      case "failed":
        return {
          icon: "AlertCircle",
          color: theme.colors.statusDanger,
          label: "Turn Failed",
        };
      case "canceled":
        return {
          icon: "MinusCircle",
          color: theme.colors.statusWarning,
          label: "Turn Canceled",
        };
      default:
        return {
          icon: "Activity",
          color: theme.colors.foregroundMuted,
          label: "Turn Ended",
        };
    }
  }, [data.outcomeKind, theme.colors]);

  // CPU/RAM colors resolve through the shared canonical thresholds
  // (shared/resources.ts) so the timeline card can never diverge from the
  // pill and dashboard surfaces.
  const cpuColor = useMemo(
    () => getStatusColor(resolveMetricStatus(data.cpuPercent, CPU_THRESHOLDS), theme.colors),
    [data.cpuPercent, theme.colors],
  );

  const memColor = useMemo(
    () =>
      getStatusColor(resolveMetricStatus(data.memPercent, MEM_THRESHOLDS), theme.colors),
    [data.memPercent, theme.colors],
  );

  const timeLabel = useMemo(() => {
    try {
      const d = data.timestamp ? new Date(data.timestamp) : timestamp;
      return d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return "";
    }
  }, [data.timestamp, timestamp]);

  const totalTokens =
    inputTokens != null || outputTokens != null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined;

  const contextPercent = useMemo(() => {
    if (!contextMaxTokens || contextMaxTokens <= 0) return null;
    return Math.round(((contextUsedTokens ?? 0) / contextMaxTokens) * 100);
  }, [contextUsedTokens, contextMaxTokens]);

  const getCopyText = useCallback(
    () => buildTelemetryCopyText({ data, liveUsage, timeLabel }),
    [data, liveUsage, timeLabel],
  );

  const hasTokenDetails =
    inputTokens != null ||
    outputTokens != null ||
    cachedTokens != null ||
    contextUsedTokens != null ||
    contextMaxTokens != null ||
    costUsd != null;

  const canceledText =
    data.outcomeKind === "canceled"
      ? !/^cancel/i.test(data.outcomeError ?? "")
        ? `Canceled${data.outcomeError ? `: ${data.outcomeError}` : ""}`
        : (data.outcomeError ?? "Canceled")
      : "";

  const turnThroughput = useMemo(
    () => formatTurnTokensPerSecond(data.outputTokens, data.durationMs),
    [data.outputTokens, data.durationMs],
  );

  return (
    <HostThemeProvider theme={theme}>
      <HostLayoutProvider layout={layout}>
        <HostCollapsible
          variant="elevated"
          isExpanded={isExpanded}
          onToggle={setIsExpanded}
          style={data.outcomeKind === "failed" ? { borderColor: theme.colors.statusDanger } : undefined}
          title={
            <HostRow gap={6} align="center" style={styles.headerInlineRow}>
              <Icon name={outcomeConfig.icon} size={14} color={outcomeConfig.color} />
              <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground, flexShrink: 0 }}>
                {outcomeConfig.label}
              </Text>
              {data.durationMs != null ? (
                <HostBadge
                  label={`${(data.durationMs / 1000).toFixed(1)}s`}
                  variant="neutral"
                  style={{ flexShrink: 0 }}
                />
              ) : null}
              {show("tokens") && turnThroughput ? (
                <HostBadge
                  label={turnThroughput}
                  variant="neutral"
                  style={{ flexShrink: 0 }}
                />
              ) : null}
            </HostRow>
          }
          subtitle={
            !isExpanded && data.outcomeKind === "canceled" ? (
              <Text numberOfLines={2} style={{ fontSize: 11, color: theme.colors.statusDanger }}>
                {canceledText}
              </Text>
            ) : undefined
          }
          headerRight={
            <HostRow gap={6} align="center" style={styles.headerInlineRow}>
              {timeLabel !== "" ? (
                <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>{timeLabel}</Text>
              ) : null}
              <Text
                style={{
                  fontSize: 10,
                  color: theme.colors.foregroundMuted,
                  fontStyle: "italic",
                }}
              >
                via top
              </Text>
              {/*
               * Explicit copy affordance. Web's selection-copy handler only
               * rebuilds clipboard content for `[data-testid="assistant-message"]`
               * selections, so styled timeline items copy nothing
               * (xpufx-org/paseo#278). The helper CopyButton bypasses that gate
               * with the helper's own clipboard path. Empty labels keep the
               * header compact: the icon flips Copy -> Check on success.
               */}
              <HostCopyButton
                getText={getCopyText}
                label=""
                copiedLabel=""
                accessibilityLabel="Copy timeline card"
                toastMessage="timeline card"
              />
            </HostRow>
          }
          summary={
            <HostRow wrap gap={compact ? 6 : 8} align="center">
              {show("cpu_ram") && (
                <HostVital icon="Cpu" color={cpuColor}>
                  CPU {data.cpuPercent}%
                </HostVital>
              )}

              {show("cpu_ram") && (
                <HostVital icon="Database" color={memColor}>
                  RAM {formatBytes(data.memUsedBytes)} ({data.memPercent}%)
                </HostVital>
              )}

              {show("load") && (
                <HostVital icon="Activity" color={theme.colors.foreground}>
                  Load {data.loadAvg1m.toFixed(2)}
                </HostVital>
              )}

              {showMcp && (
                <HostVital
                  icon="Server"
                  color={
                    data.mcpTotal == null
                      ? theme.colors.foregroundMuted
                      : (data.mcpHealthy ?? 0) === data.mcpTotal
                        ? theme.colors.statusSuccess
                        : theme.colors.statusWarning
                  }
                >
                  {data.mcpTotal != null ? `MCP ${data.mcpHealthy ?? 0}/${data.mcpTotal}` : "MCP --"}
                </HostVital>
              )}

              {show("agent_id") && (
                <HostVital icon="Fingerprint" color={theme.colors.foreground}>
                  {data.agentId && data.agentId.length > 7
                    ? data.agentId.slice(0, 7)
                    : (data.agentId ?? "--")}
                </HostVital>
              )}

              {show("agent") && (
                <HostVital
                  icon="Bot"
                  color={data.agentModel ? theme.colors.foreground : theme.colors.foregroundMuted}
                >
                  {data.agentModel ?? "model --"}
                </HostVital>
              )}

              {show("agent_provider") && (
                <HostVital
                  icon="Globe"
                  color={
                    data.agentProvider ? theme.colors.foreground : theme.colors.foregroundMuted
                  }
                >
                  {data.agentProvider ?? "provider --"}
                </HostVital>
              )}

              {show("agent_title") && (
                <HostVital
                  icon="Tag"
                  color={data.agentTitle ? theme.colors.foreground : theme.colors.foregroundMuted}
                >
                  {data.agentTitle ?? "title --"}
                </HostVital>
              )}

              {show("branch") && (
                <HostVital
                  icon="GitBranch"
                  color={data.branch ? theme.colors.foreground : theme.colors.foregroundMuted}
                >
                  {data.branch ?? "branch --"}
                </HostVital>
              )}

              {show("worktree") && (
                <HostVital
                  icon="Folder"
                  color={data.worktree ? theme.colors.foreground : theme.colors.foregroundMuted}
                >
                  {data.worktree ? truncatePath(data.worktree, 20) : "worktree --"}
                </HostVital>
              )}

              {show("uptime") && (
                <HostVital icon="Clock" color={theme.colors.foreground}>
                  {data.uptimeSeconds ? formatUptime(data.uptimeSeconds) : "--"}
                </HostVital>
              )}

              {show("changes") && (
                <HostVital icon="GitCommitHorizontal" color={theme.colors.foreground}>
                  {(data.gitFilesChanged ?? 0) > 0
                    ? `±${data.gitFilesChanged} files +${data.gitInsertions ?? 0}/-${data.gitDeletions ?? 0}`
                    : "No changes"}
                </HostVital>
              )}

              {show("tokens") && (
                <HostVital
                  icon="Coins"
                  color={
                    totalTokens != null || contextUsedTokens != null
                      ? theme.colors.foreground
                      : theme.colors.foregroundMuted
                  }
                >
                  {contextUsedTokens != null && contextMaxTokens
                    ? `${formatCompactTokens(contextUsedTokens)}/${formatCompactTokens(contextMaxTokens)}${contextPercent != null ? ` (${contextPercent}% ctx)` : ""}`
                    : totalTokens != null
                      ? `${formatCompactTokens(totalTokens)} tok`
                      : contextUsedTokens != null
                        ? `${formatCompactTokens(contextUsedTokens)} ctx`
                        : "tok --"}
                </HostVital>
              )}

              {show("tools") && (
                <HostVital icon="Sigma" color={theme.colors.foreground}>
                  {data.toolCalls != null
                    ? `${data.toolCalls}${data.toolErrors ? ` (${data.toolErrors} err)` : ""}`
                    : "tools --"}
                </HostVital>
              )}

              {show("turns") && (
                <HostVital
                  icon="Repeat"
                  color={data.turnCount != null ? theme.colors.foreground : theme.colors.foregroundMuted}
                >
                  {data.turnCount != null ? `${data.turnCount} turns` : "turns --"}
                </HostVital>
              )}
            </HostRow>
          }
        >
          <HostStack gap={6}>
            {show("tokens") && hasTokenDetails ? (
              <HostStack gap={8}>
                <HostRow justify="between" align="center">
                  <HostRow gap={4} align="center">
                    <Icon name="Coins" size={12} color={theme.colors.foregroundMuted} />
                    <Text style={sectionTitleStyle(theme.colors)}>Tokens & Context</Text>
                  </HostRow>
                  {costUsd != null && (
                    <Text style={{ fontSize: 10, fontWeight: "600", color: theme.colors.foreground }}>
                      ${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}
                    </Text>
                  )}
                </HostRow>

                {contextMaxTokens != null && contextMaxTokens > 0 ? (
                  <HostStack gap={4}>
                    <HostRow justify="between" align="center">
                      <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
                        Context Window
                      </Text>
                      <Text style={{ fontSize: 10, fontWeight: "600", color: theme.colors.foreground }}>
                        {formatCompactTokens(contextUsedTokens ?? 0)} /{" "}
                        {formatCompactTokens(contextMaxTokens)} ({contextPercent}%)
                      </Text>
                    </HostRow>
                    <HostProgressBar
                      value={contextPercent ?? 0}
                      thresholds={{ warning: 70, danger: 85 }}
                      height={6}
                    />
                  </HostStack>
                ) : contextUsedTokens != null ? (
                  <Text style={{ fontSize: 10, color: theme.colors.foreground }}>
                    {formatCompactTokens(contextUsedTokens)} tokens
                  </Text>
                ) : null}

                <HostRow wrap gap={6} align="center">
                  {inputTokens != null && (
                    <HostBadge label={`In: ${inputTokens.toLocaleString()}`} variant="neutral" />
                  )}
                  {outputTokens != null && (
                    <HostBadge label={`Out: ${outputTokens.toLocaleString()}`} variant="neutral" />
                  )}
                  {cachedTokens != null && (
                    <HostBadge label={`Cache: ${cachedTokens.toLocaleString()}`} variant="neutral" />
                  )}
                </HostRow>
              </HostStack>
            ) : show("tokens") ? (
              <HostRow justify="between" align="center">
                <Text style={sectionTitleStyle(theme.colors)}>Tokens & Context</Text>
                <Text
                  style={{
                    fontSize: 10,
                    fontStyle: "italic",
                    color: theme.colors.foregroundMuted,
                  }}
                >
                  Not reported by provider
                </Text>
              </HostRow>
            ) : null}

            <HostStack gap={4}>
              <Text style={sectionTitleStyle(theme.colors)}>Turn Details</Text>
              <HostRow wrap gap={12} align="center">
                <HostVital grow={false} icon="Cpu" color={theme.colors.foreground}>
                  {data.agentModel ?? "Unknown model"} ({data.agentProvider ?? "default"})
                </HostVital>
                {data.toolCalls != null && (
                  <HostVital grow={false} icon="Sigma" color={theme.colors.foreground}>
                    {data.toolCalls} calls
                    {data.toolErrors ? `, ${data.toolErrors} failed` : ""}
                  </HostVital>
                )}
                {(data.gitInsertions != null || data.gitDeletions != null) && (
                  <HostVital grow={false} icon="GitCommitHorizontal" color={theme.colors.foreground}>
                    +{data.gitInsertions ?? 0} -{data.gitDeletions ?? 0}
                  </HostVital>
                )}
              </HostRow>
            </HostStack>

            {data.outcomeError && (
              <View
                style={{
                  padding: 6,
                  borderRadius: 4,
                  backgroundColor: theme.colors.surface2,
                  borderLeftWidth: 3,
                  borderLeftColor: theme.colors.statusDanger,
                }}
              >
                <Text numberOfLines={2} style={{ fontSize: 11, color: theme.colors.statusDanger }}>
                  {data.outcomeError}
                </Text>
              </View>
            )}
          </HostStack>
        </HostCollapsible>
      </HostLayoutProvider>
    </HostThemeProvider>
  );
}

const styles = {
  // Layout-only. Color MUST come from the theme: a raw style without `color`
  // falls back to React Native's default black and vanishes in dark mode
  // (xpufx-org/paseo#208). Use `sectionTitleStyle(colors)` at call sites.
  sectionTitle: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Header slots are auto-width: a `HostRow`'s base `width: 100%` resolves to
  // zero inside the collapsible's `flex: 1` title column on native Yoga, which
  // collapsed the header and stranded the outcome/time row mid-card
  // (xpufx-org/paseo#1010). Opting these rows out of the full-width default
  // keeps the header on one content-sized line.
  headerInlineRow: {
    width: "auto",
  },
} as const;

function sectionTitleStyle(colors: { foregroundMuted: string }) {
  return [styles.sectionTitle, { color: colors.foregroundMuted }];
}
