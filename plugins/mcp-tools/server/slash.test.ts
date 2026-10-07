import { describe, expect, it, vi } from "vitest";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { createMcpSlashHandler } from "./mcp";

describe("createMcpSlashHandler", () => {
  function makeMockContext(options?: { appendError?: boolean; refreshError?: boolean }) {
    const timelineAppend = vi.fn().mockImplementation(async () => {
      if (options?.appendError) {
        throw new Error("Append failed");
      }
      return undefined;
    });

    const context: PluginHandlerContext = {
      paseo: {
        agents: {
          ref: vi.fn().mockReturnValue({
            timeline: { append: timelineAppend },
            refresh: vi.fn().mockImplementation(async () => {
              if (options?.refreshError) {
                throw new Error("Agent database unavailable");
              }
              return {
                agent: { provider: "mock-provider", cwd: "/workspace" },
              };
            }),
            current: vi.fn().mockReturnValue({
              provider: "mock-provider",
              cwd: "/workspace",
            }),
          }),
        },
      },
    } as unknown as PluginHandlerContext;

    return { context, timelineAppend };
  }

  it("handles 'probe' and appends mcp-slash-result to agent timeline", async () => {
    const { context, timelineAppend } = makeMockContext();
    const handler = createMcpSlashHandler();
    const result = await handler({ agentId: "agent-1", args: "probe" }, context);

    expect(result.ok).toBe(true);
    expect(result.title).toBe("MCP probe");
    expect(result.body).toContain("server(s) via mock-provider:");

    expect(context.paseo.agents.ref).toHaveBeenCalledWith("agent-1");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
    expect(timelineAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plugin",
        kind: "mcp-slash-result",
        version: 1,
        data: {
          title: "MCP probe",
          body: result.body,
        },
      }),
    );
  });

  it("handles bare empty args as probe and appends result", async () => {
    const { context, timelineAppend } = makeMockContext();
    const handler = createMcpSlashHandler();
    const result = await handler({ agentId: "agent-1", args: "" }, context);

    expect(result.ok).toBe(true);
    expect(result.title).toBe("MCP probe");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
    expect(timelineAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "mcp-slash-result",
        data: expect.objectContaining({
          title: "MCP probe",
          body: result.body,
        }),
      }),
    );
  });

  it("handles 'health' and appends mcp-health-digest to agent timeline", async () => {
    const { context, timelineAppend } = makeMockContext();
    const handler = createMcpSlashHandler();
    const result = await handler({ agentId: "agent-1", args: "health" }, context);

    expect(result.ok).toBe(true);
    expect(result.title).toBe("MCP health");

    expect(timelineAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plugin",
        kind: "mcp-health-digest",
        version: 1,
        data: expect.objectContaining({
          healthy: expect.any(Number),
          total: expect.any(Number),
        }),
      }),
    );
  });

  it("handles 'run' usage errors gracefully and appends usage help", async () => {
    const { context, timelineAppend } = makeMockContext();
    const handler = createMcpSlashHandler();
    const result = await handler({ agentId: "agent-1", args: "run" }, context);

    expect(result.ok).toBe(false);
    expect(result.title).toBe("MCP run");
    expect(result.body).toContain("Usage: /mcp run <server> <tool> [json-args]");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
  });

  it("handles 'run' invalid JSON arguments gracefully", async () => {
    const { context, timelineAppend } = makeMockContext();
    const handler = createMcpSlashHandler();
    // "session:paseo" matches the discovered builtin server ID
    const result = await handler({ agentId: "agent-1", args: "run session:paseo create_agent not-json" }, context);

    expect(result.ok).toBe(false);
    expect(result.title).toBe("MCP run");
    expect(result.body).toBe("Arguments must be a JSON object.");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
  });

  it("handles unknown subcommands by appending usage", async () => {
    const { context, timelineAppend } = makeMockContext();
    const handler = createMcpSlashHandler();
    const result = await handler({ agentId: "agent-1", args: "invalid-sub" }, context);

    expect(result.ok).toBe(false);
    expect(result.title).toBe("MCP");
    expect(result.body).toContain("Usage: /mcp [probe|health [server]|run server tool [json-args]]");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
  });

  it("handles unexpected handler exceptions without throwing unhandled rejection", async () => {
    const { context, timelineAppend } = makeMockContext({ refreshError: true });

    const handler = createMcpSlashHandler();
    const result = await handler({ agentId: "agent-1", args: "probe" }, context);

    expect(result.ok).toBe(false);
    expect(result.title).toBe("MCP error");
    expect(result.body).toBe("Agent database unavailable");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
  });

  it("tolerates timeline.append rejection without secondary failure", async () => {
    const { context } = makeMockContext({ appendError: true });

    const handler = createMcpSlashHandler();
    const result = await handler({ agentId: "agent-1", args: "probe" }, context);

    expect(result.ok).toBe(true);
  });
});
