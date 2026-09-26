import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildXCommsEnvelope,
  canonicalAuthPayload,
  parseEnvelope,
  verifyEnvelopeAuth,
  type CrossDaemonEnvelope,
  type EnvelopeAuthSigner,
  type EnvelopeAuthVerifier,
  type KnownEnvelopeAuth,
} from "./envelope.ts";

const SENT_AT = "2026-09-25T12:00:00.000Z";

const SENDER = {
  agentId: "agent-a",
  agentName: "Agent A",
  host: "host-a",
  daemonServerId: "srv_a",
  cwd: "/work/a",
};

const TARGET = { daemon: "peer", agentId: "agent-b" };

/**
 * A stand-in for the node:crypto verifier the daemon supplies. It only ever
 * accepts one exact payload, so any mutation of the signed fields turns the
 * verdict to `invalid` — the same shape `mesh-identity.ts` produces.
 */
function fixedVerifier(expectedPayload: string): EnvelopeAuthVerifier {
  return (payload, auth) => auth.keyId === "k1" && payload === expectedPayload;
}

const STUB_AUTH: KnownEnvelopeAuth = { v: 1, alg: "ed25519", keyId: "k1", sig: "c2ln" };

const stubSigner: EnvelopeAuthSigner = () => STUB_AUTH;

/** A signer that records the payload it was handed, so a verifier can pin it. */
function recordingSigner(seen: string[]): EnvelopeAuthSigner {
  return (payload) => {
    seen.push(payload);
    return STUB_AUTH;
  };
}

function parse(text: string): CrossDaemonEnvelope {
  const parsed = parseEnvelope(text);
  assert.ok(parsed, "expected a parseable envelope");
  return parsed.envelope;
}

describe("envelope auth contract", () => {
  it("reports a missing auth field rather than failing to parse", () => {
    // Backward compatibility is the point: a v6 reader that predates `auth` must
    // still read these, so "unsigned" is a trust verdict, not a parse error.
    const wire = buildXCommsEnvelope({ sender: SENDER, target: TARGET, sentAt: SENT_AT });
    assert.equal(parse(wire).xComms.auth, undefined);
    assert.equal(verifyEnvelopeAuth(parse(wire), () => true), "missing");
  });

  it("verifies an envelope the builder signed", () => {
    const seen: string[] = [];
    const wire = buildXCommsEnvelope({
      sender: SENDER,
      target: TARGET,
      messageId: "msg-1",
      sentAt: SENT_AT,
      signer: recordingSigner(seen),
    });
    const envelope = parse(wire);
    assert.equal(verifyEnvelopeAuth(envelope, fixedVerifier(seen[0])), "verified");
  });

  it("rejects a sender swapped after signing", () => {
    // The verifier only accepts the exact payload the signer saw, so a swapped
    // field cannot be waved through. This is the #594 forgery.
    const signed: string[] = [];
    const wire = buildXCommsEnvelope({
      sender: SENDER,
      target: TARGET,
      sentAt: SENT_AT,
      signer: recordingSigner(signed),
    });
    const forged = parse(wire.replace('"agentId":"agent-a"', '"agentId":"agent-victim"'));
    assert.equal(forged.xComms.sender.agentId, "agent-victim");
    assert.equal(canonicalAuthPayload(forged) === signed[0], false);
    assert.equal(verifyEnvelopeAuth(forged, fixedVerifier(signed[0])), "invalid");
  });

  it("rejects a target swapped after signing", () => {
    const signed: string[] = [];
    const wire = buildXCommsEnvelope({
      sender: SENDER,
      target: TARGET,
      sentAt: SENT_AT,
      signer: recordingSigner(signed),
    });
    const forged = parse(wire.replace('"agentId":"agent-b"', '"agentId":"agent-c"'));
    assert.equal(verifyEnvelopeAuth(forged, fixedVerifier(signed[0])), "invalid");
  });

  it("treats an unknown key as unverifiable, never as a pass", () => {
    const wire = buildXCommsEnvelope({
      sender: SENDER,
      target: TARGET,
      sentAt: SENT_AT,
      signer: stubSigner,
    });
    // A verifier with no key material returns null; the envelope must land on
    // `invalid` so an unpinned peer is never attributed.
    assert.equal(verifyEnvelopeAuth(parse(wire), () => null), "invalid");
  });

  it("keeps parsing an envelope whose auth block this build cannot check", () => {
    // A future sender using a different algorithm must not make the message
    // disappear: it parses, and it is simply never trusted.
    const wire =
      '<x-comms-message>{"xComms":{"version":6,"type":"x-comms.message","sender":' +
      '{"agentId":"a","agentName":null,"host":"h","daemonServerId":null,"cwd":null},' +
      '"target":{"daemon":null,"agentId":null},"sentAt":"2026-01-01T00:00:00.000Z",' +
      '"auth":{"v":9,"alg":"ml-dsa-44","keyId":"k9","sig":"c2ln"}}}<\/x-comms-message>\n\nbody';
    const parsed = parseEnvelope(wire);
    assert.ok(parsed, "a version-skewed auth block must not make the message vanish");
    assert.equal(parsed.body, "body");
    assert.equal(parsed.envelope.xComms.sender.agentId, "a");
    assert.equal(verifyEnvelopeAuth(parsed.envelope, () => true), "invalid");
  });

  it("keeps parsing an envelope with an empty auth block", () => {
    const wire =
      '<x-comms-message>{"xComms":{"version":6,"type":"x-comms.message","sender":' +
      '{"agentId":"a","agentName":null,"host":"h","daemonServerId":null,"cwd":null},' +
      '"target":{"daemon":null,"agentId":null},"sentAt":"2026-01-01T00:00:00.000Z",' +
      '"auth":{"v":1,"alg":"ed25519","keyId":"","sig":""}}}<\/x-comms-message>';
    const parsed = parseEnvelope(wire);
    assert.ok(parsed, "an empty auth block is untrusted, not unreadable");
    assert.equal(verifyEnvelopeAuth(parsed.envelope, () => true), "invalid");
  });

  it("signs the same payload whether the auth is added or not", () => {
    const signed = buildXCommsEnvelope({
      sender: SENDER,
      target: TARGET,
      messageId: "msg-1",
      sentAt: SENT_AT,
      signer: (payload) => {
        assert.equal(
          payload,
          canonicalAuthPayload(
            parseEnvelope(buildXCommsEnvelope({ sender: SENDER, target: TARGET, messageId: "msg-1", sentAt: SENT_AT }))!.envelope,
          ),
        );
        return STUB_AUTH;
      },
    });
    assert.ok(signed.includes('"auth"'));
  });
});
