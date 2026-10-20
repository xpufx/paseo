// Lives in shared/ on purpose: a test file under client/ shifts TypeScript's
// global-lib ordering and trips pre-existing vendor setTimeout errors.
import { describe, expect, it, vi } from "vitest";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  BACKOFF_DELAYS,
  MAX_BACKOFF_MS,
  getBackoffDelay,
  registerSlashCommands,
} from "../client/commands";
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

  it("routes send-verb commands through runCommandRpc (server delivers via agent.send)", async () => {
    const { client, rpcCalls, contributions, sent, timelineAppended, agentRef } = harness();
    const dispose = registerSlashCommands(client);

    await vi.waitFor(() => expect(contributions.length).toBe(SEED_COMMANDS.length));
    const review = contributions.find((c) => c.name === "slash-review");
    expect(review).toBeDefined();

    await review?.onSubmit({
      args: "focus on performance",
      agent: { id: "agent-1" },
      paseo: client.paseo,
    });

    // Client now dispatches through RPC; server handles agent.send()
    expect(rpcCalls).toContainEqual({
      contract: runCommandRpc,
      input: {
        name: "review",
        args: "focus on performance",
        agentId: "agent-1",
      },
    });
    // Client must NOT call agent.send() directly anymore
    expect(agentRef.send).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    expect(timelineAppended).toHaveLength(0);

    dispose();
  });

  it("triggers toast notification on execution and failure", async () => {
    const { client, contributions } = harness();
    const showMock = vi.fn();
    const errorMock = vi.fn();

    // Mock client host helper deps with a toast API
    const { initClientHelpers } = await import("paseo-plugin-helper/core");
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

  it("dispatches send-verb through RPC even when agent.send() is unavailable", async () => {
    const { client, rpcCalls, contributions, sent, agentRef } = harness();
    const showMock = vi.fn();
    const errorMock = vi.fn();

    // Mock client host helper deps with a toast API
    const { initClientHelpers } = await import("paseo-plugin-helper/core");
    initClientHelpers({
      Icon: (() => null) as any,
      Modal: (() => null) as any,
      useRpc: (() => () => Promise.resolve()) as any,
      useToast: () => ({ show: showMock, error: errorMock }),
    });

    // Stub agent.send so it never gets called, simulating an environment without it
    agentRef.send = vi.fn();

    const dispose = registerSlashCommands(client);
    await vi.waitFor(() => expect(contributions.length).toBe(SEED_COMMANDS.length));
    const review = contributions.find((c) => c.name === "slash-review");
    expect(review).toBeDefined();

    await review?.onSubmit({
      args: "focus on performance",
      agent: { id: "agent-1" },
      paseo: client.paseo,
    });

    // Send-verb always goes through RPC; server handles delivery
    expect(rpcCalls).toContainEqual({
      contract: runCommandRpc,
      input: {
        name: "review",
        args: "focus on performance",
        agentId: "agent-1",
      },
    });
    expect(agentRef.send).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);

    dispose();
  });

  it("shows toast when runCommandRpc fails for send-verb command", async () => {
    const { client, contributions, agentRef } = harness();
    const showMock = vi.fn();
    const errorMock = vi.fn();

    const { initClientHelpers } = await import("paseo-plugin-helper/core");
    initClientHelpers({
      Icon: (() => null) as any,
      Modal: (() => null) as any,
      useRpc: (() => () => Promise.resolve()) as any,
      useToast: () => ({ show: showMock, error: errorMock }),
    });

    // Force runCommandRpc to fail
    (client.rpc as any).mockImplementation(async (contract: unknown) => {
      if (contract === listCommandsRpc) return { commands: SEED_COMMANDS };
      if (contract === slashSettingsContract.get) return { prefix: "slash-" };
      if (contract === runCommandRpc) throw new Error("Server RPC offline");
      throw new Error("unexpected contract");
    });

    const dispose = registerSlashCommands(client);
    await vi.waitFor(() => expect(contributions.length).toBe(SEED_COMMANDS.length));
    const review = contributions.find((c) => c.name === "slash-review");
    expect(review).toBeDefined();

    await review?.onSubmit({
      args: "focus on performance",
      agent: { id: "agent-1" },
      paseo: client.paseo,
    });

    expect(errorMock).toHaveBeenCalledWith("/review send failed: Server RPC offline");
    expect(agentRef.send).not.toHaveBeenCalled();

    dispose();
  });
});

