import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import {
  inspectProviderMcpCapability,
  type ProviderCapabilityInspection,
  type ProviderCapabilityOptions,
} from "./providers/capability";

export const GATEWAY_SERVER_NAME = "gateway";
export const MCP_INJECTION_WARNING_HEADER = "[MCP Injection Notice]";

export interface GatewayInjectOptions {
  enabled: boolean;
  url: string;
}

type CreateRequest = PluginBeforeRequests["agent.create"];

/**
 * Builds a clear, copyable warning prompt for agent sessions spawned under
 * providers that lack runtime MCP injection.
 */
export function buildMcpInjectionWarningPrompt(cap: ProviderCapabilityInspection): string {
  const lines = [
    MCP_INJECTION_WARNING_HEADER,
    `Provider '${cap.provider}' does not support runtime MCP injection (lacks 'session.mcp' or 'supportsNativePaseoTools').`,
    `MCP-based tools will not appear in this agent session automatically.`,
  ];
  if (cap.manualConfigPath) {
    lines.push(`To configure MCP servers manually for this provider, add them to: ${cap.manualConfigPath}`);
  }
  if (cap.manualConfigSnippet) {
    lines.push(`Example configuration:\n${cap.manualConfigSnippet}`);
  }
  return lines.join("\n\n");
}

/**
 * Detects whether a provider supports runtime MCP injection.
 */
export function detectProviderInjectionSupport(
  provider: string,
  options?: ProviderCapabilityOptions,
): ProviderCapabilityInspection {
  return inspectProviderMcpCapability(provider, options);
}

/**
 * Modifies an agent.create request with diagnostic guidance if the provider
 * lacks runtime MCP injection.
 */
export function applyMcpInjectionGuidance(
  request: CreateRequest,
  cap: ProviderCapabilityInspection,
): CreateRequest {
  const currentPrompt = request.config.systemPrompt ?? "";
  if (currentPrompt.includes(MCP_INJECTION_WARNING_HEADER)) {
    return request;
  }
  const warningPrompt = buildMcpInjectionWarningPrompt(cap);
  const nextPrompt = currentPrompt.trim().length > 0
    ? `${currentPrompt}\n\n${warningPrompt}`
    : warningPrompt;

  return {
    ...request,
    config: {
      ...request.config,
      systemPrompt: nextPrompt,
    },
  };
}

// Returns a modified agent.create request with the gateway MCP server
// injected and diagnostic guidance attached if runtime injection is unsupported,
// or undefined to keep the caller's request unchanged.
export function injectGatewayIntoCreateRequest(
  request: CreateRequest,
  opts: GatewayInjectOptions,
): CreateRequest | undefined {
  if (!opts.enabled) return undefined;
  if (!opts.url) return undefined;

  const mcpServers = request.config.mcpServers ?? {};
  if (mcpServers[GATEWAY_SERVER_NAME]) return undefined;

  const provider = request.config.provider ?? "";
  const cap = inspectProviderMcpCapability(provider, {
    serverName: GATEWAY_SERVER_NAME,
    serverConfig: { url: opts.url },
  });

  let nextRequest: CreateRequest = {
    ...request,
    config: {
      ...request.config,
      mcpServers: {
        ...mcpServers,
        [GATEWAY_SERVER_NAME]: { type: "http", url: opts.url },
      },
    },
  };

  if (!cap.supportsMcpInjection) {
    nextRequest = applyMcpInjectionGuidance(nextRequest, cap);
  }

  return nextRequest;
}
