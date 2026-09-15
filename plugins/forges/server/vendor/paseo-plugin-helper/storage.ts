import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ZodType } from "zod";

export interface PluginStorageOptions<T> {
  defaultData?: T;
  /**
   * Base directory override. When provided, storage is located at path.join(baseDir, pluginId).
   * When omitted, defaults to path.join(os.homedir(), ".paseo", namespace ?? "xpufx-plugins", pluginId).
   */
  baseDir?: string;
  /**
   * Namespace directory under ~/.paseo. Defaults to "xpufx-plugins".
   */
  namespace?: string;
  /**
   * Legacy directory override for backward compatibility testing or custom setups.
   */
  legacyDir?: string;
  /**
   * Optional Zod schema to validate and parse data on read/write, automatically applying defaults.
   */
  schema?: ZodType<T>;
}

export interface StorageStats {
  path: string;
  fileCount: number;
  totalBytes: number;
  lastModified: Date | null;
}

export const DEFAULT_NAMESPACE_README = `# Paseo Plugins Storage (xpufx)

This directory is managed by \`paseo-plugin-helper\` to store persistent settings, cached metrics, and state for plugins.
- Safe to inspect or backup.
- Avoid editing files manually while the Paseo daemon is active.
`;

/**
 * Scoped, atomic filesystem-backed document storage for Paseo daemon plugins.
 * Automatically handles directory creation, atomic temporary file swaps,
 * schema validation, default state fallback, and isolated namespace auditing.
 */
export class PluginStorage<T extends Record<string, any>> {
  readonly pluginId: string;
  readonly filename: string;
  readonly pluginDir: string;
  readonly filePath: string;
  readonly namespaceDir: string | null;
  readonly legacyPluginDir: string | null;
  readonly legacyFilePath: string | null;
  readonly defaultData?: T;
  readonly schema?: ZodType<T>;

  constructor(pluginId: string, filename = "state.json", options: PluginStorageOptions<T> = {}) {
    this.pluginId = pluginId;
    this.filename = filename;
    this.defaultData = options.defaultData;
    this.schema = options.schema;

    const namespace = options.namespace ?? "xpufx-plugins";
    if (options.baseDir) {
      this.namespaceDir = options.baseDir;
      this.pluginDir = path.join(options.baseDir, pluginId);
      this.legacyPluginDir = options.legacyDir ?? null;
    } else {
      this.namespaceDir = path.join(os.homedir(), ".paseo", namespace);
      this.pluginDir = path.join(this.namespaceDir, pluginId);
      this.legacyPluginDir = options.legacyDir ?? path.join(os.homedir(), ".paseo", pluginId);
    }

    this.filePath = path.join(this.pluginDir, filename);
    this.legacyFilePath = this.legacyPluginDir ? path.join(this.legacyPluginDir, filename) : null;
  }

