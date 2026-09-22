import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Row,
  SearchInput,
  Stack,
  StatusDot,
  usePluginTheme,
} from "paseo-plugin-helper/client";
import type {
  UppidiAgent,
  UppidiAgentTreeNode,
  DeterministicAgentState,
  UppidiAgentsOutput,
} from "../shared/contracts.js";

export interface UppidiForgeTreeViewProps {
  agentsData?: UppidiAgentsOutput;
  isLoading?: boolean;
  onRefresh?: () => void;
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

function getDeterministicBadgeVariant(
  state: DeterministicAgentState
): "success" | "danger" | "warning" | "info" | "neutral" {
  switch (state) {
    case "working":
      return "success";
    case "running":
      return "info";
    case "idle:waiting":
      return "neutral";
    case "sleeping":
      return "neutral";
    case "idle:quota-exhausted":
      return "warning";
    case "failed:quota-exhausted":
    case "failed:spawn":
    case "failed:timeout":
    case "failed:error":
      return "danger";
    default:
      return "neutral";
  }
}

function getStatusDotVariant(
  state: DeterministicAgentState
): "success" | "danger" | "warning" | "neutral" {
  switch (state) {
    case "working":
    case "running":
      return "success";
    case "idle:quota-exhausted":
      return "warning";
    case "failed:quota-exhausted":
    case "failed:spawn":
    case "failed:timeout":
    case "failed:error":
      return "danger";
    case "sleeping":
    case "idle:waiting":
    default:
      return "neutral";
  }
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
            const badgeVariant = getDeterministicBadgeVariant(agent.deterministicState);
            const dotVariant = getStatusDotVariant(agent.deterministicState);
            const isWorking = agent.deterministicState === "working";
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
                    {/* Left: Indicator, Lineage Branch Symbol, Name, Category */}
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
                      <StatusDot variant={dotVariant} pulse={isWorking} />
                      <Text
                        style={{
                          color: colors.foreground,
                          ...typography.heading,
                          fontWeight: "600",
                        }}
                      >
                        {agent.name}
                      </Text>
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
                        variant={badgeVariant}
                        size="sm"
                        dot
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
