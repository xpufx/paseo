import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  XCommsConversationsSnapshotSchema,
  emptyConversationsSnapshot,
} from "../shared/conversations-snapshot.ts";
import {
  detachLocalAgent,
  prunePeer,
  readConversationsSnapshot,
  reconcileTimelines,
  recordSend,
  scanLocalTimelines,
  writeConversationsSnapshot,
  type TimelineOwnerLike,
} from "./conversations-snapshot.ts";
import { buildSenderEnvelope } from "./local-send.ts";
import {
  loadMeshKey,
  meshPublicKey,
  meshSigner,
  resetMeshKeyCache,
  signEnvelopeAuth,
  verifierFor,
} from "./mesh-identity.ts";
import { parseEnvelope, verifyEnvelopeAuth, type EnvelopeAuthVerifier } from "../shared/envelope.ts";

/**
 * The reconcile gate is only meaningful against a real signature, so the
 * fixtures go through the production producer + signer. The pinned peer is this
 * process's own mesh key, which `withSandboxedHome` gives a fresh home per test.
 */
function peerVerifier(): EnvelopeAuthVerifier {
  return verifierFor([{ serverId: "srv_remote", ...meshPublicKey() }]);
}

/** A genuine cross-daemon delivery from `srv_remote`, signed by its daemon key. */
function envelope(senderAgentId: string, sentAt: string, serverId = "srv_remote"): string {
  return `${buildSenderEnvelope({
    sender: { agentId: senderAgentId, agentName: "Remote", host: "h", daemonServerId: serverId, cwd: null },
    target: { daemon: "local", agentId: "me" },
    sentAt,
    signer: meshSigner(),
  })}\n\nhello`;
}

/** The same delivery with no `auth` field: the pre-#594 hand-written shape. */
function unsignedEnvelope(senderAgentId: string, sentAt: string, serverId = "srv_remote"): string {
  const payload = {
    xComms: {
      version: 6,
      type: "x-comms.message",
      direction: "outgoing",
      sender: { agentId: senderAgentId, agentName: "Remote", host: "h", daemonServerId: serverId, cwd: null },
      target: { daemon: "local", agentId: "me" },
      sentAt,
    },
  };
  return `<x-comms-message>${JSON.stringify(payload)}</x-comms-message>\n\nhello`;
}

function legacyV5Envelope(senderAgentId: string, sentAt: string, serverId = "srv_remote"): string {
  const payload = {
    xComms: {
      version: 5,
      type: "x-comms.message",
      direction: "outgoing",
      sender: { agentId: senderAgentId, agentName: "Remote", host: "h", daemonServerId: serverId, cwd: null },
      target: { daemon: "local", agentId: "me" },
      sentAt,
    },
  };
  return `[x-comms] ${JSON.stringify(payload)}\n\nhello`;
}

/**
 * Envelope signing reads the daemon key out of the x-comms state dir, so every
 * test that builds a genuine envelope gets its own home and its own key. A
 * shared home would make the "different key per daemon" assertion meaningless
 * and let one test's pin leak into the next.
 */
let testHome: string;
let testPrevHome: string | undefined;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "xcomms-home-"));
  testPrevHome = process.env.HOME;
  process.env.HOME = testHome;
  resetMeshKeyCache();
});

afterEach(() => {
  if (testPrevHome === undefined) delete process.env.HOME;
  else process.env.HOME = testPrevHome;
  rmSync(testHome, { recursive: true, force: true });
  resetMeshKeyCache();
});

function withSandboxedHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "xcomms-home-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
}

function mockScanner(timelines: TimelineOwnerLike[]) {
  return {
    agents: {
      list: async () => ({ entries: timelines.map((t) => ({ agent: { id: t.ownerAgentId } })) }),
      ref: (id: string) => ({
        timeline: {
          refetch: async () => ({
            entries: timelines.find((t) => t.ownerAgentId === id)?.entries.map((e) => ({ item: e.item })) ?? [],
          }),
        },
      }),
    },
  };
}

