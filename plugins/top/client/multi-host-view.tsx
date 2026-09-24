import React, { useMemo } from "react";
import { Text } from "react-native";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  KeyValue,
  KeyValueGroup,
  Row,
  SectionHeader,
  Stack,
  StatusDot,
  usePluginTheme,
} from "paseo-plugin-helper/client";
import {
  aggregateFleet,
  type FleetHostSnapshot,
  type FleetHostStatus,
} from "../shared/multi-host";
import { useFleetPolling } from "./multi-host";

const STATUS_VARIANT: Record<
  FleetHostStatus,
  "success" | "warning" | "neutral" | "danger"
> = {
  online: "success",
  stale: "warning",
  offline: "neutral",
  error: "danger",
};

const STATUS_LABEL: Record<FleetHostStatus, string> = {
  online: "online",
  stale: "stale",
  offline: "offline",
  error: "error",
};

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) return "--";
  if (latencyMs < 1000) return `${Math.round(latencyMs)} ms`;
  return `${(latencyMs / 1000).toFixed(2)} s`;
}

function formatStaleAge(
  staleAt: number | null,
  now: number,
): string | null {
  if (staleAt === null) return null;
  const seconds = Math.max(0, Math.round((now - staleAt) / 1000));
  return `stale ${seconds}s`;
}

function FleetHostCard({
  snapshot,
  now,
}: {
  snapshot: FleetHostSnapshot;
  now: number;
}) {
  const { colors } = usePluginTheme();
  const variant = STATUS_VARIANT[snapshot.status];
  const staleAge = formatStaleAge(snapshot.staleAt, now);
  const subtitle =
    snapshot.status === "online"
      ? "Connected"
      : (staleAge ?? snapshot.error ?? "Not connected");

  return (
    <Card variant="elevated">
      <CardHeader
        icon="Server"
        title={snapshot.label}
        subtitle={subtitle}
        badge={
          <Row gap={6} align="center">
            <StatusDot
              variant={snapshot.status === "online" ? "success" : variant}
              pulse={snapshot.status === "online"}
            />
            <Badge
              label={STATUS_LABEL[snapshot.status]}
              variant={variant}
              size="sm"
            />
          </Row>
        }
      />
      <KeyValueGroup>
        <KeyValue label="Host" value={snapshot.serverId} truncate="middle" copyable />
        <KeyValue label="Latency" value={formatLatency(snapshot.latencyMs)} />
        <KeyValue
          label="Agents"
          value={snapshot.counts ? String(snapshot.counts.agents) : "--"}
        />
        <KeyValue
          label="Active agents"
          value={snapshot.counts ? String(snapshot.counts.activeAgents) : "--"}
        />
        <KeyValue
          label="Workspaces"
          value={snapshot.counts ? String(snapshot.counts.workspaces) : "--"}
        />
      </KeyValueGroup>
      {snapshot.status === "error" && snapshot.error ? (
        <Text style={{ marginTop: 8, fontSize: 11, color: colors.statusDanger }}>
          {snapshot.error}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * Multi-host Fleet view. Renders one card per configured host with a status
 * badge and per-host counts, plus a counts-only aggregate. Local Top gauges
 * (CPU/RAM) stay in the Activity tab and are never summed or averaged here.
 *
 * Mounting is the lifecycle: this component is rendered only while the Fleet
 * tab is active, so it starts polling on mount and disposes on unmount. Local
 * Top behavior is unaffected whenever the tab is not selected.
 */
export function FleetView() {
  const { colors } = usePluginTheme();
  const snapshots = useFleetPolling();
  const now = Date.now();
  const aggregate = useMemo(() => aggregateFleet(snapshots), [snapshots]);

  if (snapshots.length === 0) {
    return (
      <EmptyState
        icon="Server"
        title="No other hosts"
        description="Configure additional hosts in Paseo to see their fleet status here."
      />
    );
  }

  return (
    <Stack gap={12}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
        Multi-Host Fleet
      </Text>

      <Card variant="elevated">
        <CardHeader
          title="Fleet Totals"
          icon="Activity"
          subtitle="Counts only. CPU/RAM/load stay per-host."
        />
        <KeyValueGroup>
          <KeyValue label="Hosts" value={`${aggregate.responsive}/${aggregate.hosts} responsive`} />
          <KeyValue
            label="Online / Stale"
            value={`${aggregate.online} / ${aggregate.stale}`}
          />
          <KeyValue label="Agents" value={String(aggregate.counts.agents)} />
          <KeyValue
            label="Active agents"
            value={String(aggregate.counts.activeAgents)}
          />
          <KeyValue label="Workspaces" value={String(aggregate.counts.workspaces)} />
        </KeyValueGroup>
      </Card>

      <SectionHeader title="Hosts" count={snapshots.length} />
      {snapshots.map((snapshot) => (
        <FleetHostCard
          key={snapshot.serverId}
          snapshot={snapshot}
          now={now}
        />
      ))}
    </Stack>
  );
}
