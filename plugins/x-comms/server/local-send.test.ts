import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ENVELOPE_OPEN, ENVELOPE_CLOSE, META_PREFIX, parseEnvelope } from "../shared/envelope.ts";
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
  it("uses the <x-comms-message> tags shared with the MCP server", () => {
    assert.equal(ENVELOPE_OPEN, "<x-comms-message>");
    assert.equal(ENVELOPE_CLOSE, "</x-comms-message>");
    assert.equal(ENVELOPE_PREFIX, META_PREFIX);
  });

  it("produces a version-6 envelope with its delivery messageId", () => {
    const stamped = buildSenderEnvelope({
      sender: {
        agentId: "agent-a",
        agentName: "Agent A",
        host: "host-a",
        daemonServerId: "srv_self",
        cwd: "/work/a",
      },
      target: { daemon: "peer", agentId: "agent-b" },
      messageId: "msg-native-1",
      sentAt: SENT_AT,
    });
    assert.ok(stamped.startsWith("<x-comms-message>"));
    assert.ok(stamped.endsWith("</x-comms-message>"));
    const env = envelopeObject(stamped) as { xComms: Record<string, unknown> };
    assert.equal(env.xComms.version, 6);
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
    assert.equal(env.xComms.messageId, "msg-native-1");
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

describe("dual-parsing v5 and v6 envelopes", () => {
  it("parses both v5 and v6 into identical CrossDaemonEnvelope structures", () => {
    const common = {
      type: "x-comms.message",
      direction: "outgoing" as const,
      sender: {
        agentId: "agent-a",
        agentName: "Agent A",
        host: "host-a",
        daemonServerId: "srv_self",
        cwd: "/work/a",
      },
      target: { daemon: "peer", agentId: "agent-b" },
      messageId: "msg-dual-1",
      sentAt: SENT_AT,
    };

    const v5Wire = `[x-comms] ${JSON.stringify({ xComms: { version: 5, ...common } })}\n\nhello dual parse`;
    const v6Wire = `<x-comms-message>${JSON.stringify({ xComms: { version: 6, ...common } })}</x-comms-message>\n\nhello dual parse`;

    const parsedV5 = parseEnvelope(v5Wire);
    const parsedV6 = parseEnvelope(v6Wire);

    assert.ok(parsedV5);
    assert.ok(parsedV6);
    assert.equal(parsedV5.body, "hello dual parse");
    assert.equal(parsedV6.body, "hello dual parse");

    // Identical CrossDaemonEnvelope structure fields
    assert.equal(parsedV5.envelope.xComms.type, parsedV6.envelope.xComms.type);
    assert.equal(parsedV5.envelope.xComms.direction, parsedV6.envelope.xComms.direction);
    assert.deepEqual(parsedV5.envelope.xComms.sender, parsedV6.envelope.xComms.sender);
    assert.deepEqual(parsedV5.envelope.xComms.target, parsedV6.envelope.xComms.target);
    assert.equal(parsedV5.envelope.xComms.messageId, parsedV6.envelope.xComms.messageId);
    assert.equal(parsedV5.envelope.xComms.sentAt, parsedV6.envelope.xComms.sentAt);

    // Exact structure equality when payload is identical
    const v5Same = `[x-comms] ${JSON.stringify({ xComms: { version: 6, ...common } })}\n\nhello`;
    const v6Same = `<x-comms-message>${JSON.stringify({ xComms: { version: 6, ...common } })}</x-comms-message>\n\nhello`;
    assert.deepEqual(parseEnvelope(v5Same)?.envelope, parseEnvelope(v6Same)?.envelope);
  });

  it("rejects unclosed or malformed v6 envelopes", () => {
    assert.equal(parseEnvelope("<x-comms-message>{\"xComms\":{}}"), null);
    assert.equal(parseEnvelope("<x-comms-message>not json</x-comms-message>"), null);
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
