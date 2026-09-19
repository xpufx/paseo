import type { PluginCleanup } from "./host";

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
export interface CommandCenterItemRegistrar {
  addCommandCenterItem(contribution: any): any;
}

export type CommandCenterContext = "global" | "workspace" | "agent";

/**
 * Capabilities the host passes to a command-center item's `onSelect`. Mirrors
 * the subset of `PluginCommandCapabilities` the helper needs; the real host
 * context carries additional fields (paseo, rpc, workspace, agent) that a
 * handler may read off its own typed contribution.
 */
export interface CommandCenterCapabilities {
  openSurface(id: string): void;
  openSettings(id: string): void;
}

export interface CommandCenterItemContribution {
  id: string;
  title: string;
  icon: string;
  keywords?: readonly string[];
  context: CommandCenterContext;
  onSelect(context: CommandCenterCapabilities): void | Promise<void>;
}

/**
 * Registers a command-center palette item — the entry the host Ctrl+K command
 * center lists. Thin pass-through that keeps plugins on the helper seam and
 * works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
export function registerCommandCenterItem(
  plugin: CommandCenterItemRegistrar,
  contribution: CommandCenterItemContribution,
): PluginCleanup {
  return plugin.addCommandCenterItem(contribution);
}
