import React, { useMemo, useRef, useState, useEffect } from "react";
import { Animated, Linking, Platform, Text, View } from "react-native";
import {
  AttentionBeacon,
  Badge,
  Button,
  Card,
  CommandBox,
  EmptyState,
  Icon,
  InteractiveRow,
  KeyValue,
  KeyValueGroup,
  Row,
  SearchInput,
  Stack,
  StatusDot,
  copyToClipboard,
  usePluginTheme,
  useRpcMutation,
} from "paseo-plugin-helper/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  type UppidiAgent,
  type UppidiAgentTreeNode,
  type DeterministicAgentState,
  type UppidiAgentsOutput,
  type DeterministicStateConfig,
  getAgentCategoryIcon,
  getDeterministicStateConfig,
  getPendingPermissionAction,
  getPermissionAdjudicationCommand,
  getAgentAttentionReason,
  uppidiArchiveAgentContract,
  uppidiArchiveInactiveAgentsContract,
  uppidiCreateFrontDeskContract,
  uppidiReplaceFrontDeskContract,
  uppidiAddOrchestratorContract,
  uppidiReplaceOrchestratorContract,
  uppidiToggleRepoMuteContract,
  extractAgentWorktree,
  extractAgentProject,
} from "../shared/contracts.js";
import {
  filterBulkArchiveCandidates,
  buildProjectGroups,
  filterAgentTree,
  getStatusLightColor,
  deriveHealthGauge,
  DEFAULT_HEALTH_GAUGE_THRESHOLDS,
  type HealthGauge,
  type HealthGaugeSegment,
  type HealthGaugeTone,
  STATUS_LIGHT_GREEN,
  STATUS_LIGHT_ORANGE,
  STATUS_LIGHT_RED,
  STATUS_LIGHT_COLORS,
  isRepoMatching,
  type ProjectAgentGroup,
} from "../shared/sort-filter.js";

export {
  type DeterministicStateConfig,
  getAgentCategoryIcon,
  getDeterministicStateConfig,
  getStatusLightColor,
  STATUS_LIGHT_GREEN,
  STATUS_LIGHT_ORANGE,
  STATUS_LIGHT_RED,
  STATUS_LIGHT_COLORS,
};

/**
 * Coerces a possibly-partial RPC collection to an array of agents. The server
 * types promise arrays, but a truncated or legacy payload can deliver a
 * non-array (or `undefined`); spreading/calling `.filter` on that blanks the
 * whole fleet page (#510).
 */
function toAgentArray(value: unknown): UppidiAgent[] {
  return Array.isArray(value) ? (value.filter(Boolean) as UppidiAgent[]) : [];
}

export interface UppidiFleetTreeViewProps {
  agentsData?: UppidiAgentsOutput;
  isLoading?: boolean;
  onRefresh?: () => void;
  navigation?: PluginSurfaceProps["navigation"];
  onArchiveAgent?: (agentId: string) => Promise<void> | void;
  onArchiveBulk?: () => Promise<void> | void;
  isArchiving?: boolean;
  onCreateFrontDesk?: () => Promise<void> | void;
  onReplaceFrontDesk?: (existingAgentId?: string) => Promise<void> | void;
  onAddOrchestrator?: (repo: string) => Promise<void> | void;
  onReplaceOrchestrator?: (repo: string, existingAgentId?: string) => Promise<void> | void;
  onToggleRepoMute?: (repo: string, muted?: boolean) => Promise<void> | void;
  selectedRepo?: string;
  /** Agent id currently registered as Front Desk with the hook daemon (#470). */
  registeredFrontDeskAgentId?: string | null;
}

export interface AgentStatusLightProps {
  agent: UppidiAgent;
  navigation?: PluginSurfaceProps["navigation"];
  size?: number;
}

/**
 * Interactive agent status light dot (#410)
 * Color coded:
 * - Green (#10b981): working / running / executing
 * - Orange / Amber (#f59e0b): idle / waiting / paused / ready / non-failure mode
 * - Red (#ef4444): error / failed / timeout / failure mode
 * Features hover highlight, tooltip with agent name & status, and opens composer surface on click.
 */
export function AgentStatusLight({
  agent,
  navigation,
  size = 8,
}: AgentStatusLightProps) {
  const [hovered, setHovered] = useState(false);
  const { colors } = usePluginTheme();
  const color = getStatusLightColor(agent);
  const isWorking = color === STATUS_LIGHT_GREEN;

  const statusDetail =
    agent.stateDetail
      ? `${agent.deterministicState || agent.status}: ${agent.stateDetail}`
      : agent.deterministicState && agent.deterministicState !== "unknown"
      ? agent.deterministicState
      : agent.status || "idle";
  const tooltip = `${agent.name} (${statusDetail})`;

  const handlePress = (e?: any) => {
    e?.stopPropagation?.();
    if (navigation?.openAgent) {
      navigation.openAgent({ agentId: agent.id });
      return;
    }
    if (typeof window !== "undefined" && agent.url) {
      try {
        window.open(agent.url, "_blank");
        return;
      } catch {}
    }
    const url = agent.url || `paseo://agent/${agent.id}`;
    Linking.openURL(url).catch(() => {
      copyToClipboard(url).catch(() => {});
    });
  };

  return (
    <InteractiveRow
      accessibilityRole="link"
      accessibilityLabel={tooltip}
      title={tooltip}
      onPress={handlePress}
      onHoverChange={setHovered}
      pressedOpacity={0.7}
      style={{
        padding: 2,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        overflow: "visible",
      }}
    >
      <View style={{ transform: [{ scale: hovered ? 1.3 : 1 }] }}>
        <AgentStateDot color={color} pulse={isWorking} size={size} />
      </View>
      {hovered && (
        <View
          // @ts-ignore RN web accessibilityRole
          accessibilityRole={"tooltip" as any}
          testID="agent-status-light-tooltip"
          style={{
            position: "absolute",
            bottom: size + 6,
            left: "50%",
            transform: [{ translateX: "-50%" as any }],
            zIndex: 100,
            pointerEvents: "none" as any,
            backgroundColor: (colors as any).surfaceRaised || colors.surface2 || colors.surface1 || "#1e293b",
            borderColor: colors.border || "#334155",
            borderWidth: 1,
            borderRadius: 9999,
            paddingHorizontal: 8,
            paddingVertical: 3,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.35,
            shadowRadius: 4,
            elevation: 5,
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            whiteSpace: "nowrap" as any,
          } as any}
        >
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: color,
            }}
          />
          <Text
            numberOfLines={1}
            style={{
              color: colors.foreground || "#f8fafc",
              fontSize: 11,
              fontWeight: "600",
              whiteSpace: "nowrap" as any,
              flexShrink: 1,
            } as any}
          >
            {agent.name}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: colors.foregroundMuted || "#94a3b8",
              fontSize: 10,
              whiteSpace: "nowrap" as any,
              flexShrink: 1,
            } as any}
          >
            ({statusDetail})
          </Text>
        </View>
      )}
    </InteractiveRow>
  );
}

export interface AgentStatusLightsRowProps {
  agents: UppidiAgent[];
  navigation?: PluginSurfaceProps["navigation"];
  size?: number;
  gap?: number;
}

/**
 * Row of side-by-side interactive agent status lights (#410).
 */
export function AgentStatusLightsRow({
  agents,
  navigation,
  size = 8,
  gap = 4,
}: AgentStatusLightsRowProps) {
  if (!agents || agents.length === 0) return null;

  return (
    <Row align="center" gap={gap} style={{ flexWrap: "wrap", alignItems: "center", overflow: "visible" }}>
      {agents.map((agent) => (
        <AgentStatusLight
          key={agent.id}
          agent={agent}
          navigation={navigation}
          size={size}
        />
      ))}
    </Row>
  );
}

/**
 * Centered state jewel dot with smooth, subtle breathing pulse animation for active states.
 */
export function AgentStateDot({
  color,
  pulse = false,
  size = 8,
}: {
  color: string;
  pulse?: boolean;
  size?: number;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) {
      pulseAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.35,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, pulseAnim]);

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: pulseAnim,
          shadowColor: color,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: pulse ? 0.6 : 0.2,
          shadowRadius: pulse ? 3 : 1,
        }}
      />
    </View>
  );
}

export interface AgentTitleLinkProps {
  agent: UppidiAgent;
  colors: any;
  typography: any;
  navigation?: PluginSurfaceProps["navigation"];
  size?: "sm" | "md";
}

/**
 * Interactive agent name link with clean hover/press cues and no layout jitter.
 */
export function AgentTitleLink({
  agent,
  colors,
  typography,
  navigation,
  size = "md",
}: AgentTitleLinkProps) {
  const [hovered, setHovered] = useState(false);
  const handlePress = () => {
    if (navigation?.openAgent) {
      navigation.openAgent({ agentId: agent.id });
      return;
    }
    const url = agent.url || `paseo://agent/${agent.id}`;
    Linking.openURL(url).catch(() => {
      copyToClipboard(url).catch(() => {});
    });
  };

  return (
    <InteractiveRow
      accessibilityRole="link"
      accessibilityLabel={`Open Paseo agent ${agent.name}`}
      onPress={handlePress}
      onHoverChange={setHovered}
      pressedOpacity={0.75}
      style={{ flexShrink: 1 }}
    >
      <Text
        style={{
          color: hovered ? colors.accent : colors.foreground,
          ...(size === "sm" ? typography.body : typography.heading),
          fontSize: size === "sm" ? 12 : 13,
          fontWeight: "600",
          textDecorationLine: hovered ? "underline" : "none",
        }}
        numberOfLines={1}
      >
        {agent.name}
      </Text>
    </InteractiveRow>
  );
}

