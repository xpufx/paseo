import React, { useMemo } from "react";
import { Text } from "react-native";
import {
  HostBadge,
  HostCard,
  HostCardHeader,
  HostEmptyState,
  HostGrid,
  HostKeyValue,
  HostRow,
  HostSectionHeader,
  HostStack,
  HostStatusDot,
  useHostLayout,
  useHostTheme,
} from "./host-ui";
import {
  aggregateFleet,
  type FleetHostSnapshot,
  type FleetHostStatus,
} from "../shared/multi-host";
import { multiHostSupported, useFleetPolling } from "./multi-host";

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
  const { colors } = useHostTheme();
  const { compact } = useHostLayout();
  const variant = STATUS_VARIANT[snapshot.status];
  const staleAge = formatStaleAge(snapshot.staleAt, now);
  const subtitle =
    snapshot.status === "online"
      ? "Connected"
      : (staleAge ?? snapshot.error ?? "Not connected");

  return (
    <HostCard variant="elevated">
      <HostCardHeader
        icon="Server"
        title={snapshot.label}
        subtitle={subtitle}
        badge={
          <HostRow gap={6} align="center">
            <HostStatusDot
              variant={snapshot.status === "online" ? "success" : variant}
              pulse={snapshot.status === "online"}
            />
            <HostBadge
              label={STATUS_LABEL[snapshot.status]}
              variant={variant}
              size="sm"
            />
          </HostRow>
        }
      />
      <HostGrid columns={compact ? 1 : 2} gap={12}>
        <HostKeyValue label="Host" value={snapshot.serverId} truncate="middle" copyable />
        <HostKeyValue label="Latency" value={formatLatency(snapshot.latencyMs)} />
        <HostKeyValue
          label="Agents"
          value={snapshot.counts ? String(snapshot.counts.agents) : "--"}
        />
        <HostKeyValue
          label="Active agents"
          value={snapshot.counts ? String(snapshot.counts.activeAgents) : "--"}
        />
        <HostKeyValue
          label="Workspaces"
          value={snapshot.counts ? String(snapshot.counts.workspaces) : "--"}
        />
      </HostGrid>
      {snapshot.status === "error" && snapshot.error ? (
        <Text style={{ marginTop: 8, fontSize: 11, color: colors.statusDanger }}>
          {snapshot.error}
        </Text>
      ) : null}
    </HostCard>
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
  const { colors } = useHostTheme();
  const snapshots = useFleetPolling();
  const now = Date.now();
  const aggregate = useMemo(() => aggregateFleet(snapshots), [snapshots]);

  // A host that does not supply `useHosts`/`getPaseoClient` (the mobile bundle)
  // cannot borrow remote clients. Say so instead of throwing.
  if (!multiHostSupported()) {
    return (
      <HostEmptyState
        icon="Server"
        title="Multi-host fleet unavailable"
        description="This host build does not provide multi-host access. Open Paseo on desktop to see other hosts."
      />
    );
  }

  if (snapshots.length === 0) {
    return (
      <HostEmptyState
        icon="Server"
        title="No other hosts"
        description="Configure additional hosts in Paseo to see their fleet status here."
      />
    );
  }

  return (
    <HostStack gap={12}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
        Multi-Host Fleet
      </Text>

      <HostCard variant="elevated">
        <HostCardHeader
          title="Fleet Totals"
          icon="Activity"
          subtitle="Counts only. CPU/RAM/load stay per-host."
        />
        <HostGrid columns={2} gap={12}>
          <HostKeyValue label="Hosts" value={`${aggregate.responsive}/${aggregate.hosts} responsive`} />
          <HostKeyValue
            label="Online / Stale"
            value={`${aggregate.online} / ${aggregate.stale}`}
          />
          <HostKeyValue label="Agents" value={String(aggregate.counts.agents)} />
          <HostKeyValue
            label="Active agents"
            value={String(aggregate.counts.activeAgents)}
          />
          <HostKeyValue label="Workspaces" value={String(aggregate.counts.workspaces)} />
        </HostGrid>
      </HostCard>

      <HostSectionHeader title="Hosts" count={snapshots.length} />
      {snapshots.map((snapshot) => (
        <FleetHostCard
          key={snapshot.serverId}
          snapshot={snapshot}
          now={now}
        />
      ))}
    </HostStack>
  );
}
