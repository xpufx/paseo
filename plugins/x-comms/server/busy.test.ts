import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BusyGate, isBusyStatus, readLifecycleStatus, type BusyProbe } from "./busy.ts";
import { DEFER_VERDICT_TTL_MS, LOCAL_DAEMON } from "./defer-queue.ts";

const PEER = { daemon: "hsi", agentId: "agent-remote" };
const LOCAL = { daemon: LOCAL_DAEMON, agentId: "agent-local" };

describe("lifecycle reading", () => {
  it("reads either casing, because the CLI and the SDK disagree", () => {
    assert.equal(readLifecycleStatus({ Status: "running" }), "running");
    assert.equal(readLifecycleStatus({ status: "running" }), "running");
    assert.equal(readLifecycleStatus({ Lifecycle: "Running" }), "running");
  });

  it("returns null for a payload with no lifecycle at all", () => {
    assert.equal(readLifecycleStatus(null), null);
    assert.equal(readLifecycleStatus("running"), null);
    assert.equal(readLifecycleStatus({ Name: "x" }), null);
  });
});

describe("busy classification", () => {
  it("treats a turn in progress, or about to be, as busy", () => {
    for (const status of ["running", "initializing", "busy", "permission", "awaiting_permission"]) {
      assert.equal(isBusyStatus(status), true, `${status} must block a dispatch`);
    }
  });

  it("treats idle as not busy", () => {
    assert.equal(isBusyStatus("idle"), false);
  });

  it("does not pin a queue against an agent that has already stopped", () => {
    // `error` and `closed` have no running turn to replace. Calling them busy
    // would queue against a dead agent with no turn ever coming to drain it.
    assert.equal(isBusyStatus("error"), false);
    assert.equal(isBusyStatus("closed"), false);
  });

  it("cannot tell, so does not block: a swallowed message is the worse failure", () => {
    assert.equal(isBusyStatus(null), false);
    assert.equal(isBusyStatus(undefined), false);
    assert.equal(isBusyStatus(""), false);
    assert.equal(isBusyStatus("some_future_state"), false);
  });
});

function gateWith(probe: BusyProbe, now = () => 0) {
  const calls: string[] = [];
  const gate = new BusyGate({
    now,
    probe: async (target) => {
      calls.push(deferKey(target));
      return probe(target);
    },
  });
  return { gate, calls };
}

function deferKey(target: { daemon: string; agentId: string }): string {
  return `${target.daemon}/${target.agentId}`;
}

describe("busy gate", () => {
  it("reports a running peer as busy", async () => {
    const { gate } = gateWith(async () => "running");
    assert.equal(await gate.isBusy(PEER), true);
  });

  it("reports an idle peer as not busy", async () => {
    const { gate } = gateWith(async () => "idle");
    assert.equal(await gate.isBusy(PEER), false);
  });

  it("dispatches when the probe fails rather than swallowing the message", async () => {
    const { gate } = gateWith(async () => {
      throw new Error("peer unreachable");
    });
    assert.equal(await gate.isBusy(PEER), false);
  });

  it("uses the local turn hooks without probing, and trusts them over any cache", async () => {
    const { gate, calls } = gateWith(async () => "idle");
    gate.noteLocalTurnStarted(LOCAL.agentId);
    assert.equal(await gate.isBusy(LOCAL), true);
    assert.deepEqual(calls, [], "the hook already knows; no round trip");

    // Ending the turn drops the hook's verdict, so the question falls through to
    // the probe again rather than latching "busy" forever.
    gate.noteLocalTurnEnded(LOCAL.agentId);
    assert.equal(await gate.isBusy(LOCAL), false);
    assert.deepEqual(calls, ["local/agent-local"]);
  });

  it("lets a local turn hook override a cached idle verdict", async () => {
    // The hook is the stronger signal: an agent can start a turn between a
    // dispatch and the next send, and a cached "idle" must not predate that.
    const { gate } = gateWith(async () => "idle");
    assert.equal(await gate.isBusy(LOCAL), false);
    gate.noteLocalTurnStarted(LOCAL.agentId);
    assert.equal(await gate.isBusy(LOCAL), true);
  });

  it("treats a send it just made as busy, so a burst cannot preempt the turn it started", async () => {
    // The preemption this prevents: send #1 starts a turn, send #2 re-probes and
    // reads the pre-turn snapshot off a stale read, and replaces the turn.
    const { gate, calls } = gateWith(async () => "idle");
    assert.equal(await gate.isBusy(PEER), false);
    gate.noteDispatched(PEER);
    assert.equal(await gate.isBusy(PEER), true);
    assert.deepEqual(calls, ["hsi/agent-remote"], "the optimistic verdict short-circuits the probe");
  });

  it("re-probes once the verdict is older than the TTL", async () => {
    let clock = 0;
    const { gate, calls } = gateWith(async () => "idle", () => clock);
    await gate.isBusy(PEER);
    gate.noteDispatched(PEER);
    await gate.isBusy(PEER);
    assert.deepEqual(calls, ["hsi/agent-remote"]);

    clock = DEFER_VERDICT_TTL_MS + 1;
    await gate.isBusy(PEER);
    assert.deepEqual(calls, ["hsi/agent-remote", "hsi/agent-remote"], "stale once past the TTL");
  });

  it("invalidate forces the next question to be a fresh probe", async () => {
    const { gate, calls } = gateWith(async () => "idle");
    await gate.isBusy(PEER);
    gate.noteDispatched(PEER);
    gate.invalidate(PEER);
    assert.equal(await gate.isBusy(PEER), false);
    assert.equal(calls.length, 2);
  });
});
