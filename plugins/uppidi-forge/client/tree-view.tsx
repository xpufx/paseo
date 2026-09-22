import React, { useMemo, useRef, useState } from "react";
import { Animated, Linking, Pressable, Text, View } from "react-native";
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
} from "paseo-plugin-helper/client";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  type UppidiAgent,
  type UppidiAgentTreeNode,
  type DeterministicAgentState,
  type UppidiAgentsOutput,
  type DeterministicStateConfig,
  getAgentCategoryIcon,
  getDeterministicStateConfig,
} from "../shared/contracts.js";

export {
  type DeterministicStateConfig,
  getAgentCategoryIcon,
  getDeterministicStateConfig,
};

export interface UppidiForgeTreeViewProps {
  agentsData?: UppidiAgentsOutput;
  isLoading?: boolean;
  onRefresh?: () => void;
  navigation?: PluginSurfaceProps["navigation"];
}

interface FlattenedNode {
  agent: UppidiAgent;
  depth: number;
}

function flattenTree(nodes: UppidiAgentTreeNode[], currentDepth = 0): FlattenedNode[] {
  const result: FlattenedNode[] = [];
  for (const node of nodes) {
    result.push({ agent: node.agent, depth: node.depth ?? currentDepth });
    if (node.children && node.children.length > 0) {
      result.push(...flattenTree(node.children, (node.depth ?? currentDepth) + 1));
    }
  }
  return result;
}

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

  React.useEffect(() => {
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
}

export function AgentTitleLink({
  agent,
  colors,
  typography,
  navigation,
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
          ...typography.heading,
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

function formatRelativeTime(dateStr?: string | null): string {
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

export const UppidiForgeTreeView: React.FC<UppidiForgeTreeViewProps> = ({
  agentsData,
  isLoading,
  onRefresh,
  navigation,
}) => {
  const { colors, typography } = usePluginTheme();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");

  const flattenedNodes = useMemo(() => {
    if (agentsData?.tree && agentsData.tree.length > 0) {
      return flattenTree(agentsData.tree);
    }
    // Fallback: construct from categorized arrays if tree is not populated
    const fallback: FlattenedNode[] = [];
    for (const a of agentsData?.frontDesk ?? []) {
      fallback.push({ agent: a, depth: 0 });
    }
    for (const a of agentsData?.orchestrators ?? []) {
      fallback.push({ agent: a, depth: 1 });
    }
    for (const a of agentsData?.workers ?? []) {
      fallback.push({ agent: a, depth: 2 });
    }
    return fallback;
  }, [agentsData]);

  const filteredNodes = useMemo(() => {
    return flattenedNodes.filter(({ agent }) => {
      if (stateFilter !== "all") {
        if (stateFilter === "working" && agent.deterministicState !== "working") return false;
        if (stateFilter === "running" && !agent.deterministicState.startsWith("running") && agent.deterministicState !== "working") return false;
        if (stateFilter === "idle" && !agent.deterministicState.startsWith("idle") && agent.deterministicState !== "sleeping") return false;
        if (stateFilter === "failed" && !agent.deterministicState.startsWith("failed")) return false;
      }
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        agent.name.toLowerCase().includes(q) ||
        agent.shortId.toLowerCase().includes(q) ||
        agent.deterministicState.toLowerCase().includes(q) ||
        (agent.stateDetail && agent.stateDetail.toLowerCase().includes(q)) ||
        (agent.model && agent.model.toLowerCase().includes(q)) ||
        (agent.provider && agent.provider.toLowerCase().includes(q)) ||
        (agent.attributedWork?.issue && String(agent.attributedWork.issue).includes(q)) ||
        (agent.attributedWork?.slug && agent.attributedWork.slug.toLowerCase().includes(q))
      );
    });
  }, [flattenedNodes, query, stateFilter]);

  const totalCount = agentsData?.totalCount ?? 0;
  const runningCount = agentsData?.runningCount ?? 0;
  const idleCount = agentsData?.idleCount ?? 0;
  const errorCount = agentsData?.errorCount ?? 0;

  return (
    <Stack gap={12}>
      {/* Header & Metric Badges */}
      <Row justify="space-between" align="center" wrap gap="sm">
        <Stack gap="xxs" style={{ flex: 1 }}>
          <Row align="center" gap="sm">
            <StatusDot variant={runningCount > 0 ? "success" : "neutral"} pulse={runningCount > 0} />
            <Text style={{ color: colors.foreground, ...typography.title }}>Fleet Lineage Tree</Text>
            <Badge label={`${totalCount} Total`} variant="neutral" size="sm" />
            <Badge label={`${runningCount} Running`} variant="success" size="sm" dot />
            <Badge label={`${idleCount} Idle`} variant="neutral" size="sm" />
            {errorCount > 0 && <Badge label={`${errorCount} Failed`} variant="danger" size="sm" dot />}
          </Row>
          <Text style={{ color: colors.foregroundMuted, ...typography.body }}>
            Hierarchical parent-child lineage with deterministic computable states.
          </Text>
        </Stack>
        {onRefresh && (
          <Button label="Refresh Fleet" icon="RefreshCw" variant="secondary" onPress={onRefresh} />
        )}
      </Row>

      {/* Filter and Search Bar */}
      <Row justify="space-between" align="center" wrap gap="xs">
        <Row wrap gap="xs">
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
        </Row>
        <View style={{ minWidth: 200, flex: 1, maxWidth: 360 }}>
          <SearchInput
            placeholder="Search agents, models, #issues..."
            value={query}
            onChangeText={setQuery}
          />
        </View>
      </Row>

      {/* Tree Content */}
      {filteredNodes.length === 0 ? (
        <EmptyState
          title={isLoading ? "Loading fleet tree..." : "No matching agents"}
          description={
            isLoading
              ? "Scanning Paseo agent sessions..."
              : "No active agents match the selected search or state filters."
          }
          icon="Network"
        />
      ) : (
        <Stack gap={6}>
          {filteredNodes.map(({ agent, depth }) => {
            const stateConfig = getDeterministicStateConfig(
              agent.deterministicState,
              agent.category
            );
            const indentPadding = Math.min(depth * 22, 110);

            return (
              <View
                key={agent.id}
                style={{
                  paddingLeft: indentPadding,
                }}
              >
                <Card
                  variant="elevated"
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderLeftWidth: depth > 0 ? 3 : 1,
                    borderLeftColor:
                      depth === 0
                        ? colors.accent
                        : depth === 1
                        ? colors.foreground
                        : colors.foregroundMuted,
                  }}
                >
                  <Row justify="space-between" align="center" wrap gap="xs">
                    {/* Left: Indicator, Lineage Branch Symbol, Icon, Title Link, Badges */}
                    <Row align="center" gap="xs" style={{ flexShrink: 1 }}>
                      {depth > 0 && (
                        <Text
                          style={{
                            color: colors.foregroundMuted,
                            fontFamily: "monospace",
                            fontSize: 12,
                            marginRight: 2,
                          }}
                        >
                          {"└─"}
                        </Text>
                      )}
                      <AgentStateDot
                        color={stateConfig.color}
                        pulse={stateConfig.pulse}
                      />
                      <Icon
                        name={stateConfig.categoryIcon}
                        size={14}
                        color={stateConfig.color}
                      />
                      <AgentTitleLink
                        agent={agent}
                        colors={colors}
                        typography={typography}
                        navigation={navigation}
                      />
                      <Badge label={agent.shortId} variant="neutral" size="sm" />
                      <Badge label={agent.category} variant="neutral" size="sm" />
                    </Row>

                    {/* Right: Deterministic State Badge, Model, Attribution, Timing */}
                    <Row align="center" wrap gap="xs">
                      {/* Deterministic State Badge */}
                      <Badge
                        label={`${agent.deterministicState}${
                          agent.stateDetail ? `: ${agent.stateDetail}` : ""
                        }`}
                        variant={stateConfig.badgeVariant}
                        size="sm"
                        dot
                        style={{ borderColor: stateConfig.color }}
                      />

                      {/* Model Pill */}
                      {agent.model && (
                        <Badge label={agent.model} variant="neutral" size="sm" />
                      )}

                      {/* Attributed Work Pill */}
                      {agent.attributedWork?.issue && (
                        <Badge
                          label={`#${agent.attributedWork.issue}`}
                          variant="info"
                          size="sm"
                        />
                      )}

                      {/* Relative Activity Timestamp */}
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
                    </Row>
                  </Row>
                </Card>
              </View>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
};
