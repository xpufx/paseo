/**
 * Deterministic conversation turn counter.
 *
 * Source of truth is the daemon timeline, reached through the plugin-facing
 * `paseo.agents.ref(id).timeline.refetch()` path (xpufx-org/paseo#248). Each
 * `user_message` entry maps 1:1 to a canonical timeline row, so filtering to
 * `user_message` and sorting by `seqEnd` yields a stable 1-based turn number
 * plus the exact `seq` an agent can resolve against the same timeline. The UI
 * and the agent therefore agree on `Turn #N (seq S)` without a bespoke server.
 *
 * No `@getpaseo/*` import: the input/output shapes are structural so the module
 * stays dependency-free and unit-testable without the Paseo runtime.
 */

export interface TimelineEntryLike {
  seqStart?: number;
  seqEnd?: number;
  item?: { type?: string; text?: string } | null;
}

export interface TimelineCursor {
  epoch: string;
  seq: number;
}

export interface TimelinePageLike {
  entries: readonly TimelineEntryLike[];
  hasOlder?: boolean;
  startCursor?: TimelineCursor | null;
  staleCursor?: boolean;
  reset?: boolean;
}

export interface TimelineRefetchOptionsLike {
  direction?: "tail" | "before" | "after";
  cursor?: TimelineCursor;
  limit?: number;
}

export interface AgentTimelineRefLike {
  timeline: {
    refetch(options?: TimelineRefetchOptionsLike): Promise<TimelinePageLike>;
  };
}

export interface PaseoAgentApiLike {
  agents: { ref(agentId: string): AgentTimelineRefLike };
}

export interface TurnRef {
  /** 1-based conversation turn number (Turn #1 is the first user message). */
  turn: number;
  /** Canonical timeline seq of the user_message row; shared with the agent. */
  seq: number;
  /** Verbatim user message text (may be empty). */
  preview: string;
}

/** Default page size while walking history backwards. */
export const TURN_PAGE_LIMIT = 200;
/** Safety bound so a pathological timeline cannot loop forever. */
export const TURN_MAX_PAGES = 50;

/**
 * `Turn #3 (seq 12)` — the single address format the panel renders and tests
 * assert, so a human reference and the agent's own resolution cannot drift.
 */
export function formatTurnAddress(turn: number, seq: number): string {
  return `Turn #${turn} (seq ${seq})`;
}

/** Shortest unambiguous tail of a turn, for list rows and copy actions. */
export function formatTurnSummary(turn: TurnRef): string {
  return formatTurnAddress(turn.turn, turn.seq);
}

/**
 * Derives 1-based turns from timeline entries. `user_message` rows are filtered
 * and sorted by `seq`, so a caller's page-concatenation order is irrelevant.
 * Entries without a usable numeric seq are dropped rather than silently
 * shifting later turn numbers.
 */
export function deriveTurns(entries: readonly TimelineEntryLike[]): TurnRef[] {
  const rows: Array<{ seq: number; preview: string }> = [];
  for (const entry of entries) {
    const item = entry?.item;
    if (!item || item.type !== "user_message") continue;
    const seq = typeof entry.seqEnd === "number" ? entry.seqEnd : entry.seqStart;
    if (typeof seq !== "number" || !Number.isFinite(seq)) continue;
    rows.push({ seq, preview: typeof item.text === "string" ? item.text : "" });
  }
  rows.sort((a, b) => a.seq - b.seq);
  return rows.map((row, index) => ({ turn: index + 1, seq: row.seq, preview: row.preview }));
}

/** Current/last turn, or undefined for an empty conversation. */
export function currentTurn(turns: readonly TurnRef[]): TurnRef | undefined {
  return turns.length > 0 ? turns[turns.length - 1] : undefined;
}

/**
 * Full-history turns via cursor paging. `refetch()` defaults to a 200-entry
 * tail page, so walk backwards with `direction: "before"` using the page's
 * `startCursor` until the daemon reports no older history. A stale/reset epoch
 * (agent replacement) stops the walk and returns what was collected.
 */
export async function fetchAllTurns(
  paseo: PaseoAgentApiLike,
  agentId: string,
  pageLimit: number = TURN_PAGE_LIMIT,
): Promise<TurnRef[]> {
  const handle = paseo.agents.ref(agentId);
  let page = await handle.timeline.refetch({ limit: pageLimit });
  const bySeq = new Map<number, TimelineEntryLike>();
  storeEntries(bySeq, page.entries);

  let pages = 0;
  while (page.hasOlder && page.startCursor && pages < TURN_MAX_PAGES) {
    const next = await handle.timeline.refetch({
      direction: "before",
      cursor: page.startCursor,
      limit: pageLimit,
    });
    if (next.staleCursor || next.reset) break;
    storeEntries(bySeq, next.entries);
    page = next;
    pages += 1;
  }
  return deriveTurns([...bySeq.values()]);
}

function storeEntries(
  bySeq: Map<number, TimelineEntryLike>,
  entries: readonly TimelineEntryLike[],
): void {
  for (const entry of entries) {
    const seq = entrySeq(entry);
    if (seq !== undefined) bySeq.set(seq, entry);
  }
}

/**
 * Stable dedupe key for an entry. `user_message` is not identity-merged, so
 * `seqEnd` is the row seq; fall back to `seqStart` if a host omits it. Returns
 * undefined for a malformed entry so it is dropped, never a bogus `seq -1`.
 */
function entrySeq(entry: TimelineEntryLike): number | undefined {
  if (typeof entry.seqEnd === "number" && Number.isFinite(entry.seqEnd)) return entry.seqEnd;
  if (typeof entry.seqStart === "number" && Number.isFinite(entry.seqStart)) return entry.seqStart;
  return undefined;
}
