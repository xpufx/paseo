import { describe, expect, it, vi } from "vitest";
import { KNOWN_OPEN_TARGETS, operationsListRpc } from "../shared/resources";
import { allowedOperations, handleListOperations, handleRunCommand } from "./resources";

describe("handleListOperations", () => {
  it("returns the allowlisted rpc operations and the curated open targets", async () => {
    const result = await handleListOperations();
    expect(result.rpc).toEqual(await allowedOperations());
    expect(result.open).toEqual(KNOWN_OPEN_TARGETS);
    expect(operationsListRpc.output.parse(result)).toEqual(result);
  });

  it("returns copies so callers cannot mutate the shared lists", async () => {
    const result = await handleListOperations();
    expect(result.open).not.toBe(KNOWN_OPEN_TARGETS);
  });

  it("includes agent-mux operations in allowed operations", async () => {
    const ops = await allowedOperations();
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
});

