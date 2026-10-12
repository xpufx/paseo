import { z } from "zod";

export const McpServerTransportSchema = z.enum(["stdio", "sse", "http"]);

export const McpServerConfigSchema = z.object({
  name: z.string().min(1),
  transport: McpServerTransportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  prefix: z.string().optional(),
});

export const McpServerStatusSchema = z.enum(["connected", "connecting", "disconnected", "error"]);

export const McpServerInfoSchema = z.object({
  name: z.string(),
  transport: McpServerTransportSchema,
  status: McpServerStatusSchema,
  toolCount: z.number(),
  tools: z.array(z.string()),
  error: z.string().optional(),
  url: z.string().optional(),
  command: z.string().optional(),
  connectedAt: z.string().optional(),
  lastPingAt: z.string().optional(),
});

export const McpGatewayMetricsSchema = z.object({
  requestsTotal: z.number(),
  toolCallsTotal: z.number(),
  toolCallsSuccess: z.number(),
  toolCallsFailed: z.number(),
  averageLatencyMs: z.number(),
  activeSessions: z.number(),
  uptimeSeconds: z.number(),
  startTime: z.string(),
});