export function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (Number.isNaN(diffMs)) return "";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/** Compact duration rendering for the health metrics card (#560). */
export function formatDurationMs(ms?: number | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  if (hours < 24) return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function healthToneColor(tone: HealthGaugeTone, colors: any): string {
  if (tone === "critical") return colors.statusDanger ?? STATUS_LIGHT_RED;
  if (tone === "warn") return colors.statusWarning ?? STATUS_LIGHT_ORANGE;
  return colors.statusSuccess ?? STATUS_LIGHT_GREEN;
}

/** Milliseconds since an ISO timestamp, or undefined when unparseable. */
function elapsedSince(iso?: string | null, now: number = Date.now()): number | undefined {
  if (!iso) return undefined;
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return undefined;
  return Math.max(0, now - started);
}

export interface AgentHealthGaugeProps {
  agent: UppidiAgent;
  /** Compact surfaces halve the track width (28px vs 56px) (#560). */
  compact?: boolean;
  onToggle?: () => void;
  expanded?: boolean;
  now?: number;
}

/**
 * Compact agent health gauge (#560): a thin 3-4px stacked micro-bar (context /
 * turn / error) on the row's trailing edge, or a clock-arc sweep when the agent
 * is running an active turn. Renders nothing at all for legacy payloads with no
 * metrics block, so the agent line never grows or gains a second status surface
 * next to `AgentStatusLight`.
 */
export function AgentHealthGauge({
  agent,
  compact = false,
  onToggle,
  expanded = false,
  now = Date.now(),
}: AgentHealthGaugeProps) {
  const { colors } = usePluginTheme();
  const metrics = agent.metrics;
  // Absent gauge for legacy payloads: no metrics block, nothing rendered.
  if (!metrics) return null;

  const gauge: HealthGauge = deriveHealthGauge(agent, DEFAULT_HEALTH_GAUGE_THRESHOLDS, now);
  const toneColor = healthToneColor(gauge.overall, colors);
  const trackColor = colors.surface2 ?? "#334155";
  const width = compact ? 28 : 56;
  const height = 4;

  const isRunning =
    String(agent.status ?? "").toLowerCase() === "running" &&
    Boolean(metrics.activeTurnStartedAt);
  const turnElapsed = elapsedSince(metrics.activeTurnStartedAt, now);
  const sweepRatio =
    turnElapsed === undefined
      ? 0
      : Math.max(
          0,
          Math.min(1, turnElapsed / DEFAULT_HEALTH_GAUGE_THRESHOLDS.turnWarnMs)
        );
  const angleDeg = sweepRatio * 360;

  const label = `${agent.name} health: ${gauge.overall}`;

  const body = isRunning ? (
    // Clock-arc variant: a tiny clock face whose hand sweeps proportional to the
    // active turn duration (full sweep at the stall threshold).
    <View
      style={{
        width: compact ? 12 : 14,
        height: compact ? 12 : 14,
        borderRadius: compact ? 6 : 7,
        borderWidth: 1.5,
        borderColor: trackColor,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}
    >
      <View
        style={{
          position: "absolute",
          width: compact ? 12 : 14,
          height: compact ? 12 : 14,
          alignItems: "center",
          transform: [{ rotate: `${angleDeg}deg` }],
        }}
      >
        <View
          style={{
            width: 1.5,
            height: (compact ? 12 : 14) / 2 - 2,
            backgroundColor: toneColor,
            borderRadius: 1,
          }}
        />
      </View>
    </View>
  ) : (
    // Thin stacked micro-bar: three side-by-side segments (context / turn / error).
    <View
      testID={`agent-health-gauge-track-${agent.id}`}
      style={{ width, height, flexDirection: "row", gap: 2 }}
    >
      {gauge.segments.map((segment: HealthGaugeSegment) => (
        <View
          key={segment.kind}
          testID={`agent-health-gauge-segment-${segment.kind}`}
          style={{
            flex: 1,
            height,
            borderRadius: 2,
            backgroundColor: trackColor,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              width: `${Math.round(segment.ratio * 100)}%`,
              height: "100%",
              borderRadius: 2,
              backgroundColor: healthToneColor(segment.tone, colors),
            }}
          />
        </View>
      ))}
    </View>
  );

  if (!onToggle) return body;

  return (
    <InteractiveRow
      accessibilityRole="button"
      accessibilityLabel={label}
      title={`${label} — tap for metrics`}
      testID={`agent-health-gauge-${agent.id}`}
      onPress={(e) => {
        e?.stopPropagation?.();
        onToggle();
      }}
      opacity={expanded ? 1 : 0.85}
      pressedOpacity={0.7}
      style={{
        paddingHorizontal: 2,
        paddingVertical: 1,
        borderRadius: 3,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {body}
    </InteractiveRow>
  );
}

export interface AgentMetricsCardProps {
  agent: UppidiAgent;
  now?: number;
}

/**
 * Expandable metrics card (#560). Inserted between the agent row and its
 * children on tap; carries the full inventory table — context %, cached ratio,
 * cost, turn duration, session lifetime, permission-wait, and errors.
 * Renders null when the agent has no metrics block.
 */
export function AgentMetricsCard({ agent, now = Date.now() }: AgentMetricsCardProps) {
  const { colors, typography } = usePluginTheme();
  const metrics = agent.metrics;
  if (!metrics) return null;

  const contextPct =
    metrics.contextUsedTokens !== undefined &&
    metrics.contextMaxTokens !== undefined &&
    metrics.contextMaxTokens > 0
      ? Math.round((metrics.contextUsedTokens / metrics.contextMaxTokens) * 100)
      : undefined;

  const cachedDenom =
    (metrics.cachedTokens ?? 0) + (metrics.inputTokens ?? 0);
  const cachedPct =
    metrics.cachedTokens !== undefined && cachedDenom > 0
      ? Math.round((metrics.cachedTokens / cachedDenom) * 100)
      : undefined;
  const cachedPctText = cachedPct !== undefined ? `${cachedPct}%` : "—";
  const cachedSub =
    metrics.cachedTokens !== undefined
      ? `${metrics.cachedTokens.toLocaleString()} cached`
      : undefined;

  const costText =
    metrics.costUsd !== undefined ? `$${metrics.costUsd.toFixed(2)}` : "—";

  const turnMs = elapsedSince(metrics.activeTurnStartedAt, now);
  const turnText = turnMs !== undefined ? formatDurationMs(turnMs) : "—";

  let lifetimeText = "—";
  if (agent.created && agent.updatedAt) {
    const createdMs = Date.parse(agent.created);
    const updatedMs = Date.parse(agent.updatedAt);
    if (Number.isFinite(createdMs) && Number.isFinite(updatedMs) && updatedMs >= createdMs) {
      lifetimeText = formatDurationMs(updatedMs - createdMs);
    }
  }

  const permissionWaitMs = elapsedSince(metrics.attentionTimestamp, now);
  const permissionWaitText =
    permissionWaitMs !== undefined ? formatDurationMs(permissionWaitMs) : "—";

  const errorText = agent.lastError?.trim() || "None";

  return (
    <View testID={`agent-metrics-card-${agent.id}`} style={{ marginTop: 2, marginBottom: 2 }}>
      <Card
        variant="elevated"
        style={{
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderColor: colors.border,
          borderRadius: 6,
        }}
      >
        <Stack gap="xs">
          <Row align="center" gap="xs">
            <Icon name="Activity" size={12} color={colors.foregroundMuted} />
            <Text
              numberOfLines={1}
              style={{
                color: colors.foregroundMuted,
                ...typography.caption,
                fontWeight: "700",
                flexShrink: 1,
              }}
            >
              Agent Metrics
            </Text>
          </Row>
          <KeyValueGroup columns={3} collapse="never" gap={8}>
            <KeyValue
              label="Context"
              value={contextPct !== undefined ? `${contextPct}%` : "—"}
              subValue={
                metrics.contextUsedTokens !== undefined && metrics.contextMaxTokens !== undefined
                  ? `${metrics.contextUsedTokens.toLocaleString()} / ${metrics.contextMaxTokens.toLocaleString()}`
                  : undefined
              }
            />
            <KeyValue label="Cached ratio" value={cachedPctText} subValue={cachedSub} />
            <KeyValue label="Cost" value={costText} />
            <KeyValue
              label="Input tokens"
              value={metrics.inputTokens !== undefined ? metrics.inputTokens.toLocaleString() : "—"}
            />
            <KeyValue
              label="Output tokens"
              value={metrics.outputTokens !== undefined ? metrics.outputTokens.toLocaleString() : "—"}
            />
            <KeyValue label="Turn duration" value={turnText} />
            <KeyValue label="Session lifetime" value={lifetimeText} />
            <KeyValue label="Permission wait" value={permissionWaitText} />
            <KeyValue label="Errors" value={errorText} />
          </KeyValueGroup>
        </Stack>
      </Card>
    </View>
  );
}

/**
 * Dedicated Fleet Front Desk Header & Hero Card (#403)
 * Elevated at the top of the tree view as the fleet-wide liaison.
 * Displays interactive status lights for fleet orchestrators (#410).
 *
 * Front Desk is a singleton (#470): this renders the single registered primary
 * session only. Duplicate/orphaned sessions are surfaced separately as stale
 * cleanup candidates rather than a pseudo-official "secondary" grouping.
 */
export function FrontDeskHero({
  node,
  orchestrators = [],
  colors,
  typography,
  navigation,
  archivingAgentId,
  onArchiveAgent,
  onCreateFrontDesk,
  onReplaceFrontDesk,
  isActionLoading = false,
}: {
  node?: UppidiAgentTreeNode | null;
  orchestrators?: UppidiAgent[];
  colors: any;
  typography: any;
  navigation?: PluginSurfaceProps["navigation"];
  archivingAgentId?: string | null;
  onArchiveAgent: (id: string) => Promise<void> | void;
  onCreateFrontDesk?: () => Promise<void> | void;
  onReplaceFrontDesk?: (existingAgentId?: string) => Promise<void> | void;
  isActionLoading?: boolean;
}) {
  const [metricsOpen, setMetricsOpen] = useState(false);

  if (!node) {
    return (
      <Card
        variant="elevated"
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderColor: colors.border,
          borderLeftWidth: 4,
          borderLeftColor: colors.foregroundMuted,
          borderRadius: 8,
          overflow: "visible",
        }}
      >
        <Stack gap={8} style={{ overflow: "visible" }}>
          <Row justify="space-between" align="center" wrap gap="sm" style={{ overflow: "visible" }}>
            <Row align="center" gap="sm">
              <Icon name="Inbox" size={18} color={colors.foregroundMuted} />
              <Stack gap={2}>
                <Row align="center" gap="xs">
                  <Text
                    numberOfLines={1}
                    style={{
                      color: colors.foreground,
                      ...typography.heading,
                      fontWeight: "700",
                      flexShrink: 1,
                    }}
                  >
                    Fleet Front Desk
                  </Text>
                  <Badge label="Liaison" variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
                </Row>
                <Text
                  style={{
                    color: colors.foregroundMuted,
                    ...typography.caption,
                    // Prose, not a label: it wraps onto its own lines rather than
                    // ellipsizing. Either way it must be allowed to compress, or it
                    // demands its full 357px and pushes the hero past the viewport.
                    flexShrink: 1,
                  }}
                >
                  No active front desk liaison session running. Webhook events route to standbys.
                </Text>
              </Stack>
            </Row>
            <Row align="center" gap="xs">
              <Badge label="Standby" variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
              {onCreateFrontDesk && (
                <Button
                  label="+ Create Front Desk"
                  icon="Plus"
                  size="sm"
                  variant="primary"
                  disabled={isActionLoading}
                  loading={isActionLoading}
                  onPress={onCreateFrontDesk}
                />
              )}
            </Row>
          </Row>

          {/* Fleet Orchestrator Status Lights (#410) */}
          {orchestrators && orchestrators.length > 0 && (
            <Row
              align="center"
              justify="space-between"
              wrap
              gap="xs"
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.border,
                paddingTop: 8,
                marginTop: 2,
                overflow: "visible",
              }}
            >
              <Row align="center" gap="xs" style={{ overflow: "visible" }}>
                <Icon name="Network" size={13} color={colors.foregroundMuted} />
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.foregroundMuted,
                    fontSize: 11,
                    fontWeight: "600",
                    flexShrink: 1,
                  }}
                >
                  Orchestrators ({orchestrators.length}):
                </Text>
              </Row>
              <AgentStatusLightsRow
                agents={orchestrators}
                navigation={navigation}
                size={9}
              />
            </Row>
          )}
        </Stack>
      </Card>
    );
  }

  const primaryNode = node;
  const primaryAgent = primaryNode.agent;
  const primaryStateConfig = getDeterministicStateConfig(
    primaryAgent.deterministicState,
    primaryAgent.category
  );
  const primaryWorktree = primaryAgent.worktree || extractAgentWorktree(primaryAgent);

  return (
    <Card
      variant="elevated"
      style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderColor: colors.border,
        borderLeftWidth: 4,
        borderLeftColor: primaryStateConfig.color,
        borderRadius: 8,
        overflow: "visible",
      }}
    >
      <Stack gap={10} style={{ overflow: "visible" }}>
        <Row justify="space-between" align="center" wrap gap="sm" style={{ overflow: "visible" }}>
          {/* Left: Status Light, Icon, Titles & Worktree */}
          <Row align="center" gap="sm" style={{ flexShrink: 1, overflow: "visible" }}>
            <AgentStatusLight
              agent={primaryAgent}
              navigation={navigation}
              size={10}
            />
            <Icon name="Inbox" size={18} color={primaryStateConfig.color} />
            <Stack gap={2} style={{ flexShrink: 1 }}>
              <Row align="center" gap="xs" wrap>
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.foregroundMuted,
                    fontSize: 10,
                    fontWeight: "700",
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    flexShrink: 1,
                  }}
                >
                  Fleet Front Desk
                </Text>
                <Badge label="Liaison" variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
              </Row>
              <Row align="center" gap="xs" wrap style={{ flexShrink: 1 }}>
                <AgentTitleLink
                  agent={primaryAgent}
                  colors={colors}
                  typography={typography}
                  navigation={navigation}
                />
                <Badge
                  label={primaryAgent.shortId}
                  variant="neutral"
                  size="sm"
                  textStyle={{ fontFamily: "monospace", fontSize: 10, letterSpacing: 0.2 }}
                />
                {primaryWorktree && (
                  <Badge
                    label={primaryWorktree}
                    variant="neutral"
                    size="sm"
                    textStyle={{ fontFamily: "monospace", fontSize: 10 }}
                  />
                )}
                <AgentLabelsRow agent={primaryAgent} />
              </Row>
            </Stack>
          </Row>

          {/* Right: State, Model, Timing, Archive */}
          <Row align="center" wrap gap="xs">
            <Badge
              label={`${primaryAgent.deterministicState}${
                primaryAgent.stateDetail ? `: ${primaryAgent.stateDetail}` : ""
              }`}
              variant={primaryStateConfig.badgeVariant}
              size="sm"
              dot
              style={{ borderColor: primaryStateConfig.color }}
              textStyle={{ fontSize: 10 }}
            />

            {primaryAgent.model && (
              <Badge label={primaryAgent.model} variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
            )}

            {primaryAgent.lastActivityAt && (
              <Text
                numberOfLines={1}
                style={{
                  color: colors.foregroundMuted,
                  ...typography.caption,
                  fontSize: 11,
                  flexShrink: 1,
                }}
              >
                {formatRelativeTime(primaryAgent.lastActivityAt)}
              </Text>
            )}

            {onReplaceFrontDesk && (
              <Button
                label="Replace Front Desk"
                icon="RefreshCw"
                variant="ghost"
                size="sm"
                disabled={isActionLoading}
                loading={isActionLoading}
                onPress={() => onReplaceFrontDesk(primaryAgent.id)}
              />
            )}

            <Button
              icon="Archive"
              variant="ghost"
              size="sm"
              style={{
                width: 26,
                height: 26,
                paddingHorizontal: 0,
                paddingVertical: 0,
                justifyContent: "center",
                alignItems: "center",
                borderRadius: 4,
              }}
              accessibilityLabel={`Archive front desk agent ${primaryAgent.name}`}
              disabled={archivingAgentId === primaryAgent.id}
              loading={archivingAgentId === primaryAgent.id}
              onPress={() => onArchiveAgent(primaryAgent.id)}
            />

            {/* Compact health gauge for the Front Desk (#560). */}
            <AgentHealthGauge
              agent={primaryAgent}
              expanded={metricsOpen}
              onToggle={() => setMetricsOpen((open) => !open)}
            />
          </Row>
        </Row>

        {/* Expanded metrics card (#560). */}
        {metricsOpen && <AgentMetricsCard agent={primaryAgent} />}

        {/* Prominent permission / attention indicator for the primary Front Desk (#534) */}
        {(primaryAgent.pendingPermissions?.length || primaryAgent.requiresAttention) && (
          <AgentAttentionBanner agent={primaryAgent} />
        )}

        {/* Fleet Orchestrator Status Lights (#410) */}
        {orchestrators && orchestrators.length > 0 && (
          <Row
            align="center"
            justify="space-between"
            wrap
            gap="xs"
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: 8,
              marginTop: 2,
              overflow: "visible",
            }}
          >
            <Row align="center" gap="xs" style={{ overflow: "visible" }}>
              <Icon name="Network" size={13} color={colors.foregroundMuted} />
              <Text
                numberOfLines={1}
                style={{
                  color: colors.foregroundMuted,
                  fontSize: 11,
                  fontWeight: "600",
                  flexShrink: 1,
                }}
              >
                Fleet Orchestrators ({orchestrators.length}):
              </Text>
            </Row>
            <AgentStatusLightsRow
              agents={orchestrators}
              navigation={navigation}
              size={9}
            />
          </Row>
        )}
      </Stack>
    </Card>
  );
}


export function getDisplayableAgentLabels(agent: UppidiAgent): Array<{ key: string; value: string; display: string }> {
  if (!agent.labels || typeof agent.labels !== "object") return [];
  const entries: Array<{ key: string; value: string; display: string }> = [];
  for (const [k, v] of Object.entries(agent.labels)) {
    if (!k || v === undefined || v === null || String(v).trim() === "") continue;
    const strVal = String(v).trim();
    // Exclude internal routing/tab labels
    if (k.startsWith("paseo.open-agent-tab.") || k === "paseo.parent-agent-id") continue;
    // Common labels can be displayed cleanly
    if (k === "role" || k === "category") {
      // already shown in specialized badge, but if distinct show it
      continue;
    }
    entries.push({ key: k, value: strVal, display: `${k}=${strVal}` });
  }
  return entries;
}

export function AgentLabelsRow({ agent, max = 5 }: { agent: UppidiAgent; max?: number }) {
  const labels = getDisplayableAgentLabels(agent);
  if (labels.length === 0) return null;

  return (
    <Row align="center" gap="xxs" wrap style={{ overflow: "visible" }}>
      {labels.slice(0, max).map((item) => (
        <Badge
          key={item.key}
          label={item.display}
          variant="neutral"
          size="sm"
          textStyle={{ fontFamily: "monospace", fontSize: 9 }}
        />
      ))}
      {labels.length > max && (
        <Badge
          label={`+${labels.length - max}`}
          variant="neutral"
          size="sm"
          textStyle={{ fontSize: 9 }}
        />
      )}
    </Row>
  );
}

export function getParentBadgeLabel(agent: UppidiAgent): string | null {
  if (!agent.parentId && !agent.parentName) return null;
  if (
    agent.parentCategory === "front-desk" ||
    (agent.parentName && agent.parentName.toLowerCase().includes("front desk"))
  ) {
    return "via Front Desk";
  }
  if (agent.parentName) {
    return `via ${agent.parentName}`;
  }
  if (agent.parentId) {
    return `via ${agent.parentId.slice(0, 7)}`;
  }
  return null;
}

export interface ParentAgentPillProps {
  agent: UppidiAgent;
  navigation?: PluginSurfaceProps["navigation"];
}

/**
 * Parentage pill badge (#430)
 * Displays compact parent pill badge (e.g. via Front Desk or via <parentName> or via <shortId>).
 * Clicking opens the parent agent session if navigation is available.
 */
export function ParentAgentPill({ agent, navigation }: ParentAgentPillProps) {
  const label = getParentBadgeLabel(agent);
  if (!label) return null;

  const badge = (
    <Badge
      label={label}
      variant="neutral"
      size="sm"
      textStyle={{ fontSize: 10 }}
    />
  );

  if (navigation?.openAgent && agent.parentId) {
    return (
      <InteractiveRow
        accessibilityRole="button"
        accessibilityLabel={`Open parent agent (${label})`}
        accessibilityHint="Click to open parent agent session"
        title={agent.parentName ? `Parent: ${agent.parentName}` : label}
        onPress={(e) => {
          e?.stopPropagation?.();
          navigation.openAgent?.({ agentId: agent.parentId! });
        }}
        pressedOpacity={0.7}
      >
        {badge}
      </InteractiveRow>
    );
  }

  return badge;
}

export interface AgentAttentionBannerProps {
  agent: UppidiAgent;
  /** Compact mode renders inline badges without the adjudication command block. */
  compact?: boolean;
}

/**
 * Prominent fleet attention banner for blocked agents (#534).
 * Renders a pulsing `AttentionBeacon` warning when the agent sits at a pending
 * permission prompt (with a copyable Front Desk adjudication command), or an
 * `Awaiting Input` badge carrying the daemon-provided reason when the agent is
 * blocked on operator input. Returns null for healthy agents.
 */
export function AgentAttentionBanner({ agent, compact = false }: AgentAttentionBannerProps) {
  const { colors, typography } = usePluginTheme();
  const toast = useToast();
  const permissions = agent.pendingPermissions ?? [];
  const hasPermission = permissions.length > 0;
  const reason = getAgentAttentionReason(agent);

  if (!hasPermission && !agent.requiresAttention) return null;

  const tone: "warning" | "danger" = hasPermission ? "danger" : "warning";
  const accentColor = hasPermission
    ? colors.statusDanger ?? "#ef4444"
    : colors.statusWarning ?? "#f59e0b";

  const handleCopyCommand = async (command: string) => {
    const ok = await copyToClipboard(command, { toast, toastMessage: "Adjudication command" });
    if (!ok) toast.error("Failed to copy command");
  };

  return (
    <AttentionBeacon
      mode="radar"
      tone={tone}
      testID={`agent-attention-beacon-${agent.id}`}
      accessibilityLabel={
        hasPermission
          ? `Permission needed for ${agent.name}`
          : `Awaiting input for ${agent.name}`
      }
      style={{ flexShrink: 1 }}
    >
      <Stack
        gap="xxs"
        style={{
          borderWidth: 1,
          borderColor: accentColor,
          borderRadius: 6,
          paddingHorizontal: 8,
          paddingVertical: 5,
          backgroundColor: `${accentColor}22`,
          flexShrink: 1,
        }}
      >
        <Row align="center" gap="xs" wrap style={{ flexShrink: 1 }}>
          <Badge
            label={
              hasPermission
                ? `⚠️ Permission Needed: ${getPendingPermissionAction(permissions[0]!)}`
                : `⏸ Awaiting Input${reason ? `: ${reason}` : ""}`
            }
            variant={tone}
            size="sm"
            dot
            style={{ borderColor: accentColor }}
            textStyle={{ fontSize: 10, fontWeight: "700" }}
          />
          {hasPermission && permissions.length > 1 && (
            <Badge
              label={`+${permissions.length - 1} more`}
              variant={tone}
              size="sm"
              textStyle={{ fontSize: 9 }}
            />
          )}
        </Row>

        {hasPermission && !compact && (
          <Row align="center" gap="xs" wrap style={{ flexShrink: 1 }}>
            <CommandBox
              command={getPermissionAdjudicationCommand(agent.id, permissions[0])}
              copyLabel={`Copy adjudication command for ${agent.name}`}
              style={{ flexShrink: 1 }}
            />
          </Row>
        )}

        {hasPermission && compact && (
          <Button
            label="Copy permit command"
            icon="Copy"
            size="sm"
            variant="ghost"
            onPress={() =>
              handleCopyCommand(getPermissionAdjudicationCommand(agent.id, permissions[0]))
            }
            style={{ alignSelf: "flex-start", paddingVertical: 1, minHeight: 20 }}
          />
        )}
      </Stack>
    </AttentionBeacon>
  );
}

export interface DenseAgentRowProps {
  node: UppidiAgentTreeNode;
  depth?: number;
  isLast?: boolean;
  /** Position among siblings at the same depth; drives zebra striping (#628). */
  siblingIndex?: number;
  colors: any;
  typography: any;
  navigation?: PluginSurfaceProps["navigation"];
  archivingAgentId?: string | null;
  onArchiveAgent: (id: string) => Promise<void> | void;
}

/**
 * High-density agent list row.
 * CRITICAL (#403): Descendants/children MUST NOT use Card containers to avoid wasted space.
 * Features 4px/8px rhythm, visual tree guide connector, and subtle row hover highlighting.
 */
