import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
} from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KeyValue,
  KeyValueGroup,
  PluginThemeProvider,
  ProgressBar,
  SectionHeader,
  StatusDot,
  usePluginTheme,
} from "paseo-plugin-helper/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  pluginUpdatesCheckRpc,
  pluginUpdatesUpdateAllRpc,
  pluginUpdatesUpdateRpc,
  shortHash,
  type PluginUpdate,
} from "../shared/updates";
import { buildOrphanSection, partitionedRows, type OrphanSection } from "./orphans";

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
  if (status === "behind") return "warning";
  if (status === "error") return "danger";
  if (status === "current") return "success";
  return "neutral";
}

function fallbackDetail(plugin: PluginUpdate): string {
  if (plugin.detail) return plugin.detail;
  switch (plugin.status) {
    case "behind":
      return "Update available";
    case "current":
      return "Up to date";
    case "pinned":
      return "Pinned to a fixed ref — report only";
    case "not-a-repo":
      return "Not a git repository — no git update possible";
    case "unpinned":
      return "Detached HEAD — no upstream to compare (report only)";
    case "no-upstream":
      return "No upstream remote configured (report only)";
    case "missing":
      return "Plugin does not exist at the source it was installed from.";
    case "orphaned":
      return "Leftover managed directory from a failed install — not probed";
    case "checking":
      return "Checking…";
    default:
      return plugin.error || "Check failed";
  }
}

function reportOnlyNote(plugin: PluginUpdate): string | null {
  const status = plugin.status;
  if (status === "not-a-repo") return "Not a git checkout — update it from the workspace instead.";
  if (status === "orphaned") return "Orphaned managed directory — safe to remove if unused.";
  if (status === "pinned") {
    return plugin.refKind === "tag"
      ? "Pinned to a tag — tags are never auto-updated. Reinstall to move to another tag."
      : "Pinned by commit — immutable, no update is ever offered.";
  }
  if (status === "unpinned" || status === "no-upstream") return "Report only — no upstream remote to update from.";
  return null;
}

function refLabel(plugin: PluginUpdate): string {
  if (!plugin.ref) return "-";
  return plugin.refKind ? `${plugin.refKind} · ${plugin.ref}` : plugin.ref;
}

function hashValue(value: string | null): string | null {
  return value ? shortHash(value) : null;
}

