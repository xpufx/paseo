import React, { useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  ActionBar,
  Badge,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  Collapsible,
  DataTable,
  EmptyState,
  Grid,
  Icon,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  Row,
  SearchInput,
  Stack,
  StatusDot,
  Tabs,
  usePluginTheme,
  useRpcQuery,
  useRpcMutation,
} from "paseo-plugin-helper/client";
import {
  uppidiIssuesContract,
  uppidiHookStatusContract,
  uppidiHookQueuesContract,
  uppidiHookPauseContract,
  uppidiHookResumeContract,
  uppidiHookDrainContract,
  uppidiHookServiceStatusContract,
  uppidiHookServiceActionContract,
  uppidiHookLogTailContract,
  uppidiAgentsContract,
  uppidiRoleModelsContract,
  uppidiSetRoleModelContract,
  uppidiRunnersContract,
  uppidiFleetMetricsContract,
  type UppidiIssue,
  type AttentionLabel,
  type UppidiAgent,
  type RoleModelConfig,
  type UppidiRunner,
  type CandidateModelMetrics,
  type TaskProfileMetrics,
} from "../shared/contracts.js";
import {
  filterIssues,
  sortIssues,
  filterQueues,
  sortQueues,
  filterAgents,
  sortAgents,
  filterRunners,
  sortRunners,
  filterMetricCandidates,
  sortMetricCandidates,
  type IssuePreset,
  type IssueSortField,
  type QueuePreset,
  type QueueSortField,
  type AgentPreset,
  type AgentSortField,
  type RunnerPreset,
  type RunnerSortField,
  type MetricPreset,
  type MetricSortField,
  type SortDirection,
} from "../shared/sort-filter.js";
import { UppidiForgeStaticMockup } from "./static-mockup";
import {
  UppidiForgeTreeView,
  AgentStateDot,
  AgentTitleLink,
  getDeterministicStateConfig,
} from "./tree-view";

type SurfaceTab = "dashboard" | "tree" | "mockup";

const issuePresetFilters: Array<{ id: IssuePreset; label: string }> = [
  { id: "all", label: "All work" },
  { id: "needs-attention", label: "Needs Attention" },
  { id: "triage-review", label: "Triage / Review" },
  { id: "in-progress", label: "In Progress" },
  { id: "verify", label: "Verify" },
];

const tabs = [
  { id: "dashboard", label: "Dashboard", shortLabel: "Dashboard", icon: "LayoutDashboard" },
  { id: "tree", label: "Fleet Tree", shortLabel: "Tree", icon: "FolderTree" },
  { id: "mockup", label: "Static mockup", shortLabel: "Mockup", icon: "PanelTop" },
];

const attentionMap: Record<AttentionLabel, string> = {
  "attention/0-orchestrator": "Orchestrator",
  "attention/1-agent": "Agent",
  "attention/2-user": "You",
};

function statusVariant(status: UppidiIssue["status"]): "neutral" | "warning" | "info" | "success" {
  switch (status) {
    case "Review":
      return "warning";
    case "In progress":
      return "info";
    case "Done":
      return "success";
    default:
      return "neutral";
  }
}

