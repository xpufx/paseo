import { type PluginSurfaceProps } from "@getpaseo/plugin/client";
import React, { useMemo } from "react";
import { Text, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  SectionHeader,
  StatusDot,
  usePluginTheme,
  useRpcQuery,
} from "./vendor/paseo-plugin-helper/index";
import { formatPeerDisplay } from "./peer-label";
import { ViaXComms } from "./via-x-comms";
import { peerStatusRpc } from "../shared/registry";

const X_COMMS_CONTENT_MAX_WIDTH = 600;
const PEER_STATUS_POLL_MS = 30_000;

type PeerStatusEntry = {
  name: string;
  value: string;
  valid: boolean;
  reachable: boolean;
  error: string | null;
  transport: "relay" | "direct" | "unknown";
  serverId: string | null;
  hostname: string | null;
  version: string | null;
  pid: number | null;
  listen: string | null;
  relayEnabled: boolean | null;
  relayEndpoint: string | null;
  providerCount: number | null;
  providersAvailable: number | null;
  hubState: string | null;
  hubDaemonId: string | null;
  hubOrigin: string | null;
  hubLastError: string | null;
};

function ReachabilityBadge({ entry }: { entry: PeerStatusEntry }) {
  if (!entry.reachable) return <Badge label="down" variant="danger" dot />;
  if (!entry.valid) return <Badge label="invalid" variant="warning" dot />;
  return <Badge label="up" variant="success" dot />;
}

function relayLabel(entry: PeerStatusEntry): string {
  if (entry.relayEnabled === null) return "unknown";
  if (!entry.relayEnabled) return "disabled";
  return entry.relayEndpoint ? `enabled · ${entry.relayEndpoint}` : "enabled";
}

function providersLabel(entry: PeerStatusEntry): string {
  if (entry.providerCount === null) return "unknown";
  const available = entry.providersAvailable ?? 0;
  return `${available}/${entry.providerCount} available`;
}

function hubLabel(entry: PeerStatusEntry): string {
  if (!entry.hubState) return "unknown";
  const parts = [entry.hubState];
  if (entry.hubOrigin) parts.push(entry.hubOrigin);
  if (entry.hubLastError) parts.push(`error: ${entry.hubLastError}`);
  return parts.join(" · ");
}

function PeerCard({ entry }: { entry: PeerStatusEntry }) {
  const { colors } = usePluginTheme();
  return (
    <Card variant="elevated">
      <Card.Header
        title={formatPeerDisplay(entry.name, entry.serverId)}
        subtitle={entry.hostname && entry.hostname !== entry.name ? entry.hostname : undefined}
        badge={<ReachabilityBadge entry={entry} />}
      />
      <KeyValue label="Host value" value={entry.value} mono copyable truncate="end" truncateMaxLength={36} />
      <KeyValueGroup>
        <KeyValue label="Transport" value={entry.transport} mono />
        <KeyValue label="Version" value={entry.version ?? ""} mono />
        <KeyValue label="Listen" value={entry.listen ?? ""} copyable mono />
        <KeyValue
          label="PID"
          value={entry.pid === null ? "" : String(entry.pid)}
          mono
        />
        <KeyValue label="Relay" value={relayLabel(entry)} mono />
        <KeyValue label="Providers" value={providersLabel(entry)} mono />
      </KeyValueGroup>
      <KeyValue label="Hub relationship" value={hubLabel(entry)} mono />
      {!entry.reachable ? (
        <Text selectable style={{ color: colors.statusDanger, fontSize: 12 }}>
          {entry.error ?? "unreachable"}
        </Text>
      ) : null}
    </Card>
  );
}

/**
 * Live reachability/identity view of the known peer daemons (#7). Renders the
 * client-side x-comms registry and probes each registered host with its own
 * `daemon.get_status`; an unreachable host shows as down without failing the
 * rest of the surface.
 */
export function PeerStatusSurface({ theme }: PluginSurfaceProps) {
  const { colors } = usePluginTheme();
  const status = useRpcQuery(peerStatusRpc, {}, {
    staleTime: PEER_STATUS_POLL_MS / 2,
    refetchInterval: PEER_STATUS_POLL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const entries = status.data?.results ?? [];
  const summary = useMemo(() => {
    const up = entries.filter((entry) => entry.reachable).length;
    return { up, total: entries.length };
  }, [entries]);

  return (
    <ModalBody
      headerMode="pinned"
      maxContentWidth={X_COMMS_CONTENT_MAX_WIDTH}
      header={
        <Card variant="elevated">
          <Card.Header
            title="Known peer daemons"
            subtitle="Registry entries probed live with each peer's daemon.get_status."
            badge={
              status.isPending
                ? <Badge label="probing…" variant="neutral" dot />
                : <Badge label={`${summary.up}/${summary.total} up`} variant={summary.total > 0 && summary.up === summary.total ? "success" : "warning"} dot />
            }
            action={
              <Button
                label="Refresh"
                size="sm"
                variant="secondary"
                icon="RefreshCw"
                loading={status.isFetching}
                disabled={status.isFetching}
                onPress={() => void status.refetch()}
              />
            }
          />
        </Card>
      }
      refreshing={status.isFetching}
      onRefresh={() => void status.refetch()}
      contentContainerStyle={{ paddingTop: 6 }}
    >
      <SectionHeader title="Peers" count={entries.length} />

      {status.isPending ? (
        <Card>
          <Card.Header title="Probing peers…" subtitle="Dialing each registered daemon." />
        </Card>
      ) : null}

      {status.error ? (
        <Card variant="elevated">
          <Card.Header
            title="Probe RPC failed"
            subtitle={status.error.message}
            badge={<Badge label="error" variant="danger" dot />}
          />
        </Card>
      ) : null}

      {!status.isPending && !status.error && entries.length === 0 ? (
        <EmptyState
          title="No known peer daemons."
          description="Add a paired daemon in the Current surface; it will appear here with live status."
        />
      ) : null}

      {entries.map((entry) => (
        <PeerCard key={entry.name} entry={entry} />
      ))}

      {entries.length > 0 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <StatusDot
            variant={summary.total > 0 && summary.up === summary.total ? "success" : "warning"}
            size="sm"
          />
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            {summary.up} of {summary.total} known peers reachable.
          </Text>
        </View>
      ) : null}

      <ViaXComms theme={theme} />
    </ModalBody>
  );
}
