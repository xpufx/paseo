import { useMutation, useQuery } from "@tanstack/react-query";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActionBar,
  Badge,
  Button,
  Card,
  Collapsible,
  EmptyState,
  FormRow,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  SectionHeader,
  StatusDot,
  TextInput,
  Toggle,
} from "paseo-plugin-helper/client";
import { formatPeerDisplay } from "./peer-label";
import { ViaXComms } from "./via-x-comms";
import {
  daemonAddRpc,
  daemonHealthRpc,
  daemonRemoveRpc,
  directHostMismatch,
  identitySyncRpc,
  registryReadRpc,
  serverCheckRpc,
  serverStatusRpc,
  snapshotRefreshRpc,
  uiPrefsGetRpc,
  uiPrefsSetRpc,
} from "../shared/registry";

const HOST_FORM_HINT =
  "Full pairing link (https://app.paseo.sh/#offer=…) or a direct daemon host (host:port, tcp://…, unix://…).";

// Keep the settings surface a readable centered column instead of stretching
// edge-to-edge on large viewports. The cap lives in the helper
// (`ModalBody maxContentWidth`); this is the only place the surface picks
// the value.
const X_COMMS_CONTENT_MAX_WIDTH = 600;

// Prototype settings surface for #97. Built only from paseo-plugin-helper/client
// primitives; the current page in main.tsx is untouched and stays the default tab.
// Wired to the live registry/health/server/prefs RPCs — no local mock state.

function ReachabilityBadge({
  health,
}: {
  health?: { reachable: boolean; agentCount: number | null } | null;
}) {
  if (!health) return <Badge label="checking…" variant="neutral" dot />;
  if (health.reachable) {
    return (
      <Badge
        label={health.agentCount !== null ? `reachable (${health.agentCount} agents)` : "reachable"}
        variant="success"
        dot
      />
    );
  }
  return <Badge label="unreachable" variant="danger" dot />;
}

function ErrorRow({ label, message }: { label: string; message?: string | null }) {
  if (!message) return null;
  return (
    <FormRow label={label} description={message}>
      <Badge label="error" variant="danger" dot />
    </FormRow>
  );
}

