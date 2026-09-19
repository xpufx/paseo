import test from "node:test";
import assert from "node:assert/strict";
import {
  currentTurn,
  deriveTurns,
  fetchAllTurns,
  formatTurnAddress,
  formatTurnSummary,
  type TimelineEntryLike,
} from "./turn-counter";

function userMessage(seq: number, text = `msg ${seq}`): TimelineEntryLike {
  return { seqStart: seq, seqEnd: seq, item: { type: "user_message", text } };
}

test("deriveTurns numbers user messages 1-based with their seq", () => {
  const turns = deriveTurns([
    userMessage(0, "first"),
    { seqStart: 1, seqEnd: 1, item: { type: "assistant_message", text: "hi" } },
    userMessage(2, "second"),
    { seqStart: 3, seqEnd: 3, item: { type: "tool_call" } },
    userMessage(5, "third"),
  ]);
  assert.deepEqual(
    turns.map((t) => ({ turn: t.turn, seq: t.seq })),
    [
      { turn: 1, seq: 0 },
      { turn: 2, seq: 2 },
      { turn: 3, seq: 5 },
    ],
  );
  assert.equal(turns[0].preview, "first");
});

test("deriveTurns sorts out-of-order concatenated pages by seq", () => {
  const turns = deriveTurns([userMessage(4, "d"), userMessage(0, "a"), userMessage(2, "c")]);
  assert.deepEqual(turns.map((t) => t.seq), [0, 2, 4]);
  assert.deepEqual(turns.map((t) => t.turn), [1, 2, 3]);
});

test("deriveTurns drops entries without a numeric seq instead of shifting turns", () => {
  const turns = deriveTurns([
    userMessage(0),
    { item: { type: "user_message", text: "no seq" } },
    userMessage(3),
  ]);
  assert.deepEqual(turns.map((t) => t.seq), [0, 3]);
});

test("deriveTurns falls back to seqStart when seqEnd is absent", () => {
  const turns = deriveTurns([{ seqStart: 7, item: { type: "user_message", text: "x" } }]);
  assert.equal(turns[0].seq, 7);
});

test("currentTurn returns the last turn and undefined when empty", () => {
  assert.equal(currentTurn([]), undefined);
  const turns = deriveTurns([userMessage(0), userMessage(9)]);
  assert.equal(currentTurn(turns)?.turn, 2);
  assert.equal(currentTurn(turns)?.seq, 9);
});

test("formatTurnAddress is the shared address both sides resolve", () => {
  assert.equal(formatTurnAddress(3, 12), "Turn #3 (seq 12)");
  assert.equal(formatTurnSummary({ turn: 1, seq: 0, preview: "" }), "Turn #1 (seq 0)");
});

test("fetchAllTurns walks before-pages to the start of history", async () => {
  const pages: Record<string, { entries: TimelineEntryLike[]; hasOlder: boolean; startCursor?: { epoch: string; seq: number } | null }> = {
    tail: {
      entries: [userMessage(4), userMessage(5)],
      hasOlder: true,
      startCursor: { epoch: "e1", seq: 4 },
    },
    before4: {
      entries: [userMessage(2), userMessage(3)],
      hasOlder: true,
      startCursor: { epoch: "e1", seq: 2 },
    },
    before2: {
      entries: [userMessage(0), userMessage(1)],
      hasOlder: false,
      startCursor: null,
    },
  };
  const calls: Array<{ direction?: string; seq?: number }> = [];
  const paseo = {
    agents: {
      ref: () => ({
        timeline: {
          refetch: async (options?: { direction?: string; cursor?: { seq: number } }) => {
            calls.push({ direction: options?.direction, seq: options?.cursor?.seq });
            if (!options?.direction) return pages.tail;
            if (options.cursor?.seq === 4) return pages.before4;
            return pages.before2;
          },
        },
      }),
    },
  };

  const turns = await fetchAllTurns(paseo as never, "agent-1");
  assert.deepEqual(turns.map((t) => t.seq), [0, 1, 2, 3, 4, 5]);
  assert.equal(turns.length, 6);
  assert.deepEqual(calls, [
    { direction: undefined, seq: undefined },
    { direction: "before", seq: 4 },
    { direction: "before", seq: 2 },
  ]);
});

test("fetchAllTurns stops on a stale cursor without losing collected turns", async () => {
  let call = 0;
  const paseo = {
    agents: {
      ref: () => ({
        timeline: {
          refetch: async () => {
            call += 1;
            if (call === 1) {
              return {
                entries: [userMessage(3)],
                hasOlder: true,
                startCursor: { epoch: "old", seq: 3 },
              };
            }
            return {
              entries: [],
              hasOlder: true,
              startCursor: { epoch: "old", seq: 0 },
              staleCursor: true,
            };
          },
        },
      }),
    },
  };
  const turns = await fetchAllTurns(paseo as never, "agent-1");
  assert.deepEqual(turns.map((t) => t.seq), [3]);
});

test("fetchAllTurns dedupes the overlap between pages", async () => {
  const paseo = {
    agents: {
      ref: () => ({
        timeline: {
          refetch: async (options?: { direction?: string }) => {
            if (!options?.direction) {
              return {
                entries: [userMessage(2), userMessage(3)],
                hasOlder: true,
                startCursor: { epoch: "e", seq: 2 },
              };
            }
            return {
              entries: [userMessage(2), userMessage(3)],
              hasOlder: false,
              startCursor: null,
            };
          },
        },
      }),
    },
  };
  const turns = await fetchAllTurns(paseo as never, "agent-1");
  assert.deepEqual(turns.map((t) => t.seq), [2, 3]);
});

test("fetchAllTurns drops malformed entries instead of emitting a bogus seq", async () => {
  const paseo = {
    agents: {
      ref: () => ({
        timeline: {
          refetch: async () => ({
            entries: [
              userMessage(0),
              { item: { type: "user_message", text: "no seq" } },
              userMessage(4),
            ],
            hasOlder: false,
          }),
        },
      }),
    },
  };
  const turns = await fetchAllTurns(paseo as never, "agent-1");
  assert.deepEqual(turns.map((t) => t.seq), [0, 4]);
});

