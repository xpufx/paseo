import React, { useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import {
  ActionBar,
  AttentionBeacon,
  Badge,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  Collapsible,
  CommandBox,
  DataTable,
  EmptyState,
  Grid,
  Icon,
  ForgeIcon,
  InteractiveRow,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  ModalContent,
  Row,
  SearchInput,
  Select,
  type SelectOption,
  Stack,
  StatusDot,
  Tabs,
  TextInput,
  usePluginTheme,
  useRpcQuery,
  useRpcMutation,
  usePluginSettings,
} from "paseo-plugin-helper/client";
import {
  uppidiFleetSettingsContract,
  uppidiIssuesContract,
  uppidiHookStatusContract,
  uppidiHookQueuesContract,
  uppidiHookPauseContract,
  uppidiHookResumeContract,
  uppidiHookDrainContract,
  uppidiHookServiceStatusContract,
  uppidiHookServiceActionContract,
  uppidiHookConfigureContract,
  uppidiHookLogTailContract,
  uppidiAgentsContract,
  uppidiRoleModelsContract,
  uppidiSetRoleModelContract,
  uppidiRunnersContract,
  uppidiFleetMetricsContract,
  uppidiArchiveAgentContract,
  uppidiArchiveInactiveAgentsContract,
  type UppidiAgent,
  type UppidiIssue,
  type AttentionLabel,
  type RoleModelConfig,
  type UppidiRunner,
  type CandidateModelMetrics,
  type TaskProfileMetrics,
  getPendingPermissionAction,
  getPermissionAdjudicationCommand,
  getAgentAttentionReason,
} from "../shared/contracts.js";
import {
  filterIssues,
  sortIssues,
  filterQueues,
  sortQueues,
  filterRunners,
  sortRunners,
  filterBulkArchiveCandidates,
  filterMetricCandidates,
  sortMetricCandidates,
  isRepoMatching,
  collectAttentionAgents,
  countPermissionAgents,
  type IssuePreset,
  type IssueSortField,
  type QueuePreset,
  type QueueSortField,
  type RunnerPreset,
  type RunnerSortField,
  type MetricPreset,
  type MetricSortField,
  type SortDirection,
} from "../shared/sort-filter.js";
import {
  UppidiFleetTreeView,
  UppidiForgeTreeView,
} from "./tree-view.js";

export type SurfaceTab = "tree" | "dashboard" | "settings";

/**
 * Narrows a possibly-partial RPC collection to an array. A truncated or legacy
 * payload can deliver a non-array where the server types promise one; mapping
 * or iterating it blanks the surface (#510).
 */
function toList<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

/** Enrolled repos are plain strings; reject null/empty entries defensively. */
function toRepoList(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((r): r is string => typeof r === "string" && r.length > 0) : [];
}

const issuePresetFilters: Array<{ id: IssuePreset; label: string }> = [
  { id: "all", label: "All work" },
  { id: "needs-you", label: "Needs You" },
  { id: "needs-attention", label: "Needs Attention" },
  { id: "triage-review", label: "Triage / Review" },
  { id: "in-progress", label: "In Progress" },
  { id: "verify", label: "Verify" },
];

const tabs = [
  { id: "tree", label: "Agents & Fleet", shortLabel: "Fleet", icon: "FolderTree" },
  { id: "dashboard", label: "Work Queue", shortLabel: "Queue", icon: "LayoutDashboard" },
  { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Sliders" },
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

export function UppidiBrandMark({ size = 20, color }: { size?: number; color?: string }) {
  const { colors } = usePluginTheme();
  return (
    <ForgeIcon
      host="forge.mrs.uppidi.com"
      kind="forgejo"
      size={size}
      color={color ?? colors.accent}
      accessibilityLabel="Uppidi Fleet"
    />
  );
}

export interface RouterStatusBadge {
  label: string;
  variant: "success" | "warning" | "danger";
  pulse: boolean;
}

/**
 * Single source of truth for the router status indicator (#464). Prevents the
 * header from rendering contradictory connect + service badges side by side.
 */
export function resolveRouterStatusBadge(
  isConnected: boolean,
  isServiceRunning: boolean,
): RouterStatusBadge {
  if (isConnected) {
    return { label: "Router Active", variant: "success", pulse: true };
  }
  if (isServiceRunning) {
    return { label: "Router Starting", variant: "warning", pulse: false };
  }
  return { label: "Router Disconnected", variant: "danger", pulse: false };
}

export interface UppidiTopHeaderBarProps {
  isConnected: boolean;
  isServiceRunning: boolean;
  selectedRepo: string;
  repoOptions: SelectOption[];
  onRepoChange: (repo: string) => void;
  onRefresh: () => void;
  /** Number of agents blocked on a pending permission prompt (#534). */
  permissionAttentionCount?: number;
  /** Number of agents awaiting operator input (#534). */
  inputAttentionCount?: number;
}

/**
 * Compact Unified Header Bar (#424, #425)
 * Merges brand mark, Cockpit title, Uppidi Fleet badge, router status,
 * global repo selector, and refresh button into a single tight row.
 * Multi-line subtitle descriptions are eliminated to reduce vertical footprint by >50%.
 */
export function UppidiTopHeaderBar({
  isConnected,
  isServiceRunning,
  selectedRepo,
  repoOptions,
  onRepoChange,
  onRefresh,
  permissionAttentionCount = 0,
  inputAttentionCount = 0,
}: UppidiTopHeaderBarProps) {
  const { colors, typography } = usePluginTheme();
  const routerBadge = resolveRouterStatusBadge(isConnected, isServiceRunning);
  const attentionCount = permissionAttentionCount + inputAttentionCount;

  return (
    <Row
      justify="space-between"
      align="center"
      wrap
      gap="xs"
      style={{ paddingVertical: 2, position: "relative", zIndex: 100 }}
    >
      {/* Left: Brand mark, title, status dots & badges */}
      <Row align="center" gap="xs" wrap>
        <UppidiBrandMark size={18} />
        <StatusDot variant={routerBadge.variant} pulse={routerBadge.pulse} />
        <Text
          style={{
            color: colors.foreground,
            ...typography.title,
            fontSize: 15,
            fontWeight: "700",
          }}
        >
          Cockpit
        </Text>
        <Badge label="Uppidi Fleet" variant="accent" size="sm" textStyle={{ fontSize: 10 }} />
        <Badge
          label={routerBadge.label}
          variant={routerBadge.variant}
          size="sm"
          dot
          textStyle={{ fontSize: 10 }}
        />
        {attentionCount > 0 && (
          <AttentionBeacon mode="radar" tone="warning">
            <Badge
              label={`⚠️ ${attentionCount} Need Attention`}
              variant="warning"
              size="sm"
              dot
              textStyle={{ fontSize: 10, fontWeight: "700" }}
            />
          </AttentionBeacon>
        )}
      </Row>

      {/* Right: Repo Selector & authoritative Refresh button (#449, #466) */}
      <Row align="center" gap="xs" wrap>
        {/* Global Repo Selector */}
        <View style={{ minWidth: 150, maxWidth: 220 }}>
          <Select
            value={selectedRepo}
            options={repoOptions}
            onValueChange={onRepoChange}
            size="sm"
          />
        </View>

        <Button
          label="Refresh"
          icon="RefreshCw"
          size="sm"
          variant="secondary"
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            minHeight: 22,
          }}
          onPress={onRefresh}
        />
      </Row>
    </Row>
  );
}

export interface AttentionAgentCardProps {
  agent: UppidiAgent;
  onOpen?: (agentId: string) => void;
}

/**
 * Cockpit fleet attention card (#534): a prominent `AttentionBeacon`-wrapped row
 * for an agent blocked at a permission prompt or awaiting operator input, with
 * the Front Desk adjudication command rendered for one-click copy.
 */
export function AttentionAgentCard({ agent, onOpen }: AttentionAgentCardProps) {
  const { colors, typography } = usePluginTheme();
  const permissions = agent.pendingPermissions ?? [];
  const hasPermission = permissions.length > 0;
  const reason = getAgentAttentionReason(agent);
  const tone: "warning" | "danger" = hasPermission ? "danger" : "warning";
  const accentColor = hasPermission
    ? colors.statusDanger ?? "#ef4444"
    : colors.statusWarning ?? "#f59e0b";

  return (
    <AttentionBeacon
      mode="radar"
      tone={tone}
      testID={`cockpit-attention-beacon-${agent.id}`}
      accessibilityLabel={
        hasPermission ? `Permission needed for ${agent.name}` : `Awaiting input for ${agent.name}`
      }
    >
      <Card variant="flat" style={{ borderColor: accentColor, borderWidth: 1 }}>
        <Row justify="space-between" align="center" wrap gap="xs">
          <Stack gap="xxs" style={{ flexShrink: 1 }}>
            <Row align="center" gap="xs" wrap>
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
              <Text style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}>
                {agent.name}
              </Text>
              <Badge
                label={agent.shortId}
                variant="neutral"
                size="sm"
                textStyle={{ fontFamily: "monospace", fontSize: 10 }}
              />
            </Row>
            {hasPermission && permissions.length > 1 && (
              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                +{permissions.length - 1} more pending permission request
                {permissions.length - 1 === 1 ? "" : "s"}
              </Text>
            )}
          </Stack>
          {onOpen && (
            <Button
              label="Open agent"
              icon="ExternalLink"
              size="sm"
              variant="ghost"
              onPress={() => onOpen(agent.id)}
            />
          )}
        </Row>
        {hasPermission && (
          <Row style={{ marginTop: 4 }}>
            <CommandBox
              command={getPermissionAdjudicationCommand(agent.id, permissions[0])}
              copyLabel={`Copy adjudication command for ${agent.name}`}
              style={{ flexShrink: 1 }}
            />
          </Row>
        )}
      </Card>
    </AttentionBeacon>
  );
}

