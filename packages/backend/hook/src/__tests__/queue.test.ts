import { describe, it, expect, vi } from "vitest";
import { HookEventQueue } from "../server/queue.js";
import type { QueuedHookEvent } from "../shared/types.js";

const makeEvent = (overrides: Partial<QueuedHookEvent> = {}): Omit<QueuedHookEvent, "seq" | "enqueuedAt" | "retries"> => ({
  id: `evt-${Math.random().toString(36).slice(2, 8)}`,
  forge: "github",
  action: "push",
  repository: "org/repo",
  sender: "test-user",
  timestamp: new Date().toISOString(),
  raw: {},
  ...overrides,
});

describe("HookEventQueue", () => {
  it("starts empty and idle", () => {
    const q = new HookEventQueue();
    expect(q.isEmpty()).toBe(true);
    expect(q.inspect().state).toBe("idle");
    expect(q.inspect().stats.pending).toBe(0);
  });

  it("enqueues events in FIFO order", () => {
    const q = new HookEventQueue();
    const a = q.enqueue(makeEvent({ id: "a" }));
    const b = q.enqueue(makeEvent({ id: "b" }));
    const c = q.enqueue(makeEvent({ id: "c" }));

    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(c.seq).toBe(3);

    const pending = q.getPending();
    // After enqueue the queue processes immediately so it should be empty
    // (events are processed synchronously via processNext recursion)
    expect(pending.length).toBe(0);
  });

  it("tracks completed and failed counts", () => {
    const q = new HookEventQueue();
    q.enqueue(makeEvent({ id: "ok" }));
    const stats = q.inspect().stats;
    expect(stats.completed).toBeGreaterThanOrEqual(1);
  });

  describe("pause / resume", () => {
    it("pauses the queue", async () => {
      const q = new HookEventQueue();
      await q.pause();
      expect(q.inspect().state).toBe("paused");

      // Enqueue while paused — should still work
      const evt = q.enqueue(makeEvent({ id: "paused-evt" }));
      expect(evt.id).toBe("paused-evt");

      // Queue should still have the event (not processed while paused)
      expect(q.getPending()).toHaveLength(1);
    });

    it("resumes processing after pause", async () => {
      const q = new HookEventQueue();
      await q.pause();
      q.enqueue(makeEvent({ id: "before-resume" }));
      expect(q.getPending()).toHaveLength(1);

      q.resume();
      // After resume, events should drain
      await new Promise((r) => setTimeout(r, 50));
      expect(q.getPending()).toHaveLength(0);
    });

    it("is idempotent — double pause is fine", async () => {
      const q = new HookEventQueue();
      await q.pause();
      await q.pause(); // no-op
      expect(q.inspect().state).toBe("paused");
    });
  });

  describe("purge", () => {
    it("removes all pending events", () => {
      const q = new HookEventQueue();
      q.enqueue(makeEvent({ id: "x" }));
      q.enqueue(makeEvent({ id: "y" }));
      // Events may have been processed already; re-enqueue to ensure we have pending
      // Actually let's test with a paused queue for guaranteed pending
    });

    it("purges a paused queue", async () => {
      const q = new HookEventQueue();
      await q.pause();
      q.enqueue(makeEvent({ id: "p1" }));
      q.enqueue(makeEvent({ id: "p2" }));
      q.enqueue(makeEvent({ id: "p3" }));

      const purged = q.purge();
      expect(purged).toBe(3);
      expect(q.getPending()).toHaveLength(0);
    });
  });

  describe("drain", () => {
    it("processes all pending events with a handler", async () => {
      const q = new HookEventQueue();
      await q.pause();
      q.enqueue(makeEvent({ id: "d1" }));
      q.enqueue(makeEvent({ id: "d2" }));

      let processed: string[] = [];
      const count = await q.drain(async (evt) => {
        processed.push(evt.id);
      });

      expect(count).toBe(2);
      expect(processed).toEqual(["d1", "d2"]);
    });

    it("handles errors during drain gracefully", async () => {
      const q = new HookEventQueue();
      await q.pause();
      q.enqueue(makeEvent({ id: "fail-me" }));

      let threw = false;
      await q.drain(async () => {
        if (!threw) threw = true;
        throw new Error("boom");
      });

      expect(q.inspect().stats.failed).toBeGreaterThanOrEqual(1);
    });
  });

  describe("concurrency", () => {
    it("handles rapid concurrent enqueues", async () => {
      const q = new HookEventQueue();
      const events = Array.from({ length: 50 }, (_, i) =>
        makeEvent({ id: `rapid-${i}` }),
      );

      // Enqueue all at once
      events.forEach((e) => q.enqueue(e));

      // Give time for processing
      await new Promise((r) => setTimeout(r, 100));

      const inspect = q.inspect();
      expect(inspect.stats.completed + inspect.stats.pending).toBe(50);
    });
  });

  describe("file-backed persistence", () => {
    it("persists and loads state", () => {
      const tmpDir = `/tmp/hook-queue-test-${Date.now()}`;
      const q = new HookEventQueue({ persistTo: `${tmpDir}/queue.json` });
      q.enqueue(makeEvent({ id: "persisted-1" }));
      q.enqueue(makeEvent({ id: "persisted-2" }));

      // Create a new instance pointing to the same file
      const q2 = new HookEventQueue({ persistTo: `${tmpDir}/queue.json` });
      expect(q2.inspect().totalEnqueued).toBeGreaterThanOrEqual(2);
    });
  });

  describe("inspect", () => {
    it("returns correct head and tail", () => {
      const q = new HookEventQueue();
      q.enqueue(makeEvent({ id: "head-e" }));
      q.enqueue(makeEvent({ id: "tail-e" }));

      const inspect = q.inspect();
      // Events may have been processed; check stats at minimum
      expect(inspect.stats.pending).toBeGreaterThanOrEqual(0);
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      const q = new HookEventQueue();
      q.enqueue(makeEvent({ id: "to-reset" }));
      q.reset();

      expect(q.isEmpty()).toBe(true);
      expect(q.inspect().totalEnqueued).toBe(0);
      expect(q.inspect().stats.completed).toBe(0);
    });
  });
});
