import type { QueuedHookEvent, NormalizedEvent, QueueStats } from "../shared/types.js";
import { HookEventQueue } from "../server/queue.js";

// Re-export for convenience
export { HookEventQueue };
export type { QueuedHookEvent, NormalizedEvent, QueueStats } from "../shared/types.js";

/**
 * Typed client helpers for queue administration and hook dispatch.
 *
 * These are thin wrappers around `HookEventQueue` to provide a clean API
 * for external consumers (e.g., the hook-router in Phase 2).
 */

/**
 * Enqueue a normalized event with typed return.
 */
export function enqueueEvent(
  queue: HookEventQueue,
  event: Omit<QueuedHookEvent, "seq" | "enqueuedAt" | "retries">,
): QueuedHookEvent {
  return queue.enqueue(event);
}

/**
 * Pause the queue and wait for it to become idle.
 */
export async function pauseAndDrain(
  queue: HookEventQueue,
): Promise<void> {
  await queue.pause();
  // Wait until the queue is empty
  while (!queue.isEmpty()) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Resume the queue after a pause.
 */
export function resumeQueue(queue: HookEventQueue): void {
  queue.resume();
}

/**
 * Purge all pending events and return the count.
 */
export function purgeQueue(queue: HookEventQueue): number {
  return queue.purge();
}

/**
 * Get current queue statistics.
 */
export function getQueueStats(queue: HookEventQueue): QueueStats {
  return queue.inspect().stats;
}
