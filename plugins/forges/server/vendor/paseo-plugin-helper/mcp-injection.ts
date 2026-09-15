export interface McpStdioInjectionConfig {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  alwaysLoad?: boolean;
}

export interface McpHttpInjectionConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
  alwaysLoad?: boolean;
}

export interface McpSseInjectionConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  alwaysLoad?: boolean;
}

export type McpInjectionConfig =
  | McpStdioInjectionConfig
  | McpHttpInjectionConfig
  | McpSseInjectionConfig;

export interface AgentCreateInjectionConfig {
  mcpServers?: Record<string, McpInjectionConfig>;
  [key: string]: unknown;
}

export interface AgentCreateInjectionRequest {
  config: AgentCreateInjectionConfig;
  env?: Record<string, string>;
  [key: string]: unknown;
}

export type McpInjectionFilter = (input: {
  request: AgentCreateInjectionRequest;
}) => boolean;

export type McpInjectionHookHandler = (
  input: { request: AgentCreateInjectionRequest },
  context?: unknown,
) => AgentCreateInjectionRequest | void | Promise<AgentCreateInjectionRequest | void>;

export interface McpInjectionServer {
  // Loose on purpose: the real SDK declares a generic
  // before<Name extends keyof PluginBeforeRequests>(...) whose name param is
  // narrower than string and whose handler uses SDK request types. Typing this
  // boundary with any keeps the SDK object directly assignable with no
  // consumer-side adapter and no SDK imports here. Handler authors should use
  // McpInjectionHookHandler for the precise shape.
  before(
    name: string,
    handler: (input: { request: any }, context?: any) => any,
  ): () => void;
}

export interface RegisterMcpInjectionOptions {
  serverName: string;
  config: McpInjectionConfig;
  filter?: McpInjectionFilter;
}

export function registerMcpInjection(
  server: McpInjectionServer,
  options: RegisterMcpInjectionOptions,
): () => void {
  const { serverName, config, filter } = options;
  return server.before("agent.create", ({ request }: { request: AgentCreateInjectionRequest }) => {
    if (filter && !filter({ request })) return;
    return {
      ...request,
      config: {
        ...request.config,
        mcpServers: {
          ...(request.config.mcpServers ?? {}),
          [serverName]: config,
        },
      },
    };
  });
}
