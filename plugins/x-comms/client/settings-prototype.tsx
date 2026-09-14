import { useMutation, useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import React, { useState } from "react";
import { View } from "react-native";
import {
  ActionBar,
  Badge,
  Button,
  Card,
  Collapsible,
  EmptyState,
  FormRow,
  ModalBody,
  SectionHeader,
  StatusDot,
  TextInput,
  Toggle,
} from "paseo-plugin-helper/client";
import {
  daemonAddRpc,
  daemonHealthRpc,
  daemonRemoveRpc,
  daemonUpdateRpc,
  registryReadRpc,
  serverCheckRpc,
  serverStatusRpc,
  uiPrefsGetRpc,
  uiPrefsSetRpc,
} from "../shared/registry";

// Prototype settings surface for issue #97. Helper primitives only —
// no bespoke StyleSheet styling. The current page in main.tsx is untouched;
// MainSurface renders this behind a "Prototype" tab during ticket work.
export function SettingsPrototype() {
  const callRead = useRpc(registryReadRpc);
  const callHealth = useRpc(daemonHealthRpc);
  const callAdd = useRpc(daemonAddRpc);
  const callUpdate = useRpc(daemonUpdateRpc);
  const callRemove = useRpc(daemonRemoveRpc);
  const callStatus = useRpc(serverStatusRpc);
  const callCheck = useRpc(serverCheckRpc);
  const callPrefsGet = useRpc(uiPrefsGetRpc);
  const callPrefsSet = useRpc(uiPrefsSetRpc);

  const read = useQuery({ queryKey: ["registry-read"], queryFn: () => callRead({}) });
  const health = useQuery({
    queryKey: ["daemon-health"],
    queryFn: () => callHealth({}),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const status = useQuery({ queryKey: ["server-status"], queryFn: () => callStatus({}) });
  const check = useQuery({ queryKey: ["server-check"], queryFn: () => callCheck({}), retry: false });
  const prefs = useQuery({ queryKey: ["ui-prefs"], queryFn: () => callPrefsGet({}) });

  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const healthByName = new Map(
    (health.data?.results ?? []).map((r) => [r.name, r]),
  );

  const refetchAll = () => {
    void read.refetch();
    void health.refetch();
  };
  const add = useMutation({ mutationFn: callAdd, onSuccess: refetchAll });
  const update = useMutation({ mutationFn: callUpdate, onSuccess: refetchAll });
  const remove = useMutation({
    mutationFn: callRemove,
    onSuccess: () => {
      setConfirmRemove(null);
      refetchAll();
    },
  });
  const prefsSet = useMutation({ mutationFn: callPrefsSet });

  const canAdd = newName.trim().length > 0 && newValue.trim().length > 0;
  const prereqsCollapsed = prefs.data?.prereqsCollapsed ?? true;

  return (
    <ModalBody>
      <Card variant="elevated">
        <Card.Header
          title="X-comms settings (prototype)"
          subtitle="Helper-primitives redesign. The current page stays available under the Current tab."
          badge={<Badge label="prototype" variant="warning" />}
        />
        <ActionBar>
          <Button
            label={read.isPending ? "Loading…" : "Refresh"}
            variant="secondary"
            disabled={read.isPending}
            onPress={refetchAll}
          />
        </ActionBar>
      </Card>

      <SectionHeader title="Server" />
      <Card>
        <Card.Header
          title={status.data ? `Bundled server at ${status.data.installPath}` : "Bundled server"}
          subtitle={
            check.data
              ? check.data.error
                ? `Server check failed: ${check.data.error}`
                : check.data.match
                  ? `Server reports v${check.data.version} (matches plugin v${check.data.expected})`
                  : `Server reports v${check.data.version}, plugin expects v${check.data.expected}`
              : "Server version check pending…"
          }
        />
      </Card>

      <SectionHeader title="Daemons" count={read.data?.daemons.length ?? 0} />
      {read.isPending ? (
        <Card>
          <Card.Header title="Loading…" subtitle="Reading daemon registry." />
        </Card>
      ) : null}
      {!read.data?.exists ? (
        <EmptyState title="No registry file yet." description="Add your first daemon below." />
      ) : null}
      {(read.data?.daemons ?? []).map((daemon) => {
        const h = healthByName.get(daemon.name);
        return (
          <Card key={daemon.name} variant="elevated">
            <Card.Header
              title={daemon.name}
              subtitle={daemon.value}
              badge={
                h ? (
                  <Badge
                    label={h.reachable ? "reachable" : "unreachable"}
                    variant={h.reachable ? "success" : "danger"}
                  />
                ) : (
                  <Badge label="checking…" variant="neutral" />
                )
              }
            />
            <FormRow
              label="Health"
              description={h?.error ?? (h?.reachable ? "Daemon is reachable." : "Health check pending…")}
            >
              <View style={{ flexDirection: "row" as const, alignItems: "center" as const }}>
                <StatusDot variant={h?.reachable ? "success" : h ? "danger" : "neutral"} size="sm" />
              </View>
            </FormRow>
            <FormRow label="Enabled" description="Toggle reachability tracking for this daemon.">
              <Toggle
                value={h?.reachable ?? true}
                disabled={!h}
                onValueChange={(next) => {
                  if (!next) remove.mutate({ name: daemon.name });
                  else update.mutate({ name: daemon.name, value: daemon.value });
                }}
              />
            </FormRow>
            <ActionBar>
              <Button
                label="Remove"
                variant="ghost"
                onPress={() => setConfirmRemove(daemon.name)}
              />
            </ActionBar>
            {confirmRemove === daemon.name ? (
              <ActionBar>
                <Button
                  label={remove.isPending ? "Removing…" : "Confirm remove"}
                  variant="primary"
                  disabled={remove.isPending}
                  onPress={() => remove.mutate({ name: daemon.name })}
                />
                <Button label="Cancel" variant="secondary" onPress={() => setConfirmRemove(null)} />
              </ActionBar>
            ) : null}
          </Card>
        );
      })}

      <SectionHeader title="Add daemon" />
      <Card>
        <FormRow label="Name" description="The daemon's real name; derived automatically for relay links.">
          <TextInput value={newName} onChangeText={setNewName} autoCapitalize="none" autoCorrect={false} />
        </FormRow>
        <FormRow
          label="Host value"
          description="Full pairing link (https://app.paseo.sh/#offer=…) or a direct daemon host (host:port, tcp://…, unix://…)."
        >
          <TextInput value={newValue} onChangeText={setNewValue} autoCapitalize="none" autoCorrect={false} />
        </FormRow>
        <ActionBar>
          <Button
            label={add.isPending ? "Adding…" : "Add daemon"}
            variant="primary"
            disabled={!canAdd || add.isPending}
            onPress={() => add.mutate({ name: newName.trim(), value: newValue.trim() })}
          />
        </ActionBar>
      </Card>

      <SectionHeader title="Preferences" />
      <Card>
        <Collapsible
          title="Prerequisites"
          isExpanded={!prereqsCollapsed}
          onToggle={(expanded) => prefsSet.mutate({ prereqsCollapsed: !expanded })}
        >
          <FormRow label="Collapse prerequisites" description="Persist the collapsed state of the prerequisites section.">
            <Toggle
              value={prereqsCollapsed}
              onValueChange={(next) => prefsSet.mutate({ prereqsCollapsed: next })}
            />
          </FormRow>
        </Collapsible>
      </Card>
    </ModalBody>
  );
}
