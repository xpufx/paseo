import type {
  McpServerConfig,
  McpServerInfo,
  McpGatewayMetrics,
} from "../shared/types.js";

export interface GatewayStatus {
  status: string;
  gateway: string;
  version: string;
  serversCount: number;
  toolsCount: number;
  activeSessions: number;
  uptimeSeconds: number;
}

export function normalizeGatewayBaseUrl(url: string): string {
  return url.replace(/\/mcp\/?$/, "").replace(/\/sse\/?$/, "").replace(/\/$/, "");
}

export async function fetchGatewayStatus(
  gatewayUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<GatewayStatus> {
  const base = normalizeGatewayBaseUrl(gatewayUrl);
  const res = await fetchFn(`${base}/health`);
  if (!res.ok) {
    throw new Error(`Failed to fetch gateway status: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<GatewayStatus>;
}

export async function fetchGatewayServers(
  gatewayUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<McpServerInfo[]> {
  const base = normalizeGatewayBaseUrl(gatewayUrl);
  const res = await fetchFn(`${base}/api/servers`);
  if (!res.ok) {
    throw new Error(`Failed to fetch gateway servers: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { servers: McpServerInfo[] };
  return data.servers;
}

export async function fetchGatewayTools(
  gatewayUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<unknown[]> {
  const base = normalizeGatewayBaseUrl(gatewayUrl);
  const res = await fetchFn(`${base}/api/tools`);
  if (!res.ok) {
    throw new Error(`Failed to fetch gateway tools: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { tools: unknown[] };
  return data.tools;
}

export async function fetchGatewayMetrics(
  gatewayUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<McpGatewayMetrics> {
  const base = normalizeGatewayBaseUrl(gatewayUrl);
  const res = await fetchFn(`${base}/api/metrics`);
  if (!res.ok) {
    throw new Error(`Failed to fetch gateway metrics: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { metrics: McpGatewayMetrics };
  return data.metrics;
}

export async function registerGatewayServer(
  gatewayUrl: string,
  config: McpServerConfig,
  fetchFn: typeof fetch = fetch
): Promise<McpServerInfo> {
  const base = normalizeGatewayBaseUrl(gatewayUrl);
  const res = await fetchFn(`${base}/api/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    throw new Error(`Failed to register server on gateway: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { server: McpServerInfo };
  return data.server;
}

export async function removeGatewayServer(
  gatewayUrl: string,
  serverName: string,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const base = normalizeGatewayBaseUrl(gatewayUrl);
  const res = await fetchFn(`${base}/api/servers/${encodeURIComponent(serverName)}`, {
    method: "DELETE",
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new Error(`Failed to remove server from gateway: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { ok: boolean };
  return Boolean(data.ok);
}

export type * from "../shared/types.js";
export * from "../shared/schemas.js";
