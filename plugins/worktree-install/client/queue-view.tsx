import React, { useMemo, useState } from "react";
import { View } from "react-native";
import type { QueueOutput, QueuePreset, RepoQueue, RouterStatusOutput } from "../shared/contracts.js";
import {
  QUEUE_FILTERS,
  QUEUE_SORT_FIELDS,
  durationText,
  queueMatchesFilter,
  queueMatchesQuery,
  queueState,
  routerBadge,
  sortQueues,
  type QueueSortField,
  type SortDirection,
} from "../shared/derive.js";
import {
  Banner,
  Chip,
  Cluster,
  Empty,
  Field,
  Hairline,
  Press,
  SearchField,
  Stack,
  Stat,
  Type,
  toneColorOf,
  useSkin,
} from "./kit.js";

export interface QueueActions {
  onPause: (repo?: string) => Promise<void> | void;
  onResume: (repo?: string) => Promise<void> | void;
  onDrain: (repo: string) => Promise<void> | void;
  busy?: boolean;
}

const QUEUE_TONE = { ready: "muted", busy: "ok", paused: "warn" } as const;

export function QueueView({
  status,
  queues,
  loading,
  actions,
}: {
  status?: RouterStatusOutput;
  queues?: QueueOutput;
  loading?: boolean;
  actions: QueueActions;
}) {
  const { palette, narrow } = useSkin();
  const [preset, setPreset] = useState<QueuePreset>("all");
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<QueueSortField>("repo");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const list = queues?.queues ?? [];
  const badge = routerBadge(Boolean(status?.ok), Boolean(status?.active));

  const visible = useMemo(
    () =>
      sortQueues(
        list.filter((queue) => queueMatchesFilter(queue, preset) && queueMatchesQuery(queue, query)),
        sortField,
        sortDir,
      ),
    [list, preset, query, sortField, sortDir],
  );

  const flip = (field: QueueSortField) => {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(field);
    setSortDir(field === "depth" ? "desc" : "asc");
  };

  return (
    <Stack gap={8} testID="queue-view">
      <Cluster gap={2} wrap={false} testID="queue-stats">
        <Type size={13} weight="700">
          Queue
        </Type>
        <Chip
          testID="router-badge"
          label={badge.label}
          tone={badge.tone === "ok" ? "ok" : badge.tone === "warn" ? "warn" : "critical"}
          dot
          strong
        />
        <Stat label="repos" value={status?.repoCount ?? list.length} testID="queue-repo-count" />
        <Stat label="queued" value={status?.totalQueued ?? 0} tone="accent" testID="queue-total" />
        <Stat label="paused" value={status?.paused.length ?? 0} tone="warn" testID="queue-paused-count" />
        <View style={{ flex: 1 }} />
        <Press testID="queue-pause-all" tone="warn" disabled={actions.busy} onPress={() => actions.onPause()} accessibilityLabel="Pause all queues">
          <Type size={10} weight="600" color={palette.warn}>
            pause all
          </Type>
        </Press>
        <Press testID="queue-resume-all" tone="ok" disabled={actions.busy} onPress={() => actions.onResume()} accessibilityLabel="Resume all queues">
          <Type size={10} weight="600" color={palette.ok}>
            resume all
          </Type>
        </Press>
      </Cluster>

      <Hairline />

      {/* Router read-out. Read-only on purpose: the router process is owned by
          uppidi-fleet, and a second plugin reconfiguring it is not this
          surface's business. */}
      <View
        testID="router-strip"
        style={{
          borderWidth: 1,
          borderColor: palette.rule,
          backgroundColor: palette.panel,
          borderRadius: 4,
          padding: 7,
          gap: 5,
        }}
      >
        <Cluster gap={5} justify="between" align="start">
          <Cluster gap={5}>
            <Type size={9} weight="700" color={palette.textFaint} upper>
              router
            </Type>
            <Type size={12} weight="700" testID="router-state">
              {status?.state ?? "checking"}
            </Type>
            {status?.service ? <Chip label={status.service} tone="muted" /> : null}
            {status?.version !== undefined ? <Chip label={`v${status.version}`} tone="muted" mono /> : null}
            {status?.uptime !== undefined ? <Chip label={`up ${durationText(status.uptime * 1000)}`} tone="muted" /> : null}
            {status?.capabilities?.xCommsInstalled ? <Chip label="x-comms" tone="ok" dot /> : null}
          </Cluster>
          <Chip
            label={`${visible.length}/${list.length} shown`}
            tone="muted"
            testID="queue-shown-count"
          />
        </Cluster>
        <Cluster gap={10} align="start">
          <Field testID="router-endpoint" label="endpoint" value={status?.url ?? "—"} mono copyable />
          <Field
            testID="router-active-host"
            label="active host"
            value={status?.host ?? "not listening"}
            mono
            tone={status?.host ? undefined : "muted"}
          />
          <Field
            testID="router-active-port"
            label="active port"
            value={status?.port !== undefined ? String(status.port) : "not listening"}
            mono
            tone={status?.port !== undefined ? undefined : "muted"}
          />
          <Field
            testID="router-configured"
            label="configured"
            value={`${status?.configuredHost ?? "127.0.0.1"}:${status?.configuredPort ?? 8099}`}
            mono
          />
          <Field
            testID="router-liaison"
            label="liaison agent"
            value={status?.frontDeskAgentId ?? "none assigned"}
            mono
            copyable={Boolean(status?.frontDeskAgentId)}
          />
          {status?.availableInterfaces && status.availableInterfaces.length > 0 ? (
            <Field testID="router-interfaces" label="interfaces" value={status.availableInterfaces.join(", ")} mono />
          ) : null}
        </Cluster>
        {status?.error ? (
          <Banner
            testID="router-error"
            tone="critical"
            title="Router unreachable"
            detail={`${status.error}. The queue below is empty because the router could not be reached, not because there is no work.`}
          />
        ) : null}
      </View>

      <Cluster gap={6} testID="queue-filters">
        <Cluster gap={2} wrap={false}>
          {QUEUE_FILTERS.map((filter) => (
            <Press
              key={filter.id}
              testID={`queue-filter-${filter.id}`}
              selected={preset === filter.id}
              onPress={() => setPreset(filter.id)}
              tone="accent"
              style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 3 }}
            >
              <Type size={10} weight={preset === filter.id ? "700" : "500"} color={preset === filter.id ? palette.accent : palette.textDim}>
                {filter.label}
              </Type>
            </Press>
          ))}
        </Cluster>
        <SearchField testID="queue-search" value={query} onChange={setQuery} placeholder="repo or liaison agent" />
        <Cluster gap={2} wrap={false}>
          {QUEUE_SORT_FIELDS.map((field) => (
            <Press
              key={field.id}
              testID={`queue-sort-${field.id}`}
              selected={sortField === field.id}
              onPress={() => flip(field.id)}
              tone="muted"
              accessibilityLabel={`Sort by ${field.label}`}
              style={{ paddingHorizontal: 5, paddingVertical: 3, borderRadius: 3 }}
            >
              <Type size={9} weight={sortField === field.id ? "700" : "500"} color={sortField === field.id ? palette.textDim : palette.textFaint}>
                {field.label}
                {sortField === field.id ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </Type>
            </Press>
          ))}
        </Cluster>
      </Cluster>

      {visible.length === 0 ? (
        <Empty
          testID="queue-empty"
          title={loading ? "Reading the router…" : list.length === 0 ? "No active queues" : "No queues match"}
          detail={
            loading
              ? "Asking the router for its per-repository queues."
              : list.length === 0
                ? "The router is not tracking any repository."
                : "Change the preset or the search to see more."
          }
        />
      ) : (
        <Stack gap={4} testID="queue-list">
          {visible.map((queue) => (
            <QueueRow key={queue.key} queue={queue} busy={actions.busy} actions={actions} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function QueueRow({ queue, busy, actions }: { queue: RepoQueue; busy?: boolean; actions: QueueActions }) {
  const { palette, narrow } = useSkin();
  const state = queueState(queue);
  const tone = QUEUE_TONE[state];

  return (
    <View
      testID={`queue-${queue.key}`}
      style={{
        borderWidth: 1,
        borderColor: palette.rule,
        borderLeftWidth: 2,
        borderLeftColor: toneColorOf(palette, tone),
        backgroundColor: palette.panel,
        borderRadius: 3,
        paddingHorizontal: 8,
        paddingVertical: 6,
        gap: 4,
      }}
    >
      <Cluster gap={6} justify="between" align="start">
        <Cluster gap={5} style={{ flex: 1, minWidth: 0 }}>
          <Type size={11} weight="700" mono numberOfLines={1} testID={`queue-key-${queue.key}`}>
            {queue.key}
          </Type>
          <Chip testID={`queue-state-${queue.key}`} label={state} tone={tone} dot strong />
          <Chip label={`${queue.depth} queued`} tone="accent" />
          {queue.dropped > 0 ? <Chip testID={`queue-dropped-${queue.key}`} label={`${queue.dropped} dropped`} tone="critical" /> : null}
          {queue.busyAttempts > 0 ? (
            <Chip testID={`queue-attempts-${queue.key}`} label={`${queue.busyAttempts} attempts`} tone="warn" />
          ) : null}
          {queue.orchestrator?.agentId ? (
            <Chip
              testID={`queue-orchestrator-${queue.key}`}
              label={`liaison ${queue.orchestrator.agentId.slice(0, 8)}`}
              tone="muted"
              mono
            />
          ) : null}
        </Cluster>
        <Cluster gap={4} wrap={false}>
          <Press
            testID={`queue-toggle-${queue.key}`}
            tone={state === "paused" ? "ok" : "warn"}
            disabled={busy}
            onPress={() => (state === "paused" ? actions.onResume(queue.key) : actions.onPause(queue.key))}
            accessibilityLabel={state === "paused" ? `Resume ${queue.key}` : `Pause ${queue.key}`}
          >
            <Type size={10} weight="600" color={state === "paused" ? palette.ok : palette.warn}>
              {state === "paused" ? "resume" : "pause"}
            </Type>
          </Press>
          <Press
            testID={`queue-drain-${queue.key}`}
            tone="critical"
            disabled={busy}
            onPress={() => actions.onDrain(queue.key)}
            accessibilityLabel={`Drain ${queue.key}`}
          >
            <Type size={10} weight="600" color={palette.critical}>
              drain
            </Type>
          </Press>
        </Cluster>
      </Cluster>

      {queue.messages.length > 0 ? (
        <Stack gap={2} testID={`queue-messages-${queue.key}`}>
          {(narrow ? queue.messages.slice(0, 2) : queue.messages.slice(0, 3)).map((message) => (
            <Cluster key={message.id} gap={5} align="start">
              <Type size={9} mono color={palette.textFaint}>
                •
              </Type>
              <Type size={10} mono color={palette.textDim} numberOfLines={1} style={{ flex: 1 } as never}>
                {message.preview}
              </Type>
            </Cluster>
          ))}
        </Stack>
      ) : null}
    </View>
  );
}
