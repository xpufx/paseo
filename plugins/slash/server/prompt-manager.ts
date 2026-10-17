import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { COMMAND_NAME_PATTERN, type SlashCommand } from "../shared/resources";
import { isPluginRunning } from "./vendor/paseo-plugin-helper";

export const PROMPT_MANAGER_PLUGIN_ID = "paseo-prompt-manager";

export interface PromptManagerSettings {
  directory: string;
  gitEnabled?: boolean;
  syncMode?: string;
  syncInterval?: number;
}

export interface PromptSummary {
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
  archived?: boolean;
}

export interface PromptDetail {
  id: string;
  title?: string;
  content: string;
  description?: string;
}

export interface PromptFileMetadata {
  description?: string;
  tags?: string[];
}

export interface ParsedPromptFile {
  body: string;
  metadata?: PromptFileMetadata;
}

/**
 * Normalizes a prompt ID / filename into a valid slash command name.
 * e.g. "review-code.md" -> "review-code", "frontend/button-check" -> "frontend-button-check".
 */
export function promptIdToCommandName(id: string): string {
  const normalized = id
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 64);
}

/**
 * Authoritative presence check for paseo-prompt-manager.
 * Uses daemon context.paseo.plugins.list() when available, or isPluginRunning() from paseo-plugin-helper.
 * Zero fallback chains or filesystem guessing.
 */
export async function isPromptManagerRunning(
  context?: PluginHandlerContext,
): Promise<boolean> {
  if (context?.paseo && typeof (context.paseo as any).plugins?.list === "function") {
    try {
      const list = await (context.paseo as any).plugins.list();
      if (Array.isArray(list)) {
        const found = list.find((p: any) => p.id === PROMPT_MANAGER_PLUGIN_ID);
        return (
          !!found &&
          found.enabled !== false &&
          (found.status === "running" || found.running === true)
        );
      }
    } catch {
      return false;
    }
  }
  return isPluginRunning(PROMPT_MANAGER_PLUGIN_ID);
}

/**
 * Resolves the configuration file path for paseo-prompt-manager.
 */
export function getPromptManagerConfigPath(): string {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "paseo", "prompt-manager.json")
    : path.join(os.homedir(), ".config", "paseo", "prompt-manager.json");
}

/**
 * Resolves the default prompt library directory.
 */
export function getDefaultPromptDirectory(): string {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configHome, "paseo", "prompt-lib");
}

/**
 * Resolves ~ to os.homedir() and normalizes directory path.
 */
export function resolvePromptDirectory(dir: string): string {
  const home = os.homedir();
  if (dir === "~") {
    return home;
  }
  if (dir.startsWith("~/")) {
    return path.join(home, dir.slice(2));
  }
  return path.resolve(dir);
}

/**
 * Reads prompt manager settings directly from disk.
 * If config file exists and is valid JSON with `directory: string`, uses that directory.
 * If missing or invalid, falls back to default prompt-lib directory.
 */
export async function getPromptManagerSettings(
  _context?: PluginHandlerContext,
): Promise<PromptManagerSettings> {
  const configPath = getPromptManagerConfigPath();
  const defaultDir = getDefaultPromptDirectory();

  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.directory === "string" && parsed.directory.trim()) {
      return {
        directory: resolvePromptDirectory(parsed.directory.trim()),
        gitEnabled: Boolean(parsed.gitEnabled),
        syncMode: typeof parsed.syncMode === "string" ? parsed.syncMode : undefined,
        syncInterval: typeof parsed.syncInterval === "number" ? parsed.syncInterval : undefined,
      };
    }
  } catch {
    // Missing, unreadable, or invalid JSON falls back to default directory
  }

  return {
    directory: defaultDir,
    gitEnabled: false,
  };
}

/**
 * Parses frontmatter header (---\npaseo: ({[^\n]*})\n---\n) if present.
 */
export function parsePromptFile(raw: string): ParsedPromptFile {
  const match = /^---\r?\npaseo: (\{[^\r\n]*\})\r?\n---\r?\n/.exec(raw);
  if (!match) {
    return { body: raw };
  }
  let metadata: PromptFileMetadata | undefined;
  try {
    metadata = JSON.parse(match[1]);
  } catch {
    // Malformed JSON in frontmatter header: treat as unparsed metadata
  }
  return {
    body: raw.slice(match[0].length),
    metadata,
  };
}

/**
 * Extracts the first `# <heading>` or falls back to prompt name.
 */
export function extractPromptTitle(content: string, fallback: string): string {
  const match = /^#{1,6}\s+(.+?)\s*#*\s*$/m.exec(content);
  return match?.[1]?.trim() || fallback;
}

/**
 * Recursively scans directory for `.md` files, skipping `versions` or any hidden dotfiles/dotdirs.
 */
async function scanDirectoryForPrompts(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(currentDir: string, relativePrefix: string) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === "versions") {
          continue;
        }
        const nextRel = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
        await walk(path.join(currentDir, entry.name), nextRel);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const relPath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
        results.push(relPath);
      }
    }
  }
  await walk(dir, "");
  return results;
}

/**
 * Loads prompt files directly from disk following paseo-prompt-manager's canonical storage contract.
 */
export async function loadPromptManagerSlashCommands(
  context?: PluginHandlerContext,
): Promise<SlashCommand[]> {
  const settings = await getPromptManagerSettings(context);
  const directory = settings.directory;

  try {
    const st = await fs.stat(directory);
    if (!st.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const relFiles = await scanDirectoryForPrompts(directory);
  const commands: SlashCommand[] = [];
  const seen = new Set<string>();

  for (const relPath of relFiles) {
    const promptId = relPath.replace(/\.md$/i, "");
    if (!promptId) continue;
    const name = promptIdToCommandName(promptId);
    if (!name || !COMMAND_NAME_PATTERN.test(name) || seen.has(name)) continue;
    seen.add(name);

    const filePath = path.join(directory, relPath);
    let rawContent = "";
    try {
      rawContent = await fs.readFile(filePath, "utf-8");
    } catch {
      continue;
    }

    const { body, metadata } = parsePromptFile(rawContent);
    const title = extractPromptTitle(body, name);
    const description =
      metadata?.description &&
      typeof metadata.description === "string" &&
      metadata.description.trim()
        ? metadata.description.trim()
        : "Prompt Manager prompt";

    commands.push({
      name,
      title,
      description,
      enabled: true,
      source: PROMPT_MANAGER_PLUGIN_ID,
      promptId,
      action: {
        verb: "send",
        template: "{args}",
      },
    });
  }

  return commands;
}

/**
 * Dynamically fetches the fresh Markdown content of a prompt from disk,
 * stripping frontmatter header if present.
 */
export async function fetchPromptManagerContent(
  promptId: string,
  context?: PluginHandlerContext,
): Promise<string> {
  const settings = await getPromptManagerSettings(context);
  const filePath = path.join(settings.directory, `${promptId}.md`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const { body } = parsePromptFile(raw);
    return body;
  } catch (err) {
    throw new Error(
      `Failed to read prompt "${promptId}" from ${PROMPT_MANAGER_PLUGIN_ID}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
