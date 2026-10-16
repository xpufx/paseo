import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { COMMAND_NAME_PATTERN, type SlashCommand } from "../shared/resources";
import { isPluginRunning } from "./vendor/paseo-plugin-helper";

export const PROMPT_MANAGER_PLUGIN_ID = "paseo-prompt-manager";

export interface PromptManagerSettings {
  directory: string;
  gitEnabled: boolean;
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
 * Invokes an RPC method on paseo-prompt-manager over plugin RPC.
 */
export async function callPromptManagerRpc<T = unknown>(
  method: string,
  input: unknown = {},
  context?: PluginHandlerContext,
): Promise<T> {
  const pluginId = PROMPT_MANAGER_PLUGIN_ID;
  const paseo = context?.paseo as any;
  if (typeof paseo?.invokePluginRpc === "function") {
    return paseo.invokePluginRpc(pluginId, method, input);
  }
  if (typeof paseo?.plugins?.invoke === "function") {
    return paseo.plugins.invoke(pluginId, method, input);
  }
  if (typeof paseo?.plugins?.rpc === "function") {
    return paseo.plugins.rpc(pluginId, method, input);
  }
  if (typeof (context as any)?.invokePluginRpc === "function") {
    return (context as any).invokePluginRpc(pluginId, method, input);
  }
  if (typeof paseo?.daemonClient?.invokePluginRpc === "function") {
    return paseo.daemonClient.invokePluginRpc(pluginId, method, input);
  }
  throw new Error(`Plugin RPC invocation unavailable for ${pluginId}:${method}`);
}

/**
 * Discovers prompt manager settings and configured directory via library.settings RPC.
 */
export async function getPromptManagerSettings(
  context?: PluginHandlerContext,
): Promise<PromptManagerSettings> {
  return callPromptManagerRpc<PromptManagerSettings>("library.settings", {}, context);
}

/**
 * Lists external prompts from paseo-prompt-manager via prompts.list RPC,
 * mapping each prompt into an executable send slash command.
 */
export async function loadPromptManagerSlashCommands(
  context?: PluginHandlerContext,
): Promise<SlashCommand[]> {
  // Call library.settings RPC over plugin RPC to discover its configured directory/settings
  await getPromptManagerSettings(context);

  // Discover prompts dynamically via prompts.list RPC
  const prompts = await callPromptManagerRpc<PromptSummary[]>(
    "prompts.list",
    { archived: false },
    context,
  );

  if (!Array.isArray(prompts)) return [];

  const commands: SlashCommand[] = [];
  for (const prompt of prompts) {
    if (!prompt.id || prompt.archived) continue;
    const name = promptIdToCommandName(prompt.id);
    if (!name || !COMMAND_NAME_PATTERN.test(name)) continue;

    commands.push({
      name,
      title: prompt.title || name,
      description: prompt.description || "Prompt Manager prompt",
      enabled: true,
      source: PROMPT_MANAGER_PLUGIN_ID,
      promptId: prompt.id,
      action: {
        verb: "send",
        template: "{args}",
      },
    });
  }
  return commands;
}

/**
 * Dynamically fetches the fresh Markdown content of a prompt via prompts.read RPC.
 */
export async function fetchPromptManagerContent(
  promptId: string,
  context?: PluginHandlerContext,
): Promise<string> {
  const result = await callPromptManagerRpc<PromptDetail>(
    "prompts.read",
    { id: promptId },
    context,
  );
  if (!result || typeof result.content !== "string") {
    throw new Error(`Failed to read prompt "${promptId}" from ${PROMPT_MANAGER_PLUGIN_ID}`);
  }
  return result.content;
}
