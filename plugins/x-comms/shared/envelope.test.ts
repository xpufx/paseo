import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildXCommsEnvelope,
  parseEnvelope,
  type CrossDaemonEnvelope,
} from "./envelope.ts";
import { directHostMismatch } from "./registry.ts";

const SENT_AT = "2026-09-25T12:00:00.000Z";

const SENDER = {
  agentId: "agent-a",
  agentName: "Agent A",
  host: "host-a",
  daemonServerId: "srv_a",
  cwd: "/work/a",
};

const TARGET = { daemon: "peer", agentId: "agent-b" };

function parse(text: string): CrossDaemonEnvelope {
  const parsed = parseEnvelope(text);
  assert.ok(parsed, "expected a parseable envelope");
  return parsed.envelope;
}

describe("envelope wire contract", () => {
  it("builds a version-6 envelope with the attribution fields as plain claims", () => {
    const wire = buildXCommsEnvelope({
      sender: SENDER,
      target: TARGET,
      messageId: "msg-1",
      sentAt: SENT_AT,
    });
    const envelope = parse(wire);
    assert.equal(envelope.xComms.version, 6);
    assert.equal(envelope.xComms.type, "x-comms.message");
    assert.equal(envelope.xComms.direction, "outgoing");
    assert.deepEqual(envelope.xComms.sender, SENDER);
    assert.deepEqual(envelope.xComms.target, TARGET);
    assert.equal(envelope.xComms.messageId, "msg-1");
    assert.equal(envelope.xComms.sentAt, SENT_AT);
  });

  it("omits messageId when not given", () => {
    const wire = buildXCommsEnvelope({ sender: SENDER, target: TARGET, sentAt: SENT_AT });
    assert.equal(parse(wire).xComms.messageId, undefined);
  });

  it("keeps the body separate from the envelope block", () => {
    const wire = buildXCommsEnvelope({ sender: SENDER, target: TARGET, sentAt: SENT_AT });
    const parsed = parseEnvelope(`${wire}\n\nhello there`);
    assert.ok(parsed);
    assert.equal(parsed.body, "hello there");
  });

  it("parses the legacy v5 prefix form into the same structure", () => {
    const v5 = `[x-comms] ${JSON.stringify({
      xComms: {
        version: 5,
        type: "x-comms.message",
        direction: "outgoing",
        sender: SENDER,
        target: TARGET,
        messageId: "msg-dual-1",
        sentAt: SENT_AT,
      },
    })}\n\nhello dual parse`;
    const parsed = parseEnvelope(v5);
    assert.ok(parsed);
    assert.equal(parsed.envelope.xComms.version, 5);
    assert.equal(parsed.body, "hello dual parse");
    assert.deepEqual(parsed.envelope.xComms.sender, SENDER);
  });

  it("parses v5 and v6 forms of the same payload identically apart from version", () => {
    const common = {
      type: "x-comms.message",
      direction: "outgoing" as const,
      sender: SENDER,
      target: TARGET,
      messageId: "msg-dual-1",
      sentAt: SENT_AT,
    };
    const v5 = `[x-comms] ${JSON.stringify({ xComms: { version: 5, ...common } })}\n\nhello`;
    const v6 = `<x-comms-message>${JSON.stringify({ xComms: { version: 6, ...common } })}</x-comms-message>\n\nhello`;
    const parsedV5 = parseEnvelope(v5);
    const parsedV6 = parseEnvelope(v6);
    assert.ok(parsedV5);
    assert.ok(parsedV6);
    assert.equal(parsedV5.body, "hello");
    assert.equal(parsedV6.body, "hello");
    assert.deepEqual(parsedV5.envelope.xComms.sender, parsedV6.envelope.xComms.sender);
    assert.deepEqual(parsedV5.envelope.xComms.target, parsedV6.envelope.xComms.target);
    assert.equal(parsedV5.envelope.xComms.messageId, parsedV6.envelope.xComms.messageId);
    assert.equal(parsedV5.envelope.xComms.sentAt, parsedV6.envelope.xComms.sentAt);
  });

  it("rejects unclosed or malformed v6 envelopes", () => {
    assert.equal(parseEnvelope("<x-comms-message>{\"xComms\":{}}"), null);
    assert.equal(parseEnvelope("<x-comms-message>not json</x-comms-message>"), null);
  });

  it("does not treat ordinary prose as a delivery", () => {
    assert.equal(parseEnvelope("Can you take a look at the failing test?"), null);
    assert.equal(parseEnvelope(`A user pasted ${"<x-comms-message>"} mid-sentence`), null);
  });
});

describe("directHostMismatch custom aliases (#1367)", () => {
  it("returns null for arbitrary custom aliases without enforcing host name matching", () => {
    assert.equal(directHostMismatch("my-laptop", "192.168.1.100:6767"), null);
    assert.equal(directHostMismatch("desktop", "tcp://10.0.0.5:6767"), null);
    assert.equal(directHostMismatch("remote", "https://app.paseo.sh/#offer=xyz"), null);
  });
});
