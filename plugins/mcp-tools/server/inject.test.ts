import { describe, expect, it } from "vitest";
import { GATEWAY_SERVER_NAME, injectGatewayIntoCreateRequest } from "./inject";

function baseRequest() {
  return {
    config: {
      provider: "antigravity-acp",
      mcpServers: {
        direct: { type: "http", url: "http://localhost:9999/mcp" },
      },
    },
  } as never;
}

describe("gateway injection into agent.create", () => {
  it("adds the gateway entry and preserves existing servers", () => {
    const out = injectGatewayIntoCreateRequest(baseRequest(), {
      enabled: true,
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out).toBeDefined();
    expect(out?.config.mcpServers?.[GATEWAY_SERVER_NAME]).toEqual({
      type: "http",
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out?.config.mcpServers?.direct).toBeDefined();
  });

  it("keeps the request when injection is disabled", () => {
    expect(
      injectGatewayIntoCreateRequest(baseRequest(), { enabled: false, url: "http://x/mcp" }),
    ).toBeUndefined();
  });

  it("keeps the request when a gateway entry already exists", () => {
    const req = baseRequest() as { config: { provider: string; mcpServers: Record<string, unknown> } };
    req.config.mcpServers[GATEWAY_SERVER_NAME] = { type: "http", url: "http://custom/mcp" };
    const out = injectGatewayIntoCreateRequest(req as never, {
      enabled: true,
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out).toBeUndefined();
  });

  it("keeps the request when no url is configured", () => {
    expect(
      injectGatewayIntoCreateRequest(baseRequest(), { enabled: true, url: "" }),
    ).toBeUndefined();
  });

  it("appends manual configuration guidance to systemPrompt for providers lacking runtime MCP injection", () => {
    const out = injectGatewayIntoCreateRequest(baseRequest(), {
      enabled: true,
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out?.config.systemPrompt).toContain("[MCP Injection Notice]");
    expect(out?.config.systemPrompt).toContain("antigravity-acp");
    expect(out?.config.systemPrompt).toContain("mcp_config.json");
    expect(out?.config.systemPrompt).toContain('"gateway"');
  });

  it("does not append warning prompt for providers that support runtime MCP injection", () => {
    const req = {
      config: {
        provider: "claude",
        systemPrompt: "You are a helpful coding assistant.",
        mcpServers: {},
      },
    } as never;
    const out = injectGatewayIntoCreateRequest(req, {
      enabled: true,
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out?.config.mcpServers?.[GATEWAY_SERVER_NAME]).toBeDefined();
    expect(out?.config.systemPrompt).toBe("You are a helpful coding assistant.");
    expect(out?.config.systemPrompt).not.toContain("[MCP Injection Notice]");
  });

  it("does not duplicate warning if already present in systemPrompt", () => {
    const req = {
      config: {
        provider: "antigravity",
        systemPrompt: "Existing prompt\n\n[MCP Injection Notice]\nAlready warned",
        mcpServers: {},
      },
    } as never;
    const out = injectGatewayIntoCreateRequest(req, {
      enabled: true,
      url: "http://127.0.0.1:37374/mcp",
    });
    expect(out?.config.systemPrompt).toBe("Existing prompt\n\n[MCP Injection Notice]\nAlready warned");
  });
});
