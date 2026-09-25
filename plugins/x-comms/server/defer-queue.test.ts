import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFER_EXPIRY_MS,
  DEFER_MAX_DEPTH_PER_TARGET,
  DEFER_MAX_TOTAL,
  claimNextDefer,
  completeDeferItem,
  deferDepth,
  deferDropReason,
  deferQueueDir,
  deferTargetKey,
  deliveryNoticeText,
  enqueueDefer,
  expiredDeferEntries,
  listStaleClaims,
  listWaiting,
  parseDeferTargetKey,
  pendingDeferTargets,
  releaseDeferItem,
  removeDeferItem,
  type DeferEntry,
} from "./defer-queue.ts";

const T0 = Date.parse("2026-09-25T12:00:00.000Z");
const BUSY: { daemon: string; agentId: string } = { daemon: "hsi", agentId: "agent-remote" };
const IDLE: { daemon: string; agentId: string } = { daemon: "hsi", agentId: "agent-idle" };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "x-comms-defer-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function send(prompt: string, target = BUSY, nowMs = T0, extra: Record<string, unknown> = {}) {
  return enqueueDefer(
    { ...target, prompt, messageId: `msg-${prompt}`, fromAgentId: "agent-local", ...extra },
    { dir, nowMs },
  );
}

/**
 * A minimal stand-in for the drain's per-pass loop: probe, then claim and
 * deliver at most one item per target. Mirrors drainDeferQueue's contract
 * without needing a daemon, so the ordering guarantees are what is under test.
 */
function drainOnce(opts: { nowMs: number; busy?: (target: { daemon: string; agentId: string }) => boolean; deliver?: (entry: DeferEntry) => void }) {
  const delivered: DeferEntry[] = [];
  for (const entry of listStaleClaims(dir)) removeDeferItem(dir, entry.id);
  for (const entry of expiredDeferEntries(listWaiting(dir), opts.nowMs)) removeDeferItem(dir, entry.id);
  for (const target of pendingDeferTargets(dir)) {
    if (opts.busy?.(target)) continue;
    const entry = claimNextDefer(dir, target, opts.nowMs);
    if (!entry) continue;
    opts.deliver?.(entry);
    completeDeferItem(dir, entry.id);
    delivered.push(entry);
  }
  return delivered;
}

describe("defer queue target identity", () => {
  it("keys a target by daemon AND agent, not daemon alone", () => {
    assert.notEqual(deferTargetKey(BUSY), deferTargetKey(IDLE));
    assert.deepEqual(parseDeferTargetKey(deferTargetKey(BUSY)), BUSY);
  });

  it("keeps one agent's backlog out of another's", () => {
    send("a", BUSY, T0);
    send("b", IDLE, T0);
    assert.equal(deferDepth(dir, BUSY), 1);
    assert.equal(deferDepth(dir, IDLE), 1);
  });

  it("lives in the x-comms state dir the MCP server also reads", () => {
    assert.match(deferQueueDir(), /paseo-x-comms[/\\]pending$/);
  });
});

describe("defer queue: a busy target is not preempted", () => {
  it("holds the message instead of dispatching, and reports the position", () => {
    const first = send("one");
    assert.equal(first.entry?.prompt, "one");
    assert.equal(first.depth, 1);
    const second = send("two");
    assert.equal(second.depth, 2);
    assert.equal(listWaiting(dir).length, 2);
  });

  it("does not deliver to a target the probe still reports busy", () => {
    send("one");
    const delivered = drainOnce({ nowMs: T0 + 1000, busy: () => true });
    assert.deepEqual(delivered, []);
    assert.equal(listWaiting(dir).length, 1, "the message must still be waiting");
  });

  it("delivers once the target is observed idle, oldest first", () => {
    send("one", BUSY, T0);
    send("two", BUSY, T0 + 10);
    const delivered = drainOnce({ nowMs: T0 + 1000, busy: () => false });
    assert.deepEqual(delivered.map((entry) => entry.prompt), ["one"]);
    assert.equal(listWaiting(dir).length, 1);
  });
});

