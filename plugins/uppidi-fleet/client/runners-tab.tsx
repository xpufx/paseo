import React, { useMemo, useState } from "react";
import { View, Text } from "react-native";
import {
  ActionBar,
  AttentionBeacon,
  Badge,
  Button,
  Card,
  CardHeader,
  Collapsible,
  Grid,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  Row,
  Select,
  StatusDot,
  Stack,
  Tabs,
  type SelectOption,
} from "./host-ui.js";
import { useRpcQuery, useRpcMutation } from "paseo-plugin-helper/core";
import { useFleetTheme } from "./theme.js";
import {
  uppidiFleetScaleHostContract,
  uppidiFleetDrainHostContract,
  uppidiRunnersContract,
  type UppidiFleetScaleHost,
  type UppidiFleetDrainHost,
  type UppidiRunner,
  type UppidiFleetStatus,
  type UppidiRunnerSource,
  getRunnerStatusConfig,
} from "../shared/contracts.js";
import {
  RunnerPreset,
  RunnerSortField,
  SortDirection,
  filterRunners,
  sortRunners,
  isRepoMatching,
} from "../shared/sort-filter.js";

const runnerTabs = [
  { id: "hosts", label: "Hosts", shortLabel: "Hosts", icon: "Server" },
  { id: "gauges", label: "Capacity Gauges", shortLabel: "Gauges", icon: "ChartBar" },
  { id: "dind", label: "DinD Status", shortLabel: "DinD", icon: "Docker" },
  { id: "jobs", label: "Active Jobs", shortLabel: "Jobs", icon: "PlayCircle" },
];

function RunnerHostCard({
  runner,
  repoFilter,
}: {
  runner: UppidiRunner;
  repoFilter?: string;
}) {
  const { colors, typography } = useFleetTheme();
  const statusConfig = getRunnerStatusConfig(runner.status);

  const repoMatches =
    !repoFilter ||
    runner.scope === "repo"
      ? isRepoMatching(runner.name ?? "", repoFilter!) ||
        (runner.name ?? "").toLowerCase() === (repoFilter ?? "").toLowerCase()
      : true;

  if (!repoMatches) return null;

  return (
    <Card key={runner.id} variant="flat" style={{ marginBottom: 4 }}>
      <Row justify="space-between" align="center" wrap gap="xs">
        <Stack gap="xxs">
          <Row align="center" gap="xs">
            <StatusDot variant={statusConfig.badgeVariant} />
            <Text style={{ color: colors.foreground, ...typography.heading, flex: 1 }}>
              {runner.name}
            </Text>
            <Badge label={runner.scope} variant="neutral" size="sm" />
          </Row>
          <Row gap="xs" wrap align="center">
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 10 }}>
              {runner.id.slice(0, 8)}…
            </Text>
            {runner.description && (
              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 10 }}>
                {runner.description}
              </Text>
            )}
          </Row>
        </Stack>
        <Row align="center" gap="xs">
          <Badge
            label={runner.available ? "available" : "unavailable"}
            variant={statusConfig.badgeVariant}
            size="sm"
          />
          <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 10 }}>
            {runner.scope}
          </Text>
        </Row>
      </Row>
    </Card>
  );
}

function RunnerCapacityGauge({
  label,
  value,
  max = 100,
  min = 0,
}: {
  label: string;
  value: number | undefined;
  max?: number;
  min?: number;
}) {
  const { colors, typography } = useFleetTheme();
  const pct = Math.max(min, Math.min(max, (value ?? 0) / (max ?? 1) * 100));
  const barColor =
    pct >= 80
      ? "danger"
      : pct >= 50
        ? "warning"
        : "success";

  return (
    <Card variant="flat" style={{ marginBottom: 8 }}>
      <CardHeader title={label} style={{ flexDirection: "row", justifyContent: "space-between" }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
        <Text style={{ color: colors.foreground, ...typography.caption }}>{label}</Text>
        <Text style={{ color: barColor, ...typography.caption, fontWeight: "600" }}>
          {pct.toFixed(0)}%
        </Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.surface1, borderRadius: 4, overflow: "hidden" }}>
        <View
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: barColor,
            borderRadius: 4,
          }}
        />
      </View>
    </Card>
  );
}

