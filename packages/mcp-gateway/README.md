# @xpufx/mcp-gateway

Headless composite MCP router and lightweight REST control server for Paseo.

## Features
- **Composite Routing**: Aggregates multiple downstream stdio, SSE, or in-memory MCP servers into a single multiplexed endpoint.
- **Official Protocol SDK**: Built strictly with `@modelcontextprotocol/sdk` and native `node:http`.
- **Zero Heavy Dependencies**: 0 native binaries, no embedded databases, pure in-memory proxying.
- **Decoupled REST API**: Exposes `/api/servers`, `/api/tools`, `/api/metrics`, and standard MCP SSE endpoint `/mcp` or `/sse`.
- **Hermes Bundle Compatibility**: `./client` exports pure web-standard fetch helpers with zero Node built-ins.

## Usage

```ts
import { McpCompositeRouter, McpControlServer } from "@xpufx/mcp-gateway/server";

const router = new McpCompositeRouter();
await router.addServer({
  name: "github",
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-github"],
});

const server = new McpControlServer(router, { port: 37374 });
await server.start();
console.log("MCP Gateway listening on http://127.0.0.1:37374");
```
