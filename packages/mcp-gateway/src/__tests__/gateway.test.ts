import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { McpCompositeRouter } from "../server/router.js";
import { McpControlServer } from "../server/control.js";
import {
  normalizeGatewayBaseUrl,
  fetchGatewayStatus,
  fetchGatewayServers,
  fetchGatewayTools,
  fetchGatewayMetrics,
} from "../client/index.js";

describe("@xpufx/mcp-gateway", () => {
  describe("McpCompositeRouter", () => {
    let router: McpCompositeRouter;

    beforeEach(() => {
      router = new McpCompositeRouter();
    });

    afterEach(async () => {
      await router.close();
    });

    it("aggregates tools across multiple upstream servers", async () => {
      // Mock Server 1: Git
      const [clientTransport1, serverTransport1] =
        InMemoryTransport.createLinkedPair();
      const server1 = new Server(
        { name: "mock-git", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      server1.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "git_status",
            description: "Shows git status",
            inputSchema: { type: "object" },
          },
          {
            name: "git_log",
            description: "Shows git commit log",
            inputSchema: { type: "object" },
          },
        ],
      }));
      server1.setRequestHandler(CallToolRequestSchema, async (req) => ({
        content: [{ type: "text", text: `git result for ${req.params.name}` }],
      }));
      await server1.connect(serverTransport1);

      // Mock Server 2: FS
      const [clientTransport2, serverTransport2] =
        InMemoryTransport.createLinkedPair();
      const server2 = new Server(
        { name: "mock-fs", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      server2.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "read_file",
            description: "Reads file content",
            inputSchema: { type: "object" },
          },
        ],
      }));
      server2.setRequestHandler(CallToolRequestSchema, async (req) => ({
        content: [{ type: "text", text: `fs result for ${req.params.name}` }],
      }));
      await server2.connect(serverTransport2);

      // Add both servers to router
      const info1 = await router.addServer(
        { name: "git", transport: "stdio", command: "git" },
        clientTransport1
      );
      expect(info1.status).toBe("connected");
      expect(info1.toolCount).toBe(2);

      const info2 = await router.addServer(
        { name: "fs", transport: "stdio", command: "fs" },
        clientTransport2
      );
      expect(info2.status).toBe("connected");
      expect(info2.toolCount).toBe(1);

      // Verify aggregated tools list
      const tools = await router.listAggregatedTools();
      expect(tools.length).toBe(3);
      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(["git_log", "git_status", "read_file"]);

      // Verify routing tool calls
      const call1 = await router.callAggregatedTool("git_status", { foo: "bar" });
      expect(call1.content).toEqual([
        { type: "text", text: "git result for git_status" },
      ]);

      const call2 = await router.callAggregatedTool("read_file", { path: "a.txt" });
      expect(call2.content).toEqual([
        { type: "text", text: "fs result for read_file" },
      ]);

      // Verify non-existent tool
      const callNonExistent = await router.callAggregatedTool("unknown_tool");
      expect(callNonExistent.isError).toBe(true);

      // Verify metrics
      const metrics = router.getMetrics();
      expect(metrics.requestsTotal).toBeGreaterThanOrEqual(3);
      expect(metrics.toolCallsTotal).toBe(3);
      expect(metrics.toolCallsSuccess).toBe(2);
      expect(metrics.toolCallsFailed).toBe(1);
    });

    it("supports tool prefixing to avoid collisions", async () => {
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const server = new Server(
        { name: "mock-runner", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "execute",
            description: "Executes command",
            inputSchema: { type: "object" },
          },
        ],
      }));
      server.setRequestHandler(CallToolRequestSchema, async (req) => ({
        content: [{ type: "text", text: `ran ${req.params.name}` }],
      }));
      await server.connect(serverTransport);

      await router.addServer(
        {
          name: "runner",
          transport: "stdio",
          command: "runner",
          prefix: "dev",
        },
        clientTransport
      );

      const tools = await router.listAggregatedTools();
      expect(tools.length).toBe(1);
      expect(tools[0]!.name).toBe("dev_execute");

      const call = await router.callAggregatedTool("dev_execute", {});
      expect(call.content).toEqual([{ type: "text", text: "ran execute" }]);
    });

    it("dynamically removes servers and updates tool lists", async () => {
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const server = new Server(
        { name: "mock-temp", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [{ name: "temp_tool", inputSchema: { type: "object" } }],
      }));
      await server.connect(serverTransport);

      await router.addServer(
        { name: "temp", transport: "stdio", command: "temp" },
        clientTransport
      );
      expect((await router.listAggregatedTools()).length).toBe(1);

      const removed = await router.removeServer("temp");
      expect(removed).toBe(true);
      expect((await router.listAggregatedTools()).length).toBe(0);

      const removedAgain = await router.removeServer("temp");
      expect(removedAgain).toBe(false);
    });
  });

  describe("McpControlServer REST API", () => {
    let router: McpCompositeRouter;
    let controlServer: McpControlServer;
    let baseUrl: string;

    beforeEach(async () => {
      router = new McpCompositeRouter();

      // Add a test server to router
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const server = new Server(
        { name: "mock-echo", version: "1.0.0" },
        { capabilities: { tools: {} } }
      );
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: "echo",
            description: "Echoes input",
            inputSchema: { type: "object" },
          },
        ],
      }));
      await server.connect(serverTransport);
      await router.addServer(
        { name: "echo-server", transport: "stdio", command: "echo" },
        clientTransport
      );

      controlServer = new McpControlServer(router, { port: 0 });
      const address = await controlServer.start();
      baseUrl = address.url;
    });

    afterEach(async () => {
      await controlServer.stop();
    });

    it("serves health check on /health and /", async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("ok");
      expect(data.gateway).toBe("mcp-gateway");
      expect(data.serversCount).toBe(1);
      expect(data.toolsCount).toBe(1);

      const rootRes = await fetch(`${baseUrl}/`);
      expect(rootRes.status).toBe(200);
    });

    it("serves server list on GET /api/servers", async () => {
      const res = await fetch(`${baseUrl}/api/servers`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.servers.length).toBe(1);
      expect(data.servers[0].name).toBe("echo-server");
      expect(data.servers[0].status).toBe("connected");
      expect(data.servers[0].tools).toEqual(["echo"]);
    });

    it("serves aggregated tools list on GET /api/tools", async () => {
      const res = await fetch(`${baseUrl}/api/tools`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tools.length).toBe(1);
      expect(data.tools[0].name).toBe("echo");
    });

    it("serves metrics on GET /api/metrics", async () => {
      const res = await fetch(`${baseUrl}/api/metrics`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.metrics).toBeDefined();
      expect(typeof data.metrics.requestsTotal).toBe("number");
    });

    it("removes server via DELETE /api/servers/:name", async () => {
      const delRes = await fetch(`${baseUrl}/api/servers/echo-server`, {
        method: "DELETE",
      });
      expect(delRes.status).toBe(200);
      const delData = await delRes.json();
      expect(delData.ok).toBe(true);

      const listRes = await fetch(`${baseUrl}/api/servers`);
      const listData = await listRes.json();
      expect(listData.servers.length).toBe(0);
    });

    it("returns 404 for unknown endpoints", async () => {
      const res = await fetch(`${baseUrl}/api/unknown`);
      expect(res.status).toBe(404);
    });
  });

  describe("Client Utilities", () => {
    it("normalizes gateway base URL correctly", () => {
      expect(normalizeGatewayBaseUrl("http://127.0.0.1:37374/mcp")).toBe(
        "http://127.0.0.1:37374"
      );
      expect(normalizeGatewayBaseUrl("http://127.0.0.1:37374/sse")).toBe(
        "http://127.0.0.1:37374"
      );
      expect(normalizeGatewayBaseUrl("http://127.0.0.1:37374/")).toBe(
        "http://127.0.0.1:37374"
      );
      expect(normalizeGatewayBaseUrl("http://127.0.0.1:37374")).toBe(
        "http://127.0.0.1:37374"
      );
    });

    it("queries status, servers, tools, and metrics via client functions", async () => {
      const router = new McpCompositeRouter();
      const controlServer = new McpControlServer(router, { port: 0 });
      const address = await controlServer.start();

      try {
        const status = await fetchGatewayStatus(address.url);
        expect(status.status).toBe("ok");

        const servers = await fetchGatewayServers(address.url);
        expect(Array.isArray(servers)).toBe(true);

        const tools = await fetchGatewayTools(address.url);
        expect(Array.isArray(tools)).toBe(true);

        const metrics = await fetchGatewayMetrics(address.url);
        expect(metrics).toBeDefined();
        expect(typeof metrics.uptimeSeconds).toBe("number");
      } finally {
        await controlServer.stop();
      }
    });
  });
});