describe("conversations snapshot", () => {
  it("validates a representative payload against the schema", () => {
    const payload = {
      version: 1,
      updatedAt: "2026-09-09T10:00:00.000Z",
      threads: [
        {
          peerAlias: "hsi",
          peerServerId: "srv_remote",
          peerAgentId: "peer-1",
          peerAgentName: "Remote",
          localAgentIds: ["me"],
          lastDirection: "incoming",
          lastTimestamp: "2026-09-09T10:00:00.000Z",
          lastReadAt: "2026-09-09T09:00:00.000Z",
          lastSeenAt: "2026-09-09T10:00:00.000Z",
          unreadCount: 2,
        },
      ],
    };
    const parsed = XCommsConversationsSnapshotSchema.safeParse(payload);
    assert.equal(parsed.success, true);
    assert.equal(XCommsConversationsSnapshotSchema.safeParse({ ...payload, version: 2 }).success, false);
  });

  it("records a send with zero unread and an advanced watermark", () => {
    const next = recordSend(emptyConversationsSnapshot(), {
      peerAlias: "hsi",
      peerServerId: "srv_remote",
      peerAgentId: "peer-1",
      peerAgentName: null,
      localAgentId: "me",
      at: "2026-09-09T10:00:00.000Z",
    });
    assert.equal(next.threads.length, 1);
    assert.equal(next.threads[0].lastDirection, "outgoing");
    assert.equal(next.threads[0].unreadCount, 0);
    assert.deepEqual(next.threads[0].localAgentIds, ["me"]);
  });

  it("reconciles receives from timelines without double-counting rescans", () => {
    const timelines: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [{ item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } }],
    }];
    const once = reconcileTimelines(emptyConversationsSnapshot(), timelines, () => "hsi", peerVerifier());
    assert.equal(once.threads.length, 1);
    assert.equal(once.threads[0].lastDirection, "incoming");
    assert.equal(once.threads[0].unreadCount, 1);
    const twice = reconcileTimelines(once, timelines, () => "hsi", peerVerifier());
    assert.equal(twice.threads[0].unreadCount, 1);
  });

  it("counts only messages newer than the last scan", () => {
    const first: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [{ item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } }],
    }];
    const once = reconcileTimelines(emptyConversationsSnapshot(), first, () => "hsi", peerVerifier());
    assert.equal(once.threads[0].unreadCount, 1);
    const second: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [
        { item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } },
        { item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:05:00.000Z") } },
      ],
    }];
    const twice = reconcileTimelines(once, second, () => "hsi", peerVerifier());
    assert.equal(twice.threads[0].unreadCount, 2);
    assert.equal(twice.threads[0].lastTimestamp, "2026-09-09T10:05:00.000Z");
  });

  it("parses a v5 and a v6 envelope into the same thread shape", () => {
    // Both wire forms still *parse*; the reconcile gate is what refuses to
    // attribute the unsigned one. Parsing and trusting are separate questions.
    const shape = (text: string) =>
      parseEnvelope(text)?.envelope.xComms.sender;
    assert.deepEqual(
      shape(legacyV5Envelope("peer-1", "2026-09-09T10:00:00.000Z")),
      shape(envelope("peer-1", "2026-09-09T10:00:00.000Z")),
    );
  });

  it("a send after receives resets unread", () => {
    const timelines: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [{ item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } }],
    }];
    const received = reconcileTimelines(emptyConversationsSnapshot(), timelines, () => "hsi", peerVerifier());
    const sent = recordSend(received, {
      peerAlias: "hsi",
      peerServerId: "srv_remote",
      peerAgentId: "peer-1",
      peerAgentName: null,
      localAgentId: "me",
      at: "2026-09-09T11:00:00.000Z",
    });
    assert.equal(sent.threads[0].unreadCount, 0);
    assert.equal(sent.threads[0].lastDirection, "outgoing");
  });

  it("scans local timelines through the structural scanner", async () => {
    const timelines: TimelineOwnerLike[] = [{
      ownerAgentId: "me",
      entries: [{ item: { type: "user_message", text: envelope("peer-1", "2026-09-09T10:00:00.000Z") } }],
    }];
    const scanned = await scanLocalTimelines(mockScanner(timelines));
    assert.equal(scanned.length, 1);
    assert.equal(scanned[0].ownerAgentId, "me");
    assert.equal(scanned[0].entries.length, 1);
  });

  it("prunes threads on retract", () => {
    const full = recordSend(emptyConversationsSnapshot(), {
      peerAlias: "hsi",
      peerServerId: "srv_remote",
      peerAgentId: "peer-1",
      peerAgentName: null,
      localAgentId: "me",
      at: "2026-09-09T10:00:00.000Z",
    });
    const { snapshot, removed } = prunePeer(full, "srv_remote", "peer-1");
    assert.equal(removed, true);
    assert.equal(snapshot.threads.length, 0);
    assert.equal(prunePeer(full, "srv_other", "peer-1").removed, false);
  });

  it("detaches archived local agents and drops emptied threads", () => {
    let state = recordSend(emptyConversationsSnapshot(), {
      peerAlias: "hsi",
      peerServerId: "srv_remote",
      peerAgentId: "peer-1",
      peerAgentName: null,
      localAgentId: "me",
      at: "2026-09-09T10:00:00.000Z",
    });
    const untouched = detachLocalAgent(state, "someone-else");
    assert.equal(untouched.removed, false);
    assert.equal(untouched.snapshot.threads.length, 1);
    state = untouched.snapshot;
    const dropped = detachLocalAgent(state, "me");
    assert.equal(dropped.removed, true);
    assert.equal(dropped.snapshot.threads.length, 0);
  });

  it("persists and reloads the snapshot round-trip", () => {
    withSandboxedHome(() => {
      const written = recordSend(emptyConversationsSnapshot(), {
        peerAlias: "hsi",
        peerServerId: "srv_remote",
        peerAgentId: "peer-1",
        peerAgentName: "Remote",
        localAgentId: "me",
        at: "2026-09-09T10:00:00.000Z",
      });
      writeConversationsSnapshot(written);
      const read = readConversationsSnapshot();
      assert.equal(read.threads.length, 1);
      assert.equal(read.threads[0].peerAlias, "hsi");
      assert.equal(XCommsConversationsSnapshotSchema.safeParse(read).success, true);
    });
  });
});

