import os from "node:os";
import path from "node:path";
import { probeForProvider } from "./index";
import {
  ANTIGRAVITY_MANUAL_CONFIG_PATH,
  generateAntigravityManualConfigSnippet,
} from "./antigravity";
import { matchesFamily } from "./family";

export interface ProviderCapabilityOptions {
  capabilities?: readonly string[] | string[] | Record<string, boolean>;
  supportsNativePaseoTools?: boolean;
  supportsMcpInjection?: boolean;
  serverName?: string;
  serverConfig?: { url?: string; command?: string; args?: string[] };
}

export interface ProviderCapabilityInspection {
  provider: string;
  supportsMcpInjection: boolean;
  supportsNativePaseoTools: boolean;
  status: "supported" | "unsupported" | "degraded";
  manualConfigPath: string | null;
  manualConfigSnippet: string | null;
  warning: string | null;
}

/**
 * Checks provider registration capabilities (`supportsNativePaseoTools`, `session.mcp`)
 * and inspects whether the provider supports runtime MCP injection.
 * When runtime MCP injection is unsupported (e.g. Antigravity / AGY), generates
 * concrete configuration paths and copyable setup snippets.
 */
export function inspectProviderMcpCapability(
  provider: string,
  options: ProviderCapabilityOptions = {},
): ProviderCapabilityInspection {
  const probe = probeForProvider(provider);
  const isAntigravity = matchesFamily(provider, "antigravity") || matchesFamily(provider, "agy");
  const isPaseoNative = matchesFamily(provider, "paseo");

  // Determine supportsMcpInjection
  let supportsMcpInjection: boolean;
  if (typeof options.supportsMcpInjection === "boolean") {
    supportsMcpInjection = options.supportsMcpInjection;
  } else if (options.capabilities !== undefined && options.capabilities !== null) {
    if (Array.isArray(options.capabilities)) {
      const hasSessionMcp = options.capabilities.includes("session.mcp");
      supportsMcpInjection = isPaseoNative || hasSessionMcp;
    } else if (typeof options.capabilities === "object") {
      const flagMap = options.capabilities as Record<string, boolean>;
      const hasSessionMcp = Boolean(flagMap["session.mcp"]);
      supportsMcpInjection = isPaseoNative || hasSessionMcp;
    } else {
      supportsMcpInjection = isPaseoNative;
    }
  } else if (typeof options.supportsNativePaseoTools === "boolean" && !options.supportsNativePaseoTools) {
    supportsMcpInjection = false;
  } else if (isAntigravity) {
    supportsMcpInjection = false;
  } else if (probe && typeof probe.supportsMcpInjection === "boolean") {
    supportsMcpInjection = probe.supportsMcpInjection;
  } else {
    // Unknown provider without session.mcp declaration
    supportsMcpInjection = !probe ? false : true;
  }

  // Determine supportsNativePaseoTools
  let supportsNativePaseoTools: boolean;
  if (typeof options.supportsNativePaseoTools === "boolean") {
    supportsNativePaseoTools = options.supportsNativePaseoTools;
  } else if (isAntigravity) {
    supportsNativePaseoTools = false;
  } else if (probe && typeof probe.supportsNativePaseoTools === "boolean") {
    supportsNativePaseoTools = probe.supportsNativePaseoTools;
  } else {
    supportsNativePaseoTools = supportsMcpInjection;
  }

  const serverName = options.serverName ?? "gateway";
  const serverConfig = options.serverConfig;

  let manualConfigPath: string | null = null;
  let manualConfigSnippet: string | null = null;
  let warning: string | null = null;

  if (!supportsMcpInjection) {
    if (isAntigravity) {
      manualConfigPath = ANTIGRAVITY_MANUAL_CONFIG_PATH;
      manualConfigSnippet = generateAntigravityManualConfigSnippet(serverName, serverConfig);
    } else if (probe?.manualConfigPath) {
      manualConfigPath = probe.manualConfigPath;
      manualConfigSnippet = probe.getManualConfigSnippet
        ? probe.getManualConfigSnippet(serverName, serverConfig)
        : JSON.stringify({ mcpServers: { [serverName]: serverConfig ?? { command: "node" } } }, null, 2);
    } else {
      manualConfigPath = path.join(os.homedir(), ".config", provider, "mcp.json");
      manualConfigSnippet = JSON.stringify(
        {
          mcpServers: {
            [serverName]: serverConfig?.url
              ? { url: serverConfig.url }
              : { command: serverConfig?.command ?? "node", args: serverConfig?.args ?? [] },
          },
        },
        null,
        2,
      );
    }

    warning = `Provider '${provider}' does not implement runtime MCP injection (lacks 'session.mcp' or 'supportsNativePaseoTools'). Tools will not appear in the agent session automatically. Configure tools manually in ${manualConfigPath}.`;
  } else {
    manualConfigPath = probe?.manualConfigPath ?? null;
  }

  const status: "supported" | "unsupported" | "degraded" = supportsMcpInjection
    ? "supported"
    : "unsupported";

  return {
    provider,
    supportsMcpInjection,
    supportsNativePaseoTools,
    status,
    manualConfigPath,
    manualConfigSnippet,
    warning,
  };
}
