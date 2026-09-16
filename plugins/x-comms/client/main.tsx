import { useMutation, useQuery } from "@tanstack/react-query";
import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Modal } from "@getpaseo/plugin/client/react-native";
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
  ModalContent,
  SectionHeader,
  Tabs,
  TextInput,
  usePluginTheme,
} from "./vendor/paseo-plugin-helper/index";
import { formatPeerDisplay } from "./peer-label";
import { SettingsPrototype } from "./settings-prototype";
import { ViaXComms } from "./via-x-comms";
import {
  registryReadRpc,
  daemonAddRpc,
  daemonUpdateRpc,
  daemonRemoveRpc,
  daemonHealthRpc,
  daemonProbeRpc,
  uiPrefsGetRpc,
  uiPrefsSetRpc,
  snapshotRefreshRpc,
  daemonDumpRpc,
  identitySyncRpc,
  serverStatusRpc,
  serverCheckRpc,
  introspectAgentsRpc,
  introduceAgentsRpc,
  directHostMismatch,
} from "../shared/registry";

const HOST_FORM_HINT =
  "Full pairing link (https://app.paseo.sh/#offer=…) or a direct daemon host (host:port, tcp://…, unix://…).";

// Raw View/Text are kept only for plain content and layout composition
// (headings, error notices, debug dump lines, modal footers). Every
// interactive control, card, form row, status indicator, key/value display
// and empty/loading state uses a paseo-plugin-helper primitive.
function Notice({
  children,
  tone = "danger",
}: {
  children: React.ReactNode;
  tone?: "danger" | "muted";
}) {
  const { colors } = usePluginTheme();
  return (
    <Text
      selectable
      style={{
        color: tone === "danger" ? colors.statusDanger : colors.foregroundMuted,
        fontSize: 12,
      }}
    >
      {children}
    </Text>
  );
}

