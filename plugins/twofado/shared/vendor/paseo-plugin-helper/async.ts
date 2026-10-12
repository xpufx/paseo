// NOTE: no `class` here. Hermes eval of plugin client bundles binds class
// expressions as `undefined`, so errors are plain Error objects with a brand.
export interface TimeoutError extends Error {
  readonly timeoutMs: number;
}

export function createTimeoutError(message: string, timeoutMs: number): TimeoutError {
  const err = new Error(message) as Error & { timeoutMs: number };
  err.name = "TimeoutError";
  err.timeoutMs = timeoutMs;
  return err;
}

export function isTimeoutError(e: unknown): e is TimeoutError {
  return e instanceof Error && e.name === "TimeoutError";
}

/**
 * Races a promise against a timeout duration in milliseconds.
 * If the timeout expires before the promise resolves, rejects with a TimeoutError.
 * Automatically cleans up the timer on resolution or rejection.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "Operation"
): Promise<T> {
  let timer: any;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(createTimeoutError(`${label} timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