export function UppidiForgeSurface(props: PluginSurfaceProps) {
  const { colors, typography } = usePluginTheme();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<SurfaceTab>("dashboard");

  // Section 1: Issues sort & filter state
  const [filter, setFilter] = useState<IssuePreset>("all");
  const [query, setQuery] = useState("");
  const [issueSortField, setIssueSortField] = useState<IssueSortField>("number");
  const [issueSortDir, setIssueSortDir] = useState<SortDirection>("desc");
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);

  // Section 2: Hook Queues sort & filter state
  const [hookServiceExpanded, setHookServiceExpanded] = useState(false);
  const [hookQueuesExpanded, setHookQueuesExpanded] = useState(false);
  const [queuePreset, setQueuePreset] = useState<QueuePreset>("all");
  const [queueQuery, setQueueQuery] = useState("");
  const [queueSortField, setQueueSortField] = useState<QueueSortField>("repo");
  const [queueSortDir, setQueueSortDir] = useState<SortDirection>("asc");
  const [hookLogExpanded, setHookLogExpanded] = useState(false);

  // Section 3: Fleet & Agents sort & filter state
  const [fleetExpanded, setFleetExpanded] = useState(true);
  const [agentPreset, setAgentPreset] = useState<AgentPreset>("all");
  const [agentQuery, setAgentQuery] = useState("");
  const [agentSortField, setAgentSortField] = useState<AgentSortField>("name");
  const [agentSortDir, setAgentSortDir] = useState<SortDirection>("asc");
  const [frontDeskExpanded, setFrontDeskExpanded] = useState(true);
  const [orchestratorsExpanded, setOrchestratorsExpanded] = useState(true);
  const [workersExpanded, setWorkersExpanded] = useState(false);
  const [roleModelsExpanded, setRoleModelsExpanded] = useState(false);

  // Section 4: CI Runners sort & filter state
  const [runnersExpanded, setRunnersExpanded] = useState(false);
  const [runnerPreset, setRunnerPreset] = useState<RunnerPreset>("all");
  const [runnerQuery, setRunnerQuery] = useState("");
  const [runnerSortField, setRunnerSortField] = useState<RunnerSortField>("name");
  const [runnerSortDir, setRunnerSortDir] = useState<SortDirection>("asc");

  // Section 5: Fleet Capability & Benchmark Matrix sort & filter state
  const [metricsExpanded, setMetricsExpanded] = useState(false);
  const [metricPreset, setMetricPreset] = useState<MetricPreset>("all");
  const [metricQuery, setMetricQuery] = useState("");
  const [metricSortField, setMetricSortField] = useState<MetricSortField>("passRate");
  const [metricSortDir, setMetricSortDir] = useState<SortDirection>("desc");

  // Live RPC queries with polling
  const {
    data: issuesData,
    isLoading: issuesLoading,
    refetch: refetchIssues,
  } = useRpcQuery(uppidiIssuesContract, { state: "open" }, { refetchInterval: 10000 });

  const {
    data: hookStatus,
    refetch: refetchHookStatus,
  } = useRpcQuery(uppidiHookStatusContract, {}, { refetchInterval: 5000 });

  const {
    data: hookQueues,
    refetch: refetchHookQueues,
  } = useRpcQuery(uppidiHookQueuesContract, {}, { refetchInterval: 5000 });

  const {
    data: serviceStatus,
    refetch: refetchServiceStatus,
  } = useRpcQuery(uppidiHookServiceStatusContract, {}, { refetchInterval: 10000 });

  const {
    data: logTail,
    refetch: refetchLogTail,
  } = useRpcQuery(uppidiHookLogTailContract, { lines: 40 }, { refetchInterval: 5000 });

  const {
    data: agentsData,
    isLoading: agentsLoading,
    refetch: refetchAgents,
  } = useRpcQuery(uppidiAgentsContract, {}, { refetchInterval: 5000 });

  const {
    data: roleModelsData,
    refetch: refetchRoleModels,
  } = useRpcQuery(uppidiRoleModelsContract, {}, { refetchInterval: 10000 });

  const {
    data: runnersData,
    refetch: refetchRunners,
  } = useRpcQuery(uppidiRunnersContract, {}, { refetchInterval: 15000 });

  const {
    data: metricsData,
    refetch: refetchMetrics,
  } = useRpcQuery(uppidiFleetMetricsContract, {}, { refetchInterval: 15000 });

  // Mutations
  const pauseMutation = useRpcMutation(uppidiHookPauseContract);
  const resumeMutation = useRpcMutation(uppidiHookResumeContract);
  const drainMutation = useRpcMutation(uppidiHookDrainContract);
  const serviceActionMutation = useRpcMutation(uppidiHookServiceActionContract);
  const setRoleModelMutation = useRpcMutation(uppidiSetRoleModelContract);

  const refetchAll = () => {
    void refetchIssues();
    void refetchHookStatus();
    void refetchHookQueues();
    void refetchServiceStatus();
    void refetchLogTail();
    void refetchAgents();
    void refetchRoleModels();
    void refetchRunners();
    void refetchMetrics();
    toast.show("Dashboard refreshed");
  };

  const handleRoleModelChange = async (role: string, primaryModel: string) => {
    try {
      const res = await setRoleModelMutation.mutateAsync({ role, primaryModel });
      if (res.ok) {
        toast.show(res.message || `Updated model for ${role}`);
        void refetchRoleModels();
      } else {
        toast.error(res.error || "Failed to update role model");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleServiceAction = async (action: "start" | "stop" | "restart") => {
    try {
      const res = await serviceActionMutation.mutateAsync({ action });
      if (res.ok) {
        toast.show(`Hook service ${action}ed`);
        void refetchServiceStatus();
        void refetchHookStatus();
      } else {
        toast.error(res.error || `Failed to ${action} service`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleQueuePause = async (repo?: string) => {
    try {
      const res = await pauseMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(repo ? `Paused queue for ${repo}` : "Paused all queues");
        void refetchHookQueues();
        void refetchHookStatus();
      } else {
        toast.error(res.error || "Failed to pause");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleQueueResume = async (repo?: string) => {
    try {
      const res = await resumeMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(repo ? `Resumed queue for ${repo}` : "Resumed all queues");
        void refetchHookQueues();
        void refetchHookStatus();
      } else {
        toast.error(res.error || "Failed to resume");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleQueueDrain = async (repo: string) => {
    try {
      const res = await drainMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(`Drained queue for ${repo}`);
        void refetchHookQueues();
        void refetchHookStatus();
      } else {
        toast.error(res.error || "Failed to drain");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const rawIssues = issuesData?.issues ?? [];
  const visible = useMemo(() => {
    const filtered = filterIssues(rawIssues, filter, query);
    return sortIssues(filtered, issueSortField, issueSortDir);
  }, [rawIssues, filter, query, issueSortField, issueSortDir]);

  const selected = useMemo(() => {
    if (selectedNumber !== null) {
      const found = rawIssues.find((i) => i.number === selectedNumber);
      if (found) return found;
    }
    return visible[0] ?? rawIssues[0] ?? null;
  }, [selectedNumber, rawIssues, visible]);

  const isConnected = hookStatus?.ok ?? false;
  const isServiceRunning = serviceStatus?.active ?? false;
  const totalQueued = hookStatus?.totalQueued ?? 0;
  const queuesList = hookQueues?.queues ?? [];

  const visibleQueues = useMemo(() => {
    const filtered = filterQueues(queuesList, queuePreset, queueQuery);
    return sortQueues(filtered, queueSortField, queueSortDir);
  }, [queuesList, queuePreset, queueQuery, queueSortField, queueSortDir]);

  const allAgents = useMemo(() => {
    return [
      ...(agentsData?.frontDesk ?? []),
      ...(agentsData?.orchestrators ?? []),
      ...(agentsData?.workers ?? []),
    ];
  }, [agentsData]);

  const visibleAgents = useMemo(() => {
    const filtered = filterAgents(allAgents, agentPreset, agentQuery);
    return sortAgents(filtered, agentSortField, agentSortDir);
  }, [allAgents, agentPreset, agentQuery, agentSortField, agentSortDir]);

  const filteredFrontDesk = useMemo(() => {
    const filtered = filterAgents(agentsData?.frontDesk ?? [], agentPreset, agentQuery);
    return sortAgents(filtered, agentSortField, agentSortDir);
  }, [agentsData?.frontDesk, agentPreset, agentQuery, agentSortField, agentSortDir]);

  const filteredOrchestrators = useMemo(() => {
    const filtered = filterAgents(agentsData?.orchestrators ?? [], agentPreset, agentQuery);
    return sortAgents(filtered, agentSortField, agentSortDir);
  }, [agentsData?.orchestrators, agentPreset, agentQuery, agentSortField, agentSortDir]);

  const filteredWorkers = useMemo(() => {
    const filtered = filterAgents(agentsData?.workers ?? [], agentPreset, agentQuery);
    return sortAgents(filtered, agentSortField, agentSortDir);
  }, [agentsData?.workers, agentPreset, agentQuery, agentSortField, agentSortDir]);

  const rawRunners = runnersData?.runners ?? [];
  const visibleRunners = useMemo(() => {
    const filtered = filterRunners(rawRunners, runnerPreset, runnerQuery);
    return sortRunners(filtered, runnerSortField, runnerSortDir);
  }, [rawRunners, runnerPreset, runnerQuery, runnerSortField, runnerSortDir]);

  const rawCandidates = metricsData?.candidates ?? [];
  const visibleCandidates = useMemo(() => {
    const filtered = filterMetricCandidates(rawCandidates, metricPreset, metricQuery);
    return sortMetricCandidates(filtered, metricSortField, metricSortDir);
  }, [rawCandidates, metricPreset, metricQuery, metricSortField, metricSortDir]);

  return (
    <ModalBody
      headerMode="pinned"
      header={<Tabs tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as SurfaceTab)} />}
      headerStyle={{ backgroundColor: colors.surface0, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 }}
      contentContainerStyle={{ gap: 12, paddingHorizontal: 12, paddingTop: 6 }}
    >
      {activeTab === "mockup" ? (
        <UppidiForgeStaticMockup {...props} />
      ) : activeTab === "tree" ? (
        <UppidiForgeTreeView
          agentsData={agentsData}
          isLoading={agentsLoading}
          onRefresh={refetchAgents}
          navigation={props.navigation}
        />
      ) : (
        <Stack gap={12}>
          {/* Header */}
          <Row justify="space-between" align="center" wrap gap="sm">
            <Stack gap="xxs" style={{ flex: 1 }}>
              <Row align="center" gap="sm">
                <StatusDot variant={isConnected ? "success" : "danger"} pulse={isConnected} />
                <Text style={{ color: colors.foreground, ...typography.title }}>Uppidi Forge</Text>
                <Badge
                  label={isConnected ? "Router Connected" : "Router Disconnected"}
                  variant={isConnected ? "success" : "danger"}
                  size="sm"
                  dot
                />
                {isServiceRunning && <Badge label="systemd active" variant="info" size="sm" />}
              </Row>
              <Text style={{ color: colors.foregroundMuted, ...typography.body }}>
                One place for triage, active work, queues, and review decisions.
              </Text>
            </Stack>
            <Button label="Refresh" icon="RefreshCw" variant="secondary" onPress={refetchAll} />
          </Row>

          {/* Action Bar & Filter Buttons */}
          <ActionBar align="space-between">
            <Row wrap gap="xs">
              {issuePresetFilters.map(({ id, label }) => {
                let count = 0;
                if (id === "all") count = rawIssues.length;
                else if (id === "needs-attention") {
                  count = rawIssues.filter(
                    (i) =>
                      i.attention.startsWith("attention/0-") ||
                      i.attention.startsWith("attention/1-") ||
                      i.attention.startsWith("attention/2-")
                  ).length;
                } else if (id === "triage-review") {
                  count = rawIssues.filter(
                    (i) =>
                      i.status === "Review" ||
                      i.labels.some((l) => l.includes("state/0-triage") || l.includes("state/2-review"))
                  ).length;
                } else if (id === "in-progress") {
                  count = rawIssues.filter(
                    (i) =>
                      i.status === "In progress" ||
                      i.labels.some((l) => l.includes("state/1-wip"))
                  ).length;
                } else if (id === "verify") {
                  count = rawIssues.filter((i) => i.labels.some((l) => l.includes("state/3-verify"))).length;
                }
                return (
                  <Button
                    key={id}
                    label={`${label} (${count})`}
                    size="sm"
                    variant={filter === id ? "primary" : "ghost"}
                    onPress={() => setFilter(id)}
                  />
                );
              })}
            </Row>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
              Repo: {issuesData?.repo ?? "xpufx-org/paseo"}
            </Text>
          </ActionBar>

          {/* Live Metrics */}
          <Grid columns={4} minColumnWidth={160} gap="sm">
            <Metric
              label="Open issues"
              value={String(issuesData?.openCount ?? rawIssues.length)}
              detail="active repository backlog"
              icon="CircleDot"
            />
            <Metric
              label="Needs your attention"
              value={String(issuesData?.needsYouCount ?? 0)}
              detail="awaiting human signoff"
              icon="Bot"
            />
            <Metric
              label="Awaiting review"
              value={String(issuesData?.reviewCount ?? 0)}
              detail="PRs & verification states"
              icon="GitPullRequest"
            />
            <Metric
              label="Hook queued"
              value={String(totalQueued)}
              detail={hookStatus?.frontDesk?.agentId ? "Front Desk active" : "Standalone bridge"}
              icon="Layers"
            />
          </Grid>

          {/* Collapsible Section: Hook Service Management (#368) */}
          <Collapsible
            title={`Hook Service Management (${serviceStatus?.state ?? "checking"})`}
            icon="Server"
            isExpanded={hookServiceExpanded}
            onToggle={(exp) => setHookServiceExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="sm">
                  <Row align="center" gap="xs">
                    <StatusDot variant={isServiceRunning ? "success" : "danger"} />
                    <Text style={{ color: colors.foreground, ...typography.heading }}>
                      forgejo-hook.service: {serviceStatus?.state ?? "unknown"}
                    </Text>
                  </Row>
                  <Row gap="xs">
                    <Button
                      label="Start"
                      size="sm"
                      variant="primary"
                      disabled={isServiceRunning}
                      onPress={() => handleServiceAction("start")}
                    />
                    <Button
                      label="Restart"
                      size="sm"
                      variant="secondary"
                      onPress={() => handleServiceAction("restart")}
                    />
                    <Button
                      label="Stop"
                      size="sm"
                      variant="danger"
                      disabled={!isServiceRunning}
                      onPress={() => handleServiceAction("stop")}
                    />
                  </Row>
                </Row>
                <KeyValueGroup>
                  <KeyValue label="Unit name" value="forgejo-hook.service (user slice)" />
                  <KeyValue label="Router endpoint" value="http://127.0.0.1:8099" />
                  <KeyValue
                    label="Front desk agent"
                    value={hookStatus?.frontDesk?.agentId ?? "None assigned"}
                    copyable={!!hookStatus?.frontDesk?.agentId}
                  />
                  <KeyValue label="Total queued across repos" value={String(totalQueued)} />
                </KeyValueGroup>
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Hook Queues (#364, #368, #376) */}
          <Collapsible
            title={`Hook Queues (${visibleQueues.length}/${queuesList.length} repos, ${totalQueued} messages)`}
            icon="ListOrdered"
            isExpanded={hookQueuesExpanded}
            onToggle={(exp) => setHookQueuesExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="xs">
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Preset:</Text>
                    <Button
                      label="All"
                      size="sm"
                      variant={queuePreset === "all" ? "primary" : "ghost"}
                      onPress={() => setQueuePreset("all")}
                    />
                    <Button
                      label="Pending / Busy"
                      size="sm"
                      variant={queuePreset === "pending-processing" ? "primary" : "ghost"}
                      onPress={() => setQueuePreset("pending-processing")}
                    />
                    <Button
                      label="Paused / Dead"
                      size="sm"
                      variant={queuePreset === "dead-failed" ? "primary" : "ghost"}
                      onPress={() => setQueuePreset("dead-failed")}
                    />
                  </Row>
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                    {(["repo", "depth", "status"] as const).map((field) => (
                      <Button
                        key={field}
                        label={`${field === "repo" ? "Repo" : field === "depth" ? "Depth" : "Status"}${queueSortField === field ? (queueSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                        size="sm"
                        variant={queueSortField === field ? "secondary" : "ghost"}
                        onPress={() => {
                          if (queueSortField === field) {
                            setQueueSortDir(queueSortDir === "asc" ? "desc" : "asc");
                          } else {
                            setQueueSortField(field);
                            setQueueSortDir(field === "depth" ? "desc" : "asc");
                          }
                        }}
                      />
                    ))}
                    <Button label="Pause all" size="sm" variant="ghost" onPress={() => handleQueuePause()} />
                    <Button label="Resume all" size="sm" variant="ghost" onPress={() => handleQueueResume()} />
                  </Row>
                </Row>
                <SearchInput
                  value={queueQuery}
                  onChangeText={setQueueQuery}
                  onClear={() => setQueueQuery("")}
                  placeholder="Filter queues by repo or orchestrator..."
                />
                {visibleQueues.length === 0 ? (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    {queuesList.length === 0 ? "No active queues." : "No queues match the selected filter."}
                  </Text>
                ) : (
                  visibleQueues.map((q) => (
                    <Card key={q.key} variant="elevated">
                      <Row justify="space-between" align="center" wrap gap="xs">
                        <Stack gap="xxs" style={{ flex: 1 }}>
                          <Row align="center" gap="xs">
                            <Text style={{ color: colors.foreground, ...typography.heading }}>{q.key}</Text>
                            <Badge
                              label={q.paused ? "Paused" : q.isBusy ? "Busy" : "Ready"}
                              variant={q.paused ? "warning" : q.isBusy ? "info" : "success"}
                              size="sm"
                            />
                            {q.depth > 0 && <Badge label={`${q.depth} queued`} variant="info" size="sm" />}
                          </Row>
                          {q.orchestrator?.agentId && (
                            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                              Orchestrator: {q.orchestrator.agentId.slice(0, 8)}...
                            </Text>
                          )}
                        </Stack>
                        <Row gap="xs">
                          {q.paused ? (
                            <Button label="Resume" size="sm" variant="ghost" onPress={() => handleQueueResume(q.key)} />
                          ) : (
                            <Button label="Pause" size="sm" variant="ghost" onPress={() => handleQueuePause(q.key)} />
                          )}
                          <Button label="Drain" size="sm" variant="danger" onPress={() => handleQueueDrain(q.key)} />
                        </Row>
                      </Row>
                      {q.messages.length > 0 && (
                        <Stack gap="xxs" style={{ marginTop: 6 }}>
                          {q.messages.slice(0, 3).map((m) => (
                            <Text
                              key={m.id}
                              numberOfLines={1}
                              style={{ color: colors.foregroundMuted, fontFamily: "monospace", ...typography.caption, fontSize: 11 }}
                            >
                              • {m.preview}
                            </Text>
                          ))}
                        </Stack>
                      )}
                    </Card>
                  ))
                )}
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Hook Log Section (#365) */}
          <Collapsible
            title={`Hook Log Tail (${logTail?.lines.length ?? 0} lines)`}
            icon="Terminal"
            isExpanded={hookLogExpanded}
            onToggle={(exp) => setHookLogExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="xs">
                <Row justify="space-between" align="center">
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    Live systemd journal tail from `forgejo-hook.service`:
                  </Text>
                  <Button label="Refresh logs" size="sm" variant="ghost" icon="RefreshCw" onPress={() => void refetchLogTail()} />
                </Row>
                <CodeBlock
                  code={(logTail?.lines ?? []).join("\n") || "No log entries available."}
                  maxHeight={220}
                  copyable={true}
                />
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Agents & Fleet Hierarchy (#367, #376) */}
          <Collapsible
            title={`Agents & Fleet (${visibleAgents.length}/${allAgents.length} total · ${agentsData?.runningCount ?? 0} running · ${agentsData?.idleCount ?? 0} idle)`}
            icon="Bot"
            isExpanded={fleetExpanded}
            onToggle={(exp) => setFleetExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="xs">
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Preset:</Text>
                    <Button
                      label="All"
                      size="sm"
                      variant={agentPreset === "all" ? "primary" : "ghost"}
                      onPress={() => setAgentPreset("all")}
                    />
                    <Button
                      label="Active"
                      size="sm"
                      variant={agentPreset === "active" ? "primary" : "ghost"}
                      onPress={() => setAgentPreset("active")}
                    />
                    <Button
                      label="Idle"
                      size="sm"
                      variant={agentPreset === "idle" ? "primary" : "ghost"}
                      onPress={() => setAgentPreset("idle")}
                    />
                    <Button
                      label="Blocked / Errors"
                      size="sm"
                      variant={agentPreset === "blocked" ? "primary" : "ghost"}
                      onPress={() => setAgentPreset("blocked")}
                    />
                  </Row>
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                    {(["name", "status", "provider"] as const).map((field) => (
                      <Button
                        key={field}
                        label={`${field === "name" ? "Name" : field === "status" ? "Status" : "Provider"}${agentSortField === field ? (agentSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                        size="sm"
                        variant={agentSortField === field ? "secondary" : "ghost"}
                        onPress={() => {
                          if (agentSortField === field) {
                            setAgentSortDir(agentSortDir === "asc" ? "desc" : "asc");
                          } else {
                            setAgentSortField(field);
                            setAgentSortDir("asc");
                          }
                        }}
                      />
                    ))}
                    <Button label="Refresh agents" size="sm" variant="ghost" icon="RefreshCw" onPress={() => void refetchAgents()} />
                  </Row>
                </Row>
                <SearchInput
                  value={agentQuery}
                  onChangeText={setAgentQuery}
                  onClear={() => setAgentQuery("")}
                  placeholder="Filter agents by name, shortId, provider, cwd..."
                />
                {/* Front Desk Subtree */}
                <Collapsible
                  title={`Front Desk (${filteredFrontDesk.length})`}
                  icon="Inbox"
                  isExpanded={frontDeskExpanded}
                  onToggle={(exp) => setFrontDeskExpanded(exp)}
                >
                  <Stack gap="xs">
                    {filteredFrontDesk.length === 0 ? (
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>No matching Front Desk agents.</Text>
                    ) : (
                      filteredFrontDesk.map((a) => {
                        const config = getDeterministicStateConfig(a.deterministicState, a.category);
                        return (
                          <Card key={a.id} variant="elevated">
                            <Row justify="space-between" align="center" wrap gap="xs">
                              <Row align="center" gap="xs">
                                <AgentStateDot color={config.color} pulse={config.pulse} />
                                <Icon name={config.categoryIcon} size={14} color={config.color} />
                                <AgentTitleLink agent={a} colors={colors} typography={typography} navigation={props.navigation} />
                                <Badge label={a.deterministicState} variant={config.badgeVariant} size="sm" dot style={{ borderColor: config.color }} />
                                <Badge label={a.shortId} variant="neutral" size="sm" />
                              </Row>
                              <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                {a.provider || "default provider"}
                              </Text>
                            </Row>
                            {a.cwd && (
                              <Text style={{ color: colors.foregroundMuted, fontFamily: "monospace", ...typography.caption, fontSize: 11, marginTop: 4 }}>
                                cwd: {a.cwd}
                              </Text>
                            )}
                          </Card>
                        );
                      })
                    )}
                  </Stack>
                </Collapsible>

                {/* Orchestrators Subtree */}
                <Collapsible
                  title={`Orchestrators (${filteredOrchestrators.length})`}
                  icon="Network"
                  isExpanded={orchestratorsExpanded}
                  onToggle={(exp) => setOrchestratorsExpanded(exp)}
                >
                  <Stack gap="xs">
                    {filteredOrchestrators.length === 0 ? (
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>No matching orchestrators.</Text>
                    ) : (
                      filteredOrchestrators.map((a) => {
                        const config = getDeterministicStateConfig(a.deterministicState, a.category);
                        return (
                          <Card key={a.id} variant="elevated">
                            <Row justify="space-between" align="center" wrap gap="xs">
                              <Row align="center" gap="xs">
                                <AgentStateDot color={config.color} pulse={config.pulse} />
                                <Icon name={config.categoryIcon} size={14} color={config.color} />
                                <AgentTitleLink agent={a} colors={colors} typography={typography} navigation={props.navigation} />
                                <Badge label={a.deterministicState} variant={config.badgeVariant} size="sm" dot style={{ borderColor: config.color }} />
                                <Badge label={a.shortId} variant="neutral" size="sm" />
                              </Row>
                              <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                {a.provider || "default provider"}
                              </Text>
                            </Row>
                            {a.cwd && (
                              <Text style={{ color: colors.foregroundMuted, fontFamily: "monospace", ...typography.caption, fontSize: 11, marginTop: 4 }}>
                                cwd: {a.cwd}
                              </Text>
                            )}
                          </Card>
                        );
                      })
                    )}
                  </Stack>
                </Collapsible>

                {/* Task & Coding Agents Subtree */}
                <Collapsible
                  title={`Coding & Task Agents (${filteredWorkers.length})`}
                  icon="Terminal"
                  isExpanded={workersExpanded}
                  onToggle={(exp) => setWorkersExpanded(exp)}
                >
                  <Stack gap="xs">
                    {filteredWorkers.length === 0 ? (
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>No matching task agents.</Text>
                    ) : (
                      filteredWorkers.map((a) => {
                        const config = getDeterministicStateConfig(a.deterministicState, a.category);
                        return (
                          <Card key={a.id} variant="elevated">
                            <Row justify="space-between" align="center" wrap gap="xs">
                              <Row align="center" gap="xs">
                                <AgentStateDot color={config.color} pulse={config.pulse} />
                                <Icon name={config.categoryIcon} size={14} color={config.color} />
                                <AgentTitleLink agent={a} colors={colors} typography={typography} navigation={props.navigation} />
                                <Badge label={a.deterministicState} variant={config.badgeVariant} size="sm" dot style={{ borderColor: config.color }} />
                                <Badge label={a.shortId} variant="neutral" size="sm" />
                              </Row>
                              <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                {a.provider || "default provider"}
                              </Text>
                            </Row>
                            {a.cwd && (
                              <Text style={{ color: colors.foregroundMuted, fontFamily: "monospace", ...typography.caption, fontSize: 11, marginTop: 4 }}>
                                cwd: {a.cwd}
                              </Text>
                            )}
                          </Card>
                        );
                      })
                    )}
                  </Stack>
                </Collapsible>
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Agent Role Models (#371) */}
          <Collapsible
            title="Agent Role Models & Fallback Groups"
            icon="Cpu"
            isExpanded={roleModelsExpanded}
            onToggle={(exp) => setRoleModelsExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                  Configure primary model and fallback tiers for each agent role type:
                </Text>
                {Object.entries(roleModelsData?.roles ?? {}).map(([roleKey, cfg]) => (
                  <Card key={roleKey} variant="elevated">
                    <Row justify="space-between" align="center" wrap gap="xs">
                      <Stack gap="xxs" style={{ flex: 1 }}>
                        <Row align="center" gap="xs">
                          <Text style={{ color: colors.foreground, ...typography.heading }}>
                            {roleKey}
                          </Text>
                          <Badge label="Active tier" variant="info" size="sm" />
                        </Row>
                        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                          Primary: <Text style={{ color: colors.foreground, fontFamily: "monospace" }}>{cfg.primaryModel}</Text>
                        </Text>
                        {cfg.fallbackGroup.length > 1 && (
                          <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                            Fallbacks: {cfg.fallbackGroup.join(" → ")}
                          </Text>
                        )}
                      </Stack>
                      <Button
                        label="Switch model"
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          const available = roleModelsData?.availableModels ?? [];
                          if (available.length > 0) {
                            const nextIdx = (available.indexOf(cfg.primaryModel) + 1) % available.length;
                            const nextModel = available[nextIdx];
                            void handleRoleModelChange(roleKey, nextModel);
                          }
                        }}
                      />
                    </Row>
                  </Card>
                ))}
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: CI Runners (#366, #376) */}
          <Collapsible
            title={`CI Runner Fleet (${visibleRunners.length}/${runnersData?.totalCount ?? 0} runners \u00b7 ${runnersData?.onlineCount ?? 0} online)`}
            icon="Server"
            isExpanded={runnersExpanded}
            onToggle={(exp) => setRunnersExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="xs">
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Preset:</Text>
                    <Button
                      label="All"
                      size="sm"
                      variant={runnerPreset === "all" ? "primary" : "ghost"}
                      onPress={() => setRunnerPreset("all")}
                    />
                    <Button
                      label="Online"
                      size="sm"
                      variant={runnerPreset === "online" ? "primary" : "ghost"}
                      onPress={() => setRunnerPreset("online")}
                    />
                    <Button
                      label="Offline"
                      size="sm"
                      variant={runnerPreset === "offline" ? "primary" : "ghost"}
                      onPress={() => setRunnerPreset("offline")}
                    />
                  </Row>
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                    {(["name", "status", "lastSeen"] as const).map((field) => (
                      <Button
                        key={field}
                        label={`${field === "name" ? "Name" : field === "status" ? "Status" : "Last seen"}${runnerSortField === field ? (runnerSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                        size="sm"
                        variant={runnerSortField === field ? "secondary" : "ghost"}
                        onPress={() => {
                          if (runnerSortField === field) {
                            setRunnerSortDir(runnerSortDir === "asc" ? "desc" : "asc");
                          } else {
                            setRunnerSortField(field);
                            setRunnerSortDir("asc");
                          }
                        }}
                      />
                    ))}
                    <Button label="Refresh runners" size="sm" variant="ghost" icon="RefreshCw" onPress={() => void refetchRunners()} />
                  </Row>
                </Row>
                <SearchInput
                  value={runnerQuery}
                  onChangeText={setRunnerQuery}
                  onClear={() => setRunnerQuery("")}
                  placeholder="Filter runners by name, labels, or job..."
                />
                {visibleRunners.length === 0 ? (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    {(runnersData?.runners ?? []).length === 0 ? "No registered runners found." : "No runners match the selected filter."}
                  </Text>
                ) : (
                  visibleRunners.map((r) => (
                    <Card key={r.id} variant="elevated">
                      <Row justify="space-between" align="center" wrap gap="xs">
                        <Stack gap="xxs">
                          <Row align="center" gap="xs">
                            <StatusDot variant={r.status === "online" ? "success" : "neutral"} />
                            <Text style={{ color: colors.foreground, ...typography.heading }}>{r.name}</Text>
                            <Badge label={r.status} variant={r.status === "online" ? "success" : "neutral"} size="sm" />
                          </Row>
                          <Row gap="xs" wrap style={{ marginTop: 4 }}>
                            {r.labels.map((lbl) => (
                              <Badge key={lbl} label={lbl} variant="neutral" size="sm" />
                            ))}
                          </Row>
                          {r.lastJob && (
                            <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11, marginTop: 4 }}>
                              Last job: {r.lastJob}
                            </Text>
                          )}
                        </Stack>
                        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                          {r.lastSeen || "active"}
                        </Text>
                      </Row>
                    </Card>
                  ))
                )}
              </Stack>
            </Card>
          </Collapsible>

          {/* Collapsible Section: Fleet Capability & Benchmark Matrix (#373 / platform#18, #376) */}
          <Collapsible
            title={`Fleet Capability & Benchmark Matrix (${visibleCandidates.length}/${rawCandidates.length} candidates, ${metricsData?.totalEvaluatedTrials ?? 0} trials)`}
            icon="Activity"
            isExpanded={metricsExpanded}
            onToggle={(exp) => setMetricsExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center" wrap gap="xs">
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    Empirical task benchmark evaluation matrix comparing candidate models against repeatable task profiles (platform#18).
                  </Text>
                  <Button label="Refresh metrics" size="sm" variant="ghost" icon="RefreshCw" onPress={() => void refetchMetrics()} />
                </Row>

                <Row justify="space-between" align="center" wrap gap="xs">
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Preset:</Text>
                    <Button
                      label="All"
                      size="sm"
                      variant={metricPreset === "all" ? "primary" : "ghost"}
                      onPress={() => setMetricPreset("all")}
                    />
                    <Button
                      label="High Pass (≥85%)"
                      size="sm"
                      variant={metricPreset === "high-pass" ? "primary" : "ghost"}
                      onPress={() => setMetricPreset("high-pass")}
                    />
                    <Button
                      label="Worker Suitable"
                      size="sm"
                      variant={metricPreset === "bugfix-suitable" ? "primary" : "ghost"}
                      onPress={() => setMetricPreset("bugfix-suitable")}
                    />
                    <Button
                      label="Liaison Suitable"
                      size="sm"
                      variant={metricPreset === "liaison-suitable" ? "primary" : "ghost"}
                      onPress={() => setMetricPreset("liaison-suitable")}
                    />
                  </Row>
                  <Row gap="xs" wrap align="center">
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                    {(["passRate", "latency", "trials", "model"] as const).map((field) => (
                      <Button
                        key={field}
                        label={`${field === "passRate" ? "Pass rate" : field === "latency" ? "Latency" : field === "trials" ? "Trials" : "Model"}${metricSortField === field ? (metricSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                        size="sm"
                        variant={metricSortField === field ? "secondary" : "ghost"}
                        onPress={() => {
                          if (metricSortField === field) {
                            setMetricSortDir(metricSortDir === "asc" ? "desc" : "asc");
                          } else {
                            setMetricSortField(field);
                            setMetricSortDir(field === "latency" || field === "model" ? "asc" : "desc");
                          }
                        }}
                      />
                    ))}
                  </Row>
                </Row>

                <SearchInput
                  value={metricQuery}
                  onChangeText={setMetricQuery}
                  onClear={() => setMetricQuery("")}
                  placeholder="Filter models by name, role, or profile advisory..."
                />

                {metricsData?.privacyNotice && (
                  <Card variant="tinted">
                    <Row align="center" gap="xs">
                      <Badge label="Privacy Boundary" variant="info" size="sm" />
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption, flex: 1 }}>
                        {metricsData.privacyNotice}
                      </Text>
                    </Row>
                  </Card>
                )}

                {visibleCandidates.length === 0 ? (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    {rawCandidates.length === 0 ? "No benchmark candidate data available." : "No model candidates match the selected filter."}
                  </Text>
                ) : (
                  visibleCandidates.map((candidate) => (
                    <Card key={candidate.model} variant="elevated">
                      <Stack gap="xs">
                        <Row justify="space-between" align="center" wrap gap="xs">
                          <Row align="center" gap="xs">
                            <StatusDot variant={candidate.overallPassRate >= 90 ? "success" : candidate.overallPassRate >= 80 ? "info" : "warning"} />
                            <Text style={{ color: colors.foreground, ...typography.heading }}>{candidate.model}</Text>
                            <Badge label={`${candidate.overallPassRate}% pass`} variant={candidate.overallPassRate >= 90 ? "success" : "neutral"} size="sm" />
                            <Badge label={`${Math.round(candidate.medianWallMs / 1000)}s median`} variant="neutral" size="sm" />
                            <Badge label={`${candidate.totalTrials} trials`} variant="neutral" size="sm" />
                          </Row>
                          <Row align="center" gap="xs" wrap>
                            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Recommended roles:</Text>
                            {candidate.recommendedRoles.map((role) => (
                              <Badge key={role} label={role} variant="info" size="sm" />
                            ))}
                          </Row>
                        </Row>

                        {/* Task Profile breakdown */}
                        <Stack gap="xs" style={{ marginTop: 4 }}>
                          {candidate.profiles.map((p) => (
                            <Card key={p.taskProfile} variant="flat">
                              <Row justify="space-between" align="center" wrap gap="xs">
                                <Stack gap="xxs" style={{ flex: 1, minWidth: 200 }}>
                                  <Row align="center" gap="xs">
                                    <Text style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}>
                                      {p.taskProfileLabel}
                                    </Text>
                                    <Badge label={`${p.passRate}% pass`} variant={p.passRate >= 90 ? "success" : p.passRate >= 80 ? "info" : "warning"} size="sm" />
                                    <Badge label={`${p.reworkRate}% rework`} variant="neutral" size="sm" />
                                    <Badge label={p.confidence} variant={p.confidence === "high" ? "success" : "neutral"} size="sm" />
                                  </Row>
                                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                    {p.advisory}
                                  </Text>
                                </Stack>
                                <Row align="center" gap="xs">
                                  <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                                    Failures: Q:{p.failureBreakdown.quota} | T:{p.failureBreakdown.timeout} | Tool:{p.failureBreakdown.toolFailure} | Check:{p.failureBreakdown.checkFailure}
                                  </Text>
                                </Row>
                              </Row>
                            </Card>
                          ))}
                        </Stack>
                      </Stack>
                    </Card>
                  ))
                )}
              </Stack>
            </Card>
          </Collapsible>

          {/* Primary Main Split View: Work Queue & Selected Issue Details */}
          <Grid columns={3} minColumnWidth={280} gap="md">
            <Stack gap={12} style={{ flex: 2 }}>
              <Card variant="elevated">
                <CardHeader
                  title="Work queue"
                  subtitle={`${visible.length} issues in view`}
                  icon="ListTodo"
                  action={
                    <Button
                      label="Dispatch work"
                      size="sm"
                      icon="ArrowRight"
                      iconPosition="right"
                      variant="ghost"
                      onPress={() => {
                        if (selected) {
                          toast.show(`Worktree dispatch requested for #${selected.number}`);
                        }
                      }}
                    />
                  }
                />
                <Row justify="space-between" align="center" wrap gap="xs">
                  <View style={{ flex: 1, minWidth: 200 }}>
                    <SearchInput
                      value={query}
                      onChangeText={setQuery}
                      onClear={() => setQuery("")}
                      placeholder="Filter by title, number, or label..."
                    />
                  </View>
                  <Row gap="xs" align="center" wrap>
                    <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Sort:</Text>
                    {(["number", "title", "status", "comments", "repo"] as const).map((field) => (
                      <Button
                        key={field}
                        label={`${field === "number" ? "#" : field === "title" ? "Title" : field === "status" ? "Status" : field === "comments" ? "Comments" : "Repo"}${issueSortField === field ? (issueSortDir === "asc" ? " ↑" : " ↓") : ""}`}
                        size="sm"
                        variant={issueSortField === field ? "secondary" : "ghost"}
                        onPress={() => {
                          if (issueSortField === field) {
                            setIssueSortDir(issueSortDir === "asc" ? "desc" : "asc");
                          } else {
                            setIssueSortField(field);
                            setIssueSortDir(field === "number" || field === "comments" ? "desc" : "asc");
                          }
                        }}
                      />
                    ))}
                  </Row>
                </Row>
                <DataTable
                  data={visible}
                  keyExtractor={(issue) => String(issue.number)}
                  emptyState={
                    <EmptyState
                      title="No issues match this filter"
                      description="Try changing the filter or search query."
                      actionLabel="Clear filters"
                      onAction={() => {
                        setFilter("all");
                        setQuery("");
                      }}
                    />
                  }
                  columns={[
                    {
                      key: "issue",
                      header: "Issue",
                      flex: 3,
                      render: (issue) => (
                        <Button
                          label={`#${issue.number} · ${issue.title}`}
                          variant={selected?.number === issue.number ? "primary" : "ghost"}
                          size="sm"
                          onPress={() => setSelectedNumber(issue.number)}
                        />
                      ),
                    },
                    {
                      key: "status",
                      header: "Status",
                      flex: 1,
                      render: (issue) => <Badge label={issue.status} variant={statusVariant(issue.status)} size="sm" />,
                    },
                    {
                      key: "attention",
                      header: "Owner",
                      flex: 1,
                      render: (issue) => (
                        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                          {attentionMap[issue.attention]}
                        </Text>
                      ),
                    },
                  ]}
                />
              </Card>
            </Stack>

            <Stack gap={12} style={{ flex: 1 }}>
              {selected ? (
                <Card variant="elevated">
                  <CardHeader title="Selected work" icon="PanelRightOpen" />
                  <Stack gap="sm">
                    <Text style={{ color: colors.accent, ...typography.caption }}>
                      {selected.repo} #{selected.number}
                    </Text>
                    <Text style={{ color: colors.foreground, ...typography.heading }}>{selected.title}</Text>
                    <Row wrap gap="xs">
                      <Badge label={selected.status} variant={statusVariant(selected.status)} />
                      <Badge label={attentionMap[selected.attention]} variant="neutral" />
                      {selected.comments > 0 && <Badge label={`${selected.comments} comments`} variant="neutral" />}
                    </Row>
                    {selected.labels.length > 0 && (
                      <Row wrap gap="xxs">
                        {selected.labels.map((l) => (
                          <Badge key={l} label={l} variant="neutral" size="sm" />
                        ))}
                      </Row>
                    )}
                    <KeyValue
                      label="Worktree branch"
                      value={selected.branch ?? "No worktree dispatched yet"}
                      copyable={!!selected.branch}
                    />
                    {selected.url && (
                      <Button
                        label="Open in Forgejo"
                        icon="ExternalLink"
                        variant="primary"
                        onPress={() => Linking.openURL(selected.url!)}
                      />
                    )}
                  </Stack>
                </Card>
              ) : (
                <Card variant="elevated">
                  <CardHeader title="Selected work" icon="PanelRightOpen" />
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    Select an issue from the queue to view details.
                  </Text>
                </Card>
              )}
            </Stack>
          </Grid>
        </Stack>
      )}
    </ModalBody>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: string }) {
  const { colors, typography } = usePluginTheme();
  return (
    <Card variant="elevated">
      <CardHeader title={label} value={value} icon={icon} />
      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>{detail}</Text>
    </Card>
  );
}
