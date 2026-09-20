import React, { useEffect, useMemo, useState } from "react";
import { Text } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  Badge,
  Button,
  Card,
  CodeBlock,
  FormRow,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  SectionHeader,
  Stack,
  StatusDot,
  TextInput,
  Toggle,
  registerSidebarSurface,
  triggerHaptic,
  usePluginTheme,
  type SidebarSurfaceRegistrar,
} from "paseo-plugin-helper/client";
import { useRpcQuery, useRpcMutation } from "paseo-plugin-helper/core";
import {
  DEMO_SERVER_SETTINGS_EXPECTED_PATH,
  DEMO_SERVER_SETTINGS_ID,
  DemoSettingsSchema,
  demoSettingsRpc,
  demoSettingsSnapshotContract,
  type DemoSettingsValues,
  type ServerSettingsSnapshot,
} from "../shared/server-settings.js";

/**
 * TEMP DEMO (issue #62) - not a production surface.
 *
 * Shows the upstream server-side settings handle for `id: "server-demo"`:
 * the daemon's `registerSettings()` returned a `PluginSettings` handle and
 * reads/subscribes through it. The write path is the host's auto-registered
 * `settings.server-demo.*` RPC (same document the host `useSettings()` uses),
 * never our helper `PluginStorage`/`registerSettingsRpc` layer.
 */

function statusBadge(snapshot: ServerSettingsSnapshot | undefined) {
  if (!snapshot || snapshot.status === "uninitialized") {
    return { variant: "warning" as const, label: "Awaiting first read" };
  }
  if (snapshot.status === "invalid") {
    return { variant: "danger" as const, label: "Invalid document" };
  }
  return { variant: "success" as const, label: "ready" };
}

function handleSource(snapshot: ServerSettingsSnapshot | undefined): string {
  if (!snapshot) return "reading server handle...";
  if (!snapshot.handleAvailable) return "unavailable (SDK < 0.9.0-beta.1)";
  if (snapshot.subscribed) return "registerSettings() -> read() + subscribe()";
  return "registerSettings() -> read() (subscribe inactive)";
}