function DinDHealthBadge({
  dinDStatus,
}: {
  dinDStatus?: "running" | "stopped" | "unhealthy" | null;
}) {
  const { colors } = useFleetTheme();

  const variantMap: Record<
    "running" | "stopped" | "unhealthy",
    "success" | "warning" | "danger"
  > = {
    running: "success",
    stopped: "warning",
    unhealthy: "danger",
  };

  const nullVariant: "neutral" = "neutral";

  const badgeVariant =
    dinDStatus !== undefined && dinDStatus !== null
      ? variantMap[dinDStatus]
      : nullVariant;

  return (
    <Badge
      label={"DinD " + (dinDStatus ?? "unknown")}
      variant={badgeVariant}
      size="sm"
    />
  );
}

function ActiveJobInspector({
  runners,
  repoFilter,
}: {
  runners: UppidiRunner[];
  repoFilter?: string;
}) {
  const activeRunners = runners.filter(
    (r) => r.available && r.status === "active",
  );
  const { colors, typography } = useFleetTheme();

  return (
    <Card variant="flat" style={{ marginBottom: 8 }}>
      <CardHeader title="Active Jobs" />
      <Row justify="space-between" align="center" wrap gap="xs">
        <Text style={{ color: colors.foreground, ...typography.heading }}>
          Active Jobs ({activeRunners.length})
        </Text>
        <Badge
          label={activeRunners.length.toString()}
          variant="info"
          size="sm"
        />
      </Row>
      {activeRunners.length === 0 ? (
        <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
          No active jobs running.
        </Text>
      ) : (
        activeRunners.slice(0, 5).map((runner) => (
          <Row key={runner.id} align="center" gap="xs" wrap style={{ marginTop: 4 }}>
            <StatusDot variant={getRunnerStatusConfig(runner.status).badgeVariant} />
            <Text style={{ color: colors.foreground, ...typography.body, flex: 1 }}>
              {runner.name}
            </Text>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 10 }}>
              {runner.scope}
            </Text>
          </Row>
        ))
      )}
    </Card>
  );
}

