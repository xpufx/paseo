import React, { useMemo, useRef, useState, useEffect } from "react";
import { Animated, Linking, Platform, Pressable, Text, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
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
  STATUS_LIGHT_GREEN,
  STATUS_LIGHT_ORANGE,
  STATUS_LIGHT_RED,
  STATUS_LIGHT_COLORS,
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
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={tooltip}
      // @ts-ignore RN web tooltip attribute
      title={tooltip}
      onPress={handlePress}
      // @ts-ignore RN web hover
      onMouseEnter={() => setHovered(true)}
      // @ts-ignore RN web hover
      onMouseLeave={() => setHovered(false)}
      style={({ pressed }: any) => ({
        padding: 2,
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        opacity: pressed ? 0.7 : 1,
        position: "relative",
        overflow: "visible",
      })}
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
            style={{
              color: colors.foreground || "#f8fafc",
              fontSize: 11,
              fontWeight: "600",
              whiteSpace: "nowrap" as any,
            } as any}
          >
            {agent.name}
          </Text>
          <Text
            style={{
              color: colors.foregroundMuted || "#94a3b8",
              fontSize: 10,
              whiteSpace: "nowrap" as any,
            } as any}
          >
            ({statusDetail})
          </Text>
        </View>
      )}
    </Pressable>
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
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open Paseo agent ${agent.name}`}
      onPress={handlePress}
      // @ts-ignore RN web hover
      onMouseEnter={() => setHovered(true)}
      // @ts-ignore RN web hover
      onMouseLeave={() => setHovered(false)}
      style={({ pressed }: any) => ({
        opacity: pressed ? 0.75 : 1,
        cursor: "pointer",
        flexShrink: 1,
      })}
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
    </Pressable>
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

/**
 * Dedicated Fleet Front Desk Header & Hero Card (#403)
 * Elevated at the top of the tree view as the fleet-wide liaison.
 * Displays interactive status lights for fleet orchestrators (#410).
 */
export function FrontDeskHero({
  nodes,
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
  nodes: UppidiAgentTreeNode[];
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
  const [secondaryExpanded, setSecondaryExpanded] = useState(false);

  if (nodes.length === 0) {
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
                  <Text style={{ color: colors.foreground, ...typography.heading, fontWeight: "700" }}>
                    Fleet Front Desk
                  </Text>
                  <Badge label="Liaison" variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
                </Row>
                <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
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
                <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
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

  const primaryNode = nodes[0];
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
                  style={{
                    color: colors.foregroundMuted,
                    fontSize: 10,
                    fontWeight: "700",
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
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
                style={{
                  color: colors.foregroundMuted,
                  ...typography.caption,
                  fontSize: 11,
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
              <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
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

        {/* If secondary front desk agents exist, render as dense rows */}
        {nodes.length > 1 && (
          <Stack gap={4} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
            <Pressable
              onPress={() => setSecondaryExpanded(!secondaryExpanded)}
              style={({ pressed }: any) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                opacity: pressed ? 0.7 : 1,
                cursor: "pointer",
                paddingVertical: 2,
              })}
              accessibilityRole="button"
              accessibilityLabel="Toggle secondary front desk sessions"
            >
              <Icon
                name={secondaryExpanded ? "ChevronDown" : "ChevronRight"}
                size={13}
                color={colors.foregroundMuted}
              />
              <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
                Secondary Front Desk Sessions ({nodes.length - 1})
              </Text>
            </Pressable>
            {secondaryExpanded &&
              nodes.slice(1).map((secNode, idx) => (
                <DenseAgentRow
                  key={secNode.agent.id}
                  node={secNode}
                  depth={1}
                  isLast={idx === nodes.length - 2}
                  colors={colors}
                  typography={typography}
                  navigation={navigation}
                  archivingAgentId={archivingAgentId}
                  onArchiveAgent={onArchiveAgent}
                />
              ))}
          </Stack>
        )}
      </Stack>
    </Card>
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open parent agent (${label})`}
        accessibilityHint="Click to open parent agent session"
        // @ts-ignore RN web title tooltip
        title={agent.parentName ? `Parent: ${agent.parentName}` : label}
        onPress={(e: any) => {
          e?.stopPropagation?.();
          navigation.openAgent?.({ agentId: agent.parentId! });
        }}
        style={({ pressed }: any) => ({
          opacity: pressed ? 0.7 : 1,
          cursor: "pointer",
        })}
      >
        {badge}
      </Pressable>
    );
  }

  return badge;
}

