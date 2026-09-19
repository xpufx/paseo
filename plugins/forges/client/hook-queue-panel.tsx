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

export function HookQueueView({ onClose }: { onClose?: () => void }) {
  const { colors } = usePluginTheme();
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

  return (
    <ModalBody>
      {/* Front Desk & Daemon Status Header */}
      <Card style={[styles.headerCard, { backgroundColor: colors.surface1 }]}>
        <View style={styles.headerTop}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.foreground }]}>Forge Webhook & Queues</Text>
            {statusData?.error ? (
              <Badge label="Daemon Unreachable" variant="danger" />
            ) : isAllPaused ? (
              <Badge label="All Queues Paused" variant="warning" />
            ) : (
              <Badge label="Hook Active" variant="success" />
            )}
          </View>
          <View style={styles.actionButtons}>
            <Button
              label={queuesLoading ? "Refreshing…" : "Refresh"}
              variant="secondary"
              onPress={refetchAll}
            />
            {isAllPaused ? (
              <Button
                label="Resume All"
                variant="primary"
                onPress={() => handleResume("all")}
              />
            ) : (
              <Button
                label="Pause All"
                variant="danger"
                onPress={() => handlePause("all")}
              />
            )}
            <Button
              label="Drain All"
              variant="secondary"
              onPress={() => handleDrain()}
            />
            {onClose ? <Button label="Close" variant="ghost" onPress={onClose} /> : null}
          </View>
        </View>

        <KeyValueGroup>
          <KeyValue
            label="Front Desk"
            value={frontDesk?.agentId ?? "Not Registered"}
            copyable={Boolean(frontDesk?.agentId)}
            mono
            truncate="middle"
          />
          <KeyValue label="Registered Repos" value={String(queues.length)} />
          <KeyValue label="Total Queued Messages" value={String(totalDepth)} />
          <KeyValue label="Uptime" value={`${Math.round((statusData?.uptime ?? 0) / 60)} min`} />
        </KeyValueGroup>
      </Card>

      {/* Filter and Search Controls */}
      <View style={styles.searchRow}>
        <View style={styles.searchContainer}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Filter by repository or agent ID…"
          />
        </View>
        <View style={styles.filterChips}>
          {(["all", "active", "busy", "paused"] as const).map((mode) => (
            <Button
              key={mode}
              label={mode.charAt(0).toUpperCase() + mode.slice(1)}
              variant={filterState === mode ? "primary" : "secondary"}
              onPress={() => setFilterState(mode)}
            />
          ))}
        </View>
      </View>

      {/* Queue Cards List */}
      {filteredQueues.length === 0 ? (
        <EmptyState
          title="No queues match"
          description={queues.length === 0 ? "No repository queues found on the daemon." : "Try adjusting your search or filters."}
        />
      ) : (
        filteredQueues.map((item) => (
          <QueueCard
            key={item.key}
            item={item}
            onPause={() => handlePause(item.key)}
            onResume={() => handleResume(item.key)}
            onDrain={() => handleDrain(item.key)}
            onCopyAgent={copyAgentId}
          />
        ))
      )}
    </ModalBody>
  );
}

function QueueCard({
  item,
  onPause,
  onResume,
  onDrain,
  onCopyAgent,
}: {
  item: HookQueueItem;
  onPause: () => void;
  onResume: () => void;
  onDrain: () => void;
  onCopyAgent: (id: string) => void;
}) {
  const { colors } = usePluginTheme();

  return (
    <Card style={styles.queueCard}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleCol}>
          <Text style={[styles.repoKey, { color: colors.foreground }]}>{item.key}</Text>
          <View style={styles.badgeRow}>
            {item.paused ? (
              <Badge label="Paused" variant="warning" />
            ) : item.isBusy ? (
              <Badge label={`Busy (attempt ${item.busyAttempts})`} variant="warning" />
            ) : item.depth > 0 ? (
              <Badge label={`Queued: ${item.depth}`} variant="info" />
            ) : (
              <Badge label="Idle / Empty" variant="neutral" />
            )}
            {item.dropped > 0 ? (
              <Badge label={`Dropped: ${item.dropped}`} variant="danger" />
            ) : null}
          </View>
        </View>

        <View style={styles.cardActions}>
          {item.paused ? (
            <Button label="Resume" variant="primary" onPress={onResume} />
          ) : (
            <Button label="Pause" variant="secondary" onPress={onPause} />
          )}
          <Button label="Drain" variant="secondary" onPress={onDrain} />
        </View>
      </View>

      <KeyValueGroup>
        <KeyValue
          label="Orchestrator Agent"
          value={item.orchestrator?.agentId ?? "None (holding)"}
          copyable={Boolean(item.orchestrator?.agentId)}
          mono
          truncate="middle"
        />
        <KeyValue label="Queue Depth" value={String(item.depth)} />
      </KeyValueGroup>

      {item.messages.length > 0 ? (
        <Collapsible title={`Queued Messages (${item.messages.length})`} initiallyExpanded={false}>
          <View style={styles.messageList}>
            {item.messages.map((msg, idx) => (
              <View
                key={msg.id || idx}
                style={[styles.messageItem, { borderLeftColor: colors.accent }]}
              >
                <View style={styles.msgMetaRow}>
                  <Text style={[styles.msgId, { color: colors.foregroundMuted }]}>
                    ID: {msg.id.slice(0, 10)}
                  </Text>
                  {msg.ts ? (
                    <Text style={[styles.msgTs, { color: colors.foregroundMuted }]}>
                      {new Date(msg.ts).toLocaleTimeString()}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.msgPreview, { color: colors.foreground }]} numberOfLines={3}>
                  {msg.preview}
                </Text>
              </View>
            ))}
          </View>
        </Collapsible>
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
  headerCard: {
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "bold",
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    flexWrap: "wrap",
  },
  searchContainer: {
    flex: 1,
    minWidth: 200,
  },
  filterChips: {
    flexDirection: "row",
    gap: 6,
  },
  queueCard: {
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitleCol: {
    flex: 1,
    gap: 4,
  },
  repoKey: {
    fontSize: 14,
    fontWeight: "600",
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  messageList: {
    gap: 6,
    marginTop: 6,
  },
  messageItem: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 4,
  },
  msgMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  msgId: {
    fontSize: 10,
    fontFamily: "monospace",
  },
  msgTs: {
    fontSize: 10,
  },
  msgPreview: {
    fontSize: 12,
  },
});
