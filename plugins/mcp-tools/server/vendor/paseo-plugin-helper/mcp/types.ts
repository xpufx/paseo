export interface McpClientOptions {
  timeoutMs?: number;
  clientInfo?: {
    name: string;
    version: string;
  };
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    [key: string]: unknown;
  }>;
  isError?: boolean;
}

export interface McpPingResult {
  healthy: boolean;
  latencyMs: number;
  serverInfo?: {
    name: string;
    version?: string;
  };
  instructions?: string;
  error?: string;
  stderr?: string;
}

export interface McpPingOptions {
  mode?: "protocol" | "tools";
  timeoutMs?: number;
}
