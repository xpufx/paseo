import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  ModalBody,
  Card,
  Button,
  Badge,
  EmptyState,
  SearchInput,
  KeyValue,
  KeyValueGroup,
  Collapsible,
  Row,
  Stack,
  SectionHeader,
  useRpcQuery,
  useRpcMutation,
  usePluginTheme,
  copyToClipboard,
} from "paseo-plugin-helper/client";
import {
  hookStatusContract,
  hookQueuesContract,
  hookPauseContract,
  hookResumeContract,
  hookDrainContract,
  type HookQueueItem,
} from "../shared/hook-queue.js";

export function HookQueueView({
  onClose,
  embedded = false,
}: {
  onClose?: () => void;
  embedded?: boolean;
}) {
  const { colors, padding, isCompact } = usePluginTheme();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState<"all" | "active" | "busy" | "paused">("all");

  const {
    data: queuesData,
    isLoading: queuesLoading,
    refetch: refetchQueues,
  } = useRpcQuery(hookQueuesContract, {}, { refetchInterval: 3000 });

  const {
    data: statusData,
    refetch: refetchStatus,
  } = useRpcQuery(hookStatusContract, {}, { refetchInterval: 3000 });

  const pauseMutation = useRpcMutation(hookPauseContract);
  const resumeMutation = useRpcMutation(hookResumeContract);
  const drainMutation = useRpcMutation(hookDrainContract);

  const refetchAll = () => {
    void refetchQueues();
    void refetchStatus();
  };

  const handlePause = async (repo?: string) => {
    try {
      const res = await pauseMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(repo ? `Paused queue for ${repo}` : "Paused all queues");
        refetchAll();
      } else {
        toast.error(res.error || "Failed to pause");
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleResume = async (repo?: string) => {
    try {
      const res = await resumeMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(repo ? `Resumed queue for ${repo}` : "Resumed all queues");
        refetchAll();
      } else {
        toast.error(res.error || "Failed to resume");
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleDrain = async (repo?: string) => {
    try {
      const res = await drainMutation.mutateAsync({ repo });
      if (res.ok) {
        toast.show(repo ? `Draining queue for ${repo}` : "Draining all queues");
        refetchAll();
      } else {
        toast.error(res.error || "Failed to drain");
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const copyAgentId = (agentId: string) => {
    void copyToClipboard(agentId);
    toast.show(`Copied ${agentId.slice(0, 8)}…`);
  };

  const queues = queuesData?.queues ?? [];
  const frontDesk = queuesData?.frontDesk ?? statusData?.frontDesk;
  const isAllPaused = statusData?.paused?.includes("all") || queuesData?.paused?.includes("all");

  const filteredQueues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queues.filter((item) => {
      if (q) {
        const matchesKey = item.key.toLowerCase().includes(q);
        const matchesOrch = item.orchestrator?.agentId?.toLowerCase().includes(q);
        if (!matchesKey && !matchesOrch) return false;
      }
      if (filterState === "active") return item.depth > 0;
      if (filterState === "busy") return item.isBusy;
      if (filterState === "paused") return item.paused;
      return true;
    });
  }, [queues, search, filterState]);

  const totalDepth = queues.reduce((sum, item) => sum + item.depth, 0);

  const content = (
    <View style={{ gap: padding.gap }}>
      {/* Front Desk & Daemon Status Header */}
      <Card variant="elevated">
        <Card.Header
          title="Forge Webhook & Queues"
          subtitle={`Uptime: ${Math.round((statusData?.uptime ?? 0) / 60)} min · ${queues.length} registered repos`}
          badge={
            statusData?.error ? (
              <Badge label="Unreachable" variant="danger" size="sm" dot />
            ) : isAllPaused ? (
              <Badge label="All Paused" variant="warning" size="sm" dot />
            ) : (
              <Badge label="Hook Active" variant="success" size="sm" dot />
            )
          }
          action={
            <Row gap="xs" align="center" wrap>
              <Button
                label="Refresh"
                size="sm"
                variant="secondary"
                loading={queuesLoading}
                onPress={refetchAll}
              />
              {isAllPaused ? (
                <Button
                  label="Resume All"
                  size="sm"
                  variant="primary"
                  onPress={() => handleResume("all")}
                />
              ) : (
                <Button
                  label="Pause All"
                  size="sm"
                  variant="danger"
                  onPress={() => handlePause("all")}
                />
              )}
              <Button
                label="Drain All"
                size="sm"
                variant="secondary"
                onPress={() => handleDrain()}
              />
              {onClose ? <Button label="Close" size="sm" variant="ghost" onPress={onClose} /> : null}
            </Row>
          }
        />

        <KeyValueGroup columns={isCompact ? 1 : 3} collapse="compact" gap={padding.gap}>
          <KeyValue
            layout="inline"
            label="Front Desk"
            value={frontDesk?.agentId ? `${frontDesk.agentId.slice(0, 8)}…` : "Not Registered"}
            copyable={Boolean(frontDesk?.agentId)}
            mono
          />
          <KeyValue
            layout="inline"
            label="Total Queued"
            value={String(totalDepth)}
            valueStyle={totalDepth > 0 ? { color: colors.statusWarning } : undefined}
          />
          <KeyValue
            layout="inline"
            label="Uptime"
            value={`${Math.round((statusData?.uptime ?? 0) / 60)} min`}
          />
        </KeyValueGroup>
      </Card>

      {/* Filter and Search Controls */}
      <Row gap="xs" align="center" wrap>
        <View style={{ flex: 1, minWidth: 180 }}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Filter by repository or agent ID…"
          />
        </View>
        <Row gap="xs" align="center" wrap>
          {(["all", "active", "busy", "paused"] as const).map((mode) => {
            const count =
              mode === "all"
                ? queues.length
                : mode === "active"
                  ? queues.filter((q) => q.depth > 0).length
                  : mode === "busy"
                    ? queues.filter((q) => q.isBusy).length
                    : queues.filter((q) => q.paused).length;
            return (
              <Button
                key={mode}
                size="sm"
                label={
                  mode === "all"
                    ? "All"
                    : `${mode.charAt(0).toUpperCase() + mode.slice(1)} (${count})`
                }
                variant={filterState === mode ? "primary" : "ghost"}
                onPress={() => setFilterState(mode)}
              />
            );
          })}
        </Row>
      </Row>

      <SectionHeader title="Queues" count={filteredQueues.length} />

      {/* Queue Cards List */}
      {filteredQueues.length === 0 ? (
        <EmptyState
          title="No queues match"
          description={
            queues.length === 0
              ? "No repository queues found on the daemon."
              : "Try adjusting your search or filters."
          }
        />
      ) : (
        <Stack gap="sm">
          {filteredQueues.map((item) => (
            <QueueCard
              key={item.key}
              item={item}
              onPause={() => handlePause(item.key)}
              onResume={() => handleResume(item.key)}
              onDrain={() => handleDrain(item.key)}
              onCopyAgent={copyAgentId}
            />
          ))}
        </Stack>
      )}
    </View>
  );

  if (embedded) {
    return content;
  }

  return (
    <ModalBody size="large" refreshing={queuesLoading} onRefresh={refetchAll}>
      {content}
    </ModalBody>
  );
}

function QueueCard({
  item,
  onPause,
  onResume,
  onDrain,
  onCopyAgent: _onCopyAgent,
}: {
  item: HookQueueItem;
  onPause: () => void;
  onResume: () => void;
  onDrain: () => void;
  onCopyAgent: (id: string) => void;
}) {
  const { colors, padding, typography, resolveRadius, isCompact } = usePluginTheme();

  return (
    <Card variant="elevated">
      <Card.Header
        title={item.key}
        badge={
          <Row gap="xs" align="center" wrap>
            {item.paused ? (
              <Badge label="Paused" variant="warning" size="sm" dot />
            ) : item.isBusy ? (
              <Badge label={`Busy (${item.busyAttempts})`} variant="warning" size="sm" dot />
            ) : item.depth > 0 ? (
              <Badge label={`${item.depth} queued`} variant="accent" size="sm" />
            ) : (
              <Badge label="Idle" variant="neutral" size="sm" dot />
            )}
            {item.dropped > 0 ? (
              <Badge label={`${item.dropped} dropped`} variant="danger" size="sm" />
            ) : null}
          </Row>
        }
        action={
          <Row gap="xs" align="center">
            {item.paused ? (
              <Button label="Resume" size="sm" variant="primary" onPress={onResume} />
            ) : (
              <Button label="Pause" size="sm" variant="secondary" onPress={onPause} />
            )}
            <Button label="Drain" size="sm" variant="secondary" onPress={onDrain} />
          </Row>
        }
      />

      <KeyValueGroup columns={isCompact ? 1 : 2} collapse="compact" gap={padding.gap}>
        <KeyValue
          layout="inline"
          label="Orchestrator"
          value={
            item.orchestrator?.agentId
              ? `${item.orchestrator.agentId.slice(0, 8)}…`
              : "None (holding)"
          }
          copyable={Boolean(item.orchestrator?.agentId)}
          mono
        />
        <KeyValue
          layout="inline"
          label="Queue Depth"
          value={String(item.depth)}
          valueStyle={item.depth > 0 ? { color: colors.statusWarning } : undefined}
        />
      </KeyValueGroup>

      {item.messages.length > 0 ? (
        <View style={{ marginTop: padding.gap }}>
          <Collapsible
            title={`Queued Messages (${item.messages.length})`}
            badge={<Badge label={String(item.messages.length)} size="sm" variant="neutral" />}
            initiallyExpanded={false}
          >
            <Stack gap="xs" style={{ marginTop: padding.gap }}>
              {item.messages.map((msg, idx) => (
                <View
                  key={msg.id || idx}
                  style={[
                    styles.messageItem,
                    {
                      borderLeftColor: colors.accent,
                      backgroundColor: colors.surface0,
                      borderRadius: resolveRadius("sm"),
                      paddingHorizontal: padding.horizontal / 2,
                      paddingVertical: padding.vertical / 2,
                    },
                  ]}
                >
                  <Row justify="space-between" align="center" style={{ marginBottom: 2 }}>
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.foregroundMuted, fontFamily: "monospace" },
                      ]}
                    >
                      {msg.id.slice(0, 10)}
                    </Text>
                    {msg.ts ? (
                      <Text style={[typography.caption, { color: colors.foregroundMuted }]}>
                        {new Date(msg.ts).toLocaleTimeString()}
                      </Text>
                    ) : null}
                  </Row>
                  <Text
                    style={[typography.caption, { color: colors.foreground }]}
                    numberOfLines={3}
                  >
                    {msg.preview}
                  </Text>
                </View>
              ))}
            </Stack>
          </Collapsible>
        </View>
      ) : null}
    </Card>
  );
}

export function ForgeHookQueuePanel({ workspaceId: _workspaceId }: { workspaceId?: string }) {
  return <HookQueueView />;
}

export function ForgeHookQueueSurface() {
  return <HookQueueView />;
}

const styles = StyleSheet.create({
  messageItem: {
    borderLeftWidth: 3,
  },
});
