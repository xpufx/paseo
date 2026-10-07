import { describe, expect, it, vi } from "vitest";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerMcpCommands } from "../client/commands";
import { runMcpSlash, listMcp } from "./mcp";

interface Contribution {
  name: string;
  context: "agent" | "workspace";
  onSubmit(ctx: unknown): void | Promise<void>;
}

function harness() {
  const rpcCalls: Array<{ contract: unknown; input: unknown }> = [];
  const contributions: Contribution[] = [];
  const timelineAppended: Array<unknown> = [];

  const rpc = vi.fn(async (contract: unknown, input: unknown) => {
    rpcCalls.push({ contract, input });
    if (contract === runMcpSlash) {
      return { ok: true, title: "MCP probe", body: "1 server" };
    }
    if (contract === listMcp) {
      return { servers: [], provider: "paseo", cwd: "/", paseoTools: [], error: null };
    }
    throw new Error("unexpected contract");
  });

  const agentRef = {
    timeline: {
      append: vi.fn(async (item: unknown) => {
        timelineAppended.push(item);
        return { seq: 1, epoch: "1" };
      }),
    },
  };

  const client = {
    rpc,
    addSlashCommand: vi.fn((contribution: Contribution) => {
      contributions.push(contribution);
      return () => {};
    }),
    addCommandCenterItem: vi.fn(() => () => {}),
    paseo: {
      agents: {
        ref: () => agentRef,
      },
    },
  } as unknown as PluginClientContext;

  return { client, rpcCalls, contributions, timelineAppended, agentRef };
}

describe("registerMcpCommands client wiring", () => {
  it("delegates slash command execution to runMcpSlash and never calls timeline.append from client", async () => {
    const { client, rpcCalls, contributions, agentRef } = harness();
    const dispose = registerMcpCommands(client);

    const mcpCommand = contributions.find((c) => c.name === "mcp");
    expect(mcpCommand).toBeDefined();

    await mcpCommand?.onSubmit({
      args: "probe",
      agent: { id: "agent-test-123" },
      rpc: client.rpc,
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      contract: runMcpSlash,
      input: { agentId: "agent-test-123", args: "probe" },
    });

    // Client session MUST NOT call timeline.append directly
    expect(agentRef.timeline.append).not.toHaveBeenCalled();

    dispose();
  });

  it("handles rpc failures gracefully without throwing and without appending to timeline", async () => {
    const { client, contributions, agentRef } = harness();
    client.rpc = vi.fn(async (contract: unknown) => {
      if (contract === runMcpSlash) {
        throw new Error("Only plugin sessions can append plugin timeline items");
      }
      throw new Error("unexpected contract");
    });

    const dispose = registerMcpCommands(client);
    const mcpCommand = contributions.find((c) => c.name === "mcp");

    await expect(
      mcpCommand?.onSubmit({
        args: "probe",
        agent: { id: "agent-test-456" },
        rpc: client.rpc,
      }),
    ).resolves.not.toThrow();

    // Client session MUST NOT attempt secondary timeline.append
    expect(agentRef.timeline.append).not.toHaveBeenCalled();

    dispose();
  });
});
