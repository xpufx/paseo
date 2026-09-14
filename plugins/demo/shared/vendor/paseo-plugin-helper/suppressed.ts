export interface SuppressedSink {
  debug?(message: string, data?: unknown): void;
  warn?(message: string, data?: unknown): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Surfaces a caught/suppressed error to the plugin log at debug level
 * (warn when `level: "warn"`). Fire-and-forget `catch(() => undefined)`
 * sites should route through here so `paseo plugin logs` shows them
 * when dev debug logging is enabled.
 */
export function reportSuppressed(
  sink: Pick<SuppressedSink, "debug" | "warn"> | undefined,
  context: string,
  error: unknown,
  level: "debug" | "warn" = "debug",
): void {
  try {
    if (level === "warn") {
      sink?.warn?.(`${context}: ${messageOf(error)}`, error);
    } else {
      sink?.debug?.(`${context}: ${messageOf(error)}`, error);
    }
  } catch {
    // Reporting must never throw.
  }
}