function HealthBadge({
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

// #97: the operator asked for an entirely new prototype surface alongside the
// current one. MainSurface keeps the existing page as the default "Current" tab
// and renders the helper-primitives prototype behind the marked "Prototype" tab.
export function MainSurface(props: PluginSurfaceProps) {
  const { colors } = usePluginTheme();
  const [surface, setSurface] = useState<"current" | "prototype">("current");
  return (
    <View style={{ flex: 1, minHeight: 0, width: "100%", backgroundColor: colors.surface0 }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 12 }}>
        <Tabs
          tabs={[
            { id: "current", label: "Current" },
            { id: "prototype", label: "Prototype", badge: "new" },
          ]}
          activeTab={surface}
          onTabChange={(id) => setSurface(id === "prototype" ? "prototype" : "current")}
        />
      </View>
      {surface === "current" ? <CurrentSurface {...props} /> : <SettingsPrototype {...props} />}
    </View>
  );
}

function CurrentSurface({ theme }: PluginSurfaceProps) {
  const { colors } = usePluginTheme();
  const callRead = useRpc(registryReadRpc);
  const callAdd = useRpc(daemonAddRpc);
  const callUpdate = useRpc(daemonUpdateRpc);
  const callRemove = useRpc(daemonRemoveRpc);
  const callHealth = useRpc(daemonHealthRpc);
  const callProbe = useRpc(daemonProbeRpc);
  const callPrefsGet = useRpc(uiPrefsGetRpc);
  const callPrefsSet = useRpc(uiPrefsSetRpc);
  const callSnapshotRefresh = useRpc(snapshotRefreshRpc);
  const callDump = useRpc(daemonDumpRpc);
  const callIdentitySync = useRpc(identitySyncRpc);
  const callStatus = useRpc(serverStatusRpc);
  const callCheck = useRpc(serverCheckRpc);
  const callIntrospect = useRpc(introspectAgentsRpc);
  const callIntroduce = useRpc(introduceAgentsRpc);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [prereqsCollapsed, setPrereqsCollapsed] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [dumpState, setDumpState] = useState<Record<string, unknown> | null>(null);
  const [dumpDaemon, setDumpDaemon] = useState<string | null>(null);
  const [dumpOpen, setDumpOpen] = useState(false);

  // Introduce: which picker (1 or 2) is expanded, selections, editable message.
  const [expandedPicker, setExpandedPicker] = useState<1 | 2 | null>(null);
  const [introFirst, setIntroFirst] = useState<{ daemon: string; agentId: string; shortId: string; name: string } | null>(null);
  const [introSecond, setIntroSecond] = useState<{ daemon: string; agentId: string; shortId: string; name: string } | null>(null);
  const [introMessage, setIntroMessage] = useState(
    "Hello! I was asked to introduce you. This daemon can communicate with you directly via paseo-x-comms.",
  );

  const read = useQuery({ queryKey: ["registry-read"], queryFn: () => callRead({}) });
  const health = useQuery({
    queryKey: ["daemon-health"],
    queryFn: () => callHealth({}),
    // Health is a network probe; never let it block the UI.
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const probe = useMutation({ mutationFn: callProbe });
  const prefs = useQuery({ queryKey: ["ui-prefs"], queryFn: () => callPrefsGet({}) });
  React.useEffect(() => {
    if (prefs.data) setPrereqsCollapsed(prefs.data.prereqsCollapsed);
  }, [prefs.data]);
  const prefsSet = useMutation({ mutationFn: callPrefsSet });
  const identitySync = useMutation({
    mutationFn: () => callIdentitySync({}),
    onSuccess: () => void read.refetch(),
  });
  const snapshotRefresh = useMutation({
    mutationFn: () => callSnapshotRefresh({}),
    onSuccess: (result) => {
      setRefreshedAt(new Date(result.updatedAt).toLocaleTimeString());
      setRefreshing(false);
      void read.refetch();
      void health.refetch();
      void introspect.refetch();
      void status.refetch();
    },
    onError: () => setRefreshing(false),
  });
  const dump = useMutation({
    mutationFn: callDump,
    onSuccess: (data) => setDumpState(data as unknown as Record<string, unknown>),
  });
  const introspect = useQuery({
    queryKey: ["introspect"],
    queryFn: () => callIntrospect({}),
    staleTime: 30_000,
  });
  const introduce = useMutation({ mutationFn: callIntroduce });
  const status = useQuery({ queryKey: ["server-status"], queryFn: () => callStatus({}) });
  const check = useQuery({ queryKey: ["server-check"], queryFn: () => callCheck({}), retry: false });
  const add = useMutation({ mutationFn: callAdd });
  const update = useMutation({ mutationFn: callUpdate });
  const remove = useMutation({ mutationFn: callRemove });

  // Editing state per daemon: current draft name + value (keyed by original name).
  const [edits, setEdits] = useState<Record<string, { name: string; value: string }>>({});
  const [expandedError, setExpandedError] = useState<Set<string>>(new Set());
  const [rowProbe, setRowProbe] = useState<Record<string, { value: string; error: string | null; saved: boolean } | "pending">>({});
  const [addProbe, setAddProbe] = useState<{ value: string; error: string | null } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Set<string>>(new Set());

  const applyResult = useCallback(
    (result: unknown) => {
      const r = result as { error?: string | null };
      if (r?.error) throw new Error(r.error);
      void read.refetch();
      void health.refetch();
    },
    [read, health],
  );

  // Probe a candidate. Returns "ok" (reachable), "unreachable" (show inline
  // confirm), or "invalid" (format error). No modal; the caller renders the
  // result at the row.
  const probeValue = useCallback(
    (value: string): Promise<"ok" | "unreachable" | "invalid"> =>
      new Promise((resolve) => {
        probe.mutate(
          { value },
          {
            onSuccess: (result) => {
              if (!result.valid) resolve("invalid");
              else if (!result.reachable) resolve("unreachable");
              else resolve("ok");
            },
            onError: () => resolve("unreachable"),
          },
        );
      }),
    [probe],
  );

  const deriveHost = useCallback((value: string) => {
    const offer = value.match(/#offer=([A-Za-z0-9_-]+)/);
    if (offer && newName.trim().length === 0) {
      try {
        const payload = JSON.parse(Buffer.from(offer[1], "base64").toString("utf8"));
        if (typeof payload.serverId === "string") setNewName(payload.serverId);
      } catch { /* ignore */ }
    }
  }, [newName]);

  const handleAdd = useCallback(() => {
    const name = newName.trim();
    const value = newValue.trim();
    if (!name || !value) return;
    setAdding(true);
    probeValue(value).then((outcome) => {
      if (outcome === "invalid") {
        setAddProbe({ value, error: "not a valid host form" });
        setAdding(false);
        return;
      }
      if (outcome === "unreachable") {
        setAddProbe({ value, error: null }); // inline confirm shown at the add row
        setAdding(false);
        return;
      }
      setAddProbe(null);
      add.mutate({ name, value }, { onSuccess: applyResult, onSettled: () => setAdding(false) });
    });
  }, [add, newName, newValue, applyResult, probeValue]);

  const confirmAddAnyway = useCallback(() => {
    const value = newValue.trim();
    const name = newName.trim();
    if (!name || !value) return;
    setAddProbe(null);
    add.mutate({ name, value }, { onSuccess: applyResult });
  }, [add, newName, newValue, applyResult]);

  const handleSave = useCallback(
    (originalName: string) => {
      const draft = edits[originalName];
      if (!draft) return;
      const rename = draft.name.trim() !== originalName ? draft.name.trim() : undefined;
      const value = draft.value.trim() !== "" ? draft.value.trim() : undefined;
      if (!rename && !value) {
        // Nothing changed; just close the editor.
        setEditing((prev) => { const next = new Set(prev); next.delete(originalName); return next; });
        return;
      }
      const targetValue = value ?? draft.value.trim();
      setRowProbe((prev) => ({ ...prev, [originalName]: "pending" }));
      probeValue(targetValue).then((outcome) => {
        if (outcome === "ok") {
          setRowProbe((prev) => { const next = { ...prev }; delete next[originalName]; return next; });
          update.mutate(
            { name: originalName, rename, value },
            {
              onSuccess: applyResult,
              onSettled: () => {
                setEdits((prev) => { const next = { ...prev }; delete next[originalName]; return next; });
                setEditing((prev) => { const next = new Set(prev); next.delete(originalName); return next; });
              },
            },
          );
          return;
        }
        if (outcome === "unreachable") {
          setRowProbe((prev) => ({ ...prev, [originalName]: { value: targetValue, error: null, saved: false } }));
          return;
        }
        setRowProbe((prev) => ({ ...prev, [originalName]: { value: targetValue, error: "not a valid host form", saved: false } }));
      });
    },
    [update, edits, applyResult, probeValue],
  );

  const confirmEditAnyway = useCallback(
    (originalName: string) => {
      const draft = edits[originalName];
      if (!draft) return;
      const rename = draft.name.trim() !== originalName ? draft.name.trim() : undefined;
      const value = draft.value.trim() !== "" ? draft.value.trim() : undefined;
      setRowProbe((prev) => { const next = { ...prev }; delete next[originalName]; return next; });
      update.mutate(
        { name: originalName, rename, value },
        {
          onSuccess: applyResult,
          onSettled: () => {
            setEdits((prev) => { const next = { ...prev }; delete next[originalName]; return next; });
            setEditing((prev) => { const next = new Set(prev); next.delete(originalName); return next; });
          },
        },
      );
    },
    [update, edits, applyResult],
  );

  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const handleRemove = useCallback(
    (name: string) => {
      setPendingRemove(name);
    },
    [],
  );

  const confirmRemove = useCallback(() => {
    if (!pendingRemove) return;
    remove.mutate({ name: pendingRemove }, { onSuccess: applyResult });
    setPendingRemove(null);
  }, [pendingRemove, remove, applyResult]);

  const canAdd = newName.trim().length > 0 && newValue.trim().length > 0;

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void identitySync
      .mutateAsync()
      .then(() => snapshotRefresh.mutate())
      .catch(() => snapshotRefresh.mutate());
  }, [identitySync, snapshotRefresh]);

  const setPrereqs = useCallback(
    (collapsed: boolean) => {
      setPrereqsCollapsed(collapsed);
      prefsSet.mutate({ prereqsCollapsed: collapsed });
    },
    [prefsSet],
  );

  const healthByName = useMemo(() => {
    const map: Record<string, { reachable: boolean; error: string | null; agentCount: number | null }> = {};
    for (const result of health.data?.results ?? []) map[result.name] = result;
    return map;
  }, [health.data]);

  const serverIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const daemon of read.data?.daemons ?? []) {
      if (daemon.serverId) map.set(daemon.name, daemon.serverId);
    }
    return map;
  }, [read.data]);

  const aliasByServerId = useMemo(() => {
    const map = new Map<string, string>();
    for (const daemon of read.data?.daemons ?? []) {
      if (daemon.serverId) map.set(daemon.serverId, daemon.name);
    }
    return map;
  }, [read.data]);

  const peerLabelForName = useCallback(
    (name: string) => formatPeerDisplay(name, serverIdByName.get(name) ?? null),
    [serverIdByName],
  );

  const sendTargetLabel = useCallback(
    (daemon: string) => {
      if (daemon.startsWith("srv_")) return formatPeerDisplay(aliasByServerId.get(daemon) ?? null, daemon);
      return formatPeerDisplay(daemon, serverIdByName.get(daemon) ?? null);
    },
    [aliasByServerId, serverIdByName],
  );

  const addMismatch =
    newName.trim().length > 0 && newValue.trim().length > 0 && !newValue.includes("#offer=")
      ? directHostMismatch(newName.trim(), newValue.trim())
      : null;

  const daemonCount = read.data?.daemons.length ?? 0;

  const renderAgentPicker = (slot: 1 | 2) => {
    const selected = slot === 1 ? introFirst : introSecond;
    return (
      <Modal
        title={`Select agent ${slot}`}
        open={expandedPicker === slot}
        onOpenChange={(open) => { if (!open) setExpandedPicker(null); }}
      >
        <ModalContent>
          {introspect.isPending ? <Notice tone="muted">Loading agents…</Notice> : null}
          {introspect.error ? <Notice>{introspect.error.message}</Notice> : null}
          {(introspect.data?.daemons ?? []).map((daemon) => (
            <View key={daemon.name}>
              <SectionHeader
                title={daemon.reachable ? peerLabelForName(daemon.name) : `${peerLabelForName(daemon.name)} (unreachable)`}
                badgeVariant={daemon.reachable ? "success" : "danger"}
              />
              {daemon.projects.map((project) => (
                <View key={`${daemon.name}-${project.project}`}>
                  <Notice tone="muted">{project.project}</Notice>
                  {project.workspaces.map((workspace) => (
                    <View key={`${daemon.name}-${project.project}-${workspace.name}`}>
                      <Notice tone="muted">⌂ {workspace.name}</Notice>
                      {workspace.agents.map((agent) => {
                        const active = selected?.agentId === agent.agentId;
                        return (
                          <Button
                            key={agent.agentId}
                            size="sm"
                            variant={active ? "primary" : "secondary"}
                            icon={active ? "Check" : "Bot"}
                            label={`${agent.name} (${agent.shortId}) · ${agent.status}`}
                            style={{ alignSelf: "stretch", marginTop: 2 }}
                            onPress={() => {
                              const setSelected = slot === 1 ? setIntroFirst : setIntroSecond;
                              setSelected({ daemon: daemon.name, agentId: agent.agentId, shortId: agent.shortId, name: agent.name });
                              setExpandedPicker(null);
                            }}
                          />
                        );
                      })}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ))}
          <ViaXComms theme={theme} />
        </ModalContent>
      </Modal>
    );
  };

  const snapshot = dumpState as any;

  return (
    <View style={{ flex: 1, minHeight: 0, width: "100%", backgroundColor: colors.surface0 }}>
      <ModalBody
        headerMode="pinned"
        header={
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "700" }}>X-comms</Text>
            <Button
              label="Refresh"
              size="sm"
              variant="secondary"
              icon="RefreshCw"
              loading={refreshing}
              disabled={refreshing}
              onPress={handleRefresh}
            />
          </View>
        }
        headerStyle={{ backgroundColor: colors.surface0, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 }}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 12, paddingBottom: 24, paddingTop: 6 }}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      >
        {refreshedAt ? <Notice tone="muted">Last refresh: {refreshedAt}</Notice> : null}

        <Collapsible
          title="Server"
          icon="Server"
          isExpanded={!prereqsCollapsed}
          onToggle={(expanded) => setPrereqs(!expanded)}
        >
          <KeyValueGroup>
            <KeyValue
              label="Bundled server"
              value={status.data ? status.data.installPath : "bundled server"}
              mono
              copyable={Boolean(status.data)}
              truncate="path"
            />
            <KeyValue
              label="Server check"
              value={
                check.data
                  ? check.data.error
                    ? `failed: ${check.data.error}`
                    : check.data.match
                      ? `v${check.data.version} (matches plugin v${check.data.expected})`
                      : `v${check.data.version}, plugin expects v${check.data.expected}`
                  : "pending…"
              }
              valueStyle={
                check.data && !check.data.error && !check.data.match
                  ? { color: colors.statusWarning }
                  : check.data?.match
                    ? { color: colors.statusSuccess }
                    : undefined
              }
            />
          </KeyValueGroup>
        </Collapsible>

        <SectionHeader title="Registered daemons" count={daemonCount} />
        {read.data?.registryPath ? (
          <KeyValue label="Registry path" value={read.data.registryPath} mono copyable truncate="path" />
        ) : null}
        {read.isPending ? (
          <Card>
            <Card.Header title="Loading…" subtitle="Reading the daemon registry." />
          </Card>
        ) : null}
        {!read.isPending && !read.data?.exists ? (
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
        {health.isPending ? <Notice tone="muted">Checking health…</Notice> : null}

        {read.data?.daemons.map((daemon) => {
          const draft = edits[daemon.name] ?? { name: daemon.name, value: daemon.value };
          const h = healthByName[daemon.name];
          const probeState = rowProbe[daemon.name];
          const probeDetail = probeState && probeState !== "pending" ? probeState : null;
          if (editing.has(daemon.name)) {
            return (
              <Card key={daemon.name} variant="elevated">
                <Card.Header title={`Edit ${peerLabelForName(daemon.name)}`} subtitle="Probe runs before saving." />
                <FormRow label="Name" description="The daemon's real name; derived for relay links.">
                  <TextInput
                    mono
                    value={draft.name}
                    onChangeText={(text) => setEdits((prev) => ({ ...prev, [daemon.name]: { name: text, value: draft.value } }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </FormRow>
                <FormRow label="Host value" description={HOST_FORM_HINT}>
                  <TextInput
                    mono
                    value={draft.value}
                    onChangeText={(text) => setEdits((prev) => ({ ...prev, [daemon.name]: { name: draft.name, value: text } }))}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </FormRow>
                {probeState === "pending" ? <Notice tone="muted">Probing host…</Notice> : null}
                {probeDetail ? (
                  <Notice>{probeDetail.error ?? `unreachable now: ${probeDetail.value}`}</Notice>
                ) : null}
                {probeDetail && !probeDetail.saved ? (
                  <ActionBar align="flex-start">
                    <Button label="Save anyway" size="sm" variant="danger" onPress={() => confirmEditAnyway(daemon.name)} />
                    <Button
                      label="Dismiss"
                      size="sm"
                      variant="secondary"
                      onPress={() => setRowProbe((prev) => { const next = { ...prev }; delete next[daemon.name]; return next; })}
                    />
                  </ActionBar>
                ) : null}
                <ActionBar align="flex-start">
                  <Button label="Save" size="sm" variant="primary" onPress={() => handleSave(daemon.name)} />
                  <Button
                    label="Cancel"
                    size="sm"
                    variant="ghost"
                    onPress={() => {
                      setEdits((prev) => { const next = { ...prev }; delete next[daemon.name]; return next; });
                      setEditing((prev) => { const next = new Set(prev); next.delete(daemon.name); return next; });
                    }}
                  />
                </ActionBar>
              </Card>
            );
          }
          return (
            <Card key={daemon.name} variant="elevated">
              <Card.Header
                title={peerLabelForName(daemon.name)}
                subtitle={daemon.hostname && daemon.hostname !== daemon.name ? daemon.hostname : undefined}
                badge={<HealthBadge health={h} />}
              />
              <KeyValue label="Host value" value={daemon.value} mono copyable truncate="end" truncateMaxLength={36} />
              {h && !h.reachable ? (
                <>
                  <Notice>{h.error ?? "unreachable"}</Notice>
                  <ActionBar align="flex-start">
                    <Button
                      label={expandedError.has(daemon.name) ? "Hide details" : "Details"}
                      size="sm"
                      variant="ghost"
                      onPress={() => setExpandedError((prev) => {
                        const next = new Set(prev);
                        if (next.has(daemon.name)) next.delete(daemon.name); else next.add(daemon.name);
                        return next;
                      })}
                    />
                  </ActionBar>
                  {expandedError.has(daemon.name) ? (
                    <KeyValue label="Error detail" value={h.error ?? "unreachable"} mono copyable />
                  ) : null}
                </>
              ) : null}
              <ActionBar align="flex-start">
                <Button
                  label="Edit"
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setEdits((prev) => ({ ...prev, [daemon.name]: { name: daemon.name, value: daemon.value } }));
                    setEditing((prev) => new Set(prev).add(daemon.name));
                  }}
                />
                <Button
                  label="Debug"
                  size="sm"
                  variant="ghost"
                  onPress={() => { setDumpOpen(true); setDumpDaemon(daemon.name); dump.mutate({ daemon: daemon.name }); }}
                />
                <Button label="Remove" size="sm" variant="danger" onPress={() => handleRemove(daemon.name)} />
              </ActionBar>
            </Card>
          );
        })}

        <SectionHeader title="Add daemon" />
        <Card>
          <FormRow label="Name" description="The daemon's real name; derived automatically for relay links.">
            <TextInput value={newName} onChangeText={setNewName} autoCapitalize="none" autoCorrect={false} />
          </FormRow>
          <FormRow label="Host value" description={HOST_FORM_HINT}>
            <TextInput
              mono
              value={newValue}
              onChangeText={(text) => { setNewValue(text); deriveHost(text); }}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={HOST_FORM_HINT}
              errorText={addMismatch ?? undefined}
            />
          </FormRow>
          {add.error ? <Notice>{add.error.message}</Notice> : null}
          {adding ? <Notice tone="muted">Probing host…</Notice> : null}
          {addProbe ? (
            <>
              <Notice>{addProbe.error ?? `unreachable now: ${addProbe.value}`}</Notice>
              <ActionBar align="flex-start">
                <Button label="Add anyway" size="sm" variant="danger" onPress={confirmAddAnyway} />
                <Button label="Dismiss" size="sm" variant="secondary" onPress={() => setAddProbe(null)} />
              </ActionBar>
            </>
          ) : null}
          <ActionBar align="flex-start">
            <Button
              label="Add daemon"
              variant="primary"
              loading={add.isPending || adding}
              disabled={!canAdd || add.isPending || adding}
              onPress={handleAdd}
            />
          </ActionBar>
        </Card>
        {update.error ? <Notice>{update.error.message}</Notice> : null}
        {remove.error ? <Notice>{remove.error.message}</Notice> : null}

        <SectionHeader title="Introduce agents" />
        <Card>
          <FormRow label="Agents" description="Pick two agents on reachable daemons; a message is sent to both.">
            {([1, 2] as const).map((slot) => {
              const selected = slot === 1 ? introFirst : introSecond;
              return (
                <Button
                  key={`intro-${slot}`}
                  size="sm"
                  variant="secondary"
                  icon="Bot"
                  style={{ marginTop: 4, alignSelf: "stretch" }}
                  label={
                    selected
                      ? `${selected.name} (${selected.shortId}) on ${selected.daemon}`
                      : `Select agent ${slot}…`
                  }
                  onPress={() => setExpandedPicker(slot)}
                />
              );
            })}
          </FormRow>
          <FormRow label="Message">
            <TextInput
              mono
              multiline
              numberOfLines={4}
              value={introMessage}
              onChangeText={setIntroMessage}
              autoCapitalize="none"
              autoCorrect={false}
              inputStyle={{ minHeight: 90, textAlignVertical: "top" }}
            />
          </FormRow>
          {introduce.error ? <Notice>{introduce.error.message}</Notice> : null}
          {!introFirst || !introSecond ? (
            <Notice tone="muted">Select both agents above to enable sending.</Notice>
          ) : null}
          <ActionBar align="flex-start">
            <Button
              label="Send introductions"
              variant="primary"
              loading={introduce.isPending}
              disabled={!introFirst || !introSecond || introMessage.trim().length === 0 || introduce.isPending}
              onPress={() =>
                introduce.mutate({
                  first: { daemon: introFirst!.daemon, agentId: introFirst!.agentId, shortId: introFirst!.shortId, name: introFirst!.name },
                  second: { daemon: introSecond!.daemon, agentId: introSecond!.agentId, shortId: introSecond!.shortId, name: introSecond!.name },
                  message: introMessage,
                })
              }
            />
          </ActionBar>
          {introduce.data ? (
            <KeyValueGroup columns={1}>
              {introduce.data.sends.map((send) => (
                <KeyValue
                  key={send.agentId}
                  label={send.ok ? "Sent" : "Failed"}
                  value={`${sendTargetLabel(send.daemon)}/${send.agentId}${send.ok ? "" : `: ${send.error}`}`}
                  valueStyle={{ color: send.ok ? colors.statusSuccess : colors.statusDanger }}
                  mono
                />
              ))}
            </KeyValueGroup>
          ) : null}
        </Card>

        <ViaXComms theme={theme} />
      </ModalBody>

      <Modal
        title={`Debug: ${dumpDaemon ?? ""}`}
        open={dumpOpen}
        onOpenChange={(open) => { if (!open) { setDumpOpen(false); setDumpState(null); } }}
      >
        <ModalContent>
          <Card variant="elevated">
            {dump.isPending && !dumpState ? (
              <Card.Header title="Loading…" subtitle="Fetching daemon snapshot." />
            ) : snapshot ? (
              <>
                <Card.Header
                  title={formatPeerDisplay(snapshot.name, snapshot.serverId)}
                  subtitle={`transport: ${String(snapshot.transport ?? "-")}`}
                  badge={<Badge label={snapshot.reached ? "reached" : "unreachable"} variant={snapshot.reached ? "success" : "danger"} dot />}
                />
                <KeyValueGroup>
                  {snapshot.error ? <KeyValue label="Error" value={snapshot.error} copyable mono /> : null}
                  {snapshot.hostname ? <KeyValue label="Hostname" value={snapshot.hostname} copyable mono /> : null}
                  {snapshot.version ? <KeyValue label="Version" value={`${snapshot.version}${snapshot.desktopManaged ? " (desktop-managed)" : ""}`} mono /> : null}
                  {snapshot.listen ? <KeyValue label="Listen" value={snapshot.listen} copyable mono /> : null}
                  {snapshot.pid ? <KeyValue label="PID" value={`${snapshot.pid}${snapshot.nodePath ? ` · node: ${snapshot.nodePath}` : ""}`} mono /> : null}
                  {snapshot.startedAt ? <KeyValue label="Started" value={snapshot.startedAt} mono /> : null}
                  <KeyValue
                    label="Relay"
                    value={snapshot.relayEnabled && snapshot.relayEndpoints?.length
                      ? `enabled ${snapshot.relayEndpoints.join(", ")}`
                      : "disabled"}
                    mono
                  />
                </KeyValueGroup>
                {snapshot.features ? (
                  <>
                    <SectionHeader title="Features" count={Object.entries(snapshot.features).filter(([, v]) => v).length} />
                    <KeyValueGroup columns={1}>
                      {Object.entries(snapshot.features).filter(([, v]) => v).map(([k]) => (
                        <KeyValue key={k} label={k} value="enabled" mono />
                      ))}
                    </KeyValueGroup>
                  </>
                ) : null}
                {snapshot.capabilities ? (
                  <>
                    <SectionHeader title="Capabilities" />
                    <KeyValueGroup columns={1}>
                      {Object.entries(snapshot.capabilities).map(([k, v]) => (
                        <KeyValue key={k} label={k} value={String(v)} mono />
                      ))}
                    </KeyValueGroup>
                  </>
                ) : null}
                <SectionHeader title="Agents" count={snapshot.agents?.length ?? 0} />
                <KeyValueGroup columns={1}>
                  {(snapshot.agents ?? []).map((a: any) => (
                    <KeyValue
                      key={a.agentId}
                      label={`${a.status} ${a.name}`}
                      value={`(${a.shortId}) ${a.provider}${a.model ? `/${a.model}` : ""}${a.archived ? " [archived]" : ""}${a.cwd ? ` · ${a.cwd}` : ""}`}
                      mono
                    />
                  ))}
                </KeyValueGroup>
                <SectionHeader title="Workspaces" count={snapshot.workspaces?.length ?? 0} />
                <KeyValueGroup columns={1}>
                  {(snapshot.workspaces ?? []).map((w: any) => (
                    <KeyValue key={w.id ?? w.name} label={`${w.project}/${w.name}`} value={`${w.isolation}${w.cwd ? ` · ${w.cwd}` : ""}`} mono />
                  ))}
                </KeyValueGroup>
                <SectionHeader title="Projects" count={snapshot.projects?.length ?? 0} />
                <KeyValueGroup columns={1}>
                  {(snapshot.projects ?? []).map((p: any) => (
                    <KeyValue key={p.id ?? p.name} label={p.name} value={p.source ? String(p.source) : "-"} mono />
                  ))}
                </KeyValueGroup>
                <SectionHeader title="Providers" count={snapshot.providerCount ?? snapshot.providers?.length ?? 0} />
                <KeyValueGroup columns={1}>
                  {(snapshot.providers ?? []).map((p: any) => (
                    <KeyValue key={String(p.provider)} label={String(p.provider)} value={p.available ? "ok" : `x${p.error ? ` · ${String(p.error)}` : ""}`} mono />
                  ))}
                </KeyValueGroup>
                <SectionHeader title="Terminals" count={snapshot.terminals?.length ?? 0} />
                <KeyValueGroup columns={1}>
                  {(snapshot.terminals ?? []).map((t: any) => (
                    <KeyValue key={String(t.id ?? t.name)} label={String(t.name ?? t.id)} value={`${t.status ? String(t.status) : "-"}${t.cwd ? ` · ${String(t.cwd)}` : ""}`} mono />
                  ))}
                </KeyValueGroup>
                <SectionHeader title="Schedules" count={snapshot.schedules?.length ?? 0} />
                <KeyValueGroup columns={1}>
                  {(snapshot.schedules ?? []).map((sched: any) => (
                    <KeyValue key={String(sched.id ?? sched.name)} label={String(sched.name)} value={String(sched.state)} mono />
                  ))}
                </KeyValueGroup>
                <SectionHeader title="Permissions" count={snapshot.permissions?.length ?? 0} />
                <KeyValueGroup columns={1}>
                  {(snapshot.permissions ?? []).map((p: any) => (
                    <KeyValue key={String(p.id)} label={String(p.name)} value={`(${String(p.agentId).slice(0, 8)})`} mono />
                  ))}
                </KeyValueGroup>
              </>
            ) : null}
          </Card>
          <ViaXComms theme={theme} />
        </ModalContent>
      </Modal>

      {renderAgentPicker(1)}
      {renderAgentPicker(2)}

      <Modal
        title="Remove daemon"
        open={pendingRemove !== null}
        onOpenChange={(open) => { if (!open) setPendingRemove(null); }}
      >
        <ModalContent>
          <Text selectable style={{ color: colors.foreground, fontSize: 13 }}>
            Remove '{pendingRemove}' from the registry?
          </Text>
          <ActionBar align="flex-start">
            <Button label="Remove" variant="danger" onPress={confirmRemove} />
            <Button label="Cancel" variant="secondary" onPress={() => setPendingRemove(null)} />
          </ActionBar>
          <ViaXComms theme={theme} />
        </ModalContent>
      </Modal>

    </View>
  );
}
