import { appendFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { PluginStorage } from "paseo-plugin-helper/server";

export interface DiskLoggerOptions {
  /** Directory where logs are written. Defaults to ~/.paseo/plugin-data/xpufx/<pluginId>/logs */
  logDir?: string;
  /** Primary log file name. Defaults to "hook.log" */
  fileName?: string;
  /** Explicit full path to primary log file. Overrides logDir and fileName. */
  filePath?: string;
  /** Maximum size in bytes before rotating. Default: 5MB (5 * 1024 * 1024). */
  maxBytes?: number;
  /** Maximum number of backup files to keep (e.g. 3 keeps hook.log.1, hook.log.2, hook.log.3). Default: 3. */
  maxFiles?: number;
  /** Plugin ID for default scoped path resolution. Default: "uppidi-fleet". */
  pluginId?: string;
  /** Base directory override passed to PluginStorage, for isolated tests. */
  storageBaseDir?: string;
  /** Namespace override passed to PluginStorage. */
  storageNamespace?: string;
  /** Whether to output to console as well. Default: false. */
  echoToConsole?: boolean;
}

export const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB
export const DEFAULT_MAX_LOG_FILES = 3;
export const DEFAULT_LOG_FILE_NAME = "hook.log";

/**
 * Resolves the log directory through PluginStorage so it remains inside the
 * plugin's namespace rather than an unscoped ~/.paseo directory.
 */
export function defaultScopedLogDir(
  pluginId = "uppidi-fleet",
  options?: Pick<DiskLoggerOptions, "storageBaseDir" | "storageNamespace">,
): string {
  const storage = new PluginStorage<Record<string, never>>(pluginId, `${DEFAULT_LOG_FILE_NAME}`, {
    ...(options?.storageBaseDir ? { baseDir: options.storageBaseDir } : {}),
    ...(options?.storageNamespace ? { namespace: options.storageNamespace } : {}),
  });
  return join(storage.pluginDir, "logs");
}

export class DiskLogger {
  readonly logFilePath: string;
  readonly logDir: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly echoToConsole: boolean;

  constructor(options?: DiskLoggerOptions) {
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
    this.maxFiles = options?.maxFiles ?? DEFAULT_MAX_LOG_FILES;
    this.echoToConsole = options?.echoToConsole ?? false;

    if (options?.filePath && options.filePath.trim()) {
      this.logFilePath = options.filePath.trim();
      this.logDir = dirname(this.logFilePath);
    } else {
      const name = options?.fileName ?? DEFAULT_LOG_FILE_NAME;
      const customDir = options?.logDir;
      if (customDir && customDir.trim()) {
        this.logDir = customDir.trim();
        this.logFilePath = join(this.logDir, name);
      } else {
        const storage = new PluginStorage<Record<string, never>>(
          options?.pluginId ?? "uppidi-fleet",
          `logs/${name}`,
          {
            ...(options?.storageBaseDir ? { baseDir: options.storageBaseDir } : {}),
            ...(options?.storageNamespace ? { namespace: options.storageNamespace } : {}),
          },
        );
        this.logFilePath = storage.filePath;
        this.logDir = dirname(this.logFilePath);
      }
    }
  }

  /**
   * Formats a raw message for file output.
   * If message already starts with a timestamp bracket `[20...`, retains it.
   * Otherwise, prefixes with ISO timestamp.
   * Ensures line ends with newline.
   */
  public formatMessage(message: string): string {
    const trimmed = message.trimEnd();
    let formatted = trimmed;
    // Check if message already has an ISO timestamp prefix like [2026-10-07T...]
    const timestampPrefixRe = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    if (!timestampPrefixRe.test(trimmed)) {
      const iso = new Date().toISOString();
      formatted = `[${iso}] ${trimmed}`;
    }
    return `${formatted}\n`;
  }

  /**
   * Rotates existing files when maxBytes is reached.
   * If maxFiles is 3:
   * hook.log.3 is deleted if it exists.
   * hook.log.2 is renamed to hook.log.3.
   * hook.log.1 is renamed to hook.log.2.
   * hook.log is renamed to hook.log.1.
   */
  public rotateSync(): void {
    if (this.maxFiles <= 0) {
      try {
        if (existsSync(this.logFilePath)) {
          unlinkSync(this.logFilePath);
        }
      } catch {
        // non-fatal
      }
      return;
    }

    try {
      const oldestPath = `${this.logFilePath}.${this.maxFiles}`;
      if (existsSync(oldestPath)) {
        try {
          unlinkSync(oldestPath);
        } catch {
          // ignore
        }
      }

      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const currentPath = `${this.logFilePath}.${i}`;
        const nextPath = `${this.logFilePath}.${i + 1}`;
        if (existsSync(currentPath)) {
          try {
            renameSync(currentPath, nextPath);
          } catch {
            // ignore
          }
        }
      }

      if (existsSync(this.logFilePath)) {
        try {
          renameSync(this.logFilePath, `${this.logFilePath}.1`);
        } catch {
          // ignore
        }
      }
    } catch {
      // non-fatal
    }
  }

  /**
   * Writes a line to the rotating disk log file.
   * Never throws, as logging failure must not crash the caller.
   */
  public log(message: string): void {
    try {
      const formatted = this.formatMessage(message);

      if (this.echoToConsole) {
        console.log(formatted.trimEnd());
      }

      mkdirSync(this.logDir, { recursive: true });

      // Check file size for rotation
      try {
        if (existsSync(this.logFilePath)) {
          const stats = statSync(this.logFilePath);
          if (stats.size >= this.maxBytes) {
            this.rotateSync();
          }
        }
      } catch {
        // proceed to append
      }

      appendFileSync(this.logFilePath, formatted, "utf8");
    } catch {
      // Non-fatal if disk is full or read-only
    }
  }
}