describe("defer queue: the queue drains", () => {
  it("delivers one item per target per pass, because a delivery starts a turn", () => {
    send("one", BUSY, T0);
    send("two", BUSY, T0 + 10);
    send("three", BUSY, T0 + 20);
    const first = drainOnce({ nowMs: T0 + 1000, busy: () => false });
    assert.deepEqual(first.map((e) => e.prompt), ["one"], "a second send in the same pass would preempt the first");
    assert.equal(listWaiting(dir).length, 2);

    const second = drainOnce({ nowMs: T0 + 2000, busy: () => false });
    assert.deepEqual(second.map((e) => e.prompt), ["two"]);
    const third = drainOnce({ nowMs: T0 + 3000, busy: () => false });
    assert.deepEqual(third.map((e) => e.prompt), ["three"]);
    assert.deepEqual(listWaiting(dir), []);
  });

  it("drains one item per target while leaving other targets alone", () => {
    send("busy-one", BUSY, T0);
    send("busy-two", BUSY, T0 + 10);
    send("idle-one", IDLE, T0);
    const delivered = drainOnce({
      nowMs: T0 + 1000,
      busy: (target) => target.agentId === BUSY.agentId,
    });
    assert.deepEqual(delivered.map((e) => e.prompt), ["idle-one"]);
    assert.equal(listWaiting(dir).length, 2);
  });
});

describe("defer queue: bounds", () => {
  it("evicts the oldest waiting item at the per-target cap and names it", () => {
    for (let i = 0; i < DEFER_MAX_DEPTH_PER_TARGET; i++) send(`m${i}`, BUSY, T0 + i);
    assert.equal(listWaiting(dir).length, DEFER_MAX_DEPTH_PER_TARGET);

    const overflow = send("newest", BUSY, T0 + 100);
    assert.equal(overflow.evicted.length, 1);
    assert.equal(overflow.evicted[0].prompt, "m0", "the superseded oldest item is the one that goes");
    assert.equal(listWaiting(dir).length, DEFER_MAX_DEPTH_PER_TARGET, "never grows past the cap");
    assert.match(deferDropReason(overflow.evicted[0], "evicted"), /queue is full/);
  });

  it("refuses a new item at the fleet cap instead of evicting someone's obligation", () => {
    // Fill across many targets so the per-target cap is not what stops it.
    for (let i = 0; i < DEFER_MAX_TOTAL; i++) {
      enqueueDefer(
        { daemon: "hsi", agentId: `agent-${i % 40}`, prompt: `m${i}`, messageId: `msg-${i}` },
        { dir, nowMs: T0 + i },
      );
    }
    const refused = send("one-too-many", IDLE, T0 + 10_000);
    assert.equal(refused.entry, null);
    assert.match(refused.error ?? "", /queue is full/);
    assert.equal(refused.evicted.length, 0, "the fleet cap refuses; it does not evict");
  });
});

describe("defer queue: expiry", () => {
  it("keeps a message inside the window and drops it after", () => {
    send("one");
    assert.deepEqual(expiredDeferEntries(listWaiting(dir), T0 + DEFER_EXPIRY_MS - 1), []);
    const expired = expiredDeferEntries(listWaiting(dir), T0 + DEFER_EXPIRY_MS);
    assert.equal(expired.length, 1);
    assert.match(deferDropReason(expired[0], "expired"), /30 minute window/);
  });

  it("drops it and tells the sender rather than delivering stale context", () => {
    const notified: string[] = [];
    send("one");
    for (const entry of expiredDeferEntries(listWaiting(dir), T0 + DEFER_EXPIRY_MS)) {
      notified.push(entry.prompt);
      removeDeferItem(dir, entry.id);
    }
    assert.deepEqual(notified, ["one"]);
    assert.deepEqual(listWaiting(dir), []);
  });

  it("never claims an expired item, even when asked directly", () => {
    send("one");
    assert.equal(claimNextDefer(dir, BUSY, T0 + DEFER_EXPIRY_MS), null);
  });
});

