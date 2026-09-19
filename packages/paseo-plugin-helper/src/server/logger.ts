import { redactSecrets } from "./redact.js";
import { resolvePluginVersion } from "./version.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === "debug" || value === "info" || value === "warn" || value === "error"
  );
}

/**
 * Resolves the minimum log level from the environment. Precedence:
 * `PASEO_PLUGIN_LOG_LEVEL` > `PASEO_LOG_LEVEL` > `PASEO_DEBUG=1` (debug).
 * Returns undefined when nothing is set so callers can apply their default.
 */
export function resolveMinLevelFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): LogLevel | undefined {
  const raw = env.PASEO_PLUGIN_LOG_LEVEL ?? env.PASEO_LOG_LEVEL;
  if (typeof raw === "string" && isLogLevel(raw.trim().toLowerCase())) {
    return raw.trim().toLowerCase() as LogLevel;
  }
  const debugFlag = env.PASEO_DEBUG ?? env.PASEO_PLUGIN_DEBUG;
  if (
    typeof debugFlag === "string" &&
    ["1", "true", "yes", "debug"].includes(debugFlag.trim().toLowerCase())
  ) {
    return "debug";
  }
  return undefined;
}

/**
 * True when running in production. Retained for callers that need a
 * production check; note the default log level no longer keys off this.
 */
export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

/**
 * True only when `NODE_ENV` is explicitly a development value
 * (`development`/`dev`). Unset, empty, `production`, and anything else
 * (e.g. `test`) all count as quiet, so a shipped plugin defaults to info
 * without any env var set.
 */
export function isDevelopmentEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const nodeEnv = (env.NODE_ENV ?? "").trim().toLowerCase();
  return nodeEnv === "development" || nodeEnv === "dev";
}

/**
 * Default rule (documented for operators):
 * explicit `PASEO_PLUGIN_LOG_LEVEL`/`PASEO_LOG_LEVEL`/`PASEO_DEBUG` always wins;
 * otherwise quiet (`info`) — including when no env var is set at all, so a
 * shipped plugin never emits debug logs by default. Debug only when `NODE_ENV`
 * is explicitly a development value (`development`/`dev`).
 */
export function resolveDefaultMinLevel(
  env: NodeJS.ProcessEnv = process.env,
): LogLevel {
  return resolveMinLevelFromEnv(env) ?? (isDevelopmentEnv(env) ? "debug" : "info");
}

export interface PluginLoggerOptions {
  /**
   * Version of the plugin.
   * If omitted, automatically resolves from `package.json` (augmented by git tag/hash).
   */
  version?: string;

  /**
   * Whether to emit a formatted startup banner on initialization.
   * Defaults to `true`.
   */
  banner?: boolean;

  /**
   * Subsystem or module tag within the plugin (e.g. "poller", "mcp-client").
   */
  subsystem?: string;

  /**
   * Minimum log level to print. Defaults to resolveDefaultMinLevel():
   * info unless NODE_ENV is explicitly development (or an explicit level is set).
   */
  minLevel?: LogLevel;

  /**
   * Optional custom metadata key-values to include in the startup banner.
   */
  meta?: Record<string, string | number | boolean>;
}

export interface PluginLogger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** Surfaces a caught/suppressed error at debug level so it reaches the plugin log. */
  suppressed(context: string, error: unknown): void;
  child(subsystemOrOptions: string | Partial<PluginLoggerOptions>): PluginLogger;
}

function formatData(data: unknown): string {
  if (data === undefined) return "";
  if (data instanceof Error) {
    return `error="${data.message}"${data.stack ? `\n${data.stack}` : ""}`;
  }

  const sanitized = redactSecrets(data);
  if (typeof sanitized === "object" && sanitized !== null && !Array.isArray(sanitized)) {
    const pairs = Object.entries(sanitized as Record<string, unknown>).map(
      ([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
    );
    return pairs.join(" ");
  }

  return typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
}

/**
 * Creates a structured logger for Paseo plugins.
 * By default, displays the plugin name and version in startup logs and tags each line
 * for Paseo's log stream without fragmented multi-line JSON.
 *
 * If `options.version` is omitted, it automatically resolves the version from `package.json`
 * augmented with git metadata.
 */
export function createPluginLogger(
  pluginId: string,
  options: PluginLoggerOptions = {},
): PluginLogger {
  const resolvedVer = options.version ?? resolvePluginVersion({ fallback: "" });
  const {
    banner = true,
    subsystem,
    minLevel = resolveDefaultMinLevel(),
    meta = {},
  } = options;

  const minSeverity = LEVEL_SEVERITY[minLevel];

  // Prefix format: "[name vX.Y.Z]" or "[name]" or "[name vX.Y.Z:subsystem]"
  const versionTag = resolvedVer ? ` v${resolvedVer}` : "";
  const subTag = subsystem ? `:${subsystem}` : "";
  const baseTag = `[${pluginId}${versionTag}${subTag}]`;

  if (banner) {
    const bannerDetails = [
      `pid ${process.pid}`,
      `node ${process.version}`,
      ...Object.entries(meta).map(([k, v]) => `${k} ${v}`),
    ].join(", ");

    // Emit startup banner directly to stdout
    console.log(`${baseTag} Initializing plugin (${bannerDetails})`);
  }

  function emit(level: LogLevel, message: string, data?: unknown) {
    if (LEVEL_SEVERITY[level] < minSeverity) return;

    const levelTag = `[${level.toUpperCase()}]`;
    const formattedData = formatData(data);
    const line = formattedData
      ? `${baseTag} ${levelTag} ${message} ${formattedData}`
      : `${baseTag} ${levelTag} ${message}`;

    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug(message: string, data?: unknown) {
      emit("debug", message, data);
    },
    info(message: string, data?: unknown) {
      emit("info", message, data);
    },
    warn(message: string, data?: unknown) {
      emit("warn", message, data);
    },
    error(message: string, data?: unknown) {
      emit("error", message, data);
    },
    suppressed(context: string, error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      emit("debug", `${context}: ${detail}`, error);
    },
    child(subsystemOrOptions: string | Partial<PluginLoggerOptions>): PluginLogger {
      const childOptions: PluginLoggerOptions =
        typeof subsystemOrOptions === "string"
          ? { ...options, version: resolvedVer, banner: false, subsystem: subsystemOrOptions }
          : { ...options, version: resolvedVer, banner: false, ...subsystemOrOptions };

      return createPluginLogger(pluginId, childOptions);
    },
  };
}
