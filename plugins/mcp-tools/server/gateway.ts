import { McpCompositeRouter, McpControlServer } from "@xpufx/mcp-gateway/server";
import type { McpToolsSettings } from "../shared/mcp.js";
import { log } from "./mcp.js";

let activeControlServer: McpControlServer | undefined;
let activeRouter: McpCompositeRouter | undefined;
let activePort: number | undefined;

export function parseGatewayPort(url: string, defaultPort = 37374): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) {
      const p = parseInt(parsed.port, 10);
      if (!isNaN(p) && p > 0) return p;
    }
  } catch {
    // ignore
  }
  return defaultPort;
}

export async function startGateway(
  settings: McpToolsSettings
): Promise<{ url: string; port: number } | undefined> {
  if (!settings.gatewayInject) {
    if (activeControlServer) {
      await stopGateway();
    }
    return undefined;
  }

  const port = parseGatewayPort(settings.gatewayUrl);

  // If already running on the same port, reuse
  if (activeControlServer && activePort === port) {
    return { url: settings.gatewayUrl, port };
  }

  if (activeControlServer) {
    await stopGateway();
  }

  try {
    const router = new McpCompositeRouter();
    const server = new McpControlServer(router, {
      port,
      host: "127.0.0.1",
      name: "paseo-mcp-gateway",
    });

    const info = await server.start();
    activeControlServer = server;
    activeRouter = router;
    activePort = info.port;

    log.info("MCP Gateway started", { url: info.url, port: info.port });
    return { url: info.url, port: info.port };
  } catch (err) {
    log.warn("Failed to start MCP Gateway on configured port", {
      port,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

export async function stopGateway(): Promise<void> {
  if (activeControlServer) {
    try {
      await activeControlServer.stop();
    } catch (err) {
      log.warn("Error stopping MCP Gateway", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    activeControlServer = undefined;
    activeRouter = undefined;
    activePort = undefined;
    log.info("MCP Gateway stopped");
  }
}

export function getGatewayServer(): McpControlServer | undefined {
  return activeControlServer;
}

export function getGatewayRouter(): McpCompositeRouter | undefined {
  return activeRouter;
}