  private ensureDir(): void {
    if (this.namespaceDir && !fs.existsSync(this.namespaceDir)) {
      fs.mkdirSync(this.namespaceDir, { recursive: true });
    }
    if (this.namespaceDir) {
      const readmePath = path.join(this.namespaceDir, "README.md");
      if (!fs.existsSync(readmePath)) {
        try {
          fs.writeFileSync(readmePath, DEFAULT_NAMESPACE_README, "utf8");
        } catch {
          // Non-fatal if filesystem is read-only
        }
      }
    }
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private checkMigrateLegacy(): void {
    if (!fs.existsSync(this.filePath) && this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
      try {
        this.ensureDir();
        fs.copyFileSync(this.legacyFilePath, this.filePath);
      } catch {
        // Fall back to reading legacy in read()
      }
    }
  }

  private async checkMigrateLegacyAsync(): Promise<void> {
    if (!fs.existsSync(this.filePath) && this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
      try {
        this.ensureDir();
        await fs.promises.copyFile(this.legacyFilePath, this.filePath);
      } catch {
        // Fall back
      }
    }
  }

  private getDefault(): T {
    if (this.schema) {
      const result = this.schema.safeParse(this.defaultData ?? {});
      if (result.success) {
        return result.data;
      }
    }
    return this.defaultData ? (JSON.parse(JSON.stringify(this.defaultData)) as T) : ({} as T);
  }

  private parseData(raw: unknown): T {
    if (this.schema) {
      const result = this.schema.safeParse(raw);
      if (result.success) {
        return result.data;
      }
      return this.getDefault();
    }
    return raw as T;
  }

  /**
   * Checks if the backing state file exists (in primary or legacy path).
   */
  exists(): boolean {
    if (fs.existsSync(this.filePath)) return true;
    if (this.legacyFilePath && fs.existsSync(this.legacyFilePath)) return true;
    return false;
  }

  /**
   * Reads data synchronously. If file does not exist, checks legacy location or returns defaultData.
   */
  read(): T {
    try {
      this.checkMigrateLegacy();
      if (!fs.existsSync(this.filePath)) {
        if (this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
          const raw = fs.readFileSync(this.legacyFilePath, "utf8");
          return this.parseData(JSON.parse(raw));
        }
        return this.getDefault();
      }
      const raw = fs.readFileSync(this.filePath, "utf8");
      return this.parseData(JSON.parse(raw));
    } catch {
      return this.getDefault();
    }
  }

  /**
   * Reads data asynchronously.
   */
  async readAsync(): Promise<T> {
    try {
      await this.checkMigrateLegacyAsync();
      if (!fs.existsSync(this.filePath)) {
        if (this.legacyFilePath && fs.existsSync(this.legacyFilePath)) {
          const raw = await fs.promises.readFile(this.legacyFilePath, "utf8");
          return this.parseData(JSON.parse(raw));
        }
        return this.getDefault();
      }
      const raw = await fs.promises.readFile(this.filePath, "utf8");
      return this.parseData(JSON.parse(raw));
    } catch {
      return this.getDefault();
    }
  }

  /**
   * Writes data atomically using a temporary file and atomic rename.
   */
  write(data: T): void {
    const validated = this.parseData(data);
    this.ensureDir();
    const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const serialized = JSON.stringify(validated, null, 2);
    fs.writeFileSync(tempPath, serialized, "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  /**
   * Writes data atomically using async filesystem operations.
   */
  async writeAsync(data: T): Promise<void> {
    const validated = this.parseData(data);
    this.ensureDir();
    const tempPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const serialized = JSON.stringify(validated, null, 2);
    await fs.promises.writeFile(tempPath, serialized, "utf8");
    await fs.promises.rename(tempPath, this.filePath);
  }

  /**
   * Updates state synchronously using an updater function.
   */
  update(updater: (prev: T) => T): T {
    const current = this.read();
    const updated = updater(current);
    const validated = this.parseData(updated);
    this.write(validated);
    return validated;
  }

  /**
   * Updates state asynchronously using an updater function.
   */
  async updateAsync(updater: (prev: T) => Promise<T> | T): Promise<T> {
    const current = await this.readAsync();
    const updated = await updater(current);
    const validated = this.parseData(updated);
    await this.writeAsync(validated);
    return validated;
  }

  /**
   * Removes the state file if it exists.
   */
  reset(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        fs.unlinkSync(this.filePath);
      } catch {}
    }
  }

  /**
   * Audits storage consumption, returning path, fileCount, totalBytes, and lastModified.
   */
  async getStorageStats(): Promise<StorageStats> {
    const stats: StorageStats = {
      path: this.pluginDir,
      fileCount: 0,
      totalBytes: 0,
      lastModified: null,
    };

    if (!fs.existsSync(this.pluginDir)) {
      return stats;
    }

    try {
      const entries = await fs.promises.readdir(this.pluginDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          stats.fileCount++;
          const target = path.join(this.pluginDir, entry.name);
          const st = await fs.promises.stat(target);
          stats.totalBytes += st.size;
          if (!stats.lastModified || st.mtime > stats.lastModified) {
            stats.lastModified = st.mtime;
          }
        }
      }
    } catch {}

    return stats;
  }

  /**
   * Alias for getStorageStats()
   */
  async getStats(): Promise<StorageStats> {
    return this.getStorageStats();
  }
}
