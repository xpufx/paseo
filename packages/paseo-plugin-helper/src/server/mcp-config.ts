import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseJsonc } from "./jsonc.js";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  autoApprove?: string[];
  [key: string]: unknown;
}

export interface McpConfigTarget {
  /**
   * Absolute or relative path to the configuration file.
   * Supports '~' expansion (e.g. "~/.claude.json").
   */
  path: string;

  /**
   * The top-level key under which MCP servers are defined.
   * Defaults to "mcpServers".
   */
  key?: string;

  /**
   * If true, creates a timestamped backup file before modifying an existing file.
   */
  backup?: boolean;
}

export interface UpsertMcpServerOptions {
  /**
   * Target config file path or McpConfigTarget descriptor.
   */
  target: string | McpConfigTarget;

  /**
   * Unique name of the MCP server entry (e.g. "paseo-gateway", "top", "x-comms").
   */
  serverName: string;

  /**
   * MCP server configuration object (command, args, env, etc.).
   */
  config: McpServerConfig;

  /**
   * Override backup option. If true, creates a backup before modifying.
   */
  backup?: boolean;
}

export interface RemoveMcpServerOptions {
  /**
   * Target config file path or McpConfigTarget descriptor.
   */
  target: string | McpConfigTarget;

  /**
   * Name of the MCP server entry to remove.
   */
  serverName: string;

  /**
   * Override backup option. If true, creates a backup before removing.
   */
  backup?: boolean;
}

export interface McpMutationResult {
  filePath: string;
  serverName: string;
  changed: boolean;
  action: "created" | "updated" | "unchanged" | "removed" | "not_found";
  backupPath?: string;
}

/**
 * Standard known MCP configuration paths across major developer tools and agent runners.
 * Note: These are pure path resolvers with zero filesystem scanning or heuristics.
 */
export const McpConfigPaths = {
  /**
   * Claude Desktop configuration path per operating system:
   * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
   * - Windows: %APPDATA%/Claude/claude_desktop_config.json
   * - Linux: ~/.config/Claude/claude_desktop_config.json
   */
  claudeDesktop(): string {
    const platform = process.platform;
    const home = os.homedir();
    if (platform === "darwin") {
      return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    }
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      return path.join(appData, "Claude", "claude_desktop_config.json");
    }
    const configDir = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    return path.join(configDir, "Claude", "claude_desktop_config.json");
  },

  /**
   * Claude Code CLI global configuration: ~/.claude.json
   */
  claudeCode(): string {
    return path.join(os.homedir(), ".claude.json");
  },

  /**
   * OpenCode configuration path: ~/.config/opencode/opencode.json
   */
  openCode(): string {
    const home = os.homedir();
    const configDir = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    return path.join(configDir, "opencode", "opencode.json");
  },

  /**
   * Cursor editor MCP configuration: ~/.cursor/mcp.json
   */
  cursor(): string {
    return path.join(os.homedir(), ".cursor", "mcp.json");
  },

  /**
   * Gemini / Antigravity CLI configuration: ~/.gemini/config/mcp_config.json
   */
  gemini(): string {
    return path.join(os.homedir(), ".gemini", "config", "mcp_config.json");
  },

  /**
   * Pi CLI agent configuration: ~/.pi/config.json
   */
  pi(): string {
    return path.join(os.homedir(), ".pi", "config.json");
  },
};

/**
 * Expands '~' to the user's home directory.
 */
export function expandPath(targetPath: string): string {
  if (targetPath === "~") {
    return os.homedir();
  }
  if (targetPath.startsWith("~/") || targetPath.startsWith("~\\")) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return path.resolve(targetPath);
}

/**
 * Deep equality check for primitives, arrays, and objects.
 */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!isDeepEqual((a as any)[key], (b as any)[key])) return false;
  }
  return true;
}

/**
 * Normalizes target string or descriptor into { filePath, key, backup }.
 */
