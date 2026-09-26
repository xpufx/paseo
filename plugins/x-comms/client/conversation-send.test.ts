import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEnvelope } from "../shared/envelope.ts";
import {
  describeDelivery,
  sendConfiguredHostViaGate,
  type CallSend,
  type ConversationSendResult,
} from "./conversation-send.ts";

const SENT_AT = "2026-09-25T12:00:00.000Z";
const EXPIRES_AT = "2026-09-25T12:30:00.000Z";

/** Records what reached the gate and answers with a fixed verdict. */
function gate(verdict: Partial<ConversationSendResult> = {}) {
  const calls: Array<Record<string, unknown>> = [];
  const callSend: CallSend = async (input) => {
    calls.push(input as unknown as Record<string, unknown>);
    return {
      daemon: input.daemon,
      agentId: input.agentId,
      ok: true,
      error: null,
      ...verdict,
    };
  };
  return { calls, callSend };
}

const base = {
  serverId: "srv_two",
  agentId: "target",
  body: "hello",
  fromAgentId: "source",
  fromAgentName: "User",
  messageId: "msg-611-1",
  sentAt: SENT_AT,
};

describe("Desktop configured-host send goes through the defer gate", () => {
  it("sends via conversation.send, not a borrowed client, and reports queued for a busy target", async () => {
    const { calls, callSend } = gate({
      delivery: "queued",
      queueDepth: 2,
      expiresAt: EXPIRES_AT,
    });
    const result = await sendConfiguredHostViaGate({ ...base, callSend });

    // The single gated entry point. There is no second send route to bypass it.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].daemon, "srv_two");
    assert.equal(calls[0].agentId, "target");
    assert.equal(calls[0].messageId, "msg-611-1");
    assert.equal(calls[0].fromAgentId, "source");

    // Reported as held, which is the whole point: this used to be hardcoded to
    // "dispatched" and preempt the target.
    assert.equal(result.delivery, "queued");
    assert.equal(result.queueDepth, 2);
    assert.equal(result.expiresAt, EXPIRES_AT);
  });

  it("marks its prompt pre-stamped so the daemon delivers those bytes unchanged", async () => {
    const { calls, callSend } = gate({ delivery: "dispatched" });
    await sendConfiguredHostViaGate({ ...base, callSend });

    assert.equal(calls[0].stamped, true, "re-stamping would move sentAt and change attribution");
    const envelope = parseEnvelope(String(calls[0].prompt));
    assert.equal(envelope?.envelope.xComms.target.daemon, "srv_two");
    assert.equal(envelope?.envelope.xComms.target.agentId, "target");
    assert.equal(envelope?.envelope.xComms.messageId, "msg-611-1");
    assert.equal(envelope?.envelope.xComms.sentAt, SENT_AT);
    assert.match(String(calls[0].prompt), /\n\nhello$/, "the prose follows the envelope");
  });

  it("passes through outbox and dropped rather than reading either as sent", async () => {
    const dropped = gate({ ok: false, error: "defer queue is full", delivery: "dropped" });
    const refused = await sendConfiguredHostViaGate({ ...base, callSend: dropped.callSend });
    assert.equal(refused.ok, false);
    assert.equal(refused.delivery, "dropped");
    assert.match(String(refused.error), /queue is full/);

    const held = gate({ ok: false, error: "undelivered; held in the outbox", delivery: "outbox" });
    const outboxed = await sendConfiguredHostViaGate({ ...base, callSend: held.callSend });
    assert.equal(outboxed.delivery, "outbox");
  });

  it("reuses one messageId across a repeat of the same message", async () => {
    const { calls, callSend } = gate({ delivery: "dispatched" });
    await sendConfiguredHostViaGate({ ...base, callSend });
    await sendConfiguredHostViaGate({ ...base, callSend });
    assert.deepEqual(calls.map((c) => c.messageId), ["msg-611-1", "msg-611-1"]);
  });
});

describe("the send affordance tells queued apart from sent", () => {
  it("reports a queued send as held, with its position and when it gives up", () => {
    const outcome = describeDelivery({
      ok: true,
      delivery: "queued",
      queueDepth: 3,
      expiresAt: EXPIRES_AT,
    });
    assert.equal(outcome?.tone, "warning");
    assert.match(outcome!.text, /Queued at position 3/);
    assert.match(outcome!.text, /mid-turn/);
    assert.match(outcome!.text, /instead of interrupting/);
    // The bounds the queue actually applies, in the caller's own locale, so the
    // user can see when the message stops being worth holding.
    assert.ok(
      outcome!.text.includes(new Date(EXPIRES_AT).toLocaleTimeString()),
      `expected the expiry time in: ${outcome!.text}`,
    );
  });

  it("omits the expiry rather than printing an empty one when the daemon sends none", () => {
    const outcome = describeDelivery({ ok: true, delivery: "queued", queueDepth: 1 });
    assert.match(outcome!.text, /Queued at position 1/);
    assert.doesNotMatch(outcome!.text, /until\s*$/);
  });

  it("treats a dispatched send as a plain success", () => {
    const outcome = describeDelivery({ ok: true, delivery: "dispatched" });
    assert.equal(outcome?.tone, "success");
  });

  it("shows the error instead of a status for outbox and dropped", () => {
    assert.equal(describeDelivery({ ok: false, delivery: "outbox" }), null);
    assert.equal(describeDelivery({ ok: false, delivery: "dropped" }), null);
    assert.equal(describeDelivery(undefined), null);
  });

  it("still reads as sent against a daemon too old to report a delivery", () => {
    // Optional field for rolling upgrades: no gate existed there, so "sent" is
    // the truthful rendering rather than a guess at queued.
    assert.equal(describeDelivery({ ok: true })?.tone, "success");
  });
});
