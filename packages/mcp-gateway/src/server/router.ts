import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  McpServerConfig,
  McpServerInfo,
  McpServerStatus,
  McpGatewayMetrics,
} from "../shared/types.js";

interface ManagedServer {
  config: McpServerConfig;
  client?: Client;
  transport?: Transport;
  status: McpServerStatus;
  tools: Map<string, Tool>;
  error?: string;
  connectedAt?: string;
  lastPingAt?: string;
}

interface ToolRoute {
  serverName: string;
  originalName: string;
  exposedName: string;
}

export class McpCompositeRouter {
  private servers = new Map<string, ManagedServer>();
  private toolRouting = new Map<string, ToolRoute>();
  private startTime = new Date();
  private metrics: {
    requestsTotal: number;
    toolCallsTotal: number;
    toolCallsSuccess: number;
    toolCallsFailed: number;
    totalLatencyMs: number;
  } = {
    requestsTotal: 0,
    toolCallsTotal: 0,
    toolCallsSuccess: 0,
    toolCallsFailed: 0,
    totalLatencyMs: 0,
  };

  /**
   * Adds and connects an upstream MCP server to the composite router.
   * If a server with the same name exists, it is closed and replaced.
   */
  async addServer(
    config: McpServerConfig,
    transportOverride?: Transport
  ): Promise<McpServerInfo> {
    if (this.servers.has(config.name)) {
      await this.removeServer(config.name);
    }

    const managed: ManagedServer = {
      config,
      status: "connecting",
      tools: new Map(),
    };
    this.servers.set(config.name, managed);

    try {
      let transport: Transport;
      if (transportOverride) {
        transport = transportOverride;
      } else if (config.transport === "stdio") {
        if (!config.command) {
          throw new Error(`Server '${config.name}' requires command for stdio transport`);
        }
        const envRecord: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (typeof v === "string") envRecord[k] = v;
        }
        if (config.env) {
          Object.assign(envRecord, config.env);
        }
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: envRecord,
          cwd: config.cwd,
        });
      } else if (config.transport === "sse" || config.transport === "http") {
        if (!config.url) {
          throw new Error(`Server '${config.name}' requires url for sse/http transport`);
        }
        transport = new SSEClientTransport(new URL(config.url), {
          eventSourceInit: config.headers ? ({ headers: config.headers } as any) : undefined,
          requestInit: config.headers ? { headers: config.headers } : undefined,
        });
      } else {
        throw new Error(`Unsupported transport: ${config.transport}`);
      }

      managed.transport = transport;

      const client = new Client(
        { name: "mcp-gateway-router", version: "0.1.0" },
        { capabilities: {} }
      );
      managed.client = client;

      await client.connect(transport);
      managed.status = "connected";
      managed.connectedAt = new Date().toISOString();
      managed.lastPingAt = new Date().toISOString();

      // Discover tools from the newly connected server
      await this.refreshServerTools(config.name);

      return this.toServerInfo(managed);
    } catch (err) {
      managed.status = "error";
      managed.error = err instanceof Error ? err.message : String(err);
      return this.toServerInfo(managed);
    }
  }

  /**
   * Disconnects and removes an upstream server by name.
   */
  async removeServer(name: string): Promise<boolean> {
    const server = this.servers.get(name);
    if (!server) return false;

    // Unregister routes
    for (const exposedName of server.tools.keys()) {
      this.toolRouting.delete(exposedName);
    }

    try {
      if (server.client) {
        await server.client.close();
      }
      if (server.transport && typeof (server.transport as any).close === "function") {
        await server.transport.close();
      }
    } catch {
      // Best-effort cleanup
    }

    server.status = "disconnected";
    this.servers.delete(name);
    return true;
  }

  /**
   * Refreshes the tools for a specific upstream server.
   */
  async refreshServerTools(serverName: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server || !server.client || server.status !== "connected") return;

    // Clear previous routes for this server
    for (const exposedName of server.tools.keys()) {
      this.toolRouting.delete(exposedName);
    }
    server.tools.clear();

    const result = await server.client.listTools();
    const tools = result.tools || [];

    for (const tool of tools) {
      const prefix = server.config.prefix;
      const exposedName = prefix ? `${prefix}_${tool.name}` : tool.name;
      const exposedTool: Tool = {
        ...tool,
        name: exposedName,
      };

      server.tools.set(exposedName, exposedTool);
      this.toolRouting.set(exposedName, {
        serverName,
        originalName: tool.name,
        exposedName,
      });
    }
  }

  /**
   * Returns information about a specific server.
   */
  getServer(name: string): McpServerInfo | undefined {
    const server = this.servers.get(name);
    return server ? this.toServerInfo(server) : undefined;
  }

  /**
   * Lists all registered servers with their connection statuses.
   */
  listServers(): McpServerInfo[] {
    return Array.from(this.servers.values()).map((s) => this.toServerInfo(s));
  }

  /**
   * Returns the aggregated list of all tools from all connected servers.
   */
  async listAggregatedTools(): Promise<Tool[]> {
    this.metrics.requestsTotal += 1;
    const tools: Tool[] = [];
    for (const server of this.servers.values()) {
      if (server.status === "connected") {
        for (const tool of server.tools.values()) {
          tools.push(tool);
        }
      }
    }
    return tools;
  }

  /**
   * Dispatches a tool call to the responsible upstream server.
   */
  async callAggregatedTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<CallToolResult> {
    this.metrics.requestsTotal += 1;
    this.metrics.toolCallsTotal += 1;
    const startTime = Date.now();

    const route = this.toolRouting.get(name);
    if (!route) {
      this.metrics.toolCallsFailed += 1;
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Tool '${name}' not found on any connected MCP server`,
          },
        ],
      };
    }

    const server = this.servers.get(route.serverName);
    if (!server || !server.client || server.status !== "connected") {
      this.metrics.toolCallsFailed += 1;
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Upstream server '${route.serverName}' is not connected`,
          },
        ],
      };
    }

    try {
      const result = await server.client.callTool({
        name: route.originalName,
        arguments: args,
      });
      const duration = Date.now() - startTime;
      this.metrics.totalLatencyMs += duration;

      if ((result as any).isError) {
        this.metrics.toolCallsFailed += 1;
      } else {
        this.metrics.toolCallsSuccess += 1;
      }

      return result as CallToolResult;
    } catch (err) {
      const duration = Date.now() - startTime;
      this.metrics.totalLatencyMs += duration;
      this.metrics.toolCallsFailed += 1;

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Error calling tool '${name}' on server '${route.serverName}': ${
              err instanceof Error ? err.message : String(err)
            }`,
          },
        ],
      };
    }
  }

  /**
   * Returns in-memory gateway performance metrics.
   */
  getMetrics(activeSessions: number = 0): McpGatewayMetrics {
    const uptimeSeconds = Math.floor(
      (Date.now() - this.startTime.getTime()) / 1000
    );
    const avgLatency =
      this.metrics.toolCallsTotal > 0
        ? Math.round(this.metrics.totalLatencyMs / this.metrics.toolCallsTotal)
        : 0;

    return {
      requestsTotal: this.metrics.requestsTotal,
      toolCallsTotal: this.metrics.toolCallsTotal,
      toolCallsSuccess: this.metrics.toolCallsSuccess,
      toolCallsFailed: this.metrics.toolCallsFailed,
      averageLatencyMs: avgLatency,
      activeSessions,
      uptimeSeconds,
      startTime: this.startTime.toISOString(),
    };
  }

  /**
   * Shuts down all connected clients and transports.
   */
  async close(): Promise<void> {
    const names = Array.from(this.servers.keys());
    for (const name of names) {
      await this.removeServer(name);
    }
  }

  private toServerInfo(server: ManagedServer): McpServerInfo {
    return {
      name: server.config.name,
      transport: server.config.transport,
      status: server.status,
      toolCount: server.tools.size,
      tools: Array.from(server.tools.keys()),
      error: server.error,
      url: server.config.url,
      command: server.config.command,
      connectedAt: server.connectedAt,
      lastPingAt: server.lastPingAt,
    };
  }
}
