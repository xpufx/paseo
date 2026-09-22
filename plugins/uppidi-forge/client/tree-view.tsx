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
  useRpcMutation,
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
  uppidiArchiveAgentContract,
  uppidiArchiveInactiveAgentsContract,
  extractAgentWorktree,
  extractAgentProject,
} from "../shared/contracts.js";
import {
  filterBulkArchiveCandidates,
  buildProjectGroups,
  filterAgentTree,
  type ProjectAgentGroup,
} from "../shared/sort-filter.js";

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
  onArchiveAgent?: (agentId: string) => Promise<void> | void;
  onArchiveBulk?: () => Promise<void> | void;
  isArchiving?: boolean;
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
 */
export function FrontDeskHero({
  nodes,
  colors,
  typography,
  navigation,
  archivingAgentId,
  onArchiveAgent,
}: {
  nodes: UppidiAgentTreeNode[];
  colors: any;
  typography: any;
  navigation?: PluginSurfaceProps["navigation"];
  archivingAgentId?: string | null;
  onArchiveAgent: (id: string) => Promise<void> | void;
}) {
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
        }}
      >
        <Row justify="space-between" align="center" wrap gap="sm">
          <Row align="center" gap="sm">
            <Icon name="Inbox" size={18} color={colors.foregroundMuted} />
            <Stack gap={2}>
              <Row align="center" gap="xs">
                <Text style={{ color: colors.foreground, ...typography.heading, fontWeight: "700" }}>
                  Fleet Front Desk
                </Text>
                <Badge label="Liaison" variant="neutral" size="sm" />
              </Row>
              <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                No active front desk liaison session running. Webhook events route to standbys.
              </Text>
            </Stack>
          </Row>
          <Badge label="Standby" variant="neutral" size="sm" />
        </Row>
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
      }}
    >
      <Stack gap={10}>
        <Row justify="space-between" align="center" wrap gap="sm">
          {/* Left: Status Dot, Icon, Titles & Worktree */}
          <Row align="center" gap="sm" style={{ flexShrink: 1 }}>
            <AgentStateDot
              color={primaryStateConfig.color}
              pulse={primaryStateConfig.pulse}
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
                    letterSpacing: 0.5,
                    textTransform: "uppercase",
                  }}
                >
                  Fleet Front Desk
                </Text>
                <Badge label="Liaison" variant="neutral" size="sm" />
              </Row>
              <Row align="center" gap="xs" wrap style={{ flexShrink: 1 }}>
                <AgentTitleLink
                  agent={primaryAgent}
                  colors={colors}
                  typography={typography}
                  navigation={navigation}
                />
                <Badge label={primaryAgent.shortId} variant="neutral" size="sm" />
                {primaryWorktree && (
                  <Badge label={primaryWorktree} variant="neutral" size="sm" />
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
            />

            {primaryAgent.model && (
              <Badge label={primaryAgent.model} variant="neutral" size="sm" />
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

            <Button
              icon="Archive"
              variant="ghost"
              size="sm"
              accessibilityLabel={`Archive front desk agent ${primaryAgent.name}`}
              disabled={archivingAgentId === primaryAgent.id}
              loading={archivingAgentId === primaryAgent.id}
              onPress={() => onArchiveAgent(primaryAgent.id)}
            />
          </Row>
        </Row>

        {/* If secondary front desk agents exist, render as dense rows */}
        {nodes.length > 1 && (
          <Stack gap={4} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontWeight: "600" }}>
              Secondary Front Desk Sessions ({nodes.length - 1})
            </Text>
            {nodes.slice(1).map((secNode, idx) => (
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
  const agent = node.agent;
  const stateConfig = getDeterministicStateConfig(agent.deterministicState, agent.category);
  const worktree = agent.worktree || extractAgentWorktree(agent);
  const indentPadding = Math.min((depth - 1) * 18, 72);

  return (
    <View
      key={agent.id}
      style={{
        paddingLeft: indentPadding,
        paddingVertical: 2,
      }}
    >
      <View
        style={{
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: 4,
          backgroundColor: "transparent",
        }}
      >
        <Row justify="space-between" align="center" wrap gap="xs">
          {/* Left side: Guide connector, status dot, icon, title, shortId */}
          <Row align="center" gap="xs" style={{ flexShrink: 1, minWidth: 200 }}>
            <Text
              style={{
                color: colors.foregroundMuted,
                fontFamily: "monospace",
                fontSize: 12,
                opacity: 0.7,
                marginRight: 2,
              }}
            >
              {isLast ? "└─" : "├─"}
            </Text>
            <AgentStateDot color={stateConfig.color} pulse={stateConfig.pulse} size={7} />
            <Icon name={stateConfig.categoryIcon} size={13} color={stateConfig.color} />
            <AgentTitleLink
              agent={agent}
              colors={colors}
              typography={typography}
              navigation={navigation}
            />
            <Badge label={agent.shortId} variant="neutral" size="sm" />
            {agent.category !== "worker" && (
              <Badge label={agent.category} variant="neutral" size="sm" />
            )}
          </Row>

          {/* Right side: State badge, Model, Issue, Worktree, Time, Archive */}
          <Row align="center" wrap gap="xs">
            <Badge
              label={`${agent.deterministicState}${agent.stateDetail ? `: ${agent.stateDetail}` : ""}`}
              variant={stateConfig.badgeVariant}
              size="sm"
              dot
              style={{ borderColor: stateConfig.color }}
            />

            {agent.model && <Badge label={agent.model} variant="neutral" size="sm" />}

            {agent.attributedWork?.issue && (
              <Badge label={`#${agent.attributedWork.issue}`} variant="info" size="sm" />
            )}

            {worktree && <Badge label={worktree} variant="neutral" size="sm" />}

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
        <Stack gap={1} style={{ marginTop: 1 }}>
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
        </Stack>
      )}
    </View>
  );
}

/**
 * Orchestrator anchored row.
 */
export function OrchestratorRow({
  node,
  colors,
  typography,
  navigation,
  archivingAgentId,
  onArchiveAgent,
}: {
  node: UppidiAgentTreeNode;
  colors: any;
  typography: any;
  navigation?: PluginSurfaceProps["navigation"];
  archivingAgentId?: string | null;
  onArchiveAgent: (id: string) => Promise<void> | void;
}) {
  const agent = node.agent;
  const stateConfig = getDeterministicStateConfig(agent.deterministicState, agent.category);
  const worktree = agent.worktree || extractAgentWorktree(agent);

  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 6,
        backgroundColor: colors.surface0 ?? "transparent",
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Row justify="space-between" align="center" wrap gap="xs">
        {/* Left: Indicator, Icon, Title Link, Badges */}
        <Row align="center" gap="xs" style={{ flexShrink: 1, minWidth: 200 }}>
          <AgentStateDot color={stateConfig.color} pulse={stateConfig.pulse} size={8} />
          <Icon name="Network" size={15} color={stateConfig.color} />
          <AgentTitleLink
            agent={agent}
            colors={colors}
            typography={typography}
            navigation={navigation}
          />
          <Badge label={agent.shortId} variant="neutral" size="sm" />
          <Badge label="Orchestrator" variant="neutral" size="sm" />
        </Row>

        {/* Right: State, Model, Worktree, Activity, Archive */}
        <Row align="center" wrap gap="xs">
          <Badge
            label={`${agent.deterministicState}${agent.stateDetail ? `: ${agent.stateDetail}` : ""}`}
            variant={stateConfig.badgeVariant}
            size="sm"
            dot
            style={{ borderColor: stateConfig.color }}
          />

          {agent.model && <Badge label={agent.model} variant="neutral" size="sm" />}

          {worktree && <Badge label={worktree} variant="neutral" size="sm" />}

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
 * Project Group Container (#403)
 * Displays top-level project, its Orchestrator(s), and dense child rows under each orchestrator.
 */
export function ProjectGroupCard({
  group,
  colors,
  typography,
  navigation,
  archivingAgentId,
  onArchiveAgent,
}: {
  group: ProjectAgentGroup;
  colors: any;
  typography: any;
  navigation?: PluginSurfaceProps["navigation"];
  archivingAgentId?: string | null;
  onArchiveAgent: (id: string) => Promise<void> | void;
}) {
  const workerCount = group.totalCount - group.orchestrators.length;

  return (
    <Card
      variant="flat"
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
      }}
    >
      <Stack gap={8}>
        {/* Project Group Header */}
        <Row justify="space-between" align="center" wrap gap="xs">
          <Row align="center" gap="xs">
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
            />
            <Badge
              label={`${workerCount} Worker${workerCount === 1 ? "" : "s"}`}
              variant="neutral"
              size="sm"
            />
          </Row>
          {group.runningCount > 0 && (
            <Badge
              label={`${group.runningCount} Active`}
              variant="success"
              size="sm"
              dot
            />
          )}
        </Row>

        {/* Orchestrators & their subagents */}
        <Stack gap={6}>
          {group.orchestrators.map((orchNode) => (
            <Stack key={orchNode.agent.id} gap={3}>
              <OrchestratorRow
                node={orchNode}
                colors={colors}
                typography={typography}
                navigation={navigation}
                archivingAgentId={archivingAgentId}
                onArchiveAgent={onArchiveAgent}
              />

              {/* Subagents under Orchestrator - NO CARDS! */}
              {orchNode.children && orchNode.children.length > 0 && (
                <View
                  style={{
                    paddingLeft: 8,
                    borderLeftWidth: 2,
                    borderLeftColor: colors.border,
                    marginLeft: 10,
                    marginTop: 2,
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
          ))}

          {/* Unparented Workers in this Project (if any) */}
          {group.unparentedWorkers.length > 0 && (
            <View
              style={{
                paddingLeft: 8,
                borderLeftWidth: 2,
                borderLeftColor: colors.border,
                marginLeft: 10,
                marginTop: 2,
              }}
            >
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
      </Stack>
    </Card>
  );
}

export const UppidiForgeTreeView: React.FC<UppidiForgeTreeViewProps> = ({
  agentsData,
  isLoading,
  onRefresh,
  navigation,
  onArchiveAgent,
  onArchiveBulk,
  isArchiving = false,
}) => {
  const { colors, typography } = usePluginTheme();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [localArchivingId, setLocalArchivingId] = useState<string | null>(null);
  const [localBulkArchiving, setLocalBulkArchiving] = useState(false);

  const archiveAgentMutation = useRpcMutation(uppidiArchiveAgentContract);
  const archiveBulkMutation = useRpcMutation(uppidiArchiveInactiveAgentsContract);

  const isBulkArchiving = isArchiving || localBulkArchiving;
  const archivingAgentId = localArchivingId;

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

  // 4. Group by Front Desk and Projects (#403)
  const { frontDeskNodes, projectGroups } = useMemo(() => {
    return buildProjectGroups(filteredTree);
  }, [filteredTree]);

  // Unfiltered Front Desk nodes for top display when filter is active
  const allFrontDeskNodes = useMemo(() => {
    return baseTree.filter((n) => n.agent.category === "front-desk");
  }, [baseTree]);

  const totalCount = agentsData?.totalCount ?? allAgents.length;
  const runningCount = agentsData?.runningCount ?? 0;
  const idleCount = agentsData?.idleCount ?? 0;
  const errorCount = agentsData?.errorCount ?? 0;

  const displayFrontDesk = query.trim() || stateFilter !== "all" ? frontDeskNodes : allFrontDeskNodes;

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
            placeholder="Search agents, projects, worktrees, #issues..."
            value={query}
            onChangeText={setQuery}
          />
        </View>
      </Row>

      {/* 1. Fleet Front Desk Hero (Elevated at Top of All) */}
      <FrontDeskHero
        nodes={displayFrontDesk}
        colors={colors}
        typography={typography}
        navigation={navigation}
        archivingAgentId={archivingAgentId}
        onArchiveAgent={handleArchiveAgent}
      />

      {/* 2. Top-Level Project Groups with Dense Non-Card Children */}
      {projectGroups.length === 0 ? (
        displayFrontDesk.length === 0 && (
          <EmptyState
            title={isLoading ? "Loading fleet tree..." : "No matching agents"}
            description={
              isLoading
                ? "Scanning Paseo agent sessions..."
                : "No active agents match the selected search or state filters."
            }
            icon="Network"
          />
        )
      ) : (
        <Stack gap={8}>
          {projectGroups.map((group) => (
            <ProjectGroupCard
              key={group.projectName}
              group={group}
              colors={colors}
              typography={typography}
              navigation={navigation}
              archivingAgentId={archivingAgentId}
              onArchiveAgent={handleArchiveAgent}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
};