export function SettingsPrototype({ theme }: PluginSurfaceProps) {
  const callRead = useRpc(registryReadRpc);
  const callHealth = useRpc(daemonHealthRpc);
  const callAdd = useRpc(daemonAddRpc);
  const callRemove = useRpc(daemonRemoveRpc);
  const callPrefsGet = useRpc(uiPrefsGetRpc);
  const callPrefsSet = useRpc(uiPrefsSetRpc);
  const callSnapshotRefresh = useRpc(snapshotRefreshRpc);
  const callIdentitySync = useRpc(identitySyncRpc);
  const callStatus = useRpc(serverStatusRpc);
  const callCheck = useRpc(serverCheckRpc);

  const read = useQuery({ queryKey: ["registry-read"], queryFn: () => callRead({}) });
  const health = useQuery({
    queryKey: ["daemon-health"],
    queryFn: () => callHealth({}),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const prefs = useQuery({ queryKey: ["ui-prefs"], queryFn: () => callPrefsGet({}) });
  const status = useQuery({ queryKey: ["server-status"], queryFn: () => callStatus({}) });
  const check = useQuery({ queryKey: ["server-check"], queryFn: () => callCheck({}), retry: false });

  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refetchAll = useCallback(() => {
    void read.refetch();
    void health.refetch();
    void prefs.refetch();
  }, [read, health, prefs]);

  const add = useMutation({ mutationFn: callAdd, onSuccess: refetchAll });
  const remove = useMutation({
    mutationFn: callRemove,
    onSuccess: () => {
      setConfirmRemove(null);
      refetchAll();
    },
  });
  const prefsSet = useMutation({ mutationFn: callPrefsSet });
  const identitySync = useMutation({
    mutationFn: () => callIdentitySync({}),
    onSuccess: () => void read.refetch(),
  });
  const snapshotRefresh = useMutation({
    mutationFn: () => callSnapshotRefresh({}),
    onSuccess: () => {
      setRefreshing(false);
      refetchAll();
      void status.refetch();
      void check.refetch();
    },
    onError: () => setRefreshing(false),
  });

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void identitySync
      .mutateAsync()
      .then(() => snapshotRefresh.mutate())
      .catch(() => snapshotRefresh.mutate());
  }, [identitySync, snapshotRefresh]);

  const healthByName = useMemo(() => {
    const map: Record<string, { reachable: boolean; error: string | null; agentCount: number | null }> = {};
    for (const result of health.data?.results ?? []) map[result.name] = result;
    return map;
  }, [health.data]);

  const daemonEnabled = prefs.data?.daemonEnabled ?? {};
  const prereqsCollapsed = prefs.data?.prereqsCollapsed ?? true;
  const presenceEnabled = prefs.data?.presenceEnabled ?? true;
  const injectionEnabled = prefs.data?.injectionEnabled ?? true;
  const outboxExpirySeconds = prefs.data?.outboxExpirySeconds ?? 600;
  const [expiryDraft, setExpiryDraft] = useState<string | null>(null);

  const persistPrefs = useCallback(
    (patch: {
      prereqsCollapsed?: boolean;
      presenceEnabled?: boolean;
      injectionEnabled?: boolean;
      outboxExpirySeconds?: number;
      daemonEnabled?: Record<string, boolean>;
    }) => {
      prefsSet.mutate(
        {
          prereqsCollapsed,
          presenceEnabled,
          injectionEnabled,
          ...patch,
        },
        { onSuccess: () => void prefs.refetch() },
      );
    },
    [prefsSet, prefs, prereqsCollapsed, presenceEnabled, injectionEnabled],
  );

  const commitExpiry = useCallback(() => {
    const seconds = Number.parseInt(expiryDraft ?? "", 10);
    setExpiryDraft(null);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds === outboxExpirySeconds) return;
    persistPrefs({ outboxExpirySeconds: seconds });
  }, [expiryDraft, outboxExpirySeconds, persistPrefs]);

  const canAdd = newName.trim().length > 0 && newValue.trim().length > 0;
  const mismatch =
    newName.trim().length > 0 && newValue.trim().length > 0 && !newValue.includes("#offer=")
      ? directHostMismatch(newName.trim(), newValue.trim())
      : null;
  const daemonCount = read.data?.daemons.length ?? 0;

  const serverCheckValue = check.data
    ? check.data.error
      ? `failed: ${check.data.error}`
      : check.data.version === null
        ? "version unavailable"
        : check.data.match
          ? `v${check.data.version} (matches plugin v${check.data.expected})`
          : `v${check.data.version}, plugin expects v${check.data.expected}`
    : "pending…";

  return (
    <ModalBody
      headerMode="pinned"
      maxContentWidth={X_COMMS_CONTENT_MAX_WIDTH}
      header={
        <Card variant="elevated">
          <Card.Header
            title="X-comms settings"
            subtitle="Prototype surface built from paseo-plugin-helper primitives."
            badge={<Badge label="prototype" variant="warning" />}
            action={
              <Button
                label="Refresh"
                size="sm"
                variant="secondary"
                icon="RefreshCw"
                loading={refreshing}
                disabled={refreshing}
                onPress={handleRefresh}
              />
            }
          />
        </Card>
      }
      refreshing={refreshing}
      onRefresh={handleRefresh}
      contentContainerStyle={{ paddingTop: 6 }}
    >
      <SectionHeader title="Server" />
      <Card variant="elevated">
        <Card.Header
          title={status.data?.installed ? `Bundled server · v${status.data.version ?? "?"}` : "Bundled server"}
          subtitle={status.data?.error ?? status.data?.installPath ?? "Locating bundled server…"}
          badge={
            check.data?.error ? (
              <Badge label="failed" variant="danger" dot />
            ) : check.data?.match ? (
              <Badge label="ok" variant="success" dot />
            ) : check.data ? (
              <Badge label="mismatch" variant="warning" dot />
            ) : (
              <Badge label="checking…" variant="neutral" dot />
            )
          }
        />
      </Card>

      <SectionHeader title="Daemons" count={daemonCount} />
      {read.isPending ? (
        <Card>
          <Card.Header title="Loading…" subtitle="Reading the daemon registry." />
        </Card>
      ) : null}
      {!read.isPending && read.data && !read.data.exists ? (
        <EmptyState title="No registry file yet." description="Add your first daemon below." />
      ) : null}
      {read.data && !read.data.validJson ? (
        <Card variant="elevated">
          <Card.Header
            title="Registry is not valid JSON"
            subtitle={read.data.parseError ?? undefined}
            badge={<Badge label="error" variant="danger" dot />}
          />
        </Card>
      ) : null}
      {health.isPending && (read.data?.daemons.length ?? 0) > 0 ? (
        <Card>
          <Card.Header title="Checking health…" subtitle="Probing registered daemons." />
        </Card>
      ) : null}

      {(read.data?.daemons ?? []).map((daemon) => {
        const h = healthByName[daemon.name];
        const enabled = daemonEnabled[daemon.name] !== false;
        const healthDetail = h
          ? (h.error ?? (h.reachable ? `${h.agentCount ?? 0} agents reachable` : "unreachable"))
          : "Health check pending…";
        return (
          <Card key={daemon.name} variant="elevated">
            <Card.Header
              title={formatPeerDisplay(daemon.name, daemon.serverId)}
              subtitle={daemon.hostname && daemon.hostname !== daemon.name ? daemon.hostname : undefined}
              badge={enabled ? <ReachabilityBadge health={h} /> : <Badge label="disabled" variant="neutral" dot />}
            />
            <KeyValue
              label="Host value"
              value={daemon.value}
              mono
              copyable
              truncate="end"
              truncateMaxLength={36}
              layout="inline"
            />
            <FormRow
              layout="inline"
              label="Health"
              description={enabled ? healthDetail : `Disabled in preferences · ${healthDetail}`}
            >
              <StatusDot
                variant={enabled ? (h?.reachable ? "success" : h ? "danger" : "neutral") : "neutral"}
                size="sm"
              />
            </FormRow>
            <FormRow
              layout="inline"
              label="Enabled"
              description="Include this daemon in the x-comms mesh."
            >
              <Toggle
                value={enabled}
                disabled={prefs.isPending}
                onValueChange={(next) =>
                  persistPrefs({ daemonEnabled: { ...daemonEnabled, [daemon.name]: next } })
                }
              />
            </FormRow>
            {confirmRemove === daemon.name ? (
              <ActionBar align="flex-start">
                <Button
                  label="Confirm remove"
                  size="sm"
                  variant="danger"
                  loading={remove.isPending}
                  disabled={remove.isPending}
                  onPress={() => remove.mutate({ name: daemon.name })}
                />
                <Button label="Cancel" size="sm" variant="secondary" onPress={() => setConfirmRemove(null)} />
              </ActionBar>
            ) : (
              <ActionBar align="flex-start">
                <Button label="Remove" size="sm" variant="ghost" onPress={() => setConfirmRemove(daemon.name)} />
              </ActionBar>
            )}
          </Card>
        );
      })}
      <ErrorRow label="Remove failed" message={remove.error?.message} />

      <SectionHeader title="Add daemon" />
      <Card variant="elevated">
        <FormRow label="Name" description="The daemon's real name; derived automatically for relay links.">
          <TextInput value={newName} onChangeText={setNewName} autoCapitalize="none" autoCorrect={false} />
        </FormRow>
        <FormRow label="Host value" description={HOST_FORM_HINT}>
          <TextInput
            mono
            value={newValue}
            onChangeText={setNewValue}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={HOST_FORM_HINT}
            errorText={mismatch ?? undefined}
          />
        </FormRow>
        <ErrorRow label="Add failed" message={add.error?.message} />
        <ActionBar align="flex-start">
          <Button
            label="Add daemon"
            variant="primary"
            loading={add.isPending}
            disabled={!canAdd || add.isPending}
            onPress={() => add.mutate({ name: newName.trim(), value: newValue.trim() })}
          />
        </ActionBar>
      </Card>

      <SectionHeader title="Preferences" />
      <Card variant="elevated">
        <Collapsible
          title="Prerequisites"
          subtitle="Bundled server paths and checks."
          icon="Server"
          isExpanded={!prereqsCollapsed}
          onToggle={(expanded) => persistPrefs({ prereqsCollapsed: !expanded })}
        >
          <KeyValueGroup>
            <KeyValue
              label="Install path"
              value={status.data?.installPath ?? ""}
              mono
              copyable={Boolean(status.data?.installPath)}
              truncate="path"
            />
            <KeyValue label="Server check" value={serverCheckValue} mono />
          </KeyValueGroup>
        </Collapsible>
        <FormRow label="Presence announcements" description="Broadcast this daemon's agents to the x-comms mesh.">
          <Toggle
            value={presenceEnabled}
            disabled={prefs.isPending}
            onValueChange={(next) => persistPrefs({ presenceEnabled: next })}
          />
        </FormRow>
        <FormRow
          label="Agent introduction injection"
          description="Inject x-comms peer context when agents are created."
        >
          <Toggle
            value={injectionEnabled}
            disabled={prefs.isPending}
            onValueChange={(next) => persistPrefs({ injectionEnabled: next })}
          />
        </FormRow>
        <FormRow
          label="Outbox expiry (seconds)"
          description="How long an undelivered message is retried before the sender is notified. Default 600. Press Enter to save."
        >
          <TextInput
            value={expiryDraft ?? String(outboxExpirySeconds)}
            onChangeText={setExpiryDraft}
            keyboardType="number-pad"
            disabled={prefs.isPending}
            onSubmitEditing={commitExpiry}
          />
        </FormRow>
        <ErrorRow label="Preferences update failed" message={prefsSet.error?.message} />
      </Card>

      <ViaXComms theme={theme} />
    </ModalBody>
  );
}
