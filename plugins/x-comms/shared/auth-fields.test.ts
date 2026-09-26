import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_FIELDS,
  canonicalAuthPayload,
  authPayloadSafe,
  type CrossDaemonEnvelope,
} from "./envelope.ts";

/**
 * Every AUTH_FIELDS entry must actually be inside the signed payload (#619).
 *
 * `canonicalAuthPayload` is pure string work — no crypto — so this does not need
 * a keypair to answer the real question. A signature only protects what it
 * covers, so the question is not "is the field in the list" but "does changing
 * the field change the signed payload". A field listed but not read would leave
 * the payload byte-identical and forgeable.
 */

function envelope(): CrossDaemonEnvelope {
  return {
    xComms: {
      version: 1,
      type: "message",
      direction: "outgoing",
      sender: {
        agentId: "agent-1",
        agentName: "Worker One",
        host: "desktop",
        daemonServerId: "srv_1",
        cwd: "/home/u/proj",
      },
      target: { daemon: "srv_2", agentId: "agent-2" },
      messageId: "msg-1",
      sentAt: "2026-09-26T00:00:00.000Z",
    },
  };
}

/** Rewrite one dotted path to a different, still schema-valid value. */
function withField(env: CrossDaemonEnvelope, field: string, value: unknown): CrossDaemonEnvelope {
  const clone = structuredClone(env) as CrossDaemonEnvelope;
  const parts = field.split(".");
  if (parts.length === 1) {
    // version, type, messageId, sentAt live directly on xComms.
    (clone.xComms as unknown as Record<string, unknown>)[parts[0]] = value;
    return clone;
  }
  const [head, tail] = parts as [string, string];
  const target = (clone.xComms as unknown as Record<string, Record<string, unknown>>)[head];
  target[tail] = value;
  return clone;
}

describe("signed auth fields (#619)", () => {
  it("pins the exact field set, so a dropped entry fails here", () => {
    assert.deepEqual(
      [...AUTH_FIELDS],
      [
      "version",
      "type",
      "sender.agentId",
      "sender.agentName",
      "sender.host",
      "sender.daemonServerId",
      "sender.cwd",
      "target.daemon",
      "target.agentId",
      "messageId",
        "sentAt",
      ],
    );
  });

  it("every listed field changes the signed payload when mutated", () => {
    // The real assertion. A field that is in AUTH_FIELDS but never read by
    // authFieldValue would leave the payload identical and stay forgeable.
    const base = canonicalAuthPayload(envelope());
    const mutations: Record<string, unknown> = {
      version: 99,
      type: "tampered",
      "sender.agentId": "attacker",
      "sender.agentName": "Impostor",
      "sender.host": "elsewhere",
      "sender.daemonServerId": "srv_evil",
      "sender.cwd": "/etc",
      "target.daemon": "srv_evil",
      "target.agentId": "agent-99",
      messageId: "msg-2",
      sentAt: "2020-01-01T00:00:00.000Z",
    };
    for (const field of AUTH_FIELDS) {
      const mutated = canonicalAuthPayload(withField(envelope(), field, mutations[field]));
      assert.notEqual(
        mutated,
        base,
        `field "${field}" is listed but does not affect the signed payload`,
      );
    }
  });

  it("catches every listed field — no untested entries", () => {
    // Guards the test above: a field added to AUTH_FIELDS without a mutation
    // case would otherwise be silently unproven.
    const covered = new Set([
      "version", "type", "sender.agentId", "sender.agentName", "sender.host",
      "sender.daemonServerId", "sender.cwd", "target.daemon", "target.agentId",
      "messageId", "sentAt",
    ]);
    for (const field of AUTH_FIELDS) {
      assert.ok(covered.has(field), `no mutation case for newly added field "${field}"`);
    }
  });

  it("still signs absent optionals as empty rather than dropping the line", () => {
    // messageId is optional. If it were skipped when absent, a present/absent
    // pair could produce the same payload and shift every later field.
    const without = structuredClone(envelope()) as CrossDaemonEnvelope;
    delete without.xComms.messageId;
    const a = canonicalAuthPayload(envelope()).split("\n");
    const b = canonicalAuthPayload(without).split("\n");
    assert.equal(a.length, b.length);
    assert.notDeepEqual(a, b);
  });

  it("rejects a newline in any signed field rather than escaping it", () => {
    // A newline would forge a field boundary in the newline-joined payload.
    assert.equal(authPayloadSafe(envelope()), true);
    assert.equal(authPayloadSafe(withField(envelope(), "sender.cwd", "/tmp\nspoof")), false);
  });
});