describe("registerSlashCommands reconnect backoff & command cache resilience (#1387)", () => {
  it("computes backoff delays matching the exponential schedule (1s, 2s, 5s up to 30s)", () => {
    expect(getBackoffDelay(0)).toBe(1_000);
    expect(getBackoffDelay(1)).toBe(2_000);
    expect(getBackoffDelay(2)).toBe(5_000);
    expect(getBackoffDelay(3)).toBe(10_000);
    expect(getBackoffDelay(4)).toBe(20_000);
    expect(getBackoffDelay(5)).toBe(30_000);
    expect(getBackoffDelay(6)).toBe(30_000);
    expect(getBackoffDelay(99)).toBe(30_000);
    expect(getBackoffDelay(-1)).toBe(1_000);

    // Respects custom backoff delays and custom max
    expect(getBackoffDelay(0, [100, 200], 500)).toBe(100);
    expect(getBackoffDelay(1, [100, 200], 500)).toBe(200);
    expect(getBackoffDelay(2, [100, 200], 500)).toBe(500);
  });

  it("retries with exponential backoff when list-commands RPC fails on initial sync", async () => {
    vi.useFakeTimers();
    try {
      let rpcCount = 0;
      const contributions: Contribution[] = [];
      const rpc = vi.fn(async (contract: unknown) => {
        if (contract === listCommandsRpc) {
          rpcCount++;
          if (rpcCount < 4) {
            throw new Error("Server disconnected");
          }
          return { commands: SEED_COMMANDS };
        }
        if (contract === slashSettingsContract.get) return { prefix: "slash-" };
        throw new Error("unexpected contract");
      });

      const client = {
        rpc,
        addSlashCommand: vi.fn((contribution: Contribution) => {
          contributions.push(contribution);
          return () => {};
        }),
      } as unknown as PluginClientContext;

      const dispose = registerSlashCommands(client);

      // Initial sync ran and failed (rpcCount = 1)
      await vi.advanceTimersByTimeAsync(0);
      expect(rpcCount).toBe(1);
      expect(contributions).toHaveLength(0);

      // Before 1000ms: no retry yet
      await vi.advanceTimersByTimeAsync(900);
      expect(rpcCount).toBe(1);

      // At 1000ms: 1st retry fires (fails, rpcCount = 2)
      await vi.advanceTimersByTimeAsync(100);
      expect(rpcCount).toBe(2);
      expect(contributions).toHaveLength(0);

      // Before 2000ms delay: no retry yet
      await vi.advanceTimersByTimeAsync(1900);
      expect(rpcCount).toBe(2);

      // At 2000ms: 2nd retry fires (fails, rpcCount = 3)
      await vi.advanceTimersByTimeAsync(100);
      expect(rpcCount).toBe(3);
      expect(contributions).toHaveLength(0);

      // Before 5000ms delay: no retry yet
      await vi.advanceTimersByTimeAsync(4900);
      expect(rpcCount).toBe(3);

      // At 5000ms: 3rd retry fires (succeeds, rpcCount = 4)
      await vi.advanceTimersByTimeAsync(100);
      expect(rpcCount).toBe(4);
      expect(contributions).toHaveLength(SEED_COMMANDS.length);

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains registered commands and removers across transient RPC failures", async () => {
    vi.useFakeTimers();
    try {
      let shouldFail = false;
      const activeRemovers = new Set<string>();
      const registeredCommands = new Map<string, Contribution>();

      const rpc = vi.fn(async (contract: unknown) => {
        if (contract === listCommandsRpc) {
          if (shouldFail) {
            throw new Error("Server disconnected");
          }
          return { commands: SEED_COMMANDS };
        }
        if (contract === slashSettingsContract.get) return { prefix: "slash-" };
        throw new Error("unexpected contract");
      });

      const client = {
        rpc,
        addSlashCommand: vi.fn((contribution: Contribution) => {
          registeredCommands.set(contribution.name, contribution);
          activeRemovers.add(contribution.name);
          return () => {
            activeRemovers.delete(contribution.name);
            registeredCommands.delete(contribution.name);
          };
        }),
      } as unknown as PluginClientContext;

      const dispose = registerSlashCommands(client, { intervalMs: 10_000 });

      // Initial sync succeeds
      await vi.advanceTimersByTimeAsync(0);
      expect(registeredCommands.size).toBe(SEED_COMMANDS.length);
      expect(activeRemovers.size).toBe(SEED_COMMANDS.length);

      // Now server disconnects
      shouldFail = true;

      // Regular interval fires, sync fails
      await vi.advanceTimersByTimeAsync(10_000);
      // Verify commands and removers were RETAINED, not cleared
      expect(registeredCommands.size).toBe(SEED_COMMANDS.length);
      expect(activeRemovers.size).toBe(SEED_COMMANDS.length);

      // First retry fires at 1s, also fails
      await vi.advanceTimersByTimeAsync(1_000);
      expect(registeredCommands.size).toBe(SEED_COMMANDS.length);
      expect(activeRemovers.size).toBe(SEED_COMMANDS.length);

      // Server recovers
      shouldFail = false;
      // Second retry fires at 2s, succeeds
      await vi.advanceTimersByTimeAsync(2_000);
      expect(registeredCommands.size).toBe(SEED_COMMANDS.length);
      expect(activeRemovers.size).toBe(SEED_COMMANDS.length);

      // Disposal cleans up all removers
      dispose();
      expect(activeRemovers.size).toBe(0);
      expect(registeredCommands.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up active retry timers on disposal to prevent leaks", async () => {
    vi.useFakeTimers();
    try {
      let rpcCount = 0;
      const rpc = vi.fn(async (contract: unknown) => {
        if (contract === listCommandsRpc) {
          rpcCount++;
          throw new Error("Server disconnected");
        }
        return {};
      });

      const client = {
        rpc,
        addSlashCommand: vi.fn(() => () => {}),
      } as unknown as PluginClientContext;

      const dispose = registerSlashCommands(client);
      await vi.advanceTimersByTimeAsync(0);
      expect(rpcCount).toBe(1);

      // Dispose while retry backoff timer is pending
      dispose();

      // Advance time by 60 seconds — no more RPC calls should occur
      await vi.advanceTimersByTimeAsync(60_000);
      expect(rpcCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets backoff attempt counter after a successful sync", async () => {
    vi.useFakeTimers();
    try {
      let rpcCount = 0;
      let shouldFail = true;

      const rpc = vi.fn(async (contract: unknown) => {
        if (contract === listCommandsRpc) {
          rpcCount++;
          if (shouldFail) throw new Error("Server disconnected");
          return { commands: SEED_COMMANDS };
        }
        if (contract === slashSettingsContract.get) return { prefix: "" };
        return {};
      });

      const client = {
        rpc,
        addSlashCommand: vi.fn(() => () => {}),
      } as unknown as PluginClientContext;

      const dispose = registerSlashCommands(client);

      // Initial fail (attempt 0 -> retry at 1s)
      await vi.advanceTimersByTimeAsync(0);
      expect(rpcCount).toBe(1);

      // Retry at 1s fails (attempt 1 -> retry at 2s)
      await vi.advanceTimersByTimeAsync(1_000);
      expect(rpcCount).toBe(2);

      // Recover for the retry at 2s
      shouldFail = false;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(rpcCount).toBe(3); // succeeded, backoff reset to 0

      // Now server fails again on next trigger
      shouldFail = true;
      // Interval fires at t=30,000 (we are currently at t=3,000, so advance 27,000ms)
      await vi.advanceTimersByTimeAsync(27_000);
      expect(rpcCount).toBe(4);

      // Since backoff was reset to 0, next retry must happen at 1s (not 5s or 10s)
      await vi.advanceTimersByTimeAsync(900);
      expect(rpcCount).toBe(4);
      await vi.advanceTimersByTimeAsync(100);
      expect(rpcCount).toBe(5);

      dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});
