import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { META_PREFIX, parseEnvelope } from "../shared/envelope.ts";
import {
  assertNotSelfMessage,
  buildSenderEnvelope,
  isLocalIdentity,
  resolveSendRoute,
  ENVELOPE_PREFIX,
  SELF_MESSAGE_LABEL,
} from "./local-send.ts";

const SENT_AT = "2026-09-19T12:00:00.000Z";

function envelopeObject(stamped: string): Record<string, unknown> {
  const parsed = parseEnvelope(stamped);
  assert.ok(parsed, `not a parseable envelope: ${stamped.slice(0, 80)}`);
  return parsed.envelope as unknown as Record<string, unknown>;
}

describe("native local send envelope", () => {
  it("uses the [x-comms] prefix shared with the MCP server", () => {
    assert.equal(ENVELOPE_PREFIX, META_PREFIX);
  });

  it("produces a version-4 envelope parseable by shared/envelope", () => {
    const stamped = buildSenderEnvelope({
      sender: {
        agentId: "agent-a",
        agentName: "Agent A",
        host: "host-a",
        daemonServerId: "srv_self",
        cwd: "/work/a",
      },
      target: { daemon: "peer", agentId: "agent-b" },
      sentAt: SENT_AT,
    });
    const env = envelopeObject(stamped) as { xComms: Record<string, unknown> };
    assert.equal(env.xComms.version, 4);
    assert.equal(env.xComms.type, "x-comms.message");
    assert.equal(env.xComms.direction, "outgoing");
    assert.deepEqual(env.xComms.sender, {
      agentId: "agent-a",
      agentName: "Agent A",
      host: "host-a",
      daemonServerId: "srv_self",
      cwd: "/work/a",
    });
    assert.deepEqual(env.xComms.target, { daemon: "peer", agentId: "agent-b" });
    assert.equal(env.xComms.sentAt, SENT_AT);
  });

  it("keeps the body separate from the envelope block", () => {
    const stamped = buildSenderEnvelope({
      sender: { agentId: null, agentName: null, host: "h", daemonServerId: null, cwd: null },
      target: { daemon: null, agentId: null },
      sentAt: SENT_AT,
    });
    const withBody = `${stamped}\n\nhello there`;
    const parsed = parseEnvelope(withBody);
    assert.ok(parsed);
    assert.equal(parsed.body, "hello there");
  });

  it("tolerates a null sender and null target (id-only fallback)", () => {
    const stamped = buildSenderEnvelope({
      sender: { agentId: null, agentName: null, host: "h", daemonServerId: null, cwd: null },
      target: { daemon: null, agentId: null },
      sentAt: SENT_AT,
    });
    const env = envelopeObject(stamped) as { xComms: { sender: Record<string, unknown> } };
    assert.equal(env.xComms.sender.agentId, null);
    assert.equal(env.xComms.sender.daemonServerId, null);
  });
});

describe("local identity decision", () => {
  it("matches only when both ids are known and equal", () => {
    assert.equal(isLocalIdentity("srv_a", "srv_a"), true);
    assert.equal(isLocalIdentity("srv_a", "srv_b"), false);
  });

  it("never treats an unknown target or self as local", () => {
    assert.equal(isLocalIdentity(null, "srv_a"), false);
    assert.equal(isLocalIdentity("srv_a", null), false);
    assert.equal(isLocalIdentity(null, null), false);
  });
});

describe("send route decision", () => {
  it("routes to local only with a handle, a target id, and an identity match", () => {
    assert.equal(
      resolveSendRoute({ hasLocalPaseo: true, targetServerId: "srv_a", selfServerId: "srv_a" }),
      "local",
    );
  });

  it("falls back to remote without a local handle", () => {
    assert.equal(
      resolveSendRoute({ hasLocalPaseo: false, targetServerId: "srv_a", selfServerId: "srv_a" }),
      "remote",
    );
  });

  it("keeps an unresolved direct-host target on the remote path", () => {
    assert.equal(
      resolveSendRoute({ hasLocalPaseo: true, targetServerId: null, selfServerId: "srv_a" }),
      "remote",
    );
  });

  it("keeps a mismatched peer on the remote path", () => {
    assert.equal(
      resolveSendRoute({ hasLocalPaseo: true, targetServerId: "srv_b", selfServerId: "srv_a" }),
      "remote",
    );
  });

  it("keeps an unreadable self id on the remote path", () => {
    assert.equal(
      resolveSendRoute({ hasLocalPaseo: true, targetServerId: "srv_a", selfServerId: null }),
      "remote",
    );
  });
});

describe("self-message guard", () => {
  it("refuses a target equal to an explicit sender with the shared label", () => {
    assert.throws(
      () => assertNotSelfMessage("agent-a", "agent-a"),
      (cause: unknown) =>
        cause instanceof Error &&
        cause.message.startsWith(SELF_MESSAGE_LABEL) &&
        cause.message.includes("agent-a"),
    );
  });

  it("allows a different target and an absent sender", () => {
    assert.doesNotThrow(() => assertNotSelfMessage("agent-a", "agent-b"));
    assert.doesNotThrow(() => assertNotSelfMessage("agent-a", null));
  });
});