describe("inbound envelope authentication (#594)", () => {
  function timelineWith(text: string): TimelineOwnerLike[] {
    return [{ ownerAgentId: "me", entries: [{ item: { type: "user_message", text } }] }];
  }

  function reconciled(text: string) {
    return reconcileTimelines(emptyConversationsSnapshot(), timelineWith(text), () => "hsi", peerVerifier());
  }

  /**
   * A forgery must be refused *as a forgery*: the envelope still parses, still
   * carries the genuine peer's auth block, and the signature check is what says
   * no. Asserting the tampered value is what was actually claimed keeps the test
   * from passing for an unrelated reason.
   */
  function assertForgeryRejected(forged: string, claimed: string): void {
    const parsed = parseEnvelope(forged);
    assert.ok(parsed, "the forged envelope must still parse; a parse failure would hide the real bug");
    assert.ok(parsed.envelope.xComms.auth, "the forgery must still carry the genuine auth block");
    const status = verifyEnvelopeAuth(parsed.envelope, peerVerifier());
    assert.equal(status, "invalid", "a tampered field must invalidate the signature");
    assert.ok(
      JSON.stringify(parsed.envelope.xComms).includes(claimed),
      "the tampered claim must be the one the envelope actually carries",
    );
  }

  it("attributes a genuinely signed delivery (round trip)", () => {
    const snapshot = reconciled(envelope("peer-1", "2026-09-09T10:00:00.000Z"));
    assert.equal(snapshot.threads.length, 1);
    assert.equal(snapshot.threads[0].peerAgentId, "peer-1");
    assert.equal(snapshot.threads[0].unreadCount, 1);
  });

  it("refuses a hand-written envelope with no auth field", () => {
    const snapshot = reconciled(unsignedEnvelope("peer-1", "2026-09-09T10:00:00.000Z"));
    assert.equal(snapshot.threads.length, 0, "an unsigned envelope must not become a thread");
  });

  it("refuses a forged sender claiming a different agent", () => {
    // The attack from the issue: a real peer's genuine message, with the
    // sender.agentId swapped for someone else. The signature covers that field,
    // so the swap invalidates it — and it is rejected as *invalid*, not merely
    // skipped for failing to parse, which would hide a much blunter bug.
    const genuine = envelope("peer-1", "2026-09-09T10:00:00.000Z");
    const forged = genuine.replace('"agentId":"peer-1"', '"agentId":"peer-2"');
    assert.notEqual(forged, genuine, "the fixture must actually differ");
    assertForgeryRejected(forged, "peer-2");
    assert.equal(reconciled(forged).threads.length, 0);
  });

  it("refuses a forged sender claiming a different daemon", () => {
    const genuine = envelope("peer-1", "2026-09-09T10:00:00.000Z");
    const forged = genuine.replace('"daemonServerId":"srv_remote"', '"daemonServerId":"srv_victim"');
    assertForgeryRejected(forged, "srv_victim");
    assert.equal(reconciled(forged).threads.length, 0);
  });

  it("refuses a tampered sentAt, which would rewrite the read watermark", () => {
    const genuine = envelope("peer-1", "2026-09-09T10:00:00.000Z");
    const forged = genuine.replace("2026-09-09T10:00:00.000Z", "2027-01-01T00:00:00.000Z");
    assertForgeryRejected(forged, "peer-1");
    assert.equal(reconciled(forged).threads.length, 0);
  });

  it("refuses a signature from a key this daemon has not pinned", () => {
    const stranger = (() => {
      const dir = mkdtempSync(join(tmpdir(), "xcomms-stranger-"));
      const key = loadMeshKey(dir);
      rmSync(dir, { recursive: true, force: true });
      resetMeshKeyCache();
      return key;
    })();
    const payload = {
      xComms: {
        version: 6,
        type: "x-comms.message",
        direction: "outgoing",
        sender: { agentId: "peer-1", agentName: "Remote", host: "h", daemonServerId: "srv_remote", cwd: null },
        target: { daemon: "local", agentId: "me" },
        sentAt: "2026-09-09T10:00:00.000Z",
        auth: {
          v: 1,
          alg: "ed25519",
          keyId: stranger.keyId,
          sig: signEnvelopeAuth("x-comms/envelope-auth/v1\n6\nx-comms.message\npeer-1\n").sig,
        },
      },
    };
    const snapshot = reconciled(`<x-comms-message>${JSON.stringify(payload)}</x-comms-message>\n\nhello`);
    assert.equal(snapshot.threads.length, 0);
  });

  it("refuses every envelope when the verifier has no keys at all", () => {
    const snapshot = reconcileTimelines(
      emptyConversationsSnapshot(),
      timelineWith(envelope("peer-1", "2026-09-09T10:00:00.000Z")),
      () => "hsi",
      verifierFor([]),
    );
    assert.equal(snapshot.threads.length, 0, "an unpeered message must not be attributed");
  });
});
