import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTH_ALG,
  MESH_KEY_FILE,
  loadMeshKey,
  meshPublicKey,
  meshSigner,
  resetMeshKeyCache,
  signEnvelopeAuth,
  verifierFor,
} from "./mesh-identity.ts";
import { emptyMeshKeysState, pinnedKeys, recordPeerKey } from "./mesh-keys.ts";
import { MESH_KEY_METHOD, fetchPeerMeshKey, type PeerTarget } from "./peer-channel.ts";
import { meshKeyGetRpc } from "../shared/registry.ts";
import {
  authPayloadSafe,
  canonicalAuthPayload,
  verifyEnvelopeAuth,
  type CrossDaemonEnvelope,
} from "../shared/envelope.ts";

const PAYLOAD = "x-comms/envelope-auth/v1\n6\nx-comms.message\nagent-a\n";

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xcomms-key-"));
  resetMeshKeyCache();
  return dir;
}

function withTempDir(fn: (dir: string) => void): void {
  const dir = tempDir();
  try {
    fn(dir);
  } finally {
    resetMeshKeyCache();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("mesh key", () => {
  it("generates a key on first use and reuses it afterwards", () => {
    withTempDir((dir) => {
      const first = loadMeshKey(dir);
      resetMeshKeyCache();
      const second = loadMeshKey(dir);
      assert.equal(second.keyId, first.keyId);
      assert.equal(second.privateKeyPem, first.privateKeyPem);
    });
  });

  it("issues a different key per state dir", () => {
    withTempDir((a) => {
      withTempDir((b) => {
        assert.notEqual(loadMeshKey(a).keyId, loadMeshKey(b).keyId);
      });
    });
  });

  it("writes the key file 0600 because it is private key material", () => {
    withTempDir((dir) => {
      loadMeshKey(dir);
      const mode = statSync(join(dir, MESH_KEY_FILE)).mode & 0o777;
      assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
    });
  });

  it("reloads the persisted key rather than regenerating it", () => {
    withTempDir((dir) => {
      const generated = loadMeshKey(dir);
      const persisted = JSON.parse(readFileSync(join(dir, MESH_KEY_FILE), "utf8"));
      assert.equal(persisted.keyId, generated.keyId);
      assert.equal(typeof persisted.privateKeyPem, "string");
    });
  });

  it("publishes the public half without the private key", () => {
    withTempDir((dir) => {
      const publicKey = meshPublicKey();
      assert.ok(publicKey.keyId.startsWith("xck1:"));
      assert.match(publicKey.publicKeyPem, /^-----BEGIN PUBLIC KEY-----/);
      assert.ok(!publicKey.publicKeyPem.includes("PRIVATE"));
    });
  });
});

describe("envelope signature round trip", () => {
  it("verifies a signature it just made", () => {
    withTempDir(() => {
      const auth = signEnvelopeAuth(PAYLOAD);
      assert.equal(auth.v, 1);
      assert.equal(auth.alg, AUTH_ALG);
      const verify = verifierFor([{ serverId: "srv_peer", ...meshPublicKey() }]);
      assert.equal(verify(PAYLOAD, auth), true);
    });
  });

  it("rejects a signature over a different payload", () => {
    withTempDir(() => {
      const auth = signEnvelopeAuth(PAYLOAD);
      const verify = verifierFor([{ serverId: "srv_peer", ...meshPublicKey() }]);
      assert.equal(verify(`${PAYLOAD}agent-b\n`, auth), false);
    });
  });

  it("rejects a signature from a key the receiver has not pinned", () => {
    withTempDir((attackerDir) => {
      const attack = loadMeshKey(attackerDir);
      const verify = verifierFor([{ serverId: "srv_peer", ...meshPublicKey() }]);
      assert.equal(
        verify(PAYLOAD, {
          v: 1,
          alg: AUTH_ALG,
          keyId: attack.keyId,
          sig: signEnvelopeAuth(PAYLOAD).sig,
        }),
        null,
        "an unknown keyId must be 'no key', never a pass",
      );
    });
  });

  it("rejects a signature that is not valid base64url", () => {
    withTempDir(() => {
      const verify = verifierFor([{ serverId: "srv_peer", ...meshPublicKey() }]);
      const auth = signEnvelopeAuth(PAYLOAD);
      assert.equal(verify(PAYLOAD, { ...auth, sig: "not base64!!" }), false);
    });
  });

  it("refuses a keyId that does not match the key bytes it names", () => {
    withTempDir((otherDir) => {
      const foreign = loadMeshKey(otherDir);
      const verify = verifierFor([{ serverId: "srv_peer", ...meshPublicKey() }]);
      const auth = signEnvelopeAuth(PAYLOAD);
      assert.equal(verify(PAYLOAD, { ...auth, keyId: foreign.keyId }), null);
    });
  });

  it("exposes a signer usable by the envelope builders", () => {
    withTempDir(() => {
      const auth = meshSigner()(PAYLOAD);
      assert.equal(verifierFor([{ serverId: "srv_peer", ...meshPublicKey() }])(PAYLOAD, auth), true);
    });
  });
});

describe("pinned peer keys", () => {
  it("pins a peer's key and hands it back for verification", () => {
    withTempDir((peerDir) => {
      const peer = loadMeshKey(peerDir);
      const state = emptyMeshKeysState();
      const outcome = recordPeerKey(state, {
        serverId: "srv_peer",
        keyId: peer.keyId,
        publicKeyPem: peer.publicKeyPem,
      });
      assert.deepEqual(outcome, { pinned: true, changed: true, reason: null });
      assert.deepEqual(pinnedKeys(state), [
        { serverId: "srv_peer", keyId: peer.keyId, publicKeyPem: peer.publicKeyPem },
      ]);
    });
  });

  it("is a no-op when the same key arrives again", () => {
    withTempDir((peerDir) => {
      const peer = loadMeshKey(peerDir);
      const state = emptyMeshKeysState();
      const key = { serverId: "srv_peer", keyId: peer.keyId, publicKeyPem: peer.publicKeyPem };
      recordPeerKey(state, key);
      assert.deepEqual(recordPeerKey(state, key), { pinned: true, changed: false, reason: null });
    });
  });

  it("refuses a substituted key for an already pinned peer", () => {
    withTempDir((a) => {
      withTempDir((b) => {
        const first = loadMeshKey(a);
        const second = loadMeshKey(b);
        const state = emptyMeshKeysState();
        recordPeerKey(state, { serverId: "srv_peer", keyId: first.keyId, publicKeyPem: first.publicKeyPem });
        const outcome = recordPeerKey(state, {
          serverId: "srv_peer",
          keyId: second.keyId,
          publicKeyPem: second.publicKeyPem,
        });
        assert.equal(outcome.pinned, false);
        assert.match(String(outcome.reason), /already pinned/);
        assert.equal(state.pinned.srv_peer, first.keyId, "the original pin must survive");
      });
    });
  });

  it("refuses a key whose keyId is a lie about its own bytes", () => {
    withTempDir((peerDir) => {
      const peer = loadMeshKey(peerDir);
      const outcome = recordPeerKey(emptyMeshKeysState(), {
        serverId: "srv_peer",
        keyId: "xck1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        publicKeyPem: peer.publicKeyPem,
      });
      assert.equal(outcome.pinned, false);
      assert.match(String(outcome.reason), /does not match/);
    });
  });
});

describe("mesh key RPC wiring", () => {
  it("uses one method name for the contract and the caller", () => {
    // The RPC contract and the peer-channel caller each name this method; if they
    // drift, key fetches silently 404 and every envelope stays unattributable
    // with no error anywhere.
    assert.equal(meshKeyGetRpc.name, MESH_KEY_METHOD);
    assert.equal(meshKeyGetRpc.name, "mesh.key");
  });
});

describe("fetching a peer key over the link", () => {
  const relayTarget: PeerTarget = {
    name: "hsi",
    endpoint: "https://app.paseo.sh/#offer=x",
    url: "wss://relay",
    e2eePublicKeyB64: "cHVibGlj",
    expectedServerId: "srv_peer",
  };
  const directTarget: PeerTarget = { ...relayTarget, e2eePublicKeyB64: null, expectedServerId: null };

  it("never dials a direct host:port target for a key", async () => {
    let called = false;
    const key = await fetchPeerMeshKey(directTarget, async () => {
      called = true;
      return { peerServerId: null, result: null };
    });
    assert.equal(key, null);
    assert.equal(called, false, "an unauthenticated link must not supply a key");
  });

  it("returns the key when the handshake proved the peer's serverId", async () => {
    const key = await fetchPeerMeshKey(relayTarget, async () => ({
      peerServerId: "srv_peer",
      result: { keyId: "xck1:k", publicKeyPem: "PEM" },
    }));
    assert.deepEqual(key, { serverId: "srv_peer", keyId: "xck1:k", publicKeyPem: "PEM" });
  });

  it("takes serverId from the link, not from the peer's own answer", async () => {
    const key = await fetchPeerMeshKey(relayTarget, async () => ({
      peerServerId: "srv_peer",
      result: { serverId: "srv_someone_else", keyId: "xck1:k", publicKeyPem: "PEM" },
    }));
    assert.equal(key?.serverId, "srv_peer");
  });

  it("refuses a key whose link identity does not match the pairing offer", async () => {
    await assert.rejects(
      fetchPeerMeshKey(relayTarget, async () => ({
        peerServerId: "srv_attacker",
        result: { keyId: "xck1:k", publicKeyPem: "PEM" },
      })),
      /identity mismatch/,
    );
  });

  it("rejects an unusable answer rather than pinning a blank key", async () => {
    await assert.rejects(
      fetchPeerMeshKey(relayTarget, async () => ({ peerServerId: "srv_peer", result: { keyId: "xck1:k" } })),
      /unusable/,
    );
  });
});

describe("canonical auth payload", () => {  const base: CrossDaemonEnvelope = {
    xComms: {
      version: 6,
      type: "x-comms.message",
      direction: "outgoing",
      sender: {
        agentId: "agent-a",
        agentName: "Agent A",
        host: "host-a",
        daemonServerId: "srv_a",
        cwd: "/work/a",
      },
      target: { daemon: "peer", agentId: "agent-b" },
      messageId: "msg-1",
      sentAt: "2026-09-25T12:00:00.000Z",
    },
  };

  it("is stable across key order so re-serialization still verifies", () => {
    // A receiver parses with JSON.parse and gets its own key order; the
    // signature must not depend on the producer's.
    const reordered = {
      xComms: {
        sentAt: base.xComms.sentAt,
        ...Object.fromEntries(Object.entries(base.xComms).reverse()),
      },
    } as CrossDaemonEnvelope;
    assert.equal(Object.keys(reordered.xComms)[0], "sentAt");
    assert.equal(canonicalAuthPayload(reordered), canonicalAuthPayload(base));
  });

  it("binds every attribution field", () => {
    const payload = canonicalAuthPayload(base);
    for (const value of [
      "agent-a",
      "Agent A",
      "host-a",
      "srv_a",
      "/work/a",
      "peer",
      "agent-b",
      "msg-1",
      "2026-09-25T12:00:00.000Z",
    ]) {
      assert.ok(payload.includes(value), `payload is missing ${value}`);
    }
  });

  it("does not bind direction, which readers derive themselves", () => {
    const flipped = { xComms: { ...base.xComms, direction: "incoming" as const } };
    assert.equal(canonicalAuthPayload(flipped), canonicalAuthPayload(base));
  });

  it("rejects a field value that would forge a field boundary", () => {
    const auth = { v: 1 as const, alg: "ed25519" as const, keyId: "xck1:x", sig: "sig" };
    const injected = {
      xComms: {
        ...base.xComms,
        sender: { ...base.xComms.sender, agentName: "Real\nsentAt: fake" },
        auth,
      },
    };
    assert.equal(authPayloadSafe(injected), false);
    // A verifier that would wave anything through must still not get a chance:
    // the payload is rejected before the signature is even offered to it.
    let consulted = false;
    const outcome = verifyEnvelopeAuth(injected, () => {
      consulted = true;
      return true;
    });
    assert.equal(outcome, "invalid");
    assert.equal(consulted, false);
  });
});