function PluginRow({
  plugin,
  updating,
  forceNeeded,
  onUpdate,
}: {
  plugin: PluginUpdate;
  updating: boolean;
  forceNeeded: boolean;
  onUpdate: (pluginId: string, force: boolean) => void;
}) {
  const { colors, typography, padding } = usePluginTheme();
  const detail = fallbackDetail(plugin);
  const note = reportOnlyNote(plugin);
  const isOrphan = plugin.status === "orphaned";
  const version = hashValue(plugin.workingTree ?? plugin.localTree);
  return (
    <Card variant="elevated">
      <View style={{ gap: padding.gap }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusDot variant={statusVariant(plugin.status)} pulse={plugin.status === "checking"} />
          <Text style={{ color: colors.foreground, ...typography.bodyStrong, flex: 1 }}>{plugin.id}</Text>
          {plugin.dirty === true && !isOrphan ? <Badge label="dirty" variant="warning" dot /> : null}
          {plugin.updateAvailable && !isOrphan ? (
            <Button
              label={forceNeeded ? "Force update" : "Update"}
              variant={forceNeeded ? "primary" : "secondary"}
              size="sm"
              loading={updating}
              disabled={updating}
              onPress={() => onUpdate(plugin.id, forceNeeded)}
            />
          ) : null}
        </View>
        <Text selectable numberOfLines={2} style={{ color: colors.foregroundMuted, ...typography.caption }}>
          {detail}
        </Text>
        {note ? (
          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>{note}</Text>
        ) : null}
        {isOrphan ? null : (
          <>
            <KeyValueGroup columns={2} gap={padding.gap}>
              <KeyValue
                label="Version"
                value={version}
                subValue={plugin.workingTree ? "working tree" : undefined}
                mono
                copyable
              />
              <KeyValue label="Remote" value={hashValue(plugin.remoteTree)} mono copyable />
              <KeyValue label="Ref" value={refLabel(plugin)} truncate="end" />
              <KeyValue label="Subdir" value={plugin.subdir === "" ? "(repo root)" : plugin.subdir} truncate="path" />
            </KeyValueGroup>
            {plugin.latestChange?.subject ? (
              <Text selectable numberOfLines={2} style={{ color: colors.foregroundMuted, ...typography.caption }}>
                Latest remote change: {plugin.latestChange.subject}
                {plugin.latestChange.date ? ` (${plugin.latestChange.date})` : ""}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}

function OrphanSection({ section }: { section: OrphanSection }) {
  const { colors, typography } = usePluginTheme();
  return (
    <View style={{ gap: 6 }}>
      <SectionHeader title={section.title} count={section.items.length} />
      <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>{section.detail}</Text>
      <View style={{ gap: 6 }}>
        {section.items.map((item) => (
          <View key={item.name} style={{ gap: 1 }}>
            <Text selectable style={{ color: colors.foreground, ...typography.bodyStrong }}>
              {item.name}
            </Text>
            <Text selectable numberOfLines={1} style={{ color: colors.foregroundMuted, ...typography.caption }}>
              {item.path}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function PluginUpdatesIconInner(props: PluginButtonIconProps) {
  const { data, isFetching, isError } = usePluginUpdates(props.workspaceId);
  const stale = data?.plugins.some((plugin) => plugin.updateAvailable) ?? false;
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

interface Failure {
  pluginId: string;
  error: string;
  requiresForce: boolean;
}

function PluginUpdatesPopoverInner(props: PluginButtonContentProps) {
  const { colors, typography, padding } = usePluginTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const query = usePluginUpdates(props.workspaceId);
  const update = useRpc(pluginUpdatesUpdateRpc);
  const updateAll = useRpc(pluginUpdatesUpdateAllRpc);
  const [activeUpdate, setActiveUpdate] = useState<string | "all" | null>(null);
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<Failure[]>([]);

  const plugins = query.data?.plugins ?? [];
  const rows = partitionedRows(plugins);
  const orphanSection = buildOrphanSection(plugins);
  const staleCount = plugins.filter((plugin) => plugin.updateAvailable).length;
  const forceCount = failures.filter((failure) => failure.requiresForce).length;

  const refresh = async () => {
    try {
      setFailures([]);
      await query.refetch();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : String(error), { variant: "error" });
    }
  };

  const recordFailure = (failure: Failure) => {
    setFailures((current) => [
      ...current.filter((item) => item.pluginId !== failure.pluginId),
      failure,
    ]);
  };

  const clearFailure = (pluginId: string) => {
    setFailures((current) => current.filter((failure) => failure.pluginId !== pluginId));
  };

  const runUpdate = async (pluginId: string, force = false) => {
    setActiveUpdate(pluginId);
    setProgress(0.25);
    try {
      const result = await update({ workspaceId: props.workspaceId, pluginId, force });
      if (result.status === "error") {
        recordFailure({
          pluginId,
          error: result.error || "Update failed",
          requiresForce: result.requiresForce === true,
        });
        toast.show(result.error || `Failed to update ${pluginId}`, { variant: "error" });
      } else {
        clearFailure(pluginId);
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

  const runUpdateAll = async (force = false) => {
    setActiveUpdate("all");
    setProgress(0.1);
    try {
      const result = await updateAll({ workspaceId: props.workspaceId, force });
      const failed = result.results.filter((item) => item.status === "error");
      setFailures(
        failed.map((item) => ({
          pluginId: item.pluginId,
          error: item.error || "Update failed",
          requiresForce: item.requiresForce === true,
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
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: padding.horizontal,
          paddingVertical: padding.vertical,
          gap: padding.gap,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, ...typography.heading }}>Plugin updates</Text>
            <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>
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
          <View style={{ alignItems: "center", paddingVertical: padding.vertical * 2 }}>
            <ActivityIndicator color={colors.foregroundMuted} />
          </View>
        ) : plugins.length === 0 ? (
          <EmptyState title="No installed plugins" description="Paseo did not report any installed plugins." />
        ) : (
          <>
            {rows.map((plugin) => (
              <PluginRow
                key={plugin.id}
                plugin={plugin}
                updating={activeUpdate === plugin.id}
                forceNeeded={failures.some((failure) => failure.pluginId === plugin.id && failure.requiresForce)}
                onUpdate={runUpdate}
              />
            ))}
            {orphanSection ? <OrphanSection section={orphanSection} /> : null}
          </>
        )}
        {failures.map((failure) => (
          <Card key={`failure-${failure.pluginId}`} variant="elevated">
            <View style={{ gap: padding.gap }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <StatusDot variant="danger" />
                <Text style={{ color: colors.statusDanger, ...typography.bodyStrong, flex: 1 }}>
                  {failure.pluginId} update failed
                </Text>
                {failure.requiresForce ? (
                  <Button
                    label="Force"
                    variant="secondary"
                    size="sm"
                    loading={activeUpdate === failure.pluginId}
                    disabled={activeUpdate !== null}
                    onPress={() => runUpdate(failure.pluginId, true)}
                  />
                ) : null}
              </View>
              <Text selectable style={{ color: colors.foregroundMuted, ...typography.caption }}>
                {failure.error}
              </Text>
            </View>
          </Card>
        ))}
        {forceCount > 0 ? (
          <Button
            label="Force update all"
            variant="secondary"
            icon="AlertTriangle"
            loading={activeUpdate === "all"}
            disabled={activeUpdate !== null}
            onPress={() => runUpdateAll(true)}
          />
        ) : staleCount > 1 ? (
          <Button
            label={`Update all (${staleCount})`}
            variant="primary"
            icon="DownloadCloud"
            loading={activeUpdate === "all"}
            disabled={activeUpdate !== null}
            onPress={() => runUpdateAll(false)}
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
