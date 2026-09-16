import { createPluginLogger, type PluginLogger } from "./logger";

export interface PeriodicTaskOptions {
  intervalMs: number;
  task: () => Promise<void> | void;
  onError?: (err: unknown, failureCount: number) => void;
  runImmediately?: boolean;
  maxBackoffMs?: number;
  /**
   * Logger for suppressed failures. Defaults to a level-gated
   * `periodic-task` logger so debug lines stay silent unless debug is enabled.
   */
  logger?: PluginLogger;
}

export interface PeriodicTaskHandle {
  stop: () => void;
  isRunning: () => boolean;
  triggerNow: () => Promise<void>;
}

/**
 * Creates a resilient periodic background task loop for Paseo plugin daemons.
 * Implements exponential backoff on consecutive failures and safe teardown hooks.
 */
export function createPeriodicTask(options: PeriodicTaskOptions): PeriodicTaskHandle {
  const {
    intervalMs,
    task,
    onError,
    runImmediately = false,
    maxBackoffMs = 60000,
  } = options;

  let timer: NodeJS.Timeout | null = null;
  let running = true;
  let inFlight = false;
  let failureCount = 0;

  let taskLogger: PluginLogger | undefined;
  function taskLog(): PluginLogger {
    taskLogger ??= options.logger
      ? options.logger.child("periodic-task")
      : createPluginLogger("periodic-task", { banner: false });
    return taskLogger;
  }

  async function execute() {
    if (!running || inFlight) return;
    inFlight = true;

    try {
      await task();
      failureCount = 0;
    } catch (err) {
      failureCount++;
      if (onError) {
        try {
          onError(err, failureCount);
        } catch (suppressed) {
          // Prevent onError handler from breaking task loop, but stay visible in dev logs.
          taskLog().debug(
            `onError handler failed: ${suppressed instanceof Error ? suppressed.message : String(suppressed)}`,
          );
        }
      } else {
        taskLog().debug(
          `suppressed error (failure ${failureCount}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } finally {
      inFlight = false;
      if (running) {
        scheduleNext();
      }
    }
  }

  function scheduleNext() {
    if (!running) return;
    if (timer) clearTimeout(timer);

    let delay = intervalMs;
    if (failureCount > 0) {
      // Exponential backoff with ceiling
      const backoff = intervalMs * Math.pow(1.5, Math.min(failureCount, 8));
      delay = Math.min(backoff, maxBackoffMs);
    }

    timer = setTimeout(execute, delay);
  }

  if (runImmediately) {
    execute();
  } else {
    scheduleNext();
  }

  return {
    stop: () => {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isRunning: () => running,
    triggerNow: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await execute();
    },
  };
}