export function UppidiFleetSurface(props: PluginSurfaceProps) {
  const { colors, typography } = usePluginTheme();
  const toast = useToast();
  const { settings, updateSettings, isUpdating: isUpdatingSettings } = usePluginSettings(uppidiFleetSettingsContract);
  const [activeTab, setActiveTab] = useState<SurfaceTab>("tree");
  const [selectedRepo, setSelectedRepo] = useState<string>("all");

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
  const configureMutation = useRpcMutation(uppidiHookConfigureContract);
  const setRoleModelMutation = useRpcMutation(uppidiSetRoleModelContract);
  const archiveAgentMutation = useRpcMutation(uppidiArchiveAgentContract);
  const archiveBulkMutation = useRpcMutation(uppidiArchiveInactiveAgentsContract);

  const [archivingAgentId, setArchivingAgentId] = useState<string | null>(null);
  const [isBulkArchiving, setIsBulkArchiving] = useState(false);

  // Hook service listen address configuration (#427)
  const [hostSelection, setHostSelection] = useState<string>("127.0.0.1");
  const [customHost, setCustomHost] = useState<string>("");
  const [isCustomHost, setIsCustomHost] = useState<boolean>(false);
  const [configuredPortInput, setConfiguredPortInput] = useState<string>("8099");
  const [isConfiguring, setIsConfiguring] = useState<boolean>(false);
  const configInitializedRef = React.useRef(false);

  React.useEffect(() => {
    if ((serviceStatus || settings) && !configInitializedRef.current) {
      configInitializedRef.current = true;
      const cfgHost = settings?.hookHost || serviceStatus?.configuredHost || serviceStatus?.host || "127.0.0.1";
      const cfgPort = settings?.hookPort || serviceStatus?.configuredPort || serviceStatus?.port || 8099;
      setConfiguredPortInput(String(cfgPort));

      const isDetected = (serviceStatus?.availableInterfaces ?? []).includes(cfgHost);
      if (cfgHost === "127.0.0.1" || cfgHost === "0.0.0.0" || isDetected) {
        setHostSelection(cfgHost);
        setIsCustomHost(false);
      } else {
        setHostSelection("custom");
        setCustomHost(cfgHost);
        setIsCustomHost(true);
      }
    }
  }, [serviceStatus, settings]);

  const detectedIps = useMemo(() => {
    const list = serviceStatus?.availableInterfaces ?? [];
    return list.filter((ip) => ip !== "127.0.0.1" && ip !== "0.0.0.0");
  }, [serviceStatus?.availableInterfaces]);

  const handleApplyConfig = async () => {
    const targetHost = isCustomHost ? customHost.trim() : hostSelection;
    const parsedPort = parseInt(configuredPortInput.trim(), 10);
    if (!targetHost) {
      toast.error("Host cannot be empty");
      return;
    }
    if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      toast.error("Please specify a valid port (1-65535)");
      return;
    }

    try {
      setIsConfiguring(true);
      const res = await configureMutation.mutateAsync({
        host: targetHost,
        port: parsedPort,
        restart: true,
      });
      void updateSettings({ hookHost: targetHost, hookPort: parsedPort });
      if (res.ok) {
        toast.show(res.message || `Hook service listening on ${res.activeHost}:${res.activePort}`);
        void refetchServiceStatus();
      } else {
        toast.error(res.error || "Failed to configure hook service");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Configuration error: ${msg}`);
    } finally {
      setIsConfiguring(false);
    }
  };

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

  const availableRepos = useMemo(() => {
    const set = new Set<string>();
    const defaultRepo = issuesData?.repo ?? "xpufx-org/paseo";
    set.add(defaultRepo);
    for (const r of toRepoList(agentsData?.enrolledRepos)) set.add(r);
    for (const q of toList(hookQueues?.queues)) if (q?.key) set.add(q.key);
    for (const i of toList(issuesData?.issues)) if (i?.repo) set.add(i.repo);
    return Array.from(set);
  }, [issuesData?.repo, issuesData?.issues, agentsData?.enrolledRepos, hookQueues?.queues]);

  const repoOptions = useMemo<SelectOption[]>(() => [
    { label: "All Repositories", value: "all" },
    ...availableRepos.map((r) => ({ label: r, value: r })),
  ], [availableRepos]);

  const rawIssues = useMemo(() => {
    const all = toList(issuesData?.issues);
    if (selectedRepo === "all") return all;
    return all.filter((i) => isRepoMatching(i?.repo, selectedRepo) || String(i?.repo ?? "").toLowerCase() === selectedRepo.toLowerCase());
  }, [issuesData?.issues, selectedRepo]);

  const visible = useMemo(() => {
    const filtered = filterIssues(rawIssues, filter, query);
    return sortIssues(filtered, issueSortField, issueSortDir);
  }, [rawIssues, filter, query, issueSortField, issueSortDir]);

  const selected = useMemo(() => {
    if (selectedNumber !== null) {
      return rawIssues.find((i) => i.number === selectedNumber) ?? null;
    }
    return null;
  }, [selectedNumber, rawIssues]);

  const isConnected = hookStatus?.ok ?? false;
  const isServiceRunning = serviceStatus?.active ?? false;
  const totalQueued = hookStatus?.totalQueued ?? 0;
  const queuesList = toList(hookQueues?.queues);

  const visibleQueues = useMemo(() => {
    const filtered = filterQueues(queuesList, queuePreset, queueQuery);
    return sortQueues(filtered, queueSortField, queueSortDir);
  }, [queuesList, queuePreset, queueQuery, queueSortField, queueSortDir]);

  const allAgents = useMemo(() => {
    return [
      ...toList(agentsData?.frontDesk),
      ...toList(agentsData?.orchestrators),
      ...toList(agentsData?.workers),
    ];
  }, [agentsData]);

  const eligibleBulkAgents = useMemo(() => {
    return filterBulkArchiveCandidates(allAgents);
  }, [allAgents]);

  const attentionAgents = useMemo(() => collectAttentionAgents(allAgents), [allAgents]);
  const permissionAgentCount = useMemo(() => countPermissionAgents(allAgents), [allAgents]);

  const handleOpenAgent = (agentId: string) => {
    if (props.navigation?.openAgent) {
      props.navigation.openAgent({ agentId });
      return;
    }
    Linking.openURL(`paseo://agent/${agentId}`).catch(() => {});
  };

  const handleArchiveAgent = async (agentId: string) => {
    try {
      setArchivingAgentId(agentId);
      const res = await archiveAgentMutation.mutateAsync({ agentId });
      if (res.ok) {
        toast.show(res.message || "Agent archived");
      } else {
        toast.error(res.error || "Failed to archive agent");
      }
      void refetchAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setArchivingAgentId(null);
    }
  };

  const handleArchiveBulk = async () => {
    if (eligibleBulkAgents.length === 0 || isBulkArchiving) return;
    try {
      setIsBulkArchiving(true);
      const agentIds = eligibleBulkAgents.map((a) => a.id);
      const res = await archiveBulkMutation.mutateAsync({ agentIds });
      if (res.ok) {
        toast.show(res.message || `Archived ${res.archivedCount ?? agentIds.length} inactive agent(s)`);
      } else {
        toast.error(res.error || "Failed to archive inactive agents");
      }
      void refetchAgents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setIsBulkArchiving(false);
    }
  };


  const rawRunners = toList(runnersData?.runners);
  const visibleRunners = useMemo(() => {
    const filtered = filterRunners(rawRunners, runnerPreset, runnerQuery);
    return sortRunners(filtered, runnerSortField, runnerSortDir);
  }, [rawRunners, runnerPreset, runnerQuery, runnerSortField, runnerSortDir]);

  const rawCandidates = toList(metricsData?.candidates);
  const visibleCandidates = useMemo(() => {
    const filtered = filterMetricCandidates(rawCandidates, metricPreset, metricQuery);
    return sortMetricCandidates(filtered, metricSortField, metricSortDir);
  }, [rawCandidates, metricPreset, metricQuery, metricSortField, metricSortDir]);

  return (
    <ModalBody
      headerMode="pinned"
      header={
        <Stack gap={4}>
          <UppidiTopHeaderBar
            isConnected={isConnected}
            isServiceRunning={isServiceRunning}
            selectedRepo={selectedRepo}
            repoOptions={repoOptions}
            onRepoChange={setSelectedRepo}
            onRefresh={refetchAll}
            permissionAttentionCount={permissionAgentCount}
            inputAttentionCount={attentionAgents.length - permissionAgentCount}
          />
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as SurfaceTab)} />
        </Stack>
      }
      headerStyle={{
        backgroundColor: colors.surface0,
        paddingHorizontal: 8,
        paddingTop: 6,
        paddingBottom: 4,
      }}
      contentContainerStyle={{
        gap: 6,
        paddingHorizontal: 8,
        paddingTop: 4,
      }}
    >
      {activeTab === "settings" ? (
        <Stack gap={6}>
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
                      Bundled router: {serviceStatus?.state ?? "unknown"}
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
                  <KeyValue
                    label="Unit name"
                    value={`Bundled router (port ${serviceStatus?.port ?? serviceStatus?.configuredPort ?? 8099})`}
                  />
                  <KeyValue
                    label="Router endpoint"
                    value={`http://${serviceStatus?.host ?? "127.0.0.1"}:${serviceStatus?.port ?? 8099}`}
                  />
                  <KeyValue
                    label="Active host"
                    value={serviceStatus?.host ?? (isServiceRunning ? (serviceStatus?.configuredHost ?? "127.0.0.1") : "Not listening")}
                  />
                  <KeyValue
                    label="Active port"
                    value={serviceStatus?.port ? String(serviceStatus.port) : "Not listening"}
                  />
                  <KeyValue
                    label="Configured address"
                    value={`${serviceStatus?.configuredHost ?? "127.0.0.1"}:${serviceStatus?.configuredPort ?? 8099}`}
                  />
                  <KeyValue
                    label="Front desk agent"
                    value={hookStatus?.frontDesk?.agentId ?? "None assigned"}
                    copyable={!!hookStatus?.frontDesk?.agentId}
                  />
                  <KeyValue label="Total queued across repos" value={String(totalQueued)} />
                </KeyValueGroup>

                <Card variant="flat">
                  <Stack gap="xs">
                    <Text style={{ color: colors.foreground, ...typography.caption, fontWeight: "600" }}>
                      Configure Listen Address & Port
                    </Text>
                    <Row gap="xs" wrap align="center">
                      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Host:</Text>
                      <Button
                        label="127.0.0.1 (Loopback)"
                        size="sm"
                        variant={!isCustomHost && hostSelection === "127.0.0.1" ? "primary" : "ghost"}
                        onPress={() => {
                          setIsCustomHost(false);
                          setHostSelection("127.0.0.1");
                        }}
                      />
                      <Button
                        label="0.0.0.0 (All interfaces)"
                        size="sm"
                        variant={!isCustomHost && hostSelection === "0.0.0.0" ? "primary" : "ghost"}
                        onPress={() => {
                          setIsCustomHost(false);
                          setHostSelection("0.0.0.0");
                        }}
                      />
                      {detectedIps.map((ip) => (
                        <Button
                          key={ip}
                          label={ip}
                          size="sm"
                          variant={!isCustomHost && hostSelection === ip ? "primary" : "ghost"}
                          onPress={() => {
                            setIsCustomHost(false);
                            setHostSelection(ip);
                          }}
                        />
                      ))}
                      <Button
                        label="Custom"
                        size="sm"
                        variant={isCustomHost ? "primary" : "ghost"}
                        onPress={() => {
                          setIsCustomHost(true);
                          setHostSelection("custom");
                        }}
                      />
                    </Row>
                    <Row gap="sm" wrap align="flex-end">
                      {isCustomHost && (
                        <View style={{ flex: 1, minWidth: 160 }}>
                          <TextInput
                            label="Custom Host"
                            value={customHost}
                            onChangeText={setCustomHost}
                            placeholder="127.0.0.1 or IP"
                          />
                        </View>
                      )}
                      <View style={{ width: 120 }}>
                        <TextInput
                          label="Port"
                          value={configuredPortInput}
                          onChangeText={setConfiguredPortInput}
                          keyboardType="number-pad"
                          placeholder="8099"
                        />
                      </View>
                      <Button
                        label={isConfiguring ? "Applying..." : "Apply & Restart"}
                        size="sm"
                        variant="primary"
                        disabled={isConfiguring}
                        onPress={handleApplyConfig}
                      />
                    </Row>
                  </Stack>
                </Card>
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
                    <Card key={q?.key} variant="elevated">
                      <Row justify="space-between" align="center" wrap gap="xs">
                        <Stack gap="xxs" style={{ flex: 1 }}>
                          <Row align="center" gap="xs">
                            <Text style={{ color: colors.foreground, ...typography.heading }}>{q?.key}</Text>
                            <Badge
                              label={q?.paused ? "Paused" : q?.isBusy ? "Busy" : "Ready"}
                              variant={q?.paused ? "warning" : q?.isBusy ? "info" : "success"}
                              size="sm"
                            />
                            {(q?.depth ?? 0) > 0 && <Badge label={`${q.depth} queued`} variant="info" size="sm" />}
                          </Row>
                          {q?.orchestrator?.agentId && (
                            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                              Orchestrator: {q.orchestrator.agentId.slice(0, 8)}...
                            </Text>
                          )}
                        </Stack>
                        <Row gap="xs">
                          {q?.paused ? (
                            <Button label="Resume" size="sm" variant="ghost" onPress={() => handleQueueResume(q?.key)} />
                          ) : (
                            <Button label="Pause" size="sm" variant="ghost" onPress={() => handleQueuePause(q?.key)} />
                          )}
                          <Button label="Drain" size="sm" variant="danger" onPress={() => handleQueueDrain(q?.key)} />
                        </Row>
                      </Row>
                      {toList(q?.messages).length > 0 && (
                        <Stack gap="xxs" style={{ marginTop: 6 }}>
                          {toList(q?.messages).slice(0, 3).map((m) => (
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
                    Live log tail from bundled hook router:
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
                {Object.entries(roleModelsData?.roles ?? {}).map(([roleKey, cfg]) => {
                  // A role entry can be missing/partial in a stale payload; skip
                  // it rather than dereferencing undefined fields (#510).
                  if (!cfg || typeof cfg !== "object") return null;
                  const fallbackGroup = Array.isArray(cfg.fallbackGroup) ? cfg.fallbackGroup : [];
                  return (
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
                        {fallbackGroup.length > 1 && (
                          <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                            Fallbacks: {fallbackGroup.join(" → ")}
                          </Text>
                        )}
                      </Stack>
                      <Button
                        label="Switch model"
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          const available = toList(roleModelsData?.availableModels);
                          if (available.length > 0) {
                            const nextIdx = (available.indexOf(cfg.primaryModel) + 1) % available.length;
                            const nextModel = available[nextIdx];
                            void handleRoleModelChange(roleKey, nextModel);
                          }
                        }}
                      />
                    </Row>
                  </Card>
                  );
                })}
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
                    {toList(runnersData?.runners).length === 0 ? "No registered runners found." : "No runners match the selected filter."}
                  </Text>
                ) : (
                  visibleRunners.map((r) => (
                    <Card key={r?.id} variant="elevated">
                      <Row justify="space-between" align="center" wrap gap="xs">
                        <Stack gap="xxs">
                          <Row align="center" gap="xs">
                            <StatusDot variant={r?.status === "online" ? "success" : "neutral"} />
                            <Text style={{ color: colors.foreground, ...typography.heading }}>{r?.name}</Text>
                            <Badge label={r?.status} variant={r?.status === "online" ? "success" : "neutral"} size="sm" />
                          </Row>
                          <Row gap="xs" wrap style={{ marginTop: 4 }}>
                            {toList(r?.labels).map((lbl) => (
                              <Badge key={lbl} label={lbl} variant="neutral" size="sm" />
                            ))}
                          </Row>
                          {r?.lastJob && (
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
                    <Card key={candidate?.model} variant="elevated">
                      <Stack gap="xs">
                        <Row justify="space-between" align="center" wrap gap="xs">
                          <Row align="center" gap="xs">
                            <StatusDot variant={candidate?.overallPassRate >= 90 ? "success" : candidate?.overallPassRate >= 80 ? "info" : "warning"} />
                            <Text style={{ color: colors.foreground, ...typography.heading }}>{candidate?.model}</Text>
                            <Badge label={`${candidate?.overallPassRate}% pass`} variant={candidate?.overallPassRate >= 90 ? "success" : "neutral"} size="sm" />
                            <Badge label={`${Math.round((candidate?.medianWallMs ?? 0) / 1000)}s median`} variant="neutral" size="sm" />
                            <Badge label={`${candidate?.totalTrials} trials`} variant="neutral" size="sm" />
                          </Row>
                          <Row align="center" gap="xs" wrap>
                            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Recommended roles:</Text>
                            {toList(candidate?.recommendedRoles).map((role) => (
                              <Badge key={role} label={role} variant="info" size="sm" />
                            ))}
                          </Row>
                        </Row>

                        {/* Task Profile breakdown */}
                        <Stack gap="xs" style={{ marginTop: 4 }}>
                          {toList(candidate?.profiles).map((p) => {
                            // A profile can arrive without its failure breakdown in
                            // a partial payload; default it so the label reads (#510).
                            const fb = p?.failureBreakdown ?? { quota: 0, timeout: 0, toolFailure: 0, checkFailure: 0 };
                            return (
                            <Card key={p?.taskProfile} variant="flat">
                              <Row justify="space-between" align="center" wrap gap="xs">
                                <Stack gap="xxs" style={{ flex: 1, minWidth: 200 }}>
                                  <Row align="center" gap="xs">
                                    <Text style={{ color: colors.foreground, ...typography.body, fontWeight: "600" }}>
                                      {p?.taskProfileLabel}
                                    </Text>
                                    <Badge label={`${p?.passRate}% pass`} variant={p?.passRate >= 90 ? "success" : p?.passRate >= 80 ? "info" : "warning"} size="sm" />
                                    <Badge label={`${p?.reworkRate}% rework`} variant="neutral" size="sm" />
                                    <Badge label={p?.confidence} variant={p?.confidence === "high" ? "success" : "neutral"} size="sm" />
                                  </Row>
                                  <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
                                    {p?.advisory}
                                  </Text>
                                </Stack>
                                <Row align="center" gap="xs">
                                  <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                                    Failures: Q:{fb.quota} | T:{fb.timeout} | Tool:{fb.toolFailure} | Check:{fb.checkFailure}
                                  </Text>
                                </Row>
                              </Row>
                            </Card>
                            );
                          })}
                        </Stack>
                      </Stack>
                    </Card>
                  ))
                )}
              </Stack>
            </Card>
          </Collapsible>

        </Stack>
      ) : activeTab === "tree" ? (
        <UppidiFleetTreeView
          agentsData={agentsData}
          isLoading={agentsLoading}
          onRefresh={refetchAgents}
          navigation={props.navigation}
          onArchiveAgent={handleArchiveAgent}
          onArchiveBulk={handleArchiveBulk}
          isArchiving={isBulkArchiving}
          selectedRepo={selectedRepo}
          registeredFrontDeskAgentId={hookStatus?.frontDesk?.agentId ?? null}
        />
      ) : (
        <Stack gap={6}>
          {/* Fleet Attention Board (#534): blocked agents need immediate clearance */}
          {attentionAgents.length > 0 && (
            <Card variant="tinted" style={{ borderColor: colors.statusWarning, borderWidth: 1 }}>
              <CardHeader
                title={`Fleet Needs Attention (${attentionAgents.length})`}
                subtitle={
                  permissionAgentCount > 0
                    ? `${permissionAgentCount} agent${
                        permissionAgentCount === 1 ? "" : "s"
                      } awaiting permission clearance`
                    : "Agents blocked awaiting operator input"
                }
                icon="BellRing"
              />
              <Stack gap="xs">
                {attentionAgents.slice(0, 5).map((agent) => (
                  <AttentionAgentCard
                    key={agent.id}
                    agent={agent}
                    onOpen={handleOpenAgent}
                  />
                ))}
                {attentionAgents.length > 5 && (
                  <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                    +{attentionAgents.length - 5} more blocked agents — see the Agents &amp; Fleet tab.
                  </Text>
                )}
              </Stack>
            </Card>
          )}

          {/* Dense Metrics Bar (#424) */}
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
            <InteractiveRow
              onPress={() => setFilter("all")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: filter === "all" ? (colors.surface2 ?? "rgba(255,255,255,0.08)") : "transparent",
              }}
              pressedOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Filter all open issues"
            >
              <Icon name="CircleDot" size={13} color={colors.accent} />
              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                Open issues:
              </Text>
              <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 12 }}>
                {issuesData?.openCount ?? rawIssues.length}
              </Text>
            </InteractiveRow>

            <View style={{ width: 1, height: 14, backgroundColor: colors.border }} />

            <InteractiveRow
              onPress={() => setFilter("needs-you")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: filter === "needs-you" ? (colors.surface2 ?? "rgba(255,255,255,0.08)") : "transparent",
              }}
              pressedOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Filter needs your attention"
            >
              <Icon
                name="Bot"
                size={13}
                color={(issuesData?.needsYouCount ?? 0) > 0 ? (colors.statusWarning ?? "#f59e0b") : colors.foregroundMuted}
              />
              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                Needs your attention:
              </Text>
              <Text
                style={{
                  color: (issuesData?.needsYouCount ?? 0) > 0 ? (colors.statusWarning ?? "#f59e0b") : colors.foreground,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                {issuesData?.needsYouCount ?? 0}
              </Text>
            </InteractiveRow>

            <View style={{ width: 1, height: 14, backgroundColor: colors.border }} />

            <InteractiveRow
              onPress={() => setFilter("triage-review")}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: filter === "triage-review" ? (colors.surface2 ?? "rgba(255,255,255,0.08)") : "transparent",
              }}
              pressedOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Filter awaiting review"
            >
              <Icon
                name="GitPullRequest"
                size={13}
                color={(issuesData?.reviewCount ?? 0) > 0 ? (colors.accent ?? "#38bdf8") : colors.foregroundMuted}
              />
              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                Awaiting review:
              </Text>
              <Text
                style={{
                  color: (issuesData?.reviewCount ?? 0) > 0 ? (colors.accent ?? "#38bdf8") : colors.foreground,
                  fontWeight: "700",
                  fontSize: 12,
                }}
              >
                {issuesData?.reviewCount ?? 0}
              </Text>
            </InteractiveRow>
          </Row>

          {/* Action Bar & Filter Buttons */}
          <ActionBar align="space-between" style={{ paddingVertical: 2 }}>
            <Row wrap gap="xs" align="center">
              {issuePresetFilters.map(({ id, label }) => {
                let count = 0;
                if (id === "all") count = rawIssues.length;
                else if (id === "needs-you") {
                  count = rawIssues.filter((i) => i.attention === "attention/2-user").length;
                } else if (id === "needs-attention") {
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
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      minHeight: 22,
                    }}
                    onPress={() => setFilter(id)}
                  />
                );
              })}
            </Row>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 10 }}>
              {selectedRepo === "all" ? "All Repositories" : `Repo: ${selectedRepo}`}
            </Text>
          </ActionBar>

          {/* Work Queue (Full Width) (#425) */}
          <Card variant="elevated" style={{ width: "100%" }}>
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
                    if (visible[0]) {
                      toast.show(`Worktree dispatch requested for #${visible[0].number}`);
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
                      variant="ghost"
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

          {/* Center Modal for Selected Work (#425) */}
          {selected && (
            <Modal
              title={`#${selected.number} · ${selected.title}`}
              open={selectedNumber !== null}
              onOpenChange={(open) => {
                if (!open) setSelectedNumber(null);
              }}
            >
              <ModalContent size="large">
                <Stack gap="xs">
                  <Row justify="space-between" align="center" wrap gap="xs">
                    <Text style={{ color: colors.accent, ...typography.caption, fontWeight: "600" }}>
                      {selected.repo} #{selected.number}
                    </Text>
                    <Row wrap gap="xs">
                      <Badge label={selected.status} variant={statusVariant(selected.status)} size="sm" />
                      <Badge label={attentionMap[selected.attention]} variant="neutral" size="sm" />
                      {selected.comments > 0 && (
                        <Badge label={`${selected.comments} comments`} variant="neutral" size="sm" />
                      )}
                    </Row>
                  </Row>

                  <Text style={{ color: colors.foreground, ...typography.heading, fontSize: 16, fontWeight: "700" }}>
                    {selected.title}
                  </Text>

                  {toList(selected.labels).length > 0 && (
                    <Row wrap gap="xxs">
                      {toList(selected.labels).map((l) => (
                        <Badge key={l} label={l} variant="neutral" size="sm" textStyle={{ fontSize: 10 }} />
                      ))}
                    </Row>
                  )}

                  <KeyValue
                    label="Worktree branch"
                    value={selected.branch ?? "No worktree dispatched yet"}
                    copyable={!!selected.branch}
                  />

                  {/* Actions: Dispatch Worktree, Open in Forgejo, Close */}
                  <Row justify="flex-end" align="center" wrap gap="xs" style={{ marginTop: 8 }}>
                    <Button
                      label="Close"
                      variant="ghost"
                      size="sm"
                      onPress={() => setSelectedNumber(null)}
                    />
                    {selected.url && (
                      <Button
                        label="Open in Forgejo"
                        icon="ExternalLink"
                        variant="secondary"
                        size="sm"
                        onPress={() => Linking.openURL(selected.url!)}
                      />
                    )}
                    <Button
                      label="Dispatch Worktree"
                      icon="ArrowRight"
                      variant="primary"
                      size="sm"
                      onPress={() => {
                        toast.show(`Worktree dispatch requested for #${selected.number}`);
                      }}
                    />
                  </Row>
                </Stack>
              </ModalContent>
            </Modal>
          )}
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

export const UppidiForgeSurface = UppidiFleetSurface;
