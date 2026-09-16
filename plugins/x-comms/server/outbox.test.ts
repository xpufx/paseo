import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_OUTBOX_EXPIRY_MS,
  OUTBOX_BACKOFF_BASE_MS,
  OUTBOX_BACKOFF_MAX_MS,
  emptyOutboxState,
  holdMessage,
  outboxBackoffMs,
  runOutboxPass,
  type OutboxEntry,
  type OutboxMessageInput,
} from "./outbox.ts";

const T0 = Date.parse("2026-09-16T12:00:00.000Z");
const MESSAGE: OutboxMessageInput = {
  daemon: "hsi",
  agentId: "agent-remote",
  prompt: "hello",
  fromAgentId: "agent-local",
  fromAgentName: "Local",
};

function deliveryStub() {
  const delivered: string[] = [];
  const notified: Array<{ entry: OutboxEntry; reason: string }> = [];
  return {
    delivered,
    notified,
    deliver: async (entry: OutboxEntry) => {
      delivered.push(entry.id);
    },
    notify: async (entry: OutboxEntry, reason: string) => {
      notified.push({ entry, reason });
    },
  };
}

describe("outbox backoff", () => {
  it("doubles per attempt and caps", () => {
    assert.equal(outboxBackoffMs(0), 0);
    assert.equal(outboxBackoffMs(1), OUTBOX_BACKOFF_BASE_MS);
    assert.equal(outboxBackoffMs(2), OUTBOX_BACKOFF_BASE_MS * 2);
    assert.equal(outboxBackoffMs(3), OUTBOX_BACKOFF_BASE_MS * 4);
    assert.equal(outboxBackoffMs(50), OUTBOX_BACKOFF_MAX_MS);
  });
});

describe("outbox delivery", () => {
  it("holds a failed message, then delivers it once the backoff elapses", async () => {
    const state = emptyOutboxState();
    const stub = deliveryStub();
    const entry = holdMessage(state, MESSAGE, { nowMs: T0, error: "connect ECONNREFUSED" });
    assert.equal(state.entries.length, 1);
    assert.equal(entry.attempts, 1);
    assert.equal(entry.lastError, "connect ECONNREFUSED");

    const early = await runOutboxPass(state, stub, { nowMs: T0 + 1 });
    assert.deepEqual(early.delivered, []);
    assert.deepEqual(stub.delivered, []);

    const later = await runOutboxPass(state, stub, { nowMs: T0 + OUTBOX_BACKOFF_BASE_MS });
    assert.deepEqual(later.delivered, [entry.id]);
    assert.deepEqual(stub.delivered, [entry.id]);
    assert.equal(state.entries.length, 0);
  });

  it("backs off further and records the new error when delivery keeps failing", async () => {
    const state = emptyOutboxState();
    const entry = holdMessage(state, MESSAGE, { nowMs: T0, error: "first" });
    const failing = {
      deliver: async () => {
        throw new Error("still down");
      },
      notify: async () => {},
    };

    const result = await runOutboxPass(state, failing, { nowMs: T0 + OUTBOX_BACKOFF_BASE_MS });
    assert.deepEqual(result.retried, [entry.id]);
    assert.equal(state.entries.length, 1);
    assert.equal(entry.attempts, 2);
    assert.equal(entry.lastError, "still down");
    assert.equal(Date.parse(entry.nextAttemptAt), T0 + OUTBOX_BACKOFF_BASE_MS + OUTBOX_BACKOFF_BASE_MS * 2);
  });

  it("retries on reconnect even while the backoff is still pending", async () => {
    const state = emptyOutboxState();
    const stub = deliveryStub();
    const entry = holdMessage(state, MESSAGE, { nowMs: T0, error: "peer offline" });

    const beforeReconnect = await runOutboxPass(state, stub, { nowMs: T0 + 1 });
    assert.deepEqual(beforeReconnect.delivered, []);
    assert.equal(state.entries.length, 1);

    const afterReconnect = await runOutboxPass(state, stub, { nowMs: T0 + 1, forceDaemon: "hsi" });
    assert.deepEqual(afterReconnect.delivered, [entry.id]);
    assert.equal(state.entries.length, 0);
  });

  it("does not force-flush held messages for a different daemon", async () => {
    const state = emptyOutboxState();
    const stub = deliveryStub();
    const entry = holdMessage(state, MESSAGE, { nowMs: T0, error: "peer offline" });

    const result = await runOutboxPass(state, stub, { nowMs: T0 + 1, forceDaemon: "office" });
    assert.deepEqual(result.delivered, []);
    assert.equal(state.entries.length, 1);
    assert.equal(state.entries[0].id, entry.id);
  });

  it("expires an undelivered message and notifies the sender with the reason", async () => {
    const state = emptyOutboxState();
    const stub = deliveryStub();
    const entry = holdMessage(state, MESSAGE, { nowMs: T0, error: "peer unreachable" });

    const result = await runOutboxPass(state, stub, { nowMs: T0 + DEFAULT_OUTBOX_EXPIRY_MS });
    assert.deepEqual(result.expired, [entry.id]);
    assert.deepEqual(result.notified, [entry.id]);
    assert.equal(stub.notified.length, 1);
    assert.match(stub.notified[0].reason, /could not deliver to 'hsi\/agent-remote' after 10m/);
    assert.match(stub.notified[0].reason, /1 attempt; last error: peer unreachable/);
    assert.deepEqual(stub.delivered, []);
    assert.equal(state.entries.length, 0);
  });

  it("honors a custom expiry window", async () => {
    const state = emptyOutboxState();
    const notified: string[] = [];
    const failing = {
      deliver: async () => {
        throw new Error("still down");
      },
      notify: async (entry: OutboxEntry) => {
        notified.push(entry.id);
      },
    };
    const entry = holdMessage(state, MESSAGE, { nowMs: T0, expiryMs: 30_000, error: "peer unreachable" });

    const early = await runOutboxPass(state, failing, { nowMs: T0 + 29_000 });
    assert.deepEqual(early.expired, []);
    assert.equal(state.entries.length, 1);

    const late = await runOutboxPass(state, failing, { nowMs: T0 + 30_000 });
    assert.deepEqual(late.expired, [entry.id]);
    assert.equal(state.entries.length, 0);
    assert.deepEqual(notified, [entry.id]);
  });

  it("expires rather than delivering when both apply in one pass", async () => {
    const state = emptyOutboxState();
    const stub = deliveryStub();
    const entry = holdMessage(state, MESSAGE, { nowMs: T0, error: "peer unreachable" });

    const result = await runOutboxPass(state, stub, {
      nowMs: T0 + DEFAULT_OUTBOX_EXPIRY_MS + OUTBOX_BACKOFF_BASE_MS,
    });
    assert.deepEqual(result.expired, [entry.id]);
    assert.deepEqual(result.delivered, []);
    assert.equal(state.entries.length, 0);
  });

  it("drops the entry and reports a failed expiry notice instead of retrying forever", async () => {
    const state = emptyOutboxState();
    holdMessage(state, MESSAGE, { nowMs: T0, error: "peer unreachable" });
    const result = await runOutboxPass(
      state,
      {
        deliver: async () => {},
        notify: async () => {
          throw new Error("timeline unavailable");
        },
      },
      { nowMs: T0 + DEFAULT_OUTBOX_EXPIRY_MS },
    );
    assert.equal(result.notified.length, 0);
    assert.equal(result.notifyFailed.length, 1);
    assert.equal(state.entries.length, 0);
  });
});
