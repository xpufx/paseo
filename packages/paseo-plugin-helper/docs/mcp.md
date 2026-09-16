# MCP Module (`paseo-plugin-helper/mcp`)

The `mcp` module provides a zero-dependency Model Context Protocol (MCP) client designed specifically for Paseo plugins. It talks to MCP servers over stdio, HTTP (Streamable HTTP), and Server-Sent Events (SSE) without requiring `@modelcontextprotocol/sdk` or heavy external dependencies.

It includes built-in defenses for common real-world desktop failure modes:
1. Non-JSON stdout line filtering (e.g. startup banners, Python deprecation warnings).
2. Stderr circular ring buffering (preventing memory leaks while capturing diagnostic logs).
3. Cross-platform process tree killing (handling `taskkill /T /F` on Windows and process group `-pid` on POSIX).
4. Fallback ping mechanism (falling back to handshake verification if a server returns `-32601 Method not found`).
5. Native HTTP and SSE support without third-party transport packages.

---

## 1. Quick Examples

### Stdio Client
```ts
import { McpClient } from "paseo-plugin-helper/mcp";

// Connect to a local or bundled MCP server via stdio
const client = McpClient.forStdio("node", ["./dist/mcp-server.js"]);

// Check health
const ping = await client.ping({ mode: "tools" });
if (!ping.healthy) {
  console.error(`MCP server unhealthy: ${ping.error}\nRecent stderr:\n${ping.stderr}`);
} else {
  console.log(`MCP server online. Latency: ${ping.latencyMs}ms`);
  console.log("Instructions:", client.instructions);

  // Enumerate tools
  const tools = await client.listTools();
  console.log("Tools:", tools.map((t) => t.name));

  // Call a tool
  const result = await client.callTool("read_query", { query: "SELECT count(*) FROM users" });
  console.log("Result:", result.content);
}

// Cleanly terminate child process and descendants
await client.close();
```

### HTTP / SSE Client
```ts
// Connect to a remote or daemon MCP server via HTTP / SSE
const httpClient = McpClient.forHttp("http://localhost:8000/sse", {
  headers: { Authorization: "Bearer sk-secret" },
});

const health = await httpClient.ping();
console.log(`HTTP Server status: ${health.healthy ? "online" : "offline"}`);
console.log("Instructions:", httpClient.instructions);

await httpClient.close();
```

---

## 2. API Reference

### `McpClient.forStdio(command, args?, env?, options?)`
Creates an `McpClient` instance that manages a spawned subprocess.

- `command` (`string`): The executable to spawn (e.g. `"npx"`, `"uvx"`, `"python"`).
- `args` (`string[]`, optional): Command line arguments.
- `env` (`Record<string, string>`, optional): Environment variables to merge with `process.env`.
- `options` (`McpClientOptions`, optional):
  - `timeoutMs` (`number`, default: `10000`): Default timeout for requests.
  - `clientInfo` (`{ name: string; version: string }`): Client identification reported during handshake.

### `McpClient.forHttp(url, options?)`
Creates an `McpHttpClient` connecting to an MCP endpoint over Streamable HTTP or Server-Sent Events (SSE).
- `url` (`string`): Target URL (e.g. `http://localhost:8000/mcp` or `http://localhost:8000/sse`).
- `options` (`McpHttpOptions`, optional):
  - `headers` (`Record<string, string>`): Custom headers such as Bearer tokens or API keys.
  - `timeoutMs` (`number`, default: `10000`): Request timeout.

### Server Metadata Accessors
- `client.instructions`: Optional server system prompt guidance returned in `InitializeResult`.
- `client.serverInfo`: Server name and version.
- `client.capabilities`: Server capability flags.
- `client.protocolVersion`: Negotiated protocol version string.

### `client.initialize()`
Performs the MCP handshake (`initialize` request followed by `notifications/initialized`).
Called automatically by `ping()`, `listTools()`, and `callTool()`.

### `client.ping(options?)`
Tests server reachability and responsiveness.
- `options.mode`: `"protocol"` (default) issues standard MCP `ping`; `"tools"` issues `tools/list` to verify tool backend readiness.
- `options.timeoutMs`: Override timeout for the ping.

Returns `Promise<McpPingResult>`:
```ts
export interface McpPingResult {
  healthy: boolean;
  latencyMs: number;
  serverInfo?: { name: string; version?: string };
  error?: string;
  stderr?: string; // Recent lines from stderr ring buffer
}
```

### `client.listTools()`
Queries the server for registered tools using the `tools/list` protocol method.
Returns `Promise<McpToolInfo[]>`:
```ts
export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
```

### `client.callTool(name, args)`
Executes a tool on the server via `tools/call`.
- `name` (`string`): Name of the tool to execute.
- `args` (`Record<string, unknown>`): Arguments matching the tool's input schema.

Returns `Promise<McpToolCallResult>`:
```ts
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
```

### `client.getStderr()`
Returns the recent text captured in the circular stderr buffer.

### `client.close()`
Terminates the spawned process and all descendant processes using `killProcessTree()`, rejects all pending requests, and releases resources.

---

## 3. Subprocess Utilities

### `killProcessTree(child, timeoutMs?)`
Cross-platform helper to terminate a child process and all its descendants.
- On Windows: Uses `taskkill /pid <PID> /T /F`.
- On POSIX: Signals the process group (`process.kill(-pid, "SIGTERM")`), escalating to `SIGKILL` if still alive after `timeoutMs`.

### `StderrRingBuffer`
A fixed-capacity in-memory buffer that retains the last `N` lines of stderr (default: 25) without unbounded memory growth.
```ts
import { StderrRingBuffer } from "paseo-plugin-helper/mcp";

const buffer = new StderrRingBuffer(30);
buffer.push("Log output\nWarning line\n");
const text = buffer.getRecentText();
```
