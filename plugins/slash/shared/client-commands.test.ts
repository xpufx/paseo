// Lives in shared/ on purpose: a test file under client/ shifts TypeScript's
// global-lib ordering and trips pre-existing vendor setTimeout errors.
import { describe, expect, it, vi } from "vitest";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { registerSlashCommands } from "../client/commands";
import { SEED_COMMANDS, listCommandsRpc, runCommandRpc, slashSettingsContract } from "./resources";

interface Contribution {
  name: string;
  context: "agent" | "workspace";
  onSubmit(ctx: unknown): void | Promise<void>;
}

function harness() {
  const rpcCalls: Array<{ contract: unknown; input: unknown }> = [];
  const contributions: Contribution[] = [];
  const sent: string[] = [];
  const timelineAppended: Array<unknown> = [];

  const rpc = vi.fn(async (contract: unknown, input: unknown) => {
    rpcCalls.push({ contract, input });
    if (contract === listCommandsRpc) return { commands: SEED_COMMANDS };
    if (contract === slashSettingsContract.get) return { prefix: "slash-" };
    if (contract === runCommandRpc) return { verb: "rpc", result: { ok: true } };
    throw new Error("unexpected contract");
  });

  const agentRef = {
    send: vi.fn(async (message: string) => {
      sent.push(message);
    }),
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
    paseo: {
      agents: {
        ref: () => agentRef,
      },
    },
  } as unknown as PluginClientContext;

  return { client, rpcCalls, contributions, sent, timelineAppended, agentRef };
}

describe("registerSlashCommands rpc wiring", () => {
  it("sends the caller agent id with the run-command input and delegates execution without prompting", async () => {
    const { client, rpcCalls, contributions, sent, agentRef } = harness();
    const dispose = registerSlashCommands(client);

    await vi.waitFor(() => expect(contributions.length).toBe(SEED_COMMANDS.length));
    const orchestrate = contributions.find((c) => c.name === "slash-orchestrate");
    expect(orchestrate).toBeDefined();

    await orchestrate?.onSubmit({
      args: "",
      agent: { id: "agent-42" },
      paseo: client.paseo,
    });

    const runCall = rpcCalls.find((call) => call.contract === runCommandRpc);
    expect(runCall?.input).toEqual({ name: "orchestrate", args: "", agentId: "agent-42" });

    // Must NOT call agent.send() so it doesn't prompt or interrupt the agent turn!
    expect(agentRef.send).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);

    // Client session must NOT attempt timeline.append (server plugin session handles this)
    expect(agentRef.timeline.append).not.toHaveBeenCalled();

    dispose();
  });

  it("handles rpc failures gracefully without calling agent.send()", async () => {
    const { client, contributions, sent, agentRef } = harness();
    client.rpc = vi.fn(async (contract: unknown) => {
      if (contract === listCommandsRpc) return { commands: SEED_COMMANDS };
      if (contract === slashSettingsContract.get) return { prefix: "slash-" };
      if (contract === runCommandRpc) throw new Error("network partition");
      throw new Error("unexpected contract");
    }) as unknown as PluginClientContext["rpc"];

    const dispose = registerSlashCommands(client);
    await vi.waitFor(() => expect(contributions.length).toBe(SEED_COMMANDS.length));
    const ping = contributions.find((c) => c.name === "slash-ping");
    expect(ping).toBeDefined();

    await ping?.onSubmit({
      args: "",
      agent: { id: "agent-99" },
      paseo: client.paseo,
    });

    expect(agentRef.send).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(agentRef.timeline.append).not.toHaveBeenCalled();

    dispose();
  });

  it("retains agent.send() for send-verb templated prompt macros", async () => {
    const { client, contributions, sent, timelineAppended, agentRef } = harness();
    const dispose = registerSlashCommands(client);

    await vi.waitFor(() => expect(contributions.length).toBe(SEED_COMMANDS.length));
    const review = contributions.find((c) => c.name === "slash-review");
    expect(review).toBeDefined();

    await review?.onSubmit({
      args: "focus on performance",
      agent: { id: "agent-1" },
      paseo: client.paseo,
    });

    expect(agentRef.send).toHaveBeenCalledWith("Review the current changes: focus on performance");
    expect(sent).toEqual(["Review the current changes: focus on performance"]);
    expect(timelineAppended).toHaveLength(0);

    dispose();
  });

  it("triggers toast notification on execution and failure", async () => {
    const { client, contributions } = harness();
    const showMock = vi.fn();
    const errorMock = vi.fn();

    // Mock client host helper deps with a toast API
    const { initClientHelpers } = await import("../client/vendor/paseo-plugin-helper/core");
    initClientHelpers({
      Icon: (() => null) as any,
      Modal: (() => null) as any,
      useRpc: (() => () => Promise.resolve()) as any,
      useToast: () => ({ show: showMock, error: errorMock }),
    });

    const dispose = registerSlashCommands(client);
    await vi.waitFor(() => expect(contributions.length).toBe(SEED_COMMANDS.length));
    const ping = contributions.find((c) => c.name === "slash-ping");
    expect(ping).toBeDefined();

    await ping?.onSubmit({
      args: "",
      agent: { id: "agent-77" },
      paseo: client.paseo,
    });

    // Verify toast notification was triggered
    expect(showMock).toHaveBeenCalledWith("/ping executed", undefined);

    dispose();
  });
});