function RunnerPermissionBanner({
  fleetStatus,
  error,
  sources,
}: {
  fleetStatus?: UppidiFleetStatus;
  error?: string;
  sources?: UppidiRunnerSource[];
}) {
  const { colors, typography } = useFleetTheme();

  const isForbidden =
    fleetStatus === "forbidden" ||
    sources?.some((s) => s.httpStatus === 403 || s.error?.includes("403"));
  const isUnreachable =
    fleetStatus === "unreachable" ||
    sources?.some((s) => s.failure === "unreachable");

  if (!isForbidden && !isUnreachable && !error) {
    return null;
  }

  const title = isForbidden
    ? "Permission Restricted (403 Forbidden)"
    : isUnreachable
      ? "Runner Fleet Unreachable"
      : "Fleet Warning";

  const defaultExplanation = isForbidden
    ? "The current API token lacks read:organization or read:admin permissions, or the user is not the repository owner. Runner fleet capacity cannot be queried."
    : "Unable to contact the runner endpoints. Check network connectivity or Forgejo runner daemon status.";

  const failedSources = sources?.filter((s) => !s.ok && s.kind === "forgejo-runners");

  return (
    <Card
      variant="tinted"
      style={{
        borderColor: isForbidden ? colors.statusWarning : colors.statusDanger,
        borderWidth: 1,
        marginBottom: 8,
      }}
    >
      <Stack gap="xs">
        <Row align="center" gap="xs">
          <StatusDot variant={isForbidden ? "warning" : "danger"} />
          <Text style={{ color: colors.foreground, ...typography.heading, fontSize: 13, flex: 1 }}>
            {title}
          </Text>
          <Badge
            label={isForbidden ? "403 Forbidden" : "Unreachable"}
            variant={isForbidden ? "warning" : "danger"}
            size="sm"
          />
        </Row>
        <Text style={{ color: colors.foregroundMuted, ...typography.body, fontSize: 12 }}>
          {error || defaultExplanation}
        </Text>
        {failedSources && failedSources.length > 0 && (
          <Stack gap="xxs" style={{ marginTop: 4 }}>
            {failedSources.map((source) => (
              <Row key={`${source.kind}:${source.key}`} align="center" gap="xs">
                <Badge label={source.key} variant="neutral" size="sm" />
                <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11, flex: 1 }}>
                  {source.endpoint ? `${source.endpoint} — ` : ""}{source.error ?? "Access denied"}
                </Text>
              </Row>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

export function RunnersTab({
  runnersData,
  scaleHostData,
  drainHostData,
  repoOptions,
  selectedRepo,
  onRepoChange,
}: {
  runnersData: {
    ok: boolean;
    runners: UppidiRunner[];
    fleetStatus?: UppidiFleetStatus;
    error?: string;
    totalCount?: number;
    onlineCount?: number;
    sources?: UppidiRunnerSource[];
  };
  scaleHostData: UppidiFleetScaleHost;
  drainHostData: UppidiFleetDrainHost;
  repoOptions: SelectOption[];
  selectedRepo: string;
  onRepoChange: (repo: string) => void;
}) {
  const { colors, typography } = useFleetTheme();
  const [activeTab, setActiveTab] = useState<"hosts" | "gauges" | "dind" | "jobs">("hosts");
  const setActiveTabHandler = (tabId: string) => setActiveTab(tabId as any);
  const [runnerPreset, setRunnerPreset] = useState<RunnerPreset>("all");
  const [runnerQuery, setRunnerQuery] = useState("");

  const rawRunners = useMemo(() => runnersData.runners, [runnersData]);
  const visibleRunners = useMemo(() => {
    const filtered = filterRunners(rawRunners, runnerPreset, runnerQuery);
    return sortRunners(filtered, "name" as RunnerSortField, "asc" as SortDirection);
  }, [rawRunners, runnerPreset, runnerQuery]);

  const repoFilter =
    selectedRepo !== "all"
      ? selectedRepo
      : undefined;

  return (
    <Stack gap={6}>
      <Tabs tabs={runnerTabs} activeTab={activeTab} onTabChange={setActiveTabHandler} />
      <RunnerPermissionBanner
        fleetStatus={runnersData.fleetStatus}
        error={runnersData.error}
        sources={runnersData.sources}
      />
      <Collapsible
        title="Host Runner Cards"
        icon="Server"
        isExpanded={true}
        onToggle={() => {}}
      >
        {visibleRunners.map((r) => (
          <RunnerHostCard runner={r} repoFilter={repoFilter} key={r.id} />
        ))}
        {visibleRunners.length === 0 && (
          <Card variant="flat" style={{ marginBottom: 4 }}>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
              {runnersData.fleetStatus === "forbidden"
                ? "No runners accessible: token permissions restricted (read:organization or read:admin permissions or repo owner required)."
                : runnersData.fleetStatus === "unreachable"
                  ? "No runners available: Forgejo runner API is unreachable."
                  : "No runners registered or matching the selected scope."}
            </Text>
          </Card>
        )}
      </Collapsible>

      <Collapsible
        title="Capacity Gauges"
        icon="ChartBar"
        isExpanded={true}
        onToggle={() => {}}
      >
        <RunnerCapacityGauge label="CPU Usage" value={scaleHostData.cpuPct} />
        <RunnerCapacityGauge label="Memory Usage" value={scaleHostData.memoryPct} />
        <RunnerCapacityGauge
          label="Runner Slots"
          value={scaleHostData.runnerCount}
          max={scaleHostData.onlineCount ?? 100}
/>
      </Collapsible>

      <Collapsible
        title="DinD Status"
        icon="Docker"
        isExpanded={true}
        onToggle={() => {}}
      >
        <DinDHealthBadge
          dinDStatus={
            drainHostData.ok
              ? (drainHostData.dinDRunning ? "running" : drainHostData.dinDHealthy ? "stopped" : null)
              : null
          }
        />
        {!drainHostData.ok && (
          <Text style={{ color: colors.statusDanger, ...typography.caption }}>
            Failed to load DinD status: {drainHostData.error ?? "unreachable"}
          </Text>
        )}
      </Collapsible>

      <Collapsible
        title="Active Jobs"
        icon="PlayCircle"
        isExpanded={true}
        onToggle={() => {}}
      >
        <ActiveJobInspector runners={visibleRunners} repoFilter={repoFilter} />
      </Collapsible>

      <Collapsible
        title="Shell Runner Drawer"
        icon="Terminal"
        isExpanded={true}
        onToggle={() => {}}
      >
        <ActiveJobInspector runners={visibleRunners} repoFilter={repoFilter} />
      </Collapsible>
    </Stack>
  );
}