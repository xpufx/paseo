import React, { useMemo, useState } from "react";
import { Linking, View } from "react-native";
import type { Ticket, TicketBoardOutput } from "../shared/contracts.js";
import {
  TICKET_FILTERS,
  TICKET_SORT_FIELDS,
  ownerLabel,
  relativeTime,
  sortTickets,
  ticketCountFor,
  ticketMatchesFilter,
  ticketMatchesQuery,
  type SortDirection,
  type TicketFilter,
  type TicketSortField,
} from "../shared/derive.js";
import {
  Chip,
  Cluster,
  Empty,
  Hairline,
  Press,
  ScopeChips,
  SearchField,
  Stack,
  Stat,
  Type,
  useSkin,
} from "./kit.js";
import { TicketDetail } from "./ticket-detail.js";

const STATUS_TONE = {
  Backlog: "muted",
  "In progress": "accent",
  Review: "warn",
  Done: "ok",
} as const;

export interface TicketActions {
  onDispatch: (ticket: Ticket) => void;
  onRepoScope: (repo: string) => void;
}

export function TicketsView({
  data,
  loading,
  repoScope,
  actions,
}: {
  data?: TicketBoardOutput;
  loading?: boolean;
  repoScope: string;
  actions: TicketActions;
}) {
  const { palette, wide, narrow } = useSkin();
  const [filter, setFilter] = useState<TicketFilter>("all");
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<TicketSortField>("number");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [selected, setSelected] = useState<number | null>(null);

  const scoped = useMemo(() => {
    const list = data?.tickets ?? [];
    if (repoScope === "all") return list;
    return list.filter((t) => t.repo === repoScope || t.repo.toLowerCase() === repoScope.toLowerCase());
  }, [data?.tickets, repoScope]);

  const visible = useMemo(
    () =>
      sortTickets(
        scoped.filter((t) => ticketMatchesFilter(t, filter) && ticketMatchesQuery(t, query)),
        sortField,
        sortDir,
      ),
    [scoped, filter, query, sortField, sortDir],
  );

  const current = useMemo(
    () => visible.find((t) => t.number === selected) ?? scoped.find((t) => t.number === selected) ?? null,
    [visible, scoped, selected],
  );

  const repoOptions = useMemo(() => {
    const set = new Set<string>();
    if (data?.repo) set.add(data.repo);
    for (const ticket of data?.tickets ?? []) set.add(ticket.repo);
    return [
      { label: "All repositories", value: "all" },
      ...Array.from(set).sort().map((r) => ({ label: r, value: r })),
    ];
  }, [data]);

  const flip = (field: TicketSortField) => {
    if (field === sortField) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(field);
    setSortDir(field === "number" || field === "comments" ? "desc" : "asc");
  };

  const showDetailInline = wide && Boolean(current);

  return (
    <Stack gap={8} grow testID="tickets-view">
      <Cluster gap={2} testID="ticket-stats">
        <Type size={13} weight="700">
          Tickets
        </Type>
        <Stat
          testID="ticket-stat-open"
          label="open"
          value={data?.openCount ?? 0}
          tone="muted"
          onPress={() => setFilter("all")}
        />
        <Stat
          testID="ticket-stat-needs-you"
          label="needs you"
          value={data?.needsYouCount ?? 0}
          tone="warn"
          onPress={() => setFilter("needs-you")}
        />
        <Stat
          testID="ticket-stat-review"
          label="review"
          value={data?.reviewCount ?? 0}
          tone="accent"
          onPress={() => setFilter("triage-review")}
        />
        <Stat testID="ticket-stat-inflight" label="in flight" value={data?.inFlightCount ?? 0} tone="accent" />
        <View style={{ flex: 1 }} />
        <Chip label={`${visible.length} in view`} tone="muted" testID="ticket-visible-count" />
        <Chip label={repoScope === "all" ? "all repositories" : repoScope} tone="muted" testID="ticket-scope-label" />
      </Cluster>

      <Hairline />

      <Cluster gap={4} testID="ticket-filters">
        {TICKET_FILTERS.map((entry) => {
          const count = ticketCountFor(scoped, entry.id);
          return (
            <Press
              key={entry.id}
              testID={`ticket-filter-${entry.id}`}
              selected={filter === entry.id}
              onPress={() => setFilter(entry.id)}
              tone="accent"
              style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 3 }}
            >
              <Type
                size={10}
                weight={filter === entry.id ? "700" : "500"}
                color={filter === entry.id ? palette.accent : palette.textDim}
              >
                {entry.label} {count}
              </Type>
            </Press>
          );
        })}
      </Cluster>

      <Cluster gap={6} testID="ticket-controls">
        <SearchField
          testID="ticket-search"
          value={query}
          onChange={setQuery}
          placeholder="title, number, label, branch"
        />
        <Cluster gap={2} wrap={false}>
          {TICKET_SORT_FIELDS.map((field) => (
            <Press
              key={field.id}
              testID={`ticket-sort-${field.id}`}
              selected={sortField === field.id}
              onPress={() => flip(field.id)}
              tone="muted"
              accessibilityLabel={`Sort by ${field.label}`}
              style={{ paddingHorizontal: 5, paddingVertical: 3, borderRadius: 3 }}
            >
              <Type
                size={9}
                weight={sortField === field.id ? "700" : "500"}
                color={sortField === field.id ? palette.textDim : palette.textFaint}
              >
                {field.label}
                {sortField === field.id ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </Type>
            </Press>
          ))}
        </Cluster>
        <ScopeChips testID="ticket-scope" options={repoOptions} value={repoScope} onChange={actions.onRepoScope} />
      </Cluster>

      <Hairline />

      <Cluster gap={0} align="stretch" grow wrap={false} testID="ticket-body">
        <Stack gap={0} grow={showDetailInline} style={{ minWidth: 0 }}>
          {visible.length === 0 ? (
            <Empty
              testID="ticket-empty"
              title={loading ? "Reading the board…" : "No tickets match"}
              detail={
                loading
                  ? "Asking the board for open tickets."
                  : data?.error
                    ? data.error
                    : "Change the filter, the search, or the repository scope."
              }
              action={
                !loading && (filter !== "all" || query) ? (
                  <Press
                    testID="ticket-clear"
                    tone="accent"
                    onPress={() => {
                      setFilter("all");
                      setQuery("");
                    }}
                    accessibilityLabel="Clear ticket filters"
                  >
                    <Type size={10} weight="700" color={palette.accent} upper>
                      clear filters
                    </Type>
                  </Press>
                ) : undefined
              }
            />
          ) : (
            <Stack gap={0} grow testID="ticket-list">
              {visible.map((ticket, index) => (
                <TicketRow
                  key={ticket.number}
                  ticket={ticket}
                  last={index === visible.length - 1}
                  selected={ticket.number === selected}
                  compact={narrow}
                  onSelect={() => setSelected(ticket.number === selected ? null : ticket.number)}
                  onDispatch={() => actions.onDispatch(ticket)}
                />
              ))}
            </Stack>
          )}
        </Stack>

        {showDetailInline && current ? (
          <TicketDetail
            embedded
            ticket={current}
            onClose={() => setSelected(null)}
            onDispatch={actions.onDispatch}
            onOpenExternal={(url) => void Linking.openURL(url).catch(() => {})}
          />
        ) : null}
      </Cluster>

      {!wide && current ? (
        <TicketDetail
          ticket={current}
          onClose={() => setSelected(null)}
          onDispatch={actions.onDispatch}
          onOpenExternal={(url) => void Linking.openURL(url).catch(() => {})}
        />
      ) : null}
    </Stack>
  );
}