export function DenseAgentRow({
  node,
  depth = 1,
  isLast = false,
  siblingIndex = 0,
  colors,
  typography,
  navigation,
  archivingAgentId,
  onArchiveAgent,
}: DenseAgentRowProps) {
  const { alpha } = usePluginTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const agent = node.agent;
  const stateConfig = getDeterministicStateConfig(agent.deterministicState, agent.category);
  const worktree = agent.worktree || extractAgentWorktree(agent);
  const indentPadding = Math.min((depth - 1) * 16, 64);

  return (
    <View
      key={agent.id}
      style={{
        paddingLeft: indentPadding,
        paddingVertical: 1,
        overflow: "visible",
      }}
    >
      <View
        // @ts-ignore RN web hover
        onMouseEnter={() => setIsHovered(true)}
        // @ts-ignore RN web hover
        onMouseLeave={() => setIsHovered(false)}
        style={{
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
          // Zebra striping (#628). Alternates among siblings at the same depth
          // so each indentation group reads as its own band. Deliberately very
          // faint: the indentation already encodes hierarchy, so the stripe is
          // only there to help the eye track across a wide row. Hover wins, and
          // alpha() over colors.surface1 keeps it correct in light and dark.
          backgroundColor: isHovered
            ? (alpha?.(colors.accent, 0.05) || colors.surface1 || "rgba(255,255,255,0.04)")
            : siblingIndex % 2 === 1
              ? (alpha?.(colors.surface1, 0.5) || "rgba(128,128,128,0.06)")
              : "transparent",
          overflow: "visible",
        }}
      >
        <Row justify="space-between" align="center" wrap gap="xs" style={{ overflow: "visible" }}>
          {/* Left side: Guide connector, status dot, icon, title, shortId */}
          <Row align="center" gap="xs" style={{ flexShrink: 1, minWidth: 200, overflow: "visible" }}>
            <View
              style={{
                width: 18,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 2,
              }}
            >
              <Text
                style={{
                  color: colors.foregroundMuted,
                  fontFamily: "monospace",
                  fontSize: 11,
                  opacity: 0.65,
                }}
              >
                {isLast ? "└─" : "├─"}
              </Text>
            </View>
            <AgentStatusLight agent={agent} navigation={navigation} size={7} />
            <Icon name={stateConfig.categoryIcon} size={13} color={stateConfig.color} />
            <AgentTitleLink
              agent={agent}
              colors={colors}
              typography={typography}
              navigation={navigation}
              size="sm"
            />
            <Badge
              label={agent.shortId}
              variant="neutral"
              size="sm"
              textStyle={{ fontFamily: "monospace", fontSize: 10, letterSpacing: 0.2 }}
            />
            {agent.category !== "worker" && (
              <Badge
                label={agent.category}
                variant="neutral"
                size="sm"
                textStyle={{ fontSize: 10 }}
              />
            )}
            <ParentAgentPill agent={agent} navigation={navigation} />
            <AgentLabelsRow agent={agent} />

          </Row>

          {/* Right side: State badge, Model, Issue, Worktree, Time, Archive */}
          <Row align="center" wrap gap="xs">
            <Badge
              label={`${agent.deterministicState}${agent.stateDetail ? `: ${agent.stateDetail}` : ""}`}
              variant={stateConfig.badgeVariant}
              size="sm"
              dot
              style={{ borderColor: stateConfig.color }}
              textStyle={{ fontSize: 10 }}
            />

            {agent.model && (
              <Badge label={agent.model} variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
            )}

            {agent.attributedWork?.issue && (
              <Badge
                label={`#${agent.attributedWork.issue}`}
                variant="info"
                size="sm"
                textStyle={{ fontFamily: "monospace", fontSize: 10, fontWeight: "600" }}
              />
            )}

            {worktree && (
              <Badge
                label={worktree}
                variant="neutral"
                size="sm"
                textStyle={{ fontFamily: "monospace", fontSize: 10 }}
              />
            )}

            {agent.lastActivityAt && (
              <Text
                numberOfLines={1}
                style={{
                  color: colors.foregroundMuted,
                  ...typography.caption,
                  fontSize: 11,
                  lineHeight: 14,
                  flexShrink: 1,
                }}
              >
                {formatRelativeTime(agent.lastActivityAt)}
              </Text>
            )}

            <Button
              icon="Archive"
              variant="ghost"
              size="sm"
              style={{
                width: 24,
                height: 24,
                paddingHorizontal: 0,
                paddingVertical: 0,
                justifyContent: "center",
                alignItems: "center",
                borderRadius: 4,
                opacity: isHovered ? 1 : 0.6,
              }}
              accessibilityLabel={`Archive agent ${agent.name}`}
              disabled={archivingAgentId === agent.id}
              loading={archivingAgentId === agent.id}
              onPress={() => onArchiveAgent(agent.id)}
            />

            {/* Compact health gauge on the trailing edge (#560). */}
            <AgentHealthGauge
              agent={agent}
              compact
              expanded={metricsOpen}
              onToggle={() => setMetricsOpen((open) => !open)}
            />
          </Row>
        </Row>

        {/* Prominent permission / attention indicator (#534) */}
        {(agent.pendingPermissions?.length || agent.requiresAttention) && (
          <View style={{ marginTop: 2 }}>
            <AgentAttentionBanner agent={agent} compact />
          </View>
        )}

        {/* Expanded metrics card sits between the row and its children (#560). */}
        {metricsOpen && <AgentMetricsCard agent={agent} />}
      </View>

      {/* Descendant subagents (recursive) - Still NO cards! */}
      {node.children && node.children.length > 0 && (
        <View
          style={{
            borderLeftWidth: 1.5,
            borderLeftColor: colors.border,
            marginLeft: 16,
            paddingLeft: 8,
            marginTop: 2,
            marginBottom: 2,
            overflow: "visible",
          }}
        >
          {node.children.map((child, idx) => (
            <DenseAgentRow
              key={child.agent.id}
              node={child}
                siblingIndex={idx}
              depth={depth + 1}
              isLast={idx === node.children.length - 1}
              colors={colors}
              typography={typography}
              navigation={navigation}
              archivingAgentId={archivingAgentId}
              onArchiveAgent={onArchiveAgent}
            />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Orchestrator anchored row with interactive expand/collapse toggle for children.
 * Renders as a clean tree row (no card wrapper) with guide connector (#409).
 */
export function OrchestratorRow({
  node,
  colors,
  typography,
  navigation,
  archivingAgentId,
  onArchiveAgent,
  isExpanded = true,
  onToggleExpand,
  hasChildren = false,
  childCount = 0,
  isLast = false,
}: {
  node: UppidiAgentTreeNode;
  colors: any;
  typography: any;
  navigation?: PluginSurfaceProps["navigation"];
  archivingAgentId?: string | null;
  onArchiveAgent: (id: string) => Promise<void> | void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  hasChildren?: boolean;
  childCount?: number;
  isLast?: boolean;
}) {
  const { alpha } = usePluginTheme();
  const [isHovered, setIsHovered] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const agent = node.agent;
  const stateConfig = getDeterministicStateConfig(agent.deterministicState, agent.category);
  const worktree = agent.worktree || extractAgentWorktree(agent);

  // Collect all child agents under this orchestrator (#410)
  const childAgents = useMemo(() => {
    const list: UppidiAgent[] = [];
    function collect(children?: UppidiAgentTreeNode[]) {
      if (!children) return;
      for (const c of children) {
        list.push(c.agent);
        if (c.children?.length) collect(c.children);
      }
    }
    collect(node.children);
    return list;
  }, [node.children]);

  return (
    <View
      // @ts-ignore RN web hover
      onMouseEnter={() => setIsHovered(true)}
      // @ts-ignore RN web hover
      onMouseLeave={() => setIsHovered(false)}
      style={{
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
        backgroundColor: isHovered
          ? (alpha?.(colors.accent, 0.05) || colors.surface1 || "rgba(255,255,255,0.04)")
          : "transparent",
        overflow: "visible",
      }}
    >
      <Row justify="space-between" align="center" wrap gap="xs" style={{ overflow: "visible" }}>
        {/* Left: Guide connector, Expand toggle, Indicator, Icon, Title Link, Badges */}
        <Row align="center" gap="xs" style={{ flexShrink: 1, minWidth: 200, overflow: "visible" }}>
          <View
            style={{
              width: 18,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 2,
            }}
          >
            <Text
              style={{
                color: colors.foregroundMuted,
                fontFamily: "monospace",
                fontSize: 11,
                opacity: 0.65,
              }}
            >
              {isLast ? "└──" : "├──"}
            </Text>
          </View>

          {hasChildren && onToggleExpand ? (
            <InteractiveRow
              onPress={onToggleExpand}
              pressedOpacity={0.6}
              style={{
                padding: 2,
                marginRight: 2,
              }}
              accessibilityRole="button"
              accessibilityLabel={`${isExpanded ? "Collapse" : "Expand"} subagents of ${agent.name}`}
            >
              <Icon
                name={isExpanded ? "ChevronDown" : "ChevronRight"}
                size={14}
                color={colors.foregroundMuted}
              />
            </InteractiveRow>
          ) : (
            <View style={{ width: 14 }} />
          )}

          <AgentStatusLight agent={agent} navigation={navigation} size={8} />
          <Icon name="Network" size={15} color={stateConfig.color} />
          <AgentTitleLink
            agent={agent}
            colors={colors}
            typography={typography}
            navigation={navigation}
          />
          <Badge
            label={agent.shortId}
            variant="neutral"
            size="sm"
            textStyle={{ fontFamily: "monospace", fontSize: 10, letterSpacing: 0.2 }}
          />
          <Badge label="Orchestrator" variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
          <ParentAgentPill agent={agent} navigation={navigation} />
          <AgentLabelsRow agent={agent} />
          {agent.isMainDirty && (
            <InteractiveRow
              accessibilityRole="button"
              accessibilityLabel={`Main workspace dirty (${agent.mainDirtySummary || "uncommitted changes"})`}
              title={`Main workspace has uncommitted changes (${agent.mainDirtySummary || "dirty"}). Click to open orchestrator.`}
              onPress={(e) => {
                e?.stopPropagation?.();
                if (navigation?.openAgent) {
                  navigation.openAgent({ agentId: agent.id });
                }
              }}
              pressedOpacity={0.7}
              style={{
                paddingHorizontal: 2,
                paddingVertical: 1,
              }}
            >
              <Badge
                label={`● Main Dirty${agent.mainDirtySummary ? `: ${agent.mainDirtySummary}` : ""}`}
                variant="warning"
                size="sm"
                textStyle={{ fontSize: 10, fontWeight: "600" }}
              />
            </InteractiveRow>
          )}
          {!isExpanded && hasChildren && childCount > 0 && (
            <Badge
              label={`${childCount} subagent${childCount === 1 ? "" : "s"}`}
              variant="neutral"
              size="sm"
              textStyle={{ fontSize: 10 }}
            />
          )}

          {/* Child agent status lights side by side (#410) */}
          {childAgents.length > 0 && (
            <Row align="center" gap="xs" style={{ marginLeft: 4, alignItems: "center", overflow: "visible" }}>
              <AgentStatusLightsRow
                agents={childAgents}
                navigation={navigation}
                size={7}
              />
            </Row>
          )}
        </Row>

        {/* Right: State, Model, Worktree, Activity, Archive */}
        <Row align="center" wrap gap="xs">
          <Badge
            label={`${agent.deterministicState}${agent.stateDetail ? `: ${agent.stateDetail}` : ""}`}
            variant={stateConfig.badgeVariant}
            size="sm"
            dot
            style={{ borderColor: stateConfig.color }}
            textStyle={{ fontSize: 10 }}
          />

          {agent.model && (
            <Badge label={agent.model} variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
          )}

          {worktree && (
            <Badge
              label={worktree}
              variant="neutral"
              size="sm"
              textStyle={{ fontFamily: "monospace", fontSize: 10 }}
            />
          )}

          {agent.lastActivityAt && (
            <Text
              numberOfLines={1}
              style={{
                color: colors.foregroundMuted,
                ...typography.caption,
                fontSize: 11,
                flexShrink: 1,
              }}
            >
              {formatRelativeTime(agent.lastActivityAt)}
            </Text>
          )}

          <Button
            icon="Archive"
            variant="ghost"
            size="sm"
            style={{
              width: 24,
              height: 24,
              paddingHorizontal: 0,
              paddingVertical: 0,
              justifyContent: "center",
              alignItems: "center",
              borderRadius: 4,
              opacity: isHovered ? 1 : 0.7,
            }}
            accessibilityLabel={`Archive agent ${agent.name}`}
            disabled={archivingAgentId === agent.id}
            loading={archivingAgentId === agent.id}
            onPress={() => onArchiveAgent(agent.id)}
          />

          {/* Compact health gauge on the trailing edge (#560). */}
          <AgentHealthGauge
            agent={agent}
            expanded={metricsOpen}
            onToggle={() => setMetricsOpen((open) => !open)}
          />
        </Row>
      </Row>

      {/* Prominent permission / attention indicator (#534) */}
      {(agent.pendingPermissions?.length || agent.requiresAttention) && (
        <View style={{ marginTop: 2 }}>
          <AgentAttentionBanner agent={agent} />
        </View>
      )}

      {/* Expanded metrics card (#560). */}
      {metricsOpen && <AgentMetricsCard agent={agent} />}
    </View>
  );
}

/**
 * Project Group Container (#403, #409)
 * Displays top-level project, its Orchestrator(s), and dense child rows under each orchestrator.
 * Clean tree hierarchy without boxy card borders, supporting interactive expand/collapse.
 */
export function ProjectGroupCard({
  group,
  colors,
  typography,
  navigation,
  archivingAgentId,
  onArchiveAgent,
  isExpanded = true,
  onToggleExpand,
  collapsedOrchestrators,
  onToggleOrchestrator,
  onAddOrchestrator,
  onReplaceOrchestrator,
  onToggleMute,
  isActionLoading = false,
}: {
  group: ProjectAgentGroup;
  colors: any;
  typography: any;
  navigation?: PluginSurfaceProps["navigation"];
  archivingAgentId?: string | null;
  onArchiveAgent: (id: string) => Promise<void> | void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  collapsedOrchestrators?: Record<string, boolean>;
  onToggleOrchestrator?: (orchId: string) => void;
  onAddOrchestrator?: (repo: string) => Promise<void> | void;
  onReplaceOrchestrator?: (repo: string, existingAgentId?: string) => Promise<void> | void;
  onToggleMute?: (repo: string, currentlyMuted?: boolean) => Promise<void> | void;
  isActionLoading?: boolean;
}) {
  const workerCount = group.totalCount - group.orchestrators.length;

  return (
    <View
      style={{
        paddingVertical: 2,
        opacity: group.isMuted ? 0.65 : 1,
        borderLeftWidth: group.isMuted ? 2 : 0,
        borderLeftColor: group.isMuted ? colors.warning || colors.accent : "transparent",
        paddingLeft: group.isMuted ? 6 : 0,
        overflow: "visible",
      }}
    >
      <Stack gap={4}>
        {/* Project Group Header - interactive expand/collapse */}
        <InteractiveRow
          onPress={onToggleExpand}
          hoverTint
          hoverTintOpacity={0.04}
          pressedOpacity={0.75}
          style={{
            paddingHorizontal: 6,
            paddingVertical: 4,
            borderRadius: 6,
          }}
          accessibilityRole="button"
          accessibilityLabel={`${isExpanded ? "Collapse" : "Expand"} project group ${group.projectName}`}
        >
          <Row justify="space-between" align="center" wrap gap="xs">
            <Row align="center" gap="xs">
              {onToggleExpand && (
                <Icon
                  name={isExpanded ? "ChevronDown" : "ChevronRight"}
                  size={15}
                  color={colors.foregroundMuted}
                />
              )}
              <Icon name="FolderGit2" size={16} color={colors.accent} />
              <Text
                numberOfLines={1}
                style={{
                  color: colors.foreground,
                  ...typography.heading,
                  fontWeight: "700",
                  fontSize: 14,
                  flexShrink: 1,
                }}
              >
                {group.projectName}
              </Text>
              <Badge
                label={`${group.orchestrators.length} Orchestrator${
                  group.orchestrators.length === 1 ? "" : "s"
                }`}
                variant="neutral"
                size="sm"
                textStyle={{ fontSize: 10 }}
              />
              <Badge
                label={`${workerCount} Worker${workerCount === 1 ? "" : "s"}`}
                variant="neutral"
                size="sm"
                textStyle={{ fontSize: 10 }}
              />

              {/* Fleet Roster Enrolled & Detached Badges (#426) */}
              {group.isMuted && (
                <Badge
                  label="🔇 Muted"
                  variant="warning"
                  size="sm"
                  dot
                  textStyle={{ fontSize: 10, fontWeight: "700" }}
                />
              )}
              {group.isEnrolled && (
                <>
                  {!group.hasOrchestrator && (
                    <Badge label="⚪ No Orchestrator" variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
                  )}
                  {(group.queuedHooksCount ?? 0) > 0 && (
                    <Badge
                      label={`${group.queuedHooksCount} hooks queued`}
                      variant="info"
                      size="sm"
                      dot
                      textStyle={{ fontSize: 10 }}
                    />
                  )}
                </>
              )}

              {group.isDetached && (
                <Badge label="Detached / Local" variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
              )}
            </Row>

            <Row align="center" gap="xs">
              {/* Lifecycle & Muting Action Buttons (#426) */}
              {group.isEnrolled && onToggleMute && (
                <Button
                  label={group.isMuted ? "Unmute" : "Mute"}
                  icon={group.isMuted ? "Volume2" : "VolumeX"}
                  size="sm"
                  variant="ghost"
                  disabled={isActionLoading}
                  loading={isActionLoading}
                  onPress={() => onToggleMute(group.projectName, !group.isMuted)}
                />
              )}

              {group.isEnrolled && !group.hasOrchestrator && onAddOrchestrator && (
                <Button
                  label="+ Add Orchestrator"
                  icon="Plus"
                  size="sm"
                  variant="primary"
                  disabled={isActionLoading}
                  loading={isActionLoading}
                  onPress={() => onAddOrchestrator(group.projectName)}
                />
              )}

              {group.isEnrolled && group.hasOrchestrator && onReplaceOrchestrator && (
                <Button
                  label="Replace Orchestrator"
                  icon="RefreshCw"
                  size="sm"
                  variant="ghost"
                  disabled={isActionLoading}
                  loading={isActionLoading}
                  onPress={() =>
                    onReplaceOrchestrator(
                      group.projectName,
                      group.orchestrators[0]?.agent?.id
                    )
                  }
                />
              )}

              {group.runningCount > 0 && (
                <Badge
                  label={`${group.runningCount} Active`}
                  variant="success"
                  size="sm"
                  dot
                  textStyle={{ fontSize: 10 }}
                />
              )}
              {!isExpanded && (
                <Badge
                  label={`${group.totalCount} Total`}
                  variant="neutral"
                  size="sm"
                  textStyle={{ fontSize: 10 }}
                />
              )}
            </Row>
          </Row>
        </InteractiveRow>

        {/* Orchestrators & their subagents (rendered when project is expanded) */}
        {isExpanded && (
          <View
            style={{
              borderLeftWidth: 1.5,
              borderLeftColor: colors.border,
              marginLeft: 14,
              paddingLeft: 6,
              marginTop: 2,
              overflow: "visible",
            }}
          >
            {group.totalCount === 0 ? (
              <Row
                align="center"
                wrap
                gap="xs"
                style={{ paddingVertical: 8, paddingHorizontal: 6 }}
              >
                <Text
                  style={{
                    color: colors.foregroundMuted,
                    fontSize: 12,
                    fontStyle: "italic",
                    flexShrink: 1,
                  }}
                >
                  No agents active. Enrolled repository is unstaffed.
                </Text>
              </Row>
            ) : (
            <Stack gap={2}>
              {group.orchestrators.map((orchNode, orchIdx) => {
                const orchId = orchNode.agent.id;
                const isOrchExpanded = collapsedOrchestrators ? !collapsedOrchestrators[orchId] : true;
                const childCount = orchNode.children?.length ?? 0;
                const isLastOrch =
                  orchIdx === group.orchestrators.length - 1 && group.unparentedWorkers.length === 0;

                return (
                  <Stack key={orchId} gap={1}>
                    <OrchestratorRow
                      node={orchNode}
                      colors={colors}
                      typography={typography}
                      navigation={navigation}
                      archivingAgentId={archivingAgentId}
                      onArchiveAgent={onArchiveAgent}
                      hasChildren={childCount > 0}
                      isExpanded={isOrchExpanded}
                      childCount={childCount}
                      isLast={isLastOrch}
                      onToggleExpand={
                        onToggleOrchestrator ? () => onToggleOrchestrator(orchId) : undefined
                      }
                    />

                    {/* Subagents under Orchestrator - NO CARDS! */}
                    {isOrchExpanded && orchNode.children && orchNode.children.length > 0 && (
                      <View
                        style={{
                          borderLeftWidth: 1.5,
                          borderLeftColor: colors.border,
                          marginLeft: 16,
                          paddingLeft: 6,
                          marginTop: 1,
                          marginBottom: 2,
                        }}
                      >
                        {orchNode.children.map((child, idx) => (
                          <DenseAgentRow
                            key={child.agent.id}
                            node={child}
                              siblingIndex={idx}
                            depth={1}
                            isLast={idx === orchNode.children.length - 1}
                            colors={colors}
                            typography={typography}
                            navigation={navigation}
                            archivingAgentId={archivingAgentId}
                            onArchiveAgent={onArchiveAgent}
                          />
                        ))}
                      </View>
                    )}
                  </Stack>
                );
              })}

              {/* Unparented Workers in this Project (if any) */}
              {group.unparentedWorkers.length > 0 && (
                <View style={{ marginTop: 2 }}>
                  {group.unparentedWorkers.map((workerNode, idx) => (
                    <DenseAgentRow
                      key={workerNode.agent.id}
                      node={workerNode}
                        siblingIndex={idx}
                      depth={1}
                      isLast={idx === group.unparentedWorkers.length - 1}
                      colors={colors}
                      typography={typography}
                      navigation={navigation}
                      archivingAgentId={archivingAgentId}
                      onArchiveAgent={onArchiveAgent}
                    />
                  ))}
                </View>
              )}
            </Stack>
            )}
          </View>
        )}
      </Stack>
    </View>
  );
}

export type UppidiForgeTreeViewProps = UppidiFleetTreeViewProps;

export const UppidiFleetTreeView: React.FC<UppidiFleetTreeViewProps> = ({
  agentsData,
  isLoading,
  onRefresh,
  navigation,
  onArchiveAgent,
  onArchiveBulk,
  isArchiving = false,
  onCreateFrontDesk,
  onReplaceFrontDesk,
  onAddOrchestrator,
  onReplaceOrchestrator,
  onToggleRepoMute,
  selectedRepo,
  registeredFrontDeskAgentId,
}) => {
  const { colors, typography } = usePluginTheme();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [localArchivingId, setLocalArchivingId] = useState<string | null>(null);
  const [localBulkArchiving, setLocalBulkArchiving] = useState(false);
  const [frontDeskLoading, setFrontDeskLoading] = useState(false);
  const [actionLoadingRepo, setActionLoadingRepo] = useState<string | null>(null);

  // Collapsible tracking states
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [collapsedOrchestrators, setCollapsedOrchestrators] = useState<Record<string, boolean>>({});

  const archiveAgentMutation = useRpcMutation(uppidiArchiveAgentContract);
  const archiveBulkMutation = useRpcMutation(uppidiArchiveInactiveAgentsContract);
  const createFrontDeskMutation = useRpcMutation(uppidiCreateFrontDeskContract);
  const replaceFrontDeskMutation = useRpcMutation(uppidiReplaceFrontDeskContract);
  const addOrchestratorMutation = useRpcMutation(uppidiAddOrchestratorContract);
  const replaceOrchestratorMutation = useRpcMutation(uppidiReplaceOrchestratorContract);
  const toggleRepoMuteMutation = useRpcMutation(uppidiToggleRepoMuteContract);

  const isBulkArchiving = isArchiving || localBulkArchiving;
  const archivingAgentId = localArchivingId;

  const handleCreateFrontDesk = async () => {
    setFrontDeskLoading(true);
    try {
      if (onCreateFrontDesk) {
        await onCreateFrontDesk();
      } else {
        const res = await createFrontDeskMutation.mutateAsync({});
        if (res.ok) {
          toast.show(res.message || "Front Desk session created");
          onRefresh?.();
        } else {
          toast.error(res.error || "Failed to create Front Desk session");
        }
      }
    } catch (err: any) {
      toast.error(err?.message || String(err));
    } finally {
      setFrontDeskLoading(false);
    }
  };

  const handleReplaceFrontDesk = async (existingAgentId?: string) => {
    setFrontDeskLoading(true);
    try {
      if (onReplaceFrontDesk) {
        await onReplaceFrontDesk(existingAgentId);
      } else {
        const res = await replaceFrontDeskMutation.mutateAsync({ existingAgentId });
        if (res.ok) {
          toast.show(res.message || "Front Desk session replaced");
          onRefresh?.();
        } else {
          toast.error(res.error || "Failed to replace Front Desk session");
        }
      }
    } catch (err: any) {
      toast.error(err?.message || String(err));
    } finally {
      setFrontDeskLoading(false);
    }
  };

  const handleAddOrchestrator = async (repo: string) => {
    setActionLoadingRepo(repo);
    try {
      if (onAddOrchestrator) {
        await onAddOrchestrator(repo);
      } else {
        const res = await addOrchestratorMutation.mutateAsync({ repo });
        if (res.ok) {
          toast.show(res.message || `Orchestrator added for ${repo}`);
          onRefresh?.();
        } else {
          toast.error(res.error || `Failed to add orchestrator for ${repo}`);
        }
      }
    } catch (err: any) {
      toast.error(err?.message || String(err));
    } finally {
      setActionLoadingRepo(null);
    }
  };

  const handleReplaceOrchestrator = async (repo: string, existingAgentId?: string) => {
    setActionLoadingRepo(repo);
    try {
      if (onReplaceOrchestrator) {
        await onReplaceOrchestrator(repo, existingAgentId);
      } else {
        const res = await replaceOrchestratorMutation.mutateAsync({ repo, existingAgentId });
        if (res.ok) {
          toast.show(res.message || `Orchestrator replaced for ${repo}`);
        } else {
          toast.error(res.error || `Failed to replace orchestrator for ${repo}`);
        }
      }
    } catch (err: any) {
      toast.error(err?.message || String(err));
    } finally {
      onRefresh?.();
      setActionLoadingRepo(null);
    }
  };

  const handleToggleRepoMute = async (repo: string, muted?: boolean) => {
    setActionLoadingRepo(repo);
    try {
      if (onToggleRepoMute) {
        await onToggleRepoMute(repo, muted);
      } else {
        const res = await toggleRepoMuteMutation.mutateAsync({ repo, muted });
        if (res.ok) {
          toast.show(
            res.message || `Repo ${repo} ${res.isMuted ? "muted" : "unmuted"}`,
          );
          onRefresh?.();
        } else {
          toast.error(res.error || `Failed to toggle mute for ${repo}`);
        }
      }
    } catch (err: any) {
      toast.error(err?.message || String(err));
    } finally {
      setActionLoadingRepo(null);
    }
  };

  // 1. Flatten all agents to extract counts and filters
  const allAgents = useMemo(() => {
    return [
      ...toAgentArray(agentsData?.frontDesk),
      ...toAgentArray(agentsData?.orchestrators),
      ...toAgentArray(agentsData?.workers),
    ].filter((agent): agent is UppidiAgent => Boolean(agent));
  }, [agentsData]);

  // Bulk archive candidates: closed/done/failed/cancelled
  const eligibleBulkAgents = useMemo(() => {
    return filterBulkArchiveCandidates(allAgents);
  }, [allAgents]);

  const eligibleBulkCount = eligibleBulkAgents.length;

  // 2. Build full tree with proper orchestrator-to-worker nesting
  const baseTree = useMemo(() => {
    if (Array.isArray(agentsData?.tree) && agentsData.tree.length > 0) {
      return agentsData.tree;
    }
    const nodes: UppidiAgentTreeNode[] = [];
    const workers = toAgentArray(agentsData?.workers);
    const orchestrators = toAgentArray(agentsData?.orchestrators);
    const frontDesk = toAgentArray(agentsData?.frontDesk);

    for (const fd of frontDesk) {
      nodes.push({ agent: fd, depth: 0, children: [] });
    }

    const claimedWorkerIds = new Set<string>();
    for (const orch of orchestrators) {
      const orchWorktree = orch.worktree || extractAgentWorktree(orch);
      const orchProject = orch.project || extractAgentProject(orch);
      const children: UppidiAgentTreeNode[] = [];

      for (const w of workers) {
        const workerWorktree = w.worktree || extractAgentWorktree(w);
        const workerProject = w.project || extractAgentProject(w);
        if (
          (orchWorktree && workerWorktree && orchWorktree === workerWorktree) ||
          (orchProject && workerProject && orchProject === workerProject)
        ) {
          children.push({ agent: w, depth: 1, children: [] });
          claimedWorkerIds.add(w.id);
        }
      }
      nodes.push({ agent: orch, depth: 0, children });
    }

    for (const w of workers) {
      if (!claimedWorkerIds.has(w.id)) {
        nodes.push({ agent: w, depth: 0, children: [] });
      }
    }

    return nodes;
  }, [agentsData]);

  const handleArchiveAgent = async (agentId: string) => {
    try {
      setLocalArchivingId(agentId);
      if (onArchiveAgent) {
        await onArchiveAgent(agentId);
      } else {
        await archiveAgentMutation.mutate({ agentId });
        onRefresh?.();
      }
    } catch {
      // Handled by caller or silent
    } finally {
      setLocalArchivingId(null);
    }
  };

  const handleBulkArchive = async () => {
    if (eligibleBulkCount === 0 || isBulkArchiving) return;
    try {
      setLocalBulkArchiving(true);
      if (onArchiveBulk) {
        await onArchiveBulk();
      } else {
        const agentIds = eligibleBulkAgents.map((a) => a.id);
        await archiveBulkMutation.mutate({ agentIds });
        onRefresh?.();
      }
    } catch {
      // Handled by caller or silent
    } finally {
      setLocalBulkArchiving(false);
    }
  };

  // 3. Filter tree with matching predicate
  const filteredTree = useMemo(() => {
    const matches = (agent: UppidiAgent): boolean => {
      if (!agent) return false;
      // Partial RPC payloads can omit string fields; normalize before any
      // `.startsWith`/`.toLowerCase` so a missing value never throws (#510).
      const detState = String(agent.deterministicState ?? "");
      if (stateFilter !== "all") {
        if (stateFilter === "working" && detState !== "working") return false;
        if (
          stateFilter === "running" &&
          !detState.startsWith("running") &&
          detState !== "working"
        ) {
          return false;
        }
        if (
          stateFilter === "idle" &&
          !detState.startsWith("idle") &&
          detState !== "sleeping"
        ) {
          return false;
        }
        if (stateFilter === "failed" && !detState.startsWith("failed")) {
          return false;
        }
      }
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      const worktree = agent.worktree || extractAgentWorktree(agent) || "";
      const project = agent.project || extractAgentProject(agent) || "";
      return (
        String(agent.name ?? "").toLowerCase().includes(q) ||
        String(agent.shortId ?? "").toLowerCase().includes(q) ||
        detState.toLowerCase().includes(q) ||
        (agent.stateDetail && agent.stateDetail.toLowerCase().includes(q)) ||
        (agent.model && agent.model.toLowerCase().includes(q)) ||
        (agent.provider && agent.provider.toLowerCase().includes(q)) ||
        worktree.toLowerCase().includes(q) ||
        project.toLowerCase().includes(q) ||
        Boolean(agent.attributedWork?.issue && String(agent.attributedWork.issue).includes(q)) ||
        Boolean(agent.attributedWork?.slug && agent.attributedWork.slug.toLowerCase().includes(q))
      );
    };

    return filterAgentTree(baseTree, matches);
  }, [baseTree, query, stateFilter]);

  // 4. Group by Front Desk and Projects (#403, #426, #470)
  const { frontDeskNodes, staleFrontDeskNodes: filteredStaleFrontDeskNodes, enrolledGroups, detachedGroups } = useMemo(() => {
    return buildProjectGroups(filteredTree, {
      enrolledRepos: agentsData?.enrolledRepos,
      mutedRepos: agentsData?.mutedRepos,
      repoQueuedHooks: agentsData?.repoQueuedHooks,
      registeredFrontDeskAgentId,
    });
  }, [filteredTree, agentsData, registeredFrontDeskAgentId]);

  // Unfiltered Front Desk nodes for top display when filter is active (#470)
  const { primaryFrontDeskNode, staleFrontDeskNodes } = useMemo(() => {
    const result = buildProjectGroups(baseTree, {
      enrolledRepos: agentsData?.enrolledRepos,
      mutedRepos: agentsData?.mutedRepos,
      repoQueuedHooks: agentsData?.repoQueuedHooks,
      registeredFrontDeskAgentId,
    });
    return {
      primaryFrontDeskNode: result.frontDeskNodes[0] ?? null,
      staleFrontDeskNodes: result.staleFrontDeskNodes,
    };
  }, [baseTree, agentsData, registeredFrontDeskAgentId]);

  const displayEnrolled = useMemo(() => {
    let list = enrolledGroups;
    if (selectedRepo && selectedRepo !== "all") {
      list = list.filter((g) => isRepoMatching(g.projectName, selectedRepo) || g.projectName.toLowerCase() === selectedRepo.toLowerCase());
    }
    if (!query.trim() && stateFilter === "all") {
      return list;
    }
    return list.filter(
      (g) => g.allAgents.length > 0 || g.projectName.toLowerCase().includes(query.toLowerCase())
    );
  }, [query, stateFilter, enrolledGroups, selectedRepo]);

  const displayDetached = useMemo(() => {
    let list = detachedGroups;
    if (selectedRepo && selectedRepo !== "all") {
      list = list.filter((g) => isRepoMatching(g.projectName, selectedRepo) || g.projectName.toLowerCase() === selectedRepo.toLowerCase());
    }
    if (!query.trim() && stateFilter === "all") {
      return list;
    }
    return list.filter((g) => g.allAgents.length > 0);
  }, [query, stateFilter, detachedGroups, selectedRepo]);

  const totalCount = agentsData?.totalCount ?? allAgents.length;
  const runningCount = agentsData?.runningCount ?? 0;
  const idleCount = agentsData?.idleCount ?? 0;
  const errorCount = agentsData?.errorCount ?? 0;

  // When a filter is active, honor it; otherwise always show the singleton primary.
  const displayFrontDeskNode =
    query.trim() || stateFilter !== "all" ? frontDeskNodes[0] ?? null : primaryFrontDeskNode;

  // 5. Fleet Orchestrators for Front Desk Hero (#410)
  const allOrchestrators = useMemo(() => {
    const provided = toAgentArray(agentsData?.orchestrators);
    if (provided.length > 0) {
      return provided;
    }
    const list: UppidiAgent[] = [];
    for (const a of allAgents) {
      if (a.category === "orchestrator") {
        list.push(a);
      }
    }
    return list;
  }, [agentsData?.orchestrators, allAgents]);

  const displayOrchestrators = useMemo(() => {
    let base = allOrchestrators;
    if (selectedRepo && selectedRepo !== "all") {
      base = base.filter((a) => {
        const proj = a.project || extractAgentProject(a) || "";
        return isRepoMatching(proj, selectedRepo) || proj.toLowerCase() === selectedRepo.toLowerCase();
      });
    }
    if (!query.trim() && stateFilter === "all") {
      return base;
    }
    const list: UppidiAgent[] = [];
    function collect(nodes: UppidiAgentTreeNode[]) {
      if (!Array.isArray(nodes)) return;
      for (const n of nodes) {
        if (!n || !n.agent) continue;
        if (n.agent.category === "orchestrator") {
          const proj = n.agent.project || extractAgentProject(n.agent) || "";
          if (!selectedRepo || selectedRepo === "all" || isRepoMatching(proj, selectedRepo) || proj.toLowerCase() === selectedRepo.toLowerCase()) {
            list.push(n.agent);
          }
        }
        if (Array.isArray(n.children) && n.children.length > 0) {
          collect(n.children);
        }
      }
    }
    collect(filteredTree);
    return list;
  }, [query, stateFilter, filteredTree, allOrchestrators, selectedRepo]);

  // Toggle handlers for collapse
  const handleToggleProject = (projectName: string) => {
    setCollapsedProjects((prev) => ({
      ...prev,
      [projectName]: !prev[projectName],
    }));
  };

  const handleToggleOrchestrator = (orchId: string) => {
    setCollapsedOrchestrators((prev) => ({
      ...prev,
      [orchId]: !prev[orchId],
    }));
  };

  // Bulk expand/collapse for projects and orchestrators
  const allProjects = useMemo(() => {
    return [...displayEnrolled, ...displayDetached];
  }, [displayEnrolled, displayDetached]);

  const allProjectsCollapsed = useMemo(() => {
    if (allProjects.length === 0) return false;
    return allProjects.every((g) => collapsedProjects[g.projectName]);
  }, [allProjects, collapsedProjects]);

  const handleToggleAllProjects = () => {
    const shouldCollapse = !allProjectsCollapsed;
    const nextCollapsed: Record<string, boolean> = {};
    for (const g of allProjects) {
      nextCollapsed[g.projectName] = shouldCollapse;
    }
    setCollapsedProjects(nextCollapsed);
  };

  const toggleAllProjects = handleToggleAllProjects;

  const allOrchestratorsCollapsed = useMemo(() => {
    if (displayOrchestrators.length === 0) return false;
    return displayOrchestrators.every((o) => collapsedOrchestrators[o.id]);
  }, [displayOrchestrators, collapsedOrchestrators]);

  const handleToggleAllOrchestrators = () => {
    const shouldCollapse = !allOrchestratorsCollapsed;
    const nextCollapsedOrch: Record<string, boolean> = {};
    for (const o of displayOrchestrators) {
      nextCollapsedOrch[o.id] = shouldCollapse;
    }
    setCollapsedOrchestrators(nextCollapsedOrch);
  };

  const isAnyCollapsed = allProjectsCollapsed || allOrchestratorsCollapsed;
  const handleToggleAllHierarchy = () => {
    const shouldCollapse = !isAnyCollapsed;
    const allGroups = [...displayEnrolled, ...displayDetached];
    const nextCollapsedProjects: Record<string, boolean> = {};
    for (const g of allGroups) {
      nextCollapsedProjects[g.projectName] = shouldCollapse;
    }
    setCollapsedProjects(nextCollapsedProjects);

    const nextCollapsedOrch: Record<string, boolean> = {};
    for (const o of displayOrchestrators) {
      nextCollapsedOrch[o.id] = shouldCollapse;
    }
    setCollapsedOrchestrators(nextCollapsedOrch);
  };

  /**
   * The four agent states as header filters that carry their own counts.
   *
   * These were a separate row of filter buttons sitting directly under a header
   * that already showed the same four numbers as badges: one piece of
   * information stated twice, with the only control in the row that had no
   * counts. The counts and the controls are now one control (#645).
   */
  const FLEET_STATE_FILTERS = useMemo(
    () =>
      [
        { id: "all" as const, label: "Total", count: totalCount, icon: "CircleDot" },
        { id: "working" as const, label: "Running", count: runningCount, icon: "Loader" },
        // "Idle / Sleeping", not the header badge's "Idle": merging the two controls must not
        // narrow what the filter is understood to match.
        { id: "idle" as const, label: "Idle / Sleeping", count: idleCount, icon: "Moon" },
        { id: "failed" as const, label: "Failed", count: errorCount, icon: "AlertCircle" },
      ],
    [totalCount, runningCount, idleCount, errorCount],
  );

  return (
    <Stack gap={6}>
      {/* Header & Metric Badges */}
      <Row justify="space-between" align="center" wrap gap="sm" style={{ paddingVertical: 2 }}>
        <Stack gap="xxs" style={{ flex: 1 }}>
          <Row align="center" gap="sm">
            <StatusDot variant={runningCount > 0 ? "success" : "neutral"} pulse={runningCount > 0} />
            <Text
              numberOfLines={1}
              style={{
                color: colors.foreground,
                ...typography.title,
                fontSize: 15,
                // The badges beside this title carry the counts and keep their
                // pixels; the title yields. Unbounded, it adds its full 129px to
                // the header's demand, and the header shares an ancestor with the
                // hero below it — so it is a contributor to that ancestor's
                // overflow, not a row that overflows on its own.
                flexShrink: 1,
              }}
            >
              Fleet Lineage Tree
            </Text>
          </Row>
        </Stack>

      </Row>

      {/*
       * The work-queue metrics bar, replicated (#645).
       *
       * Deliberately the same container, chip anatomy and metrics as
       * surface.tsx's "Dense Metrics Bar" — same surface1 fill, 1px border,
       * radius 6, and the same icon / muted-label / bold-count chip. The
       * operator rejected an earlier version of this row for not *looking* like
       * the Queue page, so these values are copied rather than approximated and
       * a test pins them so the two cannot drift apart again.
       */}
      <Row
        wrap
        gap="xs"
        align="center"
        style={{
          backgroundColor: colors.surface1 ?? "rgba(255,255,255,0.03)",
          paddingHorizontal: 6,
          paddingVertical: 4,
          borderRadius: 6,
          borderWidth: 1,
          borderColor: colors.border ?? "transparent",
        }}
      >
        {FLEET_STATE_FILTERS.map(({ id, label, count, icon }) => {
          // A permanent "0 Failed" chip is noise; the Queue bar drops its
          // zero-count criticals the same way.
          if (count === 0 && id === "failed") return null;
          const selected = stateFilter === id;
          return (
            <React.Fragment key={id}>
              <InteractiveRow
                onPress={() => setStateFilter(id)}
                accessibilityRole="button"
                accessibilityLabel={`Filter ${label}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 4,
                  backgroundColor: selected
                    ? (colors.surface2 ?? "rgba(255,255,255,0.08)")
                    : "transparent",
                }}
                pressedOpacity={0.7}
              >
                <Icon name={icon} size={13} color={colors.foregroundMuted} />
                <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                  {label}:
                </Text>
                <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 12 }}>
                  {count}
                </Text>
              </InteractiveRow>
              <View style={{ width: 1, height: 14, backgroundColor: colors.border }} />
            </React.Fragment>
          );
        })}

        {allProjects.length > 0 && (
          <Button
            label={allProjectsCollapsed ? "Expand All" : "Collapse All"}
            icon={allProjectsCollapsed ? "ChevronDown" : "ChevronRight"}
            size="sm"
            variant="ghost"
            onPress={toggleAllProjects}
            style={{ paddingVertical: 2, minHeight: 24 }}
          />
        )}
        <Button
          label={`Archive Closed/Failed${eligibleBulkCount > 0 ? ` (${eligibleBulkCount})` : ""}`}
          icon="Archive"
          variant="secondary"
          size="sm"
          disabled={eligibleBulkCount === 0 || isBulkArchiving}
          loading={isBulkArchiving}
          onPress={handleBulkArchive}
          style={{ paddingVertical: 2, minHeight: 24 }}
        />
        <View style={{ flex: 1, minWidth: 160, maxWidth: 280 }}>
          <SearchInput
            placeholder="Search agents, projects, worktrees, #issues..."
            value={query}
            onChangeText={setQuery}
          />
        </View>
      </Row>

      {/* 1. Fleet Front Desk Hero (Elevated at Top of All) — singleton (#470) */}
      <FrontDeskHero
        node={displayFrontDeskNode}
        orchestrators={displayOrchestrators}
        colors={colors}
        typography={typography}
        navigation={navigation}
        archivingAgentId={archivingAgentId}
        onArchiveAgent={handleArchiveAgent}
        onCreateFrontDesk={handleCreateFrontDesk}
        onReplaceFrontDesk={handleReplaceFrontDesk}
        isActionLoading={frontDeskLoading}
      />

      {/* 2. Top-Level Project Groups (Enrolled Fleet Roster) */}
      {displayEnrolled.length === 0 && displayDetached.length === 0 ? (
        !displayFrontDeskNode ? (
          <EmptyState
            title={isLoading ? "Scanning fleet..." : "No matching agents"}
            description={
              isLoading
                ? "Scanning Paseo agent sessions..."
                : query.trim() || stateFilter !== "all"
                ? `No agents match filter '${stateFilter}'${
                    query.trim() ? ` or search query '${query.trim()}'` : ""
                  }.`
                : "No active agents found in the fleet."
            }
            icon="Network"
            actionLabel={query.trim() || stateFilter !== "all" ? "Clear Filters" : undefined}
            onAction={
              query.trim() || stateFilter !== "all"
                ? () => {
                    setQuery("");
                    setStateFilter("all");
                  }
                : undefined
            }
          />
        ) : null
      ) : (
        <Stack gap={8}>
          {displayEnrolled.map((group) => {
            const isProjectCollapsed =
              !query.trim() && Boolean(collapsedProjects[group.projectName]);
            return (
              <ProjectGroupCard
                key={group.projectName}
                group={group}
                colors={colors}
                typography={typography}
                navigation={navigation}
                archivingAgentId={archivingAgentId}
                onArchiveAgent={handleArchiveAgent}
                isExpanded={!isProjectCollapsed}
                onToggleExpand={() => handleToggleProject(group.projectName)}
                collapsedOrchestrators={collapsedOrchestrators}
                onToggleOrchestrator={handleToggleOrchestrator}
                onAddOrchestrator={handleAddOrchestrator}
                onReplaceOrchestrator={handleReplaceOrchestrator}
                onToggleMute={handleToggleRepoMute}
                isActionLoading={actionLoadingRepo === group.projectName}
              />
            );
          })}

          {/* 3. Detached / Local Workspaces Grouping (#426) */}
          {displayDetached.length > 0 && (
            <Stack
              gap={6}
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <Row align="center" gap="xs">
                <Icon name="FolderGit2" size={14} color={colors.foregroundMuted} />
                <Text
                  numberOfLines={1}
                  style={{
                    color: colors.foregroundMuted,
                    ...typography.caption,
                    fontWeight: "700",
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    flexShrink: 1,
                  }}
                >
                  Detached / Local Workspaces ({displayDetached.length})
                </Text>
              </Row>
              <Stack gap={8}>
                {displayDetached.map((group) => {
                  const isProjectCollapsed =
                    !query.trim() && Boolean(collapsedProjects[group.projectName]);
                  return (
                    <ProjectGroupCard
                      key={group.projectName}
                      group={group}
                      colors={colors}
                      typography={typography}
                      navigation={navigation}
                      archivingAgentId={archivingAgentId}
                      onArchiveAgent={handleArchiveAgent}
                      isExpanded={!isProjectCollapsed}
                      onToggleExpand={() => handleToggleProject(group.projectName)}
                      collapsedOrchestrators={collapsedOrchestrators}
                      onToggleOrchestrator={handleToggleOrchestrator}
                    />
                  );
                })}
              </Stack>
            </Stack>
          )}
        </Stack>
      )}

      {/* 4. Stale / Orphaned Front Desk Sessions (#470) */}
      {filteredStaleFrontDeskNodes.length > 0 && (
        <Stack
          gap={6}
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Row align="center" gap="xs">
            <Icon name="Archive" size={14} color={colors.foregroundMuted} />
            <Text
              numberOfLines={1}
              style={{
                color: colors.foregroundMuted,
                ...typography.caption,
                fontWeight: "700",
                textTransform: "uppercase",
                letterSpacing: 0.8,
                flexShrink: 1,
              }}
            >
              Stale / Orphaned Front Desk Sessions ({filteredStaleFrontDeskNodes.length})
            </Text>
          </Row>
          <Text
            style={{
              color: colors.foregroundMuted,
              ...typography.caption,
              fontSize: 11,
              flexShrink: 1,
            }}
          >
            Front Desk is a singleton. These duplicate or orphaned sessions are not registered with
            the hook daemon and can be archived during cleanup.
          </Text>
          <Stack gap={2}>
            {filteredStaleFrontDeskNodes.map((staleNode, idx) => (
              <DenseAgentRow
                key={staleNode.agent.id}
                node={staleNode}
                  siblingIndex={idx}
                depth={1}
                isLast={idx === filteredStaleFrontDeskNodes.length - 1}
                colors={colors}
                typography={typography}
                navigation={navigation}
                archivingAgentId={archivingAgentId}
                onArchiveAgent={handleArchiveAgent}
              />
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
};

export const UppidiForgeTreeView = UppidiFleetTreeView;
