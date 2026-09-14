import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { McpClient } from "../mcp/client.js";

describe("McpHttpClient (HTTP / Streamable transport)", () => {
  let server: http.Server;
  let serverUrl: string;

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      if (req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk;
        });

        req.on("end", () => {
          try {
            const msg = JSON.parse(body);
            let result: any = {};

            if (msg.method === "initialize") {
              res.setHeader("Mcp-Session-Id", "session-xyz-123");
              result = {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "remote-http-server", version: "1.0.0" },
                instructions: "Remote prompt instructions.",
              };
            } else {
              // Ensure session header is propagated on non-init calls
              if (req.headers["mcp-session-id"] !== "session-xyz-123") {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { message: "Missing session ID" } }));
                return;
              }

              if (msg.method === "ping") {
                result = {};
              } else if (msg.method === "tools/list") {
                result = {
                  tools: [{ name: "http_tool", description: "An HTTP-based tool" }],
                };
              } else if (msg.method === "tools/call") {
                result = {
                  content: [{ type: "text", text: `Invoked ${msg.params?.name}` }],
                };
              }
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }));
          } catch (err: any) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { message: err.message } }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        serverUrl = `http://127.0.0.1:${addr.port}/mcp`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("performs handshake, retrieves instructions, pings, lists tools, and calls tools", async () => {
    const client = McpClient.forHttp(serverUrl);

    const ping = await client.ping();
    expect(ping.healthy).toBe(true);
    expect(ping.serverInfo?.name).toBe("remote-http-server");
    expect(ping.instructions).toBe("Remote prompt instructions.");

    expect(client.instructions).toBe("Remote prompt instructions.");
    expect(client.protocolVersion).toBe("2024-11-05");

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("http_tool");

    const callResult = await client.callTool("http_tool", { param: "value" });
    expect(callResult.content[0].text).toBe("Invoked http_tool");

    await client.close();
  });
});