export interface DenseAgentRowProps {
  node: UppidiAgentTreeNode;
  depth?: number;
  isLast?: boolean;
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
  colors,
  typography,
  navigation,
  archivingAgentId,
  onArchiveAgent,
}: DenseAgentRowProps) {
  const { alpha } = usePluginTheme();
  const [isHovered, setIsHovered] = useState(false);
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
          backgroundColor: isHovered
            ? (alpha?.(colors.accent, 0.05) || colors.surface1 || "rgba(255,255,255,0.04)")
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
                style={{
                  color: colors.foregroundMuted,
                  ...typography.caption,
                  fontSize: 11,
                  lineHeight: 14,
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
          </Row>
        </Row>
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
            <Pressable
              onPress={onToggleExpand}
              style={({ pressed }: any) => ({
                opacity: pressed ? 0.6 : 1,
                cursor: "pointer",
                padding: 2,
                marginRight: 2,
              })}
              accessibilityRole="button"
              accessibilityLabel={`${isExpanded ? "Collapse" : "Expand"} subagents of ${agent.name}`}
            >
              <Icon
                name={isExpanded ? "ChevronDown" : "ChevronRight"}
                size={14}
                color={colors.foregroundMuted}
              />
            </Pressable>
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
              style={{
                color: colors.foregroundMuted,
                ...typography.caption,
                fontSize: 11,
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
        </Row>
      </Row>
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
  const { alpha } = usePluginTheme();
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const workerCount = group.totalCount - group.orchestrators.length;

  return (
    <View
      style={{
        paddingVertical: 2,
        opacity: group.isMuted ? 0.65 : 1,
        overflow: "visible",
      }}
    >
      <Stack gap={4}>
        {/* Project Group Header - interactive expand/collapse */}
        <Pressable
          onPress={onToggleExpand}
          // @ts-ignore RN web hover
          onMouseEnter={() => setIsHeaderHovered(true)}
          // @ts-ignore RN web hover
          onMouseLeave={() => setIsHeaderHovered(false)}
          style={({ pressed }: any) => ({
            paddingHorizontal: 6,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: isHeaderHovered
              ? (alpha?.(colors.accent, 0.04) || colors.surface1 || "transparent")
              : "transparent",
            opacity: pressed ? 0.75 : 1,
            cursor: (onToggleExpand ? "pointer" : "auto") as any,
          })}
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
                style={{
                  color: colors.foreground,
                  ...typography.heading,
                  fontWeight: "700",
                  fontSize: 14,
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
              {group.isEnrolled && (
                <>
                  {group.isMuted && (
                    <Badge label="Muted" variant="warning" size="sm" dot textStyle={{ fontSize: 10 }} />
                  )}
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
                  onPress={() => onToggleMute(group.projectName, group.isMuted)}
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
        </Pressable>

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
                justify="space-between"
                wrap
                gap="xs"
                style={{ paddingVertical: 8, paddingHorizontal: 6 }}
              >
                <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontStyle: "italic" }}>
                  No agents active. Enrolled repository is unstaffed.
                </Text>
                {onAddOrchestrator && (
                  <Button
                    label="+ Add Orchestrator"
                    icon="Plus"
                    size="sm"
                    variant="secondary"
                    disabled={isActionLoading}
                    loading={isActionLoading}
                    onPress={() => onAddOrchestrator(group.projectName)}
                  />
                )}
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
          toast.show(res.message || `Orchestrator spawned for ${repo}`);
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
          onRefresh?.();
        } else {
          toast.error(res.error || `Failed to replace orchestrator for ${repo}`);
        }
      }
    } catch (err: any) {
      toast.error(err?.message || String(err));
    } finally {
      setActionLoadingRepo(null);
    }
  };

  const handleToggleRepoMute = async (repo: string, currentlyMuted?: boolean) => {
    setActionLoadingRepo(repo);
    try {
      if (onToggleRepoMute) {
        await onToggleRepoMute(repo, !currentlyMuted);
      } else {
        const res = await toggleRepoMuteMutation.mutateAsync({ repo, muted: !currentlyMuted });
        if (res.ok) {
          toast.show(res.message || (res.isMuted ? `Muted repository ${repo}` : `Unmuted repository ${repo}`));
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

  // 1. Base Tree Lineage
  const baseTree = useMemo(() => {
    if (agentsData?.tree && agentsData.tree.length > 0) {
      return agentsData.tree;
    }
    // Fallback: construct from flat arrays if tree is not populated
    const fallback: UppidiAgentTreeNode[] = [];
    for (const a of agentsData?.frontDesk ?? []) {
      fallback.push({ agent: a, depth: 0, children: [] });
    }
    for (const a of agentsData?.orchestrators ?? []) {
      fallback.push({ agent: a, depth: 0, children: [] });
    }
    for (const a of agentsData?.workers ?? []) {
      fallback.push({ agent: a, depth: 0, children: [] });
    }
    return fallback;
  }, [agentsData]);

  // 2. All agents for bulk archive evaluation
  const allAgents = useMemo(() => {
    const list: UppidiAgent[] = [];
    function collect(nodes: UppidiAgentTreeNode[]) {
      for (const n of nodes) {
        list.push(n.agent);
        if (n.children && n.children.length > 0) collect(n.children);
      }
    }
    collect(baseTree);
    return list;
  }, [baseTree]);

  const eligibleBulkAgents = useMemo(() => {
    return filterBulkArchiveCandidates(allAgents);
  }, [allAgents]);

  const eligibleBulkCount = eligibleBulkAgents.length;

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
      if (stateFilter !== "all") {
        if (stateFilter === "working" && agent.deterministicState !== "working") return false;
        if (
          stateFilter === "running" &&
          !agent.deterministicState.startsWith("running") &&
          agent.deterministicState !== "working"
        ) {
          return false;
        }
        if (
          stateFilter === "idle" &&
          !agent.deterministicState.startsWith("idle") &&
          agent.deterministicState !== "sleeping"
        ) {
          return false;
        }
        if (stateFilter === "failed" && !agent.deterministicState.startsWith("failed")) {
          return false;
        }
      }
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      const worktree = agent.worktree || extractAgentWorktree(agent) || "";
      const project = agent.project || extractAgentProject(agent) || "";
      return (
        agent.name.toLowerCase().includes(q) ||
        agent.shortId.toLowerCase().includes(q) ||
        agent.deterministicState.toLowerCase().includes(q) ||
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

  // 4. Group by Front Desk and Projects (#403, #426)
  const { frontDeskNodes, enrolledGroups, detachedGroups } = useMemo(() => {
    return buildProjectGroups(filteredTree, {
      enrolledRepos: agentsData?.enrolledRepos,
      mutedRepos: agentsData?.mutedRepos,
      repoQueuedHooks: agentsData?.repoQueuedHooks,
    });
  }, [filteredTree, agentsData]);

  // Unfiltered Front Desk nodes for top display when filter is active
  const allFrontDeskNodes = useMemo(() => {
    return buildProjectGroups(baseTree, {
      enrolledRepos: agentsData?.enrolledRepos,
      mutedRepos: agentsData?.mutedRepos,
      repoQueuedHooks: agentsData?.repoQueuedHooks,
    }).frontDeskNodes;
  }, [baseTree, agentsData]);

  const displayEnrolled = useMemo(() => {
    if (!query.trim() && stateFilter === "all") {
      return enrolledGroups;
    }
    return enrolledGroups.filter(
      (g) => g.allAgents.length > 0 || g.projectName.toLowerCase().includes(query.toLowerCase())
    );
  }, [query, stateFilter, enrolledGroups]);

  const displayDetached = useMemo(() => {
    if (!query.trim() && stateFilter === "all") {
      return detachedGroups;
    }
    return detachedGroups.filter((g) => g.allAgents.length > 0);
  }, [query, stateFilter, detachedGroups]);

  const totalCount = agentsData?.totalCount ?? allAgents.length;
  const runningCount = agentsData?.runningCount ?? 0;
  const idleCount = agentsData?.idleCount ?? 0;
  const errorCount = agentsData?.errorCount ?? 0;

  const displayFrontDesk = query.trim() || stateFilter !== "all" ? frontDeskNodes : allFrontDeskNodes;

  // 5. Fleet Orchestrators for Front Desk Hero (#410)
  const allOrchestrators = useMemo(() => {
    if (agentsData?.orchestrators && agentsData.orchestrators.length > 0) {
      return agentsData.orchestrators;
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
    if (!query.trim() && stateFilter === "all") {
      return allOrchestrators;
    }
    const list: UppidiAgent[] = [];
    function collect(nodes: UppidiAgentTreeNode[]) {
      for (const n of nodes) {
        if (n.agent.category === "orchestrator") {
          list.push(n.agent);
        }
        if (n.children && n.children.length > 0) {
          collect(n.children);
        }
      }
    }
    collect(filteredTree);
    return list;
  }, [query, stateFilter, filteredTree, allOrchestrators]);

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

  const allProjects = useMemo(() => {
    return [...displayEnrolled, ...displayDetached];
  }, [displayEnrolled, displayDetached]);

  const allProjectsCollapsed = useMemo(() => {
    if (allProjects.length === 0) return false;
    return allProjects.every((g) => collapsedProjects[g.projectName]);
  }, [allProjects, collapsedProjects]);

  const toggleAllProjects = () => {
    if (allProjectsCollapsed) {
      setCollapsedProjects({});
      setCollapsedOrchestrators({});
    } else {
      const nextCollapsedProj: Record<string, boolean> = {};
      const nextCollapsedOrch: Record<string, boolean> = {};
      for (const g of allProjects) {
        nextCollapsedProj[g.projectName] = true;
        for (const o of g.orchestrators) {
          nextCollapsedOrch[o.agent.id] = true;
        }
      }
      setCollapsedProjects(nextCollapsedProj);
      setCollapsedOrchestrators(nextCollapsedOrch);
    }
  };

  return (
    <Stack gap={12}>
      {/* Header & Metric Badges */}
      <Row justify="space-between" align="center" wrap gap="sm">
        <Stack gap="xxs" style={{ flex: 1 }}>
          <Row align="center" gap="sm">
            <StatusDot variant={runningCount > 0 ? "success" : "neutral"} pulse={runningCount > 0} />
            <Text style={{ color: colors.foreground, ...typography.title }}>Fleet Lineage Tree</Text>
            <Badge label={`${totalCount} Total`} variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
            <Badge label={`${runningCount} Running`} variant="success" size="sm" dot textStyle={{ fontSize: 10 }} />
            <Badge label={`${idleCount} Idle`} variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
            {errorCount > 0 && (
              <Badge label={`${errorCount} Failed`} variant="danger" size="sm" dot textStyle={{ fontSize: 10 }} />
            )}
          </Row>
          <Text style={{ color: colors.foregroundMuted, ...typography.body }}>
            High-density project hierarchy: Fleet Front Desk, projects, orchestrators, and subagents.
          </Text>
        </Stack>
        <Row gap="xs" align="center">
          <Button
            label={`Archive Closed/Failed${eligibleBulkCount > 0 ? ` (${eligibleBulkCount})` : ""}`}
            icon="Archive"
            variant="secondary"
            disabled={eligibleBulkCount === 0 || isBulkArchiving}
            loading={isBulkArchiving}
            onPress={handleBulkArchive}
          />
          {onRefresh && (
            <Button label="Refresh Fleet" icon="RefreshCw" variant="secondary" onPress={onRefresh} />
          )}
        </Row>
      </Row>

      {/* Filter and Search Bar */}
      <Row justify="space-between" align="center" wrap gap="xs">
        <Row wrap gap="xs" align="center">
          {[
            { id: "all", label: "All States" },
            { id: "working", label: "Working" },
            { id: "idle", label: "Idle / Sleeping" },
            { id: "failed", label: "Failed" },
          ].map((f) => (
            <Button
              key={f.id}
              label={f.label}
              size="sm"
              variant={stateFilter === f.id ? "primary" : "secondary"}
              onPress={() => setStateFilter(f.id)}
            />
          ))}
          {allProjects.length > 0 && (
            <Button
              label={allProjectsCollapsed ? "Expand All" : "Collapse All"}
              icon={allProjectsCollapsed ? "ChevronDown" : "ChevronRight"}
              size="sm"
              variant="ghost"
              onPress={toggleAllProjects}
            />
          )}
        </Row>
        <View style={{ minWidth: 200, flex: 1, maxWidth: 360 }}>
          <SearchInput
            placeholder="Search agents, projects, worktrees, #issues..."
            value={query}
            onChangeText={setQuery}
          />
        </View>
      </Row>

      {/* 1. Fleet Front Desk Hero (Elevated at Top of All) */}
      <FrontDeskHero
        nodes={displayFrontDesk}
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
        displayFrontDesk.length === 0 ? (
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
                  style={{
                    color: colors.foregroundMuted,
                    ...typography.caption,
                    fontWeight: "700",
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
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
    </Stack>
  );
};

export const UppidiForgeTreeView = UppidiFleetTreeView;