function TicketRow({
  ticket,
  last,
  selected,
  compact,
  onSelect,
  onDispatch,
}: {
  ticket: Ticket;
  last: boolean;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
  onDispatch: () => void;
}) {
  const { palette } = useSkin();
  return (
    <View>
      <Press
        testID={`ticket-row-${ticket.number}`}
        selected={selected}
        tone="accent"
        align="start"
        justify="between"
        onPress={onSelect}
        accessibilityLabel={`#${ticket.number} ${ticket.title}`}
        style={{ paddingHorizontal: 8, paddingVertical: 5, gap: 8 }}
      >
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Cluster gap={5}>
            <Type size={11} weight="700" mono color={palette.textFaint} testID={`ticket-number-${ticket.number}`}>
              #{ticket.number}
            </Type>
            <Type size={11} weight="600" numberOfLines={1} testID={`ticket-title-${ticket.number}`}>
              {ticket.title}
            </Type>
          </Cluster>
          {!compact ? (
            <Cluster gap={3}>
              {ticket.labels.slice(0, 4).map((label) => (
                <Chip key={label} label={label} tone="muted" mono size={9} />
              ))}
              {ticket.labels.length > 4 ? <Chip label={`+${ticket.labels.length - 4}`} tone="muted" size={9} /> : null}
            </Cluster>
          ) : null}
        </Stack>
        <Cluster gap={4} wrap={false} align="center">
          <Chip
            testID={`ticket-status-${ticket.number}`}
            label={ticket.status}
            tone={STATUS_TONE[ticket.status]}
            dot
          />
          <Chip testID={`ticket-owner-${ticket.number}`} label={ownerLabel(ticket.attention)} tone="muted" />
          {!compact && ticket.comments > 0 ? <Chip label={`${ticket.comments}💬`} tone="muted" /> : null}
          {!compact ? (
            <Type size={9} color={palette.textFaint}>
              {relativeTime(ticket.updatedAt) || "—"}
            </Type>
          ) : null}
          <Press
            testID={`ticket-dispatch-${ticket.number}`}
            tone="accent"
            onPress={onDispatch}
            accessibilityLabel={`Dispatch a worktree for #${ticket.number}`}
            style={{ padding: 2, margin: 0 }}
          >
            <Type size={9} weight="700" color={palette.accent} upper>
              dispatch
            </Type>
          </Press>
        </Cluster>
      </Press>
      {!last ? <Hairline inset={8} /> : null}
    </View>
  );
}
