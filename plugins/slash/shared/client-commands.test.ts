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

  const rpc = vi.fn(async (contract: unknown, input: unknown) => {
    rpcCalls.push({ contract, input });
    if (contract === listCommandsRpc) return { commands: SEED_COMMANDS };
    if (contract === slashSettingsContract.get) return { prefix: "" };
    if (contract === runCommandRpc) return { verb: "rpc", result: { ok: true } };
    throw new Error("unexpected contract");
  });

  const client = {
    rpc,
    addSlashCommand: vi.fn((contribution: Contribution) => {
      contributions.push(contribution);
      return () => {};
    }),
    paseo: {
      agents: {
        ref: () => ({ send: async (message: string) => void sent.push(message) }),
      },
    },
  } as unknown as PluginClientContext;

  return { client, rpcCalls, contributions, sent };
}

describe("registerSlashCommands rpc wiring", () => {
  it("sends the caller agent id with the run-command input", async () => {
    const { client, rpcCalls, contributions } = harness();
    const dispose = registerSlashCommands(client);

    await vi.waitFor(() => expect(contributions.length).toBe(SEED_COMMANDS.length));
    const orchestrate = contributions.find((c) => c.name === "orchestrate");
    expect(orchestrate).toBeDefined();

    await orchestrate?.onSubmit({
      args: "",
      agent: { id: "agent-42" },
      paseo: { agents: { ref: () => ({ send: async () => {} }) } },
    });

    const runCall = rpcCalls.find((call) => call.contract === runCommandRpc);
    expect(runCall?.input).toEqual({ name: "orchestrate", args: "", agentId: "agent-42" });
    dispose();
  });
});
