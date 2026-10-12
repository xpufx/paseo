export type McpServerTransport = "stdio" | "sse" | "http";

export type McpServerStatus = "connected" | "connecting" | "disconnected" | "error";

export interface McpServerConfig {
  name: string;
  transport: McpServerTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  prefix?: string;
}

export interface McpServerInfo {
  name: string;
  transport: McpServerTransport;
  status: McpServerStatus;
  toolCount: number;
  tools: string[];
  error?: string;
  url?: string;
  command?: string;
  connectedAt?: string;
  lastPingAt?: string;
}

export interface McpGatewayMetrics {
  requestsTotal: number;
  toolCallsTotal: number;
  toolCallsSuccess: number;
  toolCallsFailed: number;
  averageLatencyMs: number;
  activeSessions: number;
  uptimeSeconds: number;
  startTime: string;
}

export interface McpGatewayServerOptions {
  port?: number;
  host?: string;
  cors?: boolean;
  name?: string;
  version?: string;
}
