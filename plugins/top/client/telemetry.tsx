import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useAgent, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  Badge,
  Collapsible,
  PluginThemeProvider,
  ProgressBar,
  Row,
  Stack,
  usePluginSettings,
} from "paseo-plugin-helper/client";
import { formatBytes, formatUptime, truncatePath } from "paseo-plugin-helper/shared";
import {
  isTimelineEnabled,
  isMcpSurfaceEnabled,
  topSettingsContract,
  TIMELINE_RENDERED_METRICS,
  type MetricId,
  type TopTimelineTelemetryData,
} from "../shared/resources";
import { formatCompactTokens, type TopAgentSnapshot } from "./pill-labels";

export { TIMELINE_RENDERED_METRICS };

function Vital({
  icon,
  color,
  children,
}: {
  icon: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <Row gap={4} align="center">
      <Icon name={icon} size={12} color={color} />
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "500" }}>
        {children}
      </Text>
    </Row>
  );
}

export function TopTimelineTelemetryCard({
  item,
  theme,
  layout,
  timestamp,
}: PluginTimelineItemProps<TopTimelineTelemetryData>) {
  const data = item.data;
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

  const cpuColor = useMemo(() => {
    if (data.cpuPercent >= 85) return theme.colors.statusDanger;
    if (data.cpuPercent >= 70) return theme.colors.statusWarning;
    return theme.colors.foreground;
  }, [data.cpuPercent, theme.colors]);

  const memColor = useMemo(() => {
    if (data.memPercent >= 90) return theme.colors.statusDanger;
    if (data.memPercent >= 75) return theme.colors.statusWarning;
    return theme.colors.foreground;
  }, [data.memPercent, theme.colors]);

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

  return (
    <PluginThemeProvider theme={theme} layout={layout}>
      <Collapsible
        variant="elevated"
        isExpanded={isExpanded}
        onToggle={setIsExpanded}
        style={data.outcomeKind === "failed" ? { borderColor: theme.colors.statusDanger } : undefined}
        title={
          <Row gap={6} align="center">
            <Icon name={outcomeConfig.icon} size={14} color={outcomeConfig.color} />
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foreground }}>
              {outcomeConfig.label}
            </Text>
            {data.durationMs != null ? (
              <Badge label={`${(data.durationMs / 1000).toFixed(1)}s`} variant="neutral" />
            ) : null}
          </Row>
        }
        headerRight={
          <Row gap={6} align="center">
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
          </Row>
        }
        summary={
          !isExpanded && data.outcomeKind === "canceled" ? (
            <Text numberOfLines={2} style={{ fontSize: 11, color: theme.colors.statusDanger }}>
              {canceledText}
            </Text>
          ) : undefined
        }
      >
        <Stack gap={6}>
          <Row wrap gap={8} align="center">
            {show("cpu_ram") && (
              <Vital icon="Cpu" color={cpuColor}>
                CPU {data.cpuPercent}%
              </Vital>
            )}

            {show("cpu_ram") && (
              <Vital icon="Database" color={memColor}>
                RAM {formatBytes(data.memUsedBytes)} ({data.memPercent}%)
              </Vital>
            )}

            {show("load") && (
              <Vital icon="Activity" color={theme.colors.foreground}>
                Load {data.loadAvg1m.toFixed(2)}
              </Vital>
            )}

            {showMcp && (
              <Vital
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
              </Vital>
            )}

            {show("agent_id") && (
              <Vital icon="Fingerprint" color={theme.colors.foreground}>
                {data.agentId && data.agentId.length > 7
                  ? data.agentId.slice(0, 7)
                  : (data.agentId ?? "--")}
              </Vital>
            )}

            {show("agent") && (
              <Vital
                icon="Bot"
                color={data.agentModel ? theme.colors.foreground : theme.colors.foregroundMuted}
              >
                {data.agentModel ?? "model --"}
              </Vital>
            )}

            {show("agent_provider") && (
              <Vital
                icon="Globe"
                color={
                  data.agentProvider ? theme.colors.foreground : theme.colors.foregroundMuted
                }
              >
                {data.agentProvider ?? "provider --"}
              </Vital>
            )}

            {show("agent_title") && (
              <Vital
                icon="Tag"
                color={data.agentTitle ? theme.colors.foreground : theme.colors.foregroundMuted}
              >
                {data.agentTitle ?? "title --"}
              </Vital>
            )}

            {show("branch") && (
              <Vital
                icon="GitBranch"
                color={data.branch ? theme.colors.foreground : theme.colors.foregroundMuted}
              >
                {data.branch ?? "branch --"}
              </Vital>
            )}

            {show("worktree") && (
              <Vital
                icon="Folder"
                color={data.worktree ? theme.colors.foreground : theme.colors.foregroundMuted}
              >
                {data.worktree ? truncatePath(data.worktree, 20) : "worktree --"}
              </Vital>
            )}

            {show("uptime") && (
              <Vital icon="Clock" color={theme.colors.foreground}>
                {data.uptimeSeconds ? formatUptime(data.uptimeSeconds) : "--"}
              </Vital>
            )}

            {show("changes") && (
              <Vital icon="GitCommitHorizontal" color={theme.colors.foreground}>
                {(data.gitFilesChanged ?? 0) > 0
                  ? `±${data.gitFilesChanged} files +${data.gitInsertions ?? 0}/-${data.gitDeletions ?? 0}`
                  : "No changes"}
              </Vital>
            )}

            {show("tokens") && (
              <Vital
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
              </Vital>
            )}

            {show("tools") && (
              <Vital icon="Sigma" color={theme.colors.foreground}>
                {data.toolCalls != null
                  ? `${data.toolCalls}${data.toolErrors ? ` (${data.toolErrors} err)` : ""}`
                  : "tools --"}
              </Vital>
            )}

            {show("turns") && (
              <Vital
                icon="Repeat"
                color={data.turnCount != null ? theme.colors.foreground : theme.colors.foregroundMuted}
              >
                {data.turnCount != null ? `${data.turnCount} turns` : "turns --"}
              </Vital>
            )}
          </Row>

          {show("tokens") && hasTokenDetails ? (
            <Stack gap={8}>
              <Row justify="space-between" align="center">
                <Row gap={4} align="center">
                  <Icon name="Coins" size={12} color={theme.colors.foregroundMuted} />
                  <Text style={styles.sectionTitle}>Tokens & Context</Text>
                </Row>
                {costUsd != null && (
                  <Text style={{ fontSize: 10, fontWeight: "600", color: theme.colors.foreground }}>
                    ${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}
                  </Text>
                )}
              </Row>

              {contextMaxTokens != null && contextMaxTokens > 0 ? (
                <Stack gap={4}>
                  <Row justify="space-between" align="center">
                    <Text style={{ fontSize: 10, color: theme.colors.foregroundMuted }}>
                      Context Window
                    </Text>
                    <Text style={{ fontSize: 10, fontWeight: "600", color: theme.colors.foreground }}>
                      {formatCompactTokens(contextUsedTokens ?? 0)} /{" "}
                      {formatCompactTokens(contextMaxTokens)} ({contextPercent}%)
                    </Text>
                  </Row>
                  <ProgressBar
                    value={contextPercent ?? 0}
                    thresholds={{ warning: 70, danger: 85 }}
                    height={6}
                  />
                </Stack>
              ) : contextUsedTokens != null ? (
                <Text style={{ fontSize: 10, color: theme.colors.foreground }}>
                  {formatCompactTokens(contextUsedTokens)} tokens
                </Text>
              ) : null}

              <Row wrap gap={6} align="center">
                {inputTokens != null && (
                  <Badge label={`In: ${inputTokens.toLocaleString()}`} variant="neutral" />
                )}
                {outputTokens != null && (
                  <Badge label={`Out: ${outputTokens.toLocaleString()}`} variant="neutral" />
                )}
                {cachedTokens != null && (
                  <Badge label={`Cache: ${cachedTokens.toLocaleString()}`} variant="neutral" />
                )}
              </Row>
            </Stack>
          ) : show("tokens") ? (
            <Row justify="space-between" align="center">
              <Text style={styles.sectionTitle}>Tokens & Context</Text>
              <Text
                style={{
                  fontSize: 10,
                  fontStyle: "italic",
                  color: theme.colors.foregroundMuted,
                }}
              >
                Not reported by provider
              </Text>
            </Row>
          ) : null}

          <Stack gap={4}>
            <Text style={styles.sectionTitle}>Turn Details</Text>
            <Row wrap gap={12} align="center">
              <Vital icon="Cpu" color={theme.colors.foreground}>
                {data.agentModel ?? "Unknown model"} ({data.agentProvider ?? "default"})
              </Vital>
              {data.toolCalls != null && (
                <Vital icon="Sigma" color={theme.colors.foreground}>
                  {data.toolCalls} calls
                  {data.toolErrors ? `, ${data.toolErrors} failed` : ""}
                </Vital>
              )}
              {(data.gitInsertions != null || data.gitDeletions != null) && (
                <Vital icon="GitCommitHorizontal" color={theme.colors.foreground}>
                  +{data.gitInsertions ?? 0} -{data.gitDeletions ?? 0}
                </Vital>
              )}
            </Row>
          </Stack>

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
        </Stack>
      </Collapsible>
    </PluginThemeProvider>
  );
}

const styles = {
  sectionTitle: {
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
} as const;
