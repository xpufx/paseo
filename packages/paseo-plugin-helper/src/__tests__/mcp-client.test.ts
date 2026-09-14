import { describe, it, expect } from "vitest";
import { StderrRingBuffer } from "../mcp/ring-buffer.js";
import { McpClient } from "../mcp/client.js";

describe("MCP Client & Ring Buffer", () => {
  it("buffers recent stderr lines without unbounded growth", () => {
    const buffer = new StderrRingBuffer(5);

    for (let i = 1; i <= 10; i++) {
      buffer.push(`Error line ${i}\n`);
    }

    const recent = buffer.getRecentLines();
    expect(recent).toHaveLength(5);
    expect(recent[0]).toBe("Error line 6");
    expect(recent[4]).toBe("Error line 10");
  });

  it("handles non-existent binary with clean ENOENT message", async () => {
    const client = McpClient.forStdio("this-binary-definitely-does-not-exist-12345");
    const ping = await client.ping({ timeoutMs: 1000 });

    expect(ping.healthy).toBe(false);
    expect(ping.error).toContain('Executable "this-binary-definitely-does-not-exist-12345" not found in PATH');
  });

  it("handles handshake and tools list with mock stdio server", async () => {
    // A tiny inline Node script that speaks MCP JSON-RPC
    const script = `
      process.stdin.on('data', (data) => {
        const lines = data.toString().split('\\n').filter(Boolean);
        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            if (msg.method === 'initialize') {
              process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  protocolVersion: '2024-11-05',
                  capabilities: { tools: {} },
                  serverInfo: { name: 'mock-mcp-server', version: '1.2.3' },
                  instructions: 'Always use test tools when available.'
                }
              }) + '\\n');
            } else if (msg.method === 'ping') {
              process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: {}
              }) + '\\n');
            } else if (msg.method === 'tools/list') {
              process.stdout.write(JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  tools: [{ name: 'test_tool', description: 'A test tool' }]
                }
              }) + '\\n');
            }
          } catch {}
        }
      });
    `;

    const client = McpClient.forStdio(process.execPath, ["-e", script]);

    const ping = await client.ping();
    expect(ping.healthy).toBe(true);
    expect(ping.serverInfo?.name).toBe("mock-mcp-server");
    expect(ping.instructions).toBe("Always use test tools when available.");
    expect(client.instructions).toBe("Always use test tools when available.");
    expect(client.protocolVersion).toBe("2024-11-05");

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("test_tool");

    await client.close();
  });
});
