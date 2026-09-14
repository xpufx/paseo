import { describe, it, expect } from "vitest";
import {
  registerMcpInjection,
  type AgentCreateInjectionRequest,
  type McpInjectionHookHandler,
  type McpInjectionServer,
} from "../server/mcp-injection.js";

interface StubServer extends McpInjectionServer {
  hooks: Map<string, McpInjectionHookHandler>;
  hookCalls: Array<{ name: string; handler: McpInjectionHookHandler }>;
}

function createStubServer(): StubServer {
  const hooks = new Map<string, McpInjectionHookHandler>();
  const hookCalls: Array<{ name: string; handler: McpInjectionHookHandler }> = [];
  return {
    hooks,
    hookCalls,
    before(name: string, handler: McpInjectionHookHandler): () => void {
      hooks.set(name, handler);
      hookCalls.push({ name, handler });
      return () => {
        if (hooks.get(name) === handler) hooks.delete(name);
      };
    },
  };
}

const stdioEntry = {
  type: "stdio" as const,
  command: "node",
  args: ["x-comms-mcp.js"],
  env: { X_COMMS_HOME: "daemon-1" },
};

describe("registerMcpInjection", () => {
  it("registers an agent.create before-hook and merges the entry over existing servers", () => {
    const server = createStubServer();
    registerMcpInjection(server, { serverName: "x-comms", config: stdioEntry });
    expect(server.hookCalls).toHaveLength(1);
    expect(server.hookCalls[0].name).toBe("agent.create");

    const request: AgentCreateInjectionRequest = {
      config: {
        provider: "claude",
        cwd: "/work",
        mcpServers: {
          userServer: { type: "http" as const, url: "http://localhost:9000/mcp" },
        },
      },
    };
    const result = server.hooks.get("agent.create")!({ request }) as AgentCreateInjectionRequest;
    expect(result.config.mcpServers?.["userServer"]).toEqual({
      type: "http",
      url: "http://localhost:9000/mcp",
    });
    expect(result.config.mcpServers?.["x-comms"]).toEqual(stdioEntry);
    expect(result.config.provider).toBe("claude");
  });

  it("creates mcpServers when the request has none", () => {
    const server = createStubServer();
    registerMcpInjection(server, { serverName: "x-comms", config: stdioEntry });
    const request: AgentCreateInjectionRequest = { config: { provider: "claude", cwd: "/w" } };
    const result = server.hooks.get("agent.create")!({ request }) as AgentCreateInjectionRequest;
    expect(result.config.mcpServers).toEqual({ "x-comms": stdioEntry });
  });

  it("applies to every agent when no filter is given, and gates when one is", () => {
    const server = createStubServer();
    registerMcpInjection(server, {
      serverName: "x-comms",
      config: stdioEntry,
      filter: ({ request }) => request.config["provider"] === "claude",
    });
    const handler = server.hooks.get("agent.create")!;
    const allowed = handler({
      request: { config: { provider: "claude", cwd: "/w" } },
    }) as AgentCreateInjectionRequest;
    expect(allowed.config.mcpServers?.["x-comms"]).toEqual(stdioEntry);
    const denied = handler({ request: { config: { provider: "other", cwd: "/w" } } });
    expect(denied).toBeUndefined();
  });

  it("never mutates the incoming request object", () => {
    const server = createStubServer();
    registerMcpInjection(server, { serverName: "x-comms", config: stdioEntry });
    const request: AgentCreateInjectionRequest = {
      config: {
        provider: "claude",
        cwd: "/w",
        mcpServers: { userServer: { type: "http" as const, url: "http://localhost:9/mcp" } },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(request));
    server.hooks.get("agent.create")!({ request });
    expect(request).toEqual(snapshot);
  });

  it("returns a remover that unregisters the hook", () => {
    const server = createStubServer();
    const remove = registerMcpInjection(server, { serverName: "x-comms", config: stdioEntry });
    expect(server.hooks.has("agent.create")).toBe(true);
    remove();
    expect(server.hooks.has("agent.create")).toBe(false);
  });
});
