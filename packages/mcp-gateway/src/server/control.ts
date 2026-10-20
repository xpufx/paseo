import http from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { McpCompositeRouter } from "./router.js";
import { McpServerConfigSchema } from "../shared/schemas.js";
import type {
  McpGatewayServerOptions,
  McpGatewayMetrics,
} from "../shared/types.js";

export class McpControlServer {
  private router: McpCompositeRouter;
  private server?: http.Server;
  private activeTransports = new Map<string, SSEServerTransport>();
  private options: Required<McpGatewayServerOptions>;

  constructor(
    router?: McpCompositeRouter,
    options?: McpGatewayServerOptions
  ) {
    this.router = router || new McpCompositeRouter();
    this.options = {
      port: options?.port ?? 37374,
      host: options?.host ?? "127.0.0.1",
      cors: options?.cors ?? true,
      name: options?.name ?? "mcp-gateway",
      version: options?.version ?? "0.1.0",
    };
  }

  getRouter(): McpCompositeRouter {
    return this.router;
  }

  getMetrics(): McpGatewayMetrics {
    return this.router.getMetrics(this.activeTransports.size);
  }

  /**
   * Starts the HTTP and MCP SSE server.
   */
  async start(
    overrides?: Partial<McpGatewayServerOptions>
  ): Promise<{ port: number; host: string; url: string }> {
    const port = overrides?.port ?? this.options.port;
    const host = overrides?.host ?? this.options.host;

    return new Promise((resolve, reject) => {
      const httpServer = http.createServer(async (req, res) => {
        try {
          await this.handleHttpRequest(req, res);
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              })
            );
          }
        }
      });

      httpServer.on("error", reject);

      httpServer.listen(port, host, () => {
        this.server = httpServer;
        const address = httpServer.address();
        const actualPort =
          typeof address === "object" && address ? address.port : port;
        const actualHost =
          typeof address === "object" && address ? address.address : host;
        const url = `http://${actualHost}:${actualPort}`;

        resolve({ port: actualPort, host: actualHost, url });
      });
    });
  }

  /**
   * Gracefully stops the HTTP server, closes active transports and upstream clients.
   */
  async stop(): Promise<void> {
    for (const transport of this.activeTransports.values()) {
      try {
        await transport.close();
      } catch {
        // ignore
      }
    }
    this.activeTransports.clear();

    await this.router.close();

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }
  }

  private async handleHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const rawUrl = req.url || "/";
    const hostHeader = req.headers.host || "127.0.0.1";
    const parsedUrl = new URL(rawUrl, `http://${hostHeader}`);
    const pathname = parsedUrl.pathname;
    const method = req.method?.toUpperCase() || "GET";

    if (this.options.cors) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      );
    }

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. MCP SSE Transport initiation: GET /sse or GET /mcp
    if (method === "GET" && (pathname === "/sse" || pathname === "/mcp")) {
      await this.handleSseConnect(req, res);
      return;
    }

    // 2. MCP JSON-RPC message delivery: POST /messages or POST /mcp (with sessionId)
    if (
      method === "POST" &&
      (pathname === "/messages" ||
        pathname === "/mcp/messages" ||
        (pathname === "/mcp" && parsedUrl.searchParams.has("sessionId")))
    ) {
      await this.handlePostMessage(req, res, parsedUrl);
      return;
    }

    // 3. REST Control Plane API
    if (pathname.startsWith("/api/")) {
      await this.handleRestApi(req, res, pathname, method, parsedUrl);
      return;
    }

    // 4. Health Check / Root summary: GET / or GET /health
    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      const tools = await this.router.listAggregatedTools();
      const servers = this.router.listServers();
      this.sendJson(res, 200, {
        status: "ok",
        gateway: this.options.name,
        version: this.options.version,
        serversCount: servers.length,
        toolsCount: tools.length,
        activeSessions: this.activeTransports.size,
        uptimeSeconds: this.getMetrics().uptimeSeconds,
      });
      return;
    }

    // 404 fallback
    this.sendJson(res, 404, { error: `Not found: ${method} ${pathname}` });
  }

  private async handleSseConnect(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    this.activeTransports.set(sessionId, transport);

    transport.onclose = () => {
      this.activeTransports.delete(sessionId);
    };

    const mcpServer = new Server(
      {
        name: this.options.name,
        version: this.options.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = await this.router.listAggregatedTools();
      return { tools };
    });

    mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await this.router.callAggregatedTool(
        request.params.name,
        request.params.arguments || {}
      );
      return result;
    });

    await mcpServer.connect(transport);
  }

  private async handlePostMessage(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ): Promise<void> {
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      this.sendJson(res, 400, { error: "Missing sessionId query parameter" });
      return;
    }

    const transport = this.activeTransports.get(sessionId);
    if (!transport) {
      this.sendJson(res, 404, { error: `Session not found: ${sessionId}` });
      return;
    }

    await transport.handlePostMessage(req, res);
  }

  private async handleRestApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    method: string,
    _url: URL
  ): Promise<void> {
    // GET /api/servers
    if (method === "GET" && pathname === "/api/servers") {
      const servers = this.router.listServers();
      this.sendJson(res, 200, { servers });
      return;
    }

    // POST /api/servers
    if (method === "POST" && pathname === "/api/servers") {
      const bodyText = await this.readRequestBody(req);
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        this.sendJson(res, 400, { error: "Malformed JSON body" });
        return;
      }

      const validated = McpServerConfigSchema.safeParse(parsed);
      if (!validated.success) {
        this.sendJson(res, 400, {
          error: "Invalid server configuration",
          details: validated.error.format(),
        });
        return;
      }

      const info = await this.router.addServer(validated.data);
      this.sendJson(res, 201, { server: info });
      return;
    }

    // DELETE /api/servers/:name
    const deleteMatch = pathname.match(/^\/api\/servers\/([^/]+)$/);
    if (method === "DELETE" && deleteMatch) {
      const serverName = decodeURIComponent(deleteMatch[1]!);
      const removed = await this.router.removeServer(serverName);
      if (removed) {
        this.sendJson(res, 200, { ok: true, removed: serverName });
      } else {
        this.sendJson(res, 404, { error: `Server not found: ${serverName}` });
      }
      return;
    }

    // GET /api/tools
    if (method === "GET" && pathname === "/api/tools") {
      const tools = await this.router.listAggregatedTools();
      this.sendJson(res, 200, { tools });
      return;
    }

    // GET /api/metrics
    if (method === "GET" && pathname === "/api/metrics") {
      const metrics = this.getMetrics();
      this.sendJson(res, 200, { metrics });
      return;
    }

    this.sendJson(res, 404, { error: `Unknown API endpoint: ${method} ${pathname}` });
  }

  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    payload: unknown
  ): void {
    if (res.headersSent) return;
    res.writeHead(statusCode, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  }
}
