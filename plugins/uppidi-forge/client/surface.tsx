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
  type UppidiIssue,
  type AttentionLabel,
} from "../shared/contracts.js";
import { UppidiForgeStaticMockup } from "./static-mockup";

type Filter = "all" | "needs-you" | "in-flight" | "review";
type SurfaceTab = "dashboard" | "mockup";

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All work" },
  { id: "needs-you", label: "Needs you" },
  { id: "in-flight", label: "In flight" },
  { id: "review", label: "Review" },
];

const tabs = [
  { id: "dashboard", label: "Dashboard", shortLabel: "Dashboard", icon: "LayoutDashboard" },
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
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [hookServiceExpanded, setHookServiceExpanded] = useState(false);
  const [hookQueuesExpanded, setHookQueuesExpanded] = useState(false);
  const [hookLogExpanded, setHookLogExpanded] = useState(false);

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

  // Mutations
  const pauseMutation = useRpcMutation(uppidiHookPauseContract);
  const resumeMutation = useRpcMutation(uppidiHookResumeContract);
  const drainMutation = useRpcMutation(uppidiHookDrainContract);
  const serviceActionMutation = useRpcMutation(uppidiHookServiceActionContract);

  const refetchAll = () => {
    void refetchIssues();
    void refetchHookStatus();
    void refetchHookQueues();
    void refetchServiceStatus();
    void refetchLogTail();
    toast.show("Dashboard refreshed");
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
    return rawIssues.filter((issue) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "needs-you" && issue.attention === "attention/2-user") ||
        (filter === "in-flight" && issue.status === "In progress") ||
        (filter === "review" && issue.status === "Review");
      const search = query.trim().toLowerCase();
      return (
        matchesFilter &&
        (!search || `${issue.repo} ${issue.number} ${issue.title} ${issue.labels.join(" ")}`.toLowerCase().includes(search))
      );
    });
  }, [rawIssues, filter, query]);

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

  return (
    <ModalBody
      headerMode="pinned"
      header={<Tabs tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as SurfaceTab)} />}
      headerStyle={{ backgroundColor: colors.surface0, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 }}
      contentContainerStyle={{ gap: 12, paddingHorizontal: 12, paddingTop: 6 }}
    >
      {activeTab === "mockup" ? (
        <UppidiForgeStaticMockup {...props} />
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
              {filters.map(({ id, label }) => {
                let count = 0;
                if (id === "all") count = issuesData?.openCount ?? rawIssues.length;
                else if (id === "needs-you") count = issuesData?.needsYouCount ?? 0;
                else if (id === "in-flight") count = issuesData?.inFlightCount ?? 0;
                else if (id === "review") count = issuesData?.reviewCount ?? 0;
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

          {/* Collapsible Section: Hook Queues (#364, #368) */}
          <Collapsible
            title={`Hook Queues (${queuesList.length} repos, ${totalQueued} messages)`}
            icon="ListOrdered"
            isExpanded={hookQueuesExpanded}
            onToggle={(exp) => setHookQueuesExpanded(exp)}
          >
            <Card variant="flat">
              <Stack gap="sm">
                <Row justify="space-between" align="center">
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                    Repository webhook ingest queues managed by forgejo-hook.
                  </Text>
                  <Row gap="xs">
                    <Button label="Pause all" size="sm" variant="ghost" onPress={() => handleQueuePause()} />
                    <Button label="Resume all" size="sm" variant="ghost" onPress={() => handleQueueResume()} />
                  </Row>
                </Row>
                {queuesList.length === 0 ? (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>No active queues.</Text>
                ) : (
                  queuesList.map((q) => (
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
                <SearchInput
                  value={query}
                  onChangeText={setQuery}
                  onClear={() => setQuery("")}
                  placeholder="Filter by title, number, or label..."
                />
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
