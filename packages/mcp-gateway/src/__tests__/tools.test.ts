import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  ToolRegistry,
  registerAgentSession,
  revokeAgentSession,
  requireAgentSession,
  _clearAllSessions,
} from "../server/tools.js";
import {
  TICKET_TOOLS,
  FLEET_TOOLS,
  ALL_MCP_TOOLS,
  TicketListInputSchema,
  TicketViewInputSchema,
  TicketCreateInputSchema,
  TicketCommentInputSchema,
  TicketEditInputSchema,
  FleetStatusInputSchema,
  FleetQueueInspectInputSchema,
} from "../shared/tools.js";

describe("Typed MCP Tool Schemas", () => {
  it("defines all ticket tool schemas", () => {
    const names = TICKET_TOOLS.map((t) => t.name);
    expect(names).toContain("ticket_list");
    expect(names).toContain("ticket_view");
    expect(names).toContain("ticket_create");
    expect(names).toContain("ticket_comment");
    expect(names).toContain("ticket_edit");
    expect(TICKET_TOOLS.length).toBe(5);
  });

  it("defines all fleet tool schemas", () => {
    const names = FLEET_TOOLS.map((t) => t.name);
    expect(names).toContain("fleet_status");
    expect(names).toContain("fleet_queue_inspect");
    expect(FLEET_TOOLS.length).toBe(2);
  });

  it("ALL_MCP_TOOLS contains all 7 tools", () => {
    expect(ALL_MCP_TOOLS.length).toBe(7);
  });

  it("validates ticket_list input", () => {
    const valid = TicketListInputSchema.parse({ page: 2 });
    expect(valid.page).toBe(2);

    const withDirectory = TicketListInputSchema.parse({ directory: "/work/app", remoteUrl: "https://example.com/repo.git" });
    expect(withDirectory.directory).toBe("/work/app");
  });

  it("rejects invalid ticket_list input", () => {
    const result = TicketListInputSchema.safeParse({ page: -1 });
    expect(result.success).toBe(false);
  });

  it("validates ticket_view input", () => {
    const valid = TicketViewInputSchema.parse({ issueNumber: 42 });
    expect(valid.issueNumber).toBe(42);
  });

  it("rejects ticket_view without issueNumber", () => {
    const result = TicketViewInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("validates ticket_create input", () => {
    const valid = TicketCreateInputSchema.parse({ title: "New feature" });
    expect(valid.title).toBe("New feature");
    expect(valid.body).toBe("");
    expect(valid.labels).toEqual([]);
  });

  it("rejects empty ticket_create title", () => {
    const result = TicketCreateInputSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("validates ticket_comment input", () => {
    const valid = TicketCommentInputSchema.parse({ issueNumber: 10, body: "Nice work!" });
    expect(valid.issueNumber).toBe(10);
  });

  it("rejects ticket_comment with empty body", () => {
    const result = TicketCommentInputSchema.safeParse({ issueNumber: 10, body: "" });
    expect(result.success).toBe(false);
  });

  it("validates ticket_edit input", () => {
    const valid = TicketEditInputSchema.parse({ issueNumber: 5, label: "state/wip" });
    expect(valid.label).toBe("state/wip");
  });

  it("rejects ticket_edit with empty label", () => {
    const result = TicketEditInputSchema.safeParse({ issueNumber: 5, label: "" });
    expect(result.success).toBe(false);
  });

  it("validates fleet_status empty input", () => {
    const parsed = FleetStatusInputSchema.parse(undefined);
    expect(parsed).toEqual({});
  });

  it("validates fleet_queue_inspect empty input", () => {
    const parsed = FleetQueueInspectInputSchema.parse(undefined);
    expect(parsed).toEqual({});
  });
});

describe("Session Gating", () => {
  beforeEach(() => {
    _clearAllSessions();
  });

  afterEach(() => {
    _clearAllSessions();
  });

  it("registers a new session and returns true", () => {
    const result = registerAgentSession("sess-1", "agent-abc");
    expect(result).toBe(true);
  });

  it("requires a valid session and returns agentId", () => {
    registerAgentSession("sess-2", "agent-def");
    const agentId = requireAgentSession("sess-2");
    expect(agentId).toBe("agent-def");
  });

  it("rejects missing sessionId", () => {
    const result = requireAgentSession(undefined);
    expect(result).toBeNull();
  });

  it("rejects unknown sessionId", () => {
    const result = requireAgentSession("nonexistent");
    expect(result).toBeNull();
  });

  it("revokes a session", () => {
    registerAgentSession("sess-3", "agent-ghi");
    revokeAgentSession("sess-3");
    const result = requireAgentSession("sess-3");
    expect(result).toBeNull();
  });

  it("refreshes TTL on each require call", () => {
    registerAgentSession("sess-4", "agent-jkl");
    // First call should succeed
    const first = requireAgentSession("sess-4");
    expect(first).toBe("agent-jkl");
    // Second call should also succeed (TTL refreshed)
    const second = requireAgentSession("sess-4");
    expect(second).toBe("agent-jkl");
  });
});

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    _clearAllSessions();
    registry = new ToolRegistry({ sessionTtlMs: 60_000 });
  });

  afterEach(() => {
    _clearAllSessions();
  });

  it("returns all typed tool definitions", () => {
    const tools = registry.getTools();
    expect(tools.length).toBe(7);
    const names = tools.map((t) => t.name);
    for (const expected of ["ticket_list", "ticket_view", "ticket_create", "ticket_comment", "ticket_edit", "fleet_status", "fleet_queue_inspect"]) {
      expect(names).toContain(expected);
    }
  });

  it("each tool has required fields", () => {
    const tools = registry.getTools();
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
    }
  });

  it("rejects tool calls without session", async () => {
    const result = await registry.callTool("ticket_list", {}, undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Session validation failed");
  });

  it("rejects tool calls with invalid session", async () => {
    const result = await registry.callTool("ticket_list", {}, "nonexistent");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Session validation failed");
  });

  it("accepts tool calls with valid session", async () => {
    registerAgentSession("test-sess", "test-agent");
    const result = await registry.callTool("ticket_list", { page: 1 }, "test-sess");
    // Handlers return default/error responses since no real forge backend is connected
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("rejects unknown tool name", async () => {
    registerAgentSession("test-sess-2", "test-agent-2");
    const result = await registry.callTool("unknown_tool", {}, "test-sess-2");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });

  it("rejects invalid input for ticket_list", async () => {
    registerAgentSession("test-sess-3", "test-agent-3");
    const result = await registry.callTool("ticket_list", { page: -5 }, "test-sess-3");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid ticket_list input");
  });

  it("rejects invalid input for ticket_view", async () => {
    registerAgentSession("test-sess-4", "test-agent-4");
    const result = await registry.callTool("ticket_view", { issueNumber: "not-a-number" }, "test-sess-4");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid ticket_view input");
  });

  it("rejects invalid input for ticket_create", async () => {
    registerAgentSession("test-sess-5", "test-agent-5");
    const result = await registry.callTool("ticket_create", { title: "" }, "test-sess-5");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid ticket_create input");
  });

  it("rejects invalid input for ticket_comment", async () => {
    registerAgentSession("test-sess-6", "test-agent-6");
    const result = await registry.callTool("ticket_comment", { issueNumber: 1, body: "" }, "test-sess-6");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid ticket_comment input");
  });

  it("rejects invalid input for ticket_edit", async () => {
    registerAgentSession("test-sess-7", "test-agent-7");
    const result = await registry.callTool("ticket_edit", { issueNumber: 1, label: "" }, "test-sess-7");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid ticket_edit input");
  });

  it("handles fleet_status with valid session", async () => {
    registerAgentSession("test-sess-fleet", "test-agent-fleet");
    const result = await registry.callTool("fleet_status", {}, "test-sess-fleet");
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("handles fleet_queue_inspect with valid session", async () => {
    registerAgentSession("test-sess-queue", "test-agent-queue");
    const result = await registry.callTool("fleet_queue_inspect", {}, "test-sess-queue");
    expect(result.ok).toBe(true);
    expect(result.result).toBeDefined();
  });

  it("tracks session count", () => {
    expect(registry.getSessionCount()).toBe(0);
    registerAgentSession("sess-a", "agent-a");
    registerAgentSession("sess-b", "agent-b");
    expect(registry.getSessionCount()).toBe(2);
    revokeAgentSession("sess-a");
    expect(registry.getSessionCount()).toBe(1);
  });

  it("refreshes session TTL on repeated calls", async () => {
    registerAgentSession("ttl-test", "ttl-agent");
    const r1 = await registry.callTool("ticket_list", {}, "ttl-test");
    expect(r1.ok).toBe(true);
    // Should still be valid after refresh
    const r2 = await registry.callTool("ticket_list", {}, "ttl-test");
    expect(r2.ok).toBe(true);
  });
});

describe("McpControlServer Integration with Typed Tools", () => {
  let router: any;
  let controlServer: any;
  let baseUrl: string;

  beforeEach(async () => {
    _clearAllSessions();
    const { McpCompositeRouter } = await import("../server/router.js");
    const { McpControlServer } = await import("../server/control.js");
    router = new McpCompositeRouter();

    const control = new McpControlServer(router, { port: 0 });
    const address = await control.start();
    baseUrl = address.url;
    controlServer = control;
  });

  afterEach(async () => {
    await controlServer.stop();
    await router.close();
    _clearAllSessions();
  });

  it("exposes /api/typed-tools endpoint", async () => {
    const res = await fetch(`${baseUrl}/api/typed-tools`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.length).toBeGreaterThanOrEqual(7);
    const names = data.tools.map((t: any) => t.name);
    expect(names).toContain("ticket_list");
    expect(names).toContain("fleet_status");
  });

  it("exposes /api/tools/call endpoint", async () => {
    // Without session — should fail
    const res = await fetch(`${baseUrl}/api/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ticket_list", args: {} }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it("exposes /api/sessions/register endpoint", async () => {
    const res = await fetch(`${baseUrl}/api/sessions/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "reg-test", agentId: "reg-agent" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.sessionId).toBe("reg-test");
  });

  it("full round-trip: register session → call tool", async () => {
    // Register session
    await fetch(`${baseUrl}/api/sessions/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "rt-sess", agentId: "rt-agent" }),
    });

    // Call tool with session
    const callRes = await fetch(`${baseUrl}/api/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "ticket_list",
        args: { page: 1 },
        sessionId: "rt-sess",
      }),
    });
    expect(callRes.status).toBe(200);
    const callData = await callRes.json();
    expect(callData.ok).toBe(true);
  });

  it("health check still works alongside typed tools", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.gateway).toBe("mcp-gateway");
  });

  it("GET /api/tools still returns upstream tools", async () => {
    const res = await fetch(`${baseUrl}/api/tools`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.length).toBeGreaterThanOrEqual(0);
  });
});