function normalizeTarget(target: string | McpConfigTarget, backupOverride?: boolean): {
  filePath: string;
  key: string;
  backup: boolean;
} {
  if (typeof target === "string") {
    return {
      filePath: expandPath(target),
      key: "mcpServers",
      backup: Boolean(backupOverride),
    };
  }
  return {
    filePath: expandPath(target.path),
    key: target.key || "mcpServers",
    backup: backupOverride !== undefined ? backupOverride : Boolean(target.backup),
  };
}

/**
 * Reads an existing configuration file safely using JSONC parser.
 * Returns an empty object if the file does not exist.
 */
function readConfigDocument(filePath: string): Record<string, any> {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) {
    return {};
  }
  return parseJsonc<Record<string, any>>(raw);
}

/**
 * Writes data atomically to the given file path using a temporary file and POSIX atomic rename.
 */
function writeConfigAtomic(filePath: string, data: Record<string, any>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const serialized = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(tempPath, serialized, "utf8");
  fs.renameSync(tempPath, filePath);
}

/**
 * Retrieves an MCP server definition from a config file.
 * Returns null if the file, key, or server does not exist.
 */
export function getMcpServer(
  target: string | McpConfigTarget,
  serverName: string
): McpServerConfig | null {
  const { filePath, key } = normalizeTarget(target);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const doc = readConfigDocument(filePath);
    const servers = doc[key];
    if (servers && typeof servers === "object" && serverName in servers) {
      return servers[serverName] as McpServerConfig;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Upserts an MCP server definition into an agent or tool configuration file.
 *
 * Guarantees:
 * 1. Namespaced idempotency: If the server configuration already exists and matches,
 *    no write occurs, preventing file watcher thrashing.
 * 2. JSONC safe: Reads files containing comments or trailing commas without crashing.
 * 3. Atomic writes: Uses temporary files and atomic rename to prevent corruption.
 * 4. Optional backups: Can create a timestamped backup before modifying existing files.
 */
export function upsertMcpServer(options: UpsertMcpServerOptions): McpMutationResult {
  const { filePath, key, backup } = normalizeTarget(options.target, options.backup);
  const { serverName, config } = options;

  let doc: Record<string, any>;
  const fileExisted = fs.existsSync(filePath);

  if (fileExisted) {
    doc = readConfigDocument(filePath);
  } else {
    doc = {};
  }

  if (typeof doc[key] !== "object" || doc[key] === null || Array.isArray(doc[key])) {
    doc[key] = {};
  }

  const existingConfig = doc[key][serverName];
  const isExisting = existingConfig !== undefined;

  // Idempotency: Deep equality check
  if (isExisting && isDeepEqual(existingConfig, config)) {
    return {
      filePath,
      serverName,
      changed: false,
      action: "unchanged",
    };
  }

  let backupPath: string | undefined;
  if (backup && fileExisted) {
    backupPath = `${filePath}.bak.${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  }

  doc[key][serverName] = config;
  writeConfigAtomic(filePath, doc);

  return {
    filePath,
    serverName,
    changed: true,
    action: isExisting ? "updated" : "created",
    backupPath,
  };
}

/**
 * Removes an MCP server definition from a config file.
 *
 * Guarantees:
 * 1. Safe no-op: If the file or server does not exist, no write occurs.
 * 2. Atomic writes: Cleanly removes the key and updates the file atomically.
 * 3. Optional backups: Can create a timestamped backup before removal.
 */
export function removeMcpServer(options: RemoveMcpServerOptions): McpMutationResult {
  const { filePath, key, backup } = normalizeTarget(options.target, options.backup);
  const { serverName } = options;

  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      serverName,
      changed: false,
      action: "not_found",
    };
  }

  const doc = readConfigDocument(filePath);
  if (!doc[key] || typeof doc[key] !== "object" || !(serverName in doc[key])) {
    return {
      filePath,
      serverName,
      changed: false,
      action: "not_found",
    };
  }

  let backupPath: string | undefined;
  if (backup) {
    backupPath = `${filePath}.bak.${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
  }

  delete doc[key][serverName];
  writeConfigAtomic(filePath, doc);

  return {
    filePath,
    serverName,
    changed: true,
    action: "removed",
    backupPath,
  };
}
