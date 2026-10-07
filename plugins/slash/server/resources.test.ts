import { describe, expect, it, vi } from "vitest";
import { KNOWN_OPEN_TARGETS, operationsListRpc } from "../shared/resources";
import { allowedOperations, handleListOperations, handleRunCommand } from "./resources";

describe("handleListOperations", () => {
  it("returns the allowlisted rpc operations and the curated open targets", async () => {
    const result = await handleListOperations();
    expect(result.rpc).toEqual(await allowedOperations());
    expect(result.open).toEqual(KNOWN_OPEN_TARGETS);
    expect(result.descriptions).toBeDefined();
    expect(result.descriptions["slash.agent-mux.status"]).toContain("agent-mux");
    expect(operationsListRpc.output.parse(result)).toEqual(result);
  });

  it("returns copies so callers cannot mutate the shared lists", async () => {
    const result = await handleListOperations();
    expect(result.open).not.toBe(KNOWN_OPEN_TARGETS);
  });

  it("includes agent-mux and identity operations in allowed operations", async () => {
    const ops = await allowedOperations();
    expect(ops).toContain("slash.agent.identity");
    expect(ops).toContain("slash.agent-mux");
    expect(ops).toContain("slash.agent-mux.status");
    expect(ops).toContain("slash.agent-mux.probe");
    expect(ops).toContain("slash.agent-mux.cooldowns");
  });
});

describe("handleRunCommand", () => {
  it("appends successful command result to timeline via context.paseo", async () => {
    const timelineAppend = vi.fn().mockResolvedValue(undefined);
    const mockContext: any = {
      paseo: {
        agents: {
          ref: vi.fn().mockReturnValue({
            timeline: { append: timelineAppend },
          }),
        },
      },
    };

    const result = await handleRunCommand(
      { name: "ping", args: "", agentId: "agent-123" },
      mockContext,
    );

    expect(result.verb).toBe("rpc");
    expect(mockContext.paseo.agents.ref).toHaveBeenCalledWith("agent-123");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
    expect(timelineAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plugin",
        kind: "slash-command-result",
        version: 1,
        data: expect.objectContaining({
          command: "ping",
          status: "ok",
        }),
      }),
    );
  });

  it("appends error to timeline via context.paseo when operation fails", async () => {
    const timelineAppend = vi.fn().mockResolvedValue(undefined);
    const mockContext: any = {
      paseo: {
        agents: {
          ref: vi.fn().mockReturnValue({
            timeline: { append: timelineAppend },
          }),
        },
      },
    };

    await expect(
      handleRunCommand(
        { name: "orchestrate", args: "", agentId: "agent-fail" },
        mockContext,
      ),
    ).rejects.toThrow();

    expect(mockContext.paseo.agents.ref).toHaveBeenCalledWith("agent-fail");
    expect(timelineAppend).toHaveBeenCalledTimes(1);
    expect(timelineAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plugin",
        kind: "slash-command-result",
        version: 1,
        data: expect.objectContaining({
          command: "orchestrate",
          status: "error",
        }),
      }),
    );
  });

  it("resolves slash.agent.identity and appends agent metadata to timeline", async () => {
    const timelineAppend = vi.fn().mockResolvedValue(undefined);
    const mockContext: any = {
      paseo: {
        agents: {
          ref: vi.fn().mockReturnValue({
            timeline: { append: timelineAppend },
            refresh: vi.fn().mockResolvedValue({
              agent: {
                title: "Test Worker",
                provider: "antigravity",
                model: "claude-3-7-sonnet",
                status: "running",
                cwd: "/home/user/code/test",
                workspaceId: "wks_test123",
                thinkingOptionId: "deep",
              },
            }),
            current: vi.fn().mockReturnValue(null),
          }),
        },
      },
    };

    const result = await handleRunCommand(
      { name: "who-are-you", args: "", agentId: "agent-identity-test" },
      mockContext,
    );

    expect(result.verb).toBe("rpc");
    expect(timelineAppend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "plugin",
        kind: "slash-command-result",
        version: 1,
        data: expect.objectContaining({
          command: "who-are-you",
          status: "ok",
          body: expect.stringContaining("Agent ID: agent-identity-test"),
        }),
      }),
    );
    const body = timelineAppend.mock.calls[0][0].data.body;
    expect(body).toContain("Title: Test Worker");
    expect(body).toContain("Provider: antigravity");
    expect(body).toContain("Model: claude-3-7-sonnet");
    expect(body).toContain("Working Directory: /home/user/code/test");
  });
});

describe("tokenizeArgs", () => {
  it("splits arguments safely respecting quotes", async () => {
    const { tokenizeArgs } = await import("./resources");
    expect(tokenizeArgs("")).toEqual([]);
    expect(tokenizeArgs("   ")).toEqual([]);
    expect(tokenizeArgs("status")).toEqual(["status"]);
    expect(tokenizeArgs("probe antigravity")).toEqual(["probe", "antigravity"]);
    expect(tokenizeArgs('probe "Google Antigravity" --dry-run')).toEqual(["probe", "Google Antigravity", "--dry-run"]);
    expect(tokenizeArgs("probe 'Google Antigravity'")).toEqual(["probe", "Google Antigravity"]);
  });
});

