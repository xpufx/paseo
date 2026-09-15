import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
} from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import {
  Button,
  Card,
  EmptyState,
  PluginThemeProvider,
  ProgressBar,
  StatusDot,
  usePluginTheme,
} from "paseo-plugin-helper/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  pluginUpdatesCheckRpc,
  pluginUpdatesUpdateAllRpc,
  pluginUpdatesUpdateRpc,
  type PluginUpdate,
} from "../shared/updates";

const QUERY_KEY = ["plugin-updates"];
const POLL_MS = 30_000;

function usePluginUpdates(workspaceId: string) {
  const check = useRpc(pluginUpdatesCheckRpc);
  return useQuery({
    queryKey: [...QUERY_KEY, workspaceId],
    queryFn: () => check({ workspaceId }),
    refetchInterval: POLL_MS,
    retry: false,
  });
}

function statusVariant(status: PluginUpdate["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "stale" || status === "diverged") return "warning";
  if (status === "error") return "danger";
  if (status === "fresh") return "success";
  return "neutral";
}

function isUpdateAvailable(status: PluginUpdate["status"]): boolean {
  return status === "stale" || status === "diverged";
}

function PluginUpdatesIconInner(props: PluginButtonIconProps) {
  const { data, isFetching, isError } = usePluginUpdates(props.workspaceId);
  const stale = data?.plugins.some((plugin) => isUpdateAvailable(plugin.status)) ?? false;
  const failed = isError || data?.plugins.some((plugin) => plugin.status === "error") === true;
  const color = failed
    ? props.theme.colors.statusDanger || "#ef4444"
    : stale
      ? props.theme.colors.statusWarning || "#f59e0b"
      : props.color;
  return (
    <View style={{ width: props.size, height: props.size, alignItems: "center", justifyContent: "center" }}>
      <Icon name={isFetching ? "RefreshCw" : "Package"} size={props.size} color={color} />
      <View
        accessibilityLabel={isFetching ? "Checking plugin updates" : stale ? "Plugin updates available" : "Plugins fresh"}
        style={{
          position: "absolute",
          right: -1,
          top: -1,
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: isFetching
            ? props.theme.colors.statusWarning || "#f59e0b"
            : failed
              ? props.theme.colors.statusDanger || "#ef4444"
              : stale
                ? props.theme.colors.statusWarning || "#f59e0b"
                : props.theme.colors.statusSuccess || "#22c55e",
        }}
      />
    </View>
  );
}

export function PluginUpdatesIcon(props: PluginButtonIconProps) {
  return (
    <PluginThemeProvider theme={{ colors: props.theme.colors }}>
      <PluginUpdatesIconInner {...props} />
    </PluginThemeProvider>
  );
}

function PluginRow({
  plugin,
  updating,
  onUpdate,
  hideRemote,
}: {
  plugin: PluginUpdate;
  updating: boolean;
  onUpdate: (pluginId: string) => void;
  hideRemote?: boolean;
}) {
  const { colors } = usePluginTheme();
  const detail =
    plugin.detail ??
    (plugin.status === "stale"
      ? "Update available"
      : plugin.status === "diverged"
        ? "Diverged: remote updates available"
        : plugin.status === "ahead"
          ? "Local commits not pushed"
          : plugin.status === "fresh"
            ? "Up to date"
            : plugin.status === "checking"
              ? "Checking…"
              : plugin.error || "Check failed");
  return (
    <Card variant="elevated" noPadding>
      <View style={{ padding: 10, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusDot variant={statusVariant(plugin.status)} pulse={plugin.status === "checking"} />
          <Text style={{ color: colors.foreground, fontWeight: "700", flex: 1 }}>{plugin.id}</Text>
          {isUpdateAvailable(plugin.status) ? (
            <Button
              label="Update"
              variant="secondary"
              size="sm"
              loading={updating}
              disabled={updating}
              onPress={() => onUpdate(plugin.id)}
            />
          ) : null}
        </View>
        <Text selectable numberOfLines={2} style={{ color: colors.foregroundMuted, fontSize: 12 }}>
          {detail}
        </Text>
        {plugin.branch || (plugin.remote && !hideRemote) ? (
          <Text selectable numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            {[plugin.branch, hideRemote ? null : plugin.remote].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

function PluginUpdatesPopoverInner(props: PluginButtonContentProps) {
  const { colors } = usePluginTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = usePluginUpdates(props.workspaceId);
  const update = useRpc(pluginUpdatesUpdateRpc);
  const updateAll = useRpc(pluginUpdatesUpdateAllRpc);
  const [activeUpdate, setActiveUpdate] = useState<string | "all" | null>(null);
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<Array<{ pluginId: string; error: string }>>([]);

  const plugins = query.data?.plugins ?? [];
  const groups = useMemo(() => {
    const ordered = new Map<string, PluginUpdate[]>();
    for (const plugin of plugins) {
      const key = plugin.repoRoot ?? `\0${plugin.id}`;
      const group = ordered.get(key);
      if (group) group.push(plugin);
      else ordered.set(key, [plugin]);
    }
    return [...ordered.values()];
  }, [plugins]);
  const staleCount = useMemo(
    () => plugins.filter((plugin) => isUpdateAvailable(plugin.status)).length,
    [plugins],
  );

  const refresh = async () => {
    try {
      setFailures([]);
      await query.refetch();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  };

  const runUpdate = async (pluginId: string) => {
    setActiveUpdate(pluginId);
    setProgress(0.25);
    try {
      const result = await update({ workspaceId: props.workspaceId, pluginId });
      if (result.status === "error") {
        setFailures((current) => [
          ...current.filter((failure) => failure.pluginId !== pluginId),
          { pluginId, error: result.error || "Update failed" },
        ]);
        toast.show(result.error || `Failed to update ${pluginId}`, { variant: "error" });
      } else {
        setFailures((current) => current.filter((failure) => failure.pluginId !== pluginId));
        toast.show(`${pluginId} updated`, { variant: "success" });
      }
      setProgress(1);
      await queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, props.workspaceId] });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setActiveUpdate(null);
    }
  };

  const runUpdateAll = async () => {
    setActiveUpdate("all");
    setProgress(0.1);
    try {
      const result = await updateAll({ workspaceId: props.workspaceId });
      const failed = result.results.filter((item) => item.status === "error");
      setFailures(
        failed.map((item) => ({
          pluginId: item.pluginId,
          error: item.error || "Update failed",
        })),
      );
      setProgress(1);
      if (failed.length > 0) {
        toast.show(`${failed.length} plugin update${failed.length === 1 ? "" : "s"} failed`, {
          variant: "error",
        });
      } else {
        toast.show("All plugins updated", { variant: "success" });
      }
      await queryClient.invalidateQueries({ queryKey: [...QUERY_KEY, props.workspaceId] });
    } catch (error) {
      toast.show(error instanceof Error ? error.message : String(error), { variant: "error" });
    } finally {
      setActiveUpdate(null);
    }
  };

  useEffect(() => {
    if (query.isError) {
      toast.show("Unable to check plugin updates", { variant: "error" });
    }
  }, [query.isError, toast]);

  return (
    <PluginThemeProvider theme={props.theme} layout={props.layout}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "800" }}>Plugin updates</Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
              {query.isFetching ? "Checking installed plugins…" : `${staleCount} update${staleCount === 1 ? "" : "s"} available`}
            </Text>
          </View>
          <Button
            icon="RefreshCw"
            variant="ghost"
            size="sm"
            loading={query.isFetching}
            disabled={query.isFetching || activeUpdate !== null}
            accessibilityLabel="Refresh plugin update check"
            onPress={refresh}
          />
        </View>
        {activeUpdate ? <ProgressBar value={progress} autoStatusColor label="Updating plugins" showValueText /> : null}
        {query.isLoading && !query.data ? (
          <View style={{ alignItems: "center", padding: 18 }}>
            <ActivityIndicator color={colors.foregroundMuted} />
          </View>
        ) : plugins.length === 0 ? (
          <EmptyState title="No installed plugins" description="Paseo did not report any installed plugins." />
        ) : (
          groups.map((group) => {
            const [head] = group;
            const grouped = group.length > 1 && head;
            return (
              <View key={grouped ? (head.repoRoot ?? head.id) : head.id} style={{ gap: 10 }}>
                {grouped ? (
                  <Text selectable numberOfLines={1} style={{ color: colors.foregroundMuted, fontSize: 11 }}>
                    {[head.branch, head.remote].filter(Boolean).join(" · ")}
                  </Text>
                ) : null}
                {group.map((plugin) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    updating={activeUpdate === plugin.id}
                    onUpdate={runUpdate}
                    hideRemote={Boolean(grouped)}
                  />
                ))}
              </View>
            );
          })
        )}
        {failures.map((failure) => (
          <Card key={`failure-${failure.pluginId}`} variant="elevated" noPadding>
            <View style={{ padding: 10, gap: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StatusDot variant="danger" />
                <Text style={{ color: colors.statusDanger || "#ef4444", fontWeight: "700" }}>
                  {failure.pluginId} update failed
                </Text>
              </View>
              <Text selectable style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                {failure.error}
              </Text>
            </View>
          </Card>
        ))}
        {staleCount > 1 ? (
          <Button
            label={`Update all (${staleCount})`}
            variant="primary"
            icon="DownloadCloud"
            loading={activeUpdate === "all"}
            disabled={activeUpdate !== null}
            onPress={runUpdateAll}
          />
        ) : null}
      </ScrollView>
    </PluginThemeProvider>
  );
}

export function PluginUpdatesPopover(props: PluginButtonContentProps) {
  return (
    <PluginThemeProvider theme={props.theme} layout={props.layout}>
      <PluginUpdatesPopoverInner {...props} />
    </PluginThemeProvider>
  );
}

export function registerPluginUpdateHeaders(client: {
  addHeaderButton(contribution: {
    id: string;
    workspaceId: string;
    button: {
      title: string;
      icon: typeof PluginUpdatesIcon;
      behavior: { kind: "popover"; Content: typeof PluginUpdatesPopover };
    };
  }): PluginButtonRegistration;
  paseo: {
    agents: {
      list(): Promise<{
        entries: Array<{ agent?: { workspaceId?: string | null } }>;
      }>;
      subscribe(listener: (update: { kind: string; agent?: { workspaceId?: string | null } }) => void): () => void;
    };
  };
}) {
  const registrations = new Map<string, PluginButtonRegistration>();
  const add = (workspaceId: string) => {
    if (!workspaceId || registrations.has(workspaceId)) return;
    registrations.set(
      workspaceId,
      client.addHeaderButton({
        id: "plugin-updates",
        workspaceId,
        button: {
          title: "Plugin updates",
          icon: PluginUpdatesIcon,
          behavior: { kind: "popover", Content: PluginUpdatesPopover },
        },
      }),
    );
  };
  const subscription = client.paseo.agents.subscribe((update) => {
    if (update.kind === "upsert" && update.agent?.workspaceId) add(update.agent.workspaceId);
  });
  void client.paseo.agents.list().then((result) => {
    for (const entry of result.entries) {
      if (entry.agent?.workspaceId) add(entry.agent.workspaceId);
    }
  });
  return () => {
    subscription();
    for (const registration of registrations.values()) registration.remove();
    registrations.clear();
  };
}
