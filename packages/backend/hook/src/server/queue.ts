import { writeFileSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { QueuedHookEvent, QueueStats, QueueState, NormalizedEvent } from "../shared/types.js";

/**
 * Standalone event queue engine — zero Paseo runtime imports.
 *
 * Supports in-memory queuing with optional file-backed persistence for
 * durability across restarts. Provides pause, resume, purge, drain, and
 * inspection capabilities.
 */
export class HookEventQueue {
  private queue: QueuedHookEvent[] = [];
  private state: QueueState = "idle";
  private seqCounter = 0;
  private processingCount = 0;
  private completedCount = 0;
  private failedCount = 0;
  private _onDrain?: () => void;

  // File-backed persistence (optional)
  private persistPath: string | null = null;

  constructor(options?: { persistTo?: string }) {
    if (options?.persistTo) {
      this.persistPath = options.persistTo;
      this.loadFromDisk();
    }
  }

  /**
   * Enqueue a normalized event. Returns the enqueued event with metadata.
   */
  enqueue(event: Omit<QueuedHookEvent, "seq" | "enqueuedAt" | "retries">): QueuedHookEvent {
    const entry: QueuedHookEvent = {
      ...event,
      seq: ++this.seqCounter,
      enqueuedAt: Date.now(),
      retries: 0,
    };

    this.queue.push(entry);
    this.persist();

    // If we were paused, transition to idle (still paused until resumed)
    if (this.state === "paused") {
      return entry;
    }

    // Kick off processing if not already running
    if (this.state === "idle") {
      this.state = "processing";
      this.processNext().catch(() => {});
    }

    return entry;
  }

  /**
   * Batch-enqueue multiple events. Preserves FIFO ordering within the batch.
   */
  enqueueBatch(events: Omit<QueuedHookEvent, "seq" | "enqueuedAt" | "retries">[]): QueuedHookEvent[] {
    return events.map((e) => this.enqueue(e));
  }

  /**
   * Pause the queue — no more events will be processed until `resume()` is called.
   * Events can still be enqueued while paused.
   */
  pause(): Promise<void> {
    if (this.state === "paused") return Promise.resolve();

    this.state = "paused";
    return Promise.resolve();
  }

  /**
   * Resume processing after a pause.
   */
  resume(): void {
    if (this.state !== "paused") return;

    this.state = "idle";

    // Kick off processing if there are pending events
    if (this.queue.length > 0) {
      this.state = "processing";
      this.processNext().catch(() => {});
    }
  }

  /**
   * Get current queue state.
   */
  getState(): QueueState {
    return this.state;
  }

  /**
   * Purge all pending events from the queue.
   */
  purge(): number {
    const count = this.queue.length;
    this.queue = [];
    this.persist();
    return count;
  }

  /**
   * Drain the queue synchronously — processes all remaining events immediately.
   * Returns the number of events that were drained.
   */
  async drain(onProcess?: (event: QueuedHookEvent) => Promise<void>): Promise<number> {
    let processed = 0;

    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      try {
        await onProcess?.(event);
        this.completedCount++;
        processed++;
      } catch {
        this.failedCount++;
        processed++;
      }
    }

    this.persist();
    this.state = "idle";
    return processed;
  }

  /**
   * Inspect the current queue state.
   */
  inspect(): {
    state: QueueState;
    pending: number;
    totalEnqueued: number;
    stats: QueueStats;
    head?: QueuedHookEvent;
    tail?: QueuedHookEvent;
  } {
    return {
      state: this.state,
      pending: this.queue.length,
      totalEnqueued: this.seqCounter,
      stats: {
        pending: this.queue.length,
        processing: this.processingCount,
        completed: this.completedCount,
        failed: this.failedCount,
      },
      head: this.queue[0],
      tail: this.queue[this.queue.length - 1],
    };
  }

  /**
   * Get all pending events (read-only snapshot).
   */
  getPending(): readonly QueuedHookEvent[] {
    return [...this.queue];
  }

  /**
   * Set a callback invoked when the queue becomes empty during drain.
   */
  onDrain(callback: () => void): void {
    this._onDrain = callback;
  }

  /**
   * Check whether the queue is empty.
   */
  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Reset the queue to a clean state.
   */
  reset(): void {
    this.queue = [];
    this.state = "idle";
    this.seqCounter = 0;
    this.processingCount = 0;
    this.completedCount = 0;
    this.failedCount = 0;
    this.persist();
  }

  // ── Private helpers ────────────────────────────────────────────────

  private async processNext(): Promise<void> {
    // Snapshot the state before any async work
    const wasPaused = this.state === "paused";
    if (wasPaused || this.queue.length === 0) {
      if (this.queue.length === 0) {
        this.state = "idle";
        this._onDrain?.();
      }
      return;
    }

    this.processingCount++;
    const event = this.queue.shift()!;

    try {
      // Placeholder: in real usage this would dispatch to a handler.
      // The consumer of HookEventQueue should use `enqueue` + `drain(onProcess)`
      // or extend this class to inject their own handler logic.
      this.completedCount++;
    } catch {
      this.failedCount++;
    } finally {
      this.processingCount--;
      this.persist();

      // Continue processing if there are more events and not paused
      if (this.queue.length > 0 && !wasPaused) {
        await this.processNext();
      } else {
        this.state = "idle";
        this._onDrain?.();
      }
    }
  }

  private persist(): void {
    if (!this.persistPath) return;

    const dir = join(this.persistPath, "..");
    try {
      if (!existsSync(dir)) {
        // Use sync mkdir since tsup externalizes fs/promises
        const fs = require("node:fs");
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {
      // Best effort — don't crash the queue on persist failure
    }

    try {
      writeFileSync(
        this.persistPath,
        JSON.stringify({
          seqCounter: this.seqCounter,
          queue: this.queue,
          completedCount: this.completedCount,
          failedCount: this.failedCount,
        }),
      );
    } catch {
      // Best effort
    }
  }

  private loadFromDisk(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;

    try {
      const data = JSON.parse(readFileSync(this.persistPath, "utf-8"));
      this.seqCounter = data.seqCounter ?? 0;
      this.queue = data.queue ?? [];
      this.completedCount = data.completedCount ?? 0;
      this.failedCount = data.failedCount ?? 0;
    } catch {
      // Corrupted file — start fresh
    }
  }
}