export function ServerSettingsDemoSurface(_props: PluginSurfaceProps) {
  const { colors, typography } = usePluginTheme();
  const [label, setLabel] = useState<string>("");

  // Snapshot reflects what the DAEMON observed on the handle; each poll issues a
  // fresh handle.read() server-side (see handleGetServerSettingsSnapshot).
  const { data, isLoading, refetch, error } = useRpcQuery(
    demoSettingsSnapshotContract,
    {},
    { refetchInterval: 2000 },
  );

  // The write side of the exact same document, through upstream's host RPC.
  const readThroughRpc = useRpcQuery(demoSettingsRpc.read, {}, { refetchInterval: 5000 });
  const { mutate: writeSettings, isPending: isSaving } = useRpcMutation(demoSettingsRpc.write, {
    onSuccess: () => {
      triggerHaptic("success");
      void refetch();
      void readThroughRpc.refetch();
    },
  });
  const { mutate: resetSettings, isPending: isResetting } = useRpcMutation(demoSettingsRpc.reset, {
    onSuccess: () => {
      triggerHaptic("warning");
      void refetch();
      void readThroughRpc.refetch();
    },
  });

  const rpcRead = readThroughRpc.data;
  const values: DemoSettingsValues | undefined =
    rpcRead?.status === "ready" ? DemoSettingsSchema.parse(rpcRead.values) : undefined;
  const revision = data?.revision ?? rpcRead?.revision ?? "missing";

  useEffect(() => {
    if (values && label === "") setLabel(String(values.label));
  }, [values, label]);

  const badge = statusBadge(data);
  const eventHistory = useMemo(() => {
    if (!data?.lastEventAt) return "no subscribe() events observed yet";
    return `${data.eventCount} event(s); last ${data.lastEventAt} (${data.lastEventStatus})`;
  }, [data]);

  const handleAvailable = data?.handleAvailable ?? false;
  const controlsDisabled = !handleAvailable || isSaving || isResetting || !values;

  return (
    <ModalBody
      headerMode="pinned"
      refreshing={isLoading}
      onRefresh={() => {
        void refetch();
      }}
    >
      <Stack gap={12}>
        <Card variant="elevated">
          <Card.Header
            title="TEMP — Upstream server settings handle (#62)"
            subtitle="registerSettings() -> read()/subscribe(), read on the daemon process"
            badge={<Badge label="DEMO" variant="warning" />}
          />

          <KeyValueGroup columns={2}>
            <KeyValue
              label="Settings id"
              value={data?.settingsId ?? DEMO_SERVER_SETTINGS_ID}
              copyable
            />
            <KeyValue label="Schema version" value={String(data?.schemaVersion ?? 1)} />
            <KeyValue label="Source" value={handleSource(data)} />
            <KeyValue
              label="Handle available"
              value={handleAvailable ? "yes" : "no"}
              subValue={
                handleAvailable
                  ? "returned by registerSettings()"
                  : "older host runtime returned void"
              }
            />
          </KeyValueGroup>

          {data?.unavailableReason ? (
            <Text style={{ color: colors.statusWarning, ...typography.caption }}>
              {data.unavailableReason}
            </Text>
          ) : null}
        </Card>

        <Card variant="elevated">
          <Card.Header
            title="handle.read() snapshot"
            subtitle="State the daemon process observed, straight from the upstream handle"
            badge={<Badge label={badge.label} variant={badge.variant} />}
          />
          <KeyValueGroup columns={2}>
            <KeyValue
              label="Status"
              value={data?.status ?? "loading"}
              subValue={data?.error ?? undefined}
            />
            <KeyValue
              label="Revision"
              value={revision}
              subValue="sha256 of the stored document"
              copyable={revision !== "missing"}
            />
            <KeyValue label="Daemon read() calls" value={String(data?.readCount ?? 0)} />
            <KeyValue
              label="Subscribe active"
              value={data?.subscribed ? "yes" : "no"}
              subValue={eventHistory}
            />
          </KeyValueGroup>

          <SectionHeader title="Values seen by the server handle" />
          {data?.values ? (
            <KeyValueGroup columns={2}>
              <KeyValue label="label" value={String(data.values.label)} copyable />
              <KeyValue label="enabled" value={String(data.values.enabled)} />
              <KeyValue label="threshold" value={String(data.values.threshold)} />
            </KeyValueGroup>
          ) : (
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
              No ready values yet. The document may not exist on disk until the first write.
            </Text>
          )}

          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
            Stored at {data?.expectedPath ?? DEMO_SERVER_SETTINGS_EXPECTED_PATH}
          </Text>
        </Card>

        <Card variant="elevated">
          <Card.Header
            title="Write path (host settings.<id>.* RPC)"
            subtitle="Same document, updated through upstream's persisted RPC — then re-read on the daemon"
          />

          <FormRow
            label="Label"
            description="Persisted into the host-scoped document the handle reads"
          >
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="upstream handle demo"
            />
          </FormRow>

          <FormRow label="Enabled" description="Boolean inside the same document" layout="inline">
            <Toggle
              value={Boolean(values?.enabled)}
              onValueChange={(next) => {
                triggerHaptic("light");
                writeSettings({
                  revision,
                  values: {
                    label: values?.label ?? label,
                    enabled: next,
                    threshold: values?.threshold ?? 70,
                  },
                });
              }}
            />
          </FormRow>

          <FormRow
            label="Threshold"
            description={`Integer 0-100 (current: ${values?.threshold ?? "—"})`}
          >
            <TextInput
              value={values ? String(values.threshold) : ""}
              keyboardType="numeric"
              onChangeText={(text) => {
                if (text.trim() === "") return;
                const threshold = Number.parseInt(text, 10);
                if (Number.isNaN(threshold)) return;
                writeSettings({
                  revision,
                  values: {
                    label: values?.label ?? label,
                    enabled: values?.enabled ?? true,
                    threshold,
                  },
                });
              }}
            />
          </FormRow>

          <Button
            label={isSaving ? "Saving..." : "Save label to host settings"}
            variant="primary"
            size="sm"
            disabled={controlsDisabled}
            onPress={() => {
              triggerHaptic("medium");
              writeSettings({
                revision,
                values: {
                  label: label.trim() || "upstream handle demo",
                  enabled: values?.enabled ?? true,
                  threshold: values?.threshold ?? 70,
                },
              });
            }}
          />

          <Stack gap={4}>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
              RPC read status: {readThroughRpc.data?.status ?? (readThroughRpc.isLoading ? "loading" : "—")}
              {readThroughRpc.data?.status === "invalid"
                ? ` — ${readThroughRpc.data.error}`
                : ""}
            </Text>
            <Button
              label={isResetting ? "Resetting..." : "Reset host settings document"}
              variant="ghost"
              size="sm"
              disabled={!handleAvailable || isResetting}
              onPress={() => {
                triggerHaptic("warning");
                resetSettings({ revision });
              }}
            />
          </Stack>

          {error ? (
            <Text style={{ color: colors.statusDanger, ...typography.caption }}>
              Snapshot error: {error.message}
            </Text>
          ) : null}
        </Card>

        <Card variant="elevated">
          <Card.Header
            title="What this demo proves"
            subtitle="Upstream 0.9 server settings handle vs our helper storage layer"
          />
          <Stack gap={4}>
            <Text style={{ color: colors.foreground, ...typography.bodyStrong }}>
              <StatusDot variant={handleAvailable ? "success" : "warning"} />{" "}
              {handleAvailable
                ? "registerSettings() returned a handle"
                : "handle unavailable on this runtime"}
            </Text>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
              The daemon reads and subscribes through the handle returned by
              registerSettings(); nothing here touches paseo-plugin-helper's
              PluginStorage/registerSettingsRpc. The host owns persistence
              (revision-checked, atomic) and the client writes through the same
              document via the auto-registered settings RPC.
            </Text>
          </Stack>

          <CodeBlock
            language="typescript"
            title="server/index.server.ts"
            code={`const settings = server.registerSettings(defineSettings({
  id: "server-demo", scope: "host", version: 1,
  schema: z.object({ label: z.string().default("upstream handle demo"), ... }),
}));

// Server-side read + change subscription (upstream 0.9.0-beta.1+, PR #4674):
settings.subscribe((state) => { /* { status, revision, values|error } */ });
const state = await settings.read();
`}
            copyable
          />
        </Card>
      </Stack>
    </ModalBody>
  );
}

/**
 * Registers the temp demo surface + sidebar entry. Returns a disposer, or null
 * when the host does not expose surface registration.
 */
export function registerServerSettingsDemoSurface(
  client: SidebarSurfaceRegistrar,
): (() => void) | null {
  if (!("addSurface" in client) || !("addSidebarItem" in client)) return null;
  return registerSidebarSurface(client, {
    id: "helper-demo-server-settings",
    title: "Server Settings (temp)",
    icon: "Sliders",
    Component: ServerSettingsDemoSurface,
  });
}