describe("defer queue: a crash mid-send is not replayed", () => {
  it("claims by rename, so a second drainer cannot take the same item", () => {
    send("one");
    const first = claimNextDefer(dir, BUSY, T0 + 1);
    assert.equal(first?.prompt, "one");
    const second = claimNextDefer(dir, BUSY, T0 + 1);
    assert.equal(second, null, "the rename is the claim; exactly one drainer wins it");
  });

  it("surfaces an abandoned claim as unknown rather than resending it", () => {
    send("one");
    assert.equal(claimNextDefer(dir, BUSY, T0 + 1)?.prompt, "one");
    // The process that held the claim is gone; the claim is still on disk.
    assert.equal(listStaleClaims(dir).length, 1);
    assert.match(deferDropReason(listStaleClaims(dir)[0], "unknown"), /does not know whether/);

    const delivered: string[] = [];
    drainOnce({ nowMs: T0 + 5000, busy: () => false, deliver: (entry) => delivered.push(entry.prompt) });
    assert.deepEqual(delivered, [], "an unknown outcome must not be guessed either way");
    assert.deepEqual(listStaleClaims(dir), [], "the claim is cleared, not retried");
    assert.deepEqual(listWaiting(dir), []);
  });

  it("hands the claim back when a delivery fails, so a later pass retries it", () => {
    send("one");
    const claimed = claimNextDefer(dir, BUSY, T0 + 1);
    assert.ok(claimed);
    releaseDeferItem(dir, claimed.id);
    assert.deepEqual(listStaleClaims(dir), []);
    assert.equal(listWaiting(dir).length, 1);
    assert.equal(claimNextDefer(dir, BUSY, T0 + 2)?.prompt, "one");
  });

  it("a stale claim does not block the items behind it", () => {
    send("one", BUSY, T0);
    send("two", BUSY, T0 + 10);
    const claimed = claimNextDefer(dir, BUSY, T0 + 1);
    assert.ok(claimed);
    const delivered = drainOnce({ nowMs: T0 + 5000, busy: () => false });
    assert.deepEqual(delivered.map((e) => e.prompt), ["two"]);
  });
});

describe("notifyOnFinish notice", () => {
  it("is queued for the sender rather than sent, so it cannot preempt them", () => {
    const notice = enqueueDefer(
      {
        kind: "notice",
        daemon: "local",
        agentId: "agent-local",
        prompt: deliveryNoticeText(
          { ...({} as DeferEntry), daemon: BUSY.daemon, agentId: BUSY.agentId, messageId: "msg-one", kind: "message" },
          "2026-09-25T12:30:00.000Z",
        ),
        messageId: "notice-1",
        stamped: true,
      },
      { dir, nowMs: T0 },
    );
    assert.equal(notice.entry?.kind, "notice");
    assert.equal(notice.entry?.daemon, "local", "addressed locally, not to the peer");
    assert.equal(notice.entry?.notifyOnFinish, false, "a notice does not generate a notice");
    assert.match(notice.entry!.prompt, /landed at 2026-09-25T12:30:00.000Z/);
    assert.match(notice.entry!.prompt, /nothing was interrupted/);
  });

  it("waits for a busy sender like any other item", () => {
    const sender = { daemon: "local", agentId: "agent-local" };
    enqueueDefer(
      { kind: "notice", daemon: "local", agentId: "agent-local", prompt: "landed", messageId: "n1", stamped: true },
      { dir, nowMs: T0 },
    );
    const delivered = drainOnce({ nowMs: T0 + 1000, busy: (target) => target.daemon === "local" });
    assert.deepEqual(delivered, []);
    assert.equal(deferDepth(dir, sender), 1, "the notice is held, not steered into the sender's turn");
  });

  it("carries the messageId the sender already holds, so it can confirm", () => {
    const text = deliveryNoticeText(
      { ...({} as DeferEntry), daemon: "hsi", agentId: "agent-remote", messageId: "msg-abc", kind: "message" },
      "2026-09-25T12:30:00.000Z",
    );
    assert.match(text, /messageId msg-abc/);
    assert.match(text, /'hsi\/agent-remote'/);
  });
});

describe("defer queue: unreadable items are not silently dropped", () => {
  it("leaves a corrupt file in place rather than losing the message", () => {
    send("one");
    writeFileSync(join(dir, "garbage.json"), "{not json", "utf8");
    assert.deepEqual(listWaiting(dir).map((e) => e.prompt), ["one"]);
    assert.ok(readdirSync(dir).includes("garbage.json"), "still on disk, still inspectable");
  });

  it("ignores a file with no usable id, which could never be claimed", () => {
    writeFileSync(join(dir, "noid.json"), JSON.stringify({ daemon: "hsi", prompt: "x" }), "utf8");
    assert.deepEqual(listWaiting(dir), []);
  });

  it("does not let an unreadable claim block the queue", () => {
    send("one");
    send("two", BUSY, T0 + 10);
    renameSync(join(dir, `${listWaiting(dir)[0].id}.json`), join(dir, "junk.sending"));
    const delivered = drainOnce({ nowMs: T0 + 1000, busy: () => false });
    assert.deepEqual(delivered.map((e) => e.prompt), ["two"]);
  });
});
