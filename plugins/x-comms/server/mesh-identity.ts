import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { EnvelopeAuthVerifier, KnownEnvelopeAuth } from "../shared/envelope.ts";
import { stateDir } from "./registry.ts";

/**
 * Daemon x-comms signing identity.
 *
 * The wire envelope is plain text inside an agent's turn, so a claimed
 * `sender.agentId` is worthless without something only this daemon can produce
 * (xpufx-org/paseo#594). Every daemon therefore holds an ed25519 keypair and
 * signs the attribution fields of the envelopes it emits; receivers verify
 * against a peer's public key.
 *
 * Why the *peer's* key and not a shared secret: the two daemons never shared
 * anything out of band, but they already have an authenticated channel to each
 * other (see peer-channel.ts: relay E2EE plus a serverId checked against the
 * registry pairing offer). A key fetched over that link is exactly as
 * trustworthy as the pairing itself, so the fix needs no human provisioning
 * step. A direct `host:port` link has no authenticated identity, so envelopes
 * from such a peer stay unverifiable by construction — degraded, never trusted.
 *
 * Node-only: `shared/envelope.ts` stays browser-safe and takes the signature
 * check as an injected verifier.
 */

export const MESH_KEY_FILE = "mesh-key.json";
export const KEY_ID_PREFIX = "xck1:";
export const AUTH_ALG = "ed25519";

interface MeshKeyFile {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
}

/** A peer's published verify key. `serverId` is the pairing identity, not a claim. */
export interface MeshVerifyKey {
  serverId: string;
  keyId: string;
  publicKeyPem: string;
}

function keyIdFor(publicKeyPem: string): string {
  // Fingerprint the DER SubjectPublicKeyInfo, not the PEM text, so re-wrapping
  // the same key in different PEM armor cannot change its identity.
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return `${KEY_ID_PREFIX}${Buffer.from(der).toString("base64url")}`;
}

function encodeSignature(sig: Buffer): string {
  return Buffer.from(sig).toString("base64url");
}

function decodeSignature(sig: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(sig)) return null;
  try {
    return Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
}
// Keyed by state dir: the plugin and the tests can point at different homes, and
// a single global slot would hand one of them the other's signing key.
const cache = new Map<string, MeshKeyFile>();

/**
 * This daemon's signing key, generated on first use and persisted in the plugin
 * state dir. The file is private key material, so it is written 0600 and the
 * write is atomic (temp file + rename) so a crash cannot leave a half key that
 * every later start would fail to load.
 */
export function loadMeshKey(dir: string = stateDir()): MeshKeyFile {
  const hit = cache.get(dir);
  if (hit) return hit;
  const path = join(dir, MESH_KEY_FILE);
  if (existsSync(path)) {
    const parsed = parseKeyFile(readFileSync(path, "utf8"));
    if (parsed) {
      cache.set(dir, parsed);
      return parsed;
    }
  }
  const generated = generateKeyPairSync("ed25519");
  const publicKeyPem = generated.publicKey.export({ type: "spki", format: "pem" }) as string;
  const key: MeshKeyFile = {
    keyId: keyIdFor(publicKeyPem),
    publicKeyPem,
    privateKeyPem: generated.privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // A filesystem without POSIX modes still gets the atomic write.
  }
  cache.set(dir, key);
  return key;
}

function parseKeyFile(raw: string): MeshKeyFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const o = parsed as Partial<MeshKeyFile> | null;
  if (typeof o?.publicKeyPem !== "string" || typeof o.privateKeyPem !== "string") return null;
  try {
    // A stored key whose fingerprint disagrees with its own bytes is corrupt.
    const keyId = keyIdFor(o.publicKeyPem);
    if (o.keyId && o.keyId !== keyId) return null;
    return {
      keyId,
      publicKeyPem: o.publicKeyPem,
      privateKeyPem: o.privateKeyPem,
      createdAt: typeof o.createdAt === "string" ? o.createdAt : "",
    };
  } catch {
    return null;
  }
}

/** Test seam: drop the memoized keys so a temp dir can be used. */
export function resetMeshKeyCache(): void {
  cache.clear();
}

/**
 * This daemon's public half, for publication to paired peers. The pairing
 * identity (`serverId`) is filled in by the caller, which is the only place
 * that can read it from the authenticated link.
 */
export function meshPublicKey(): { keyId: string; publicKeyPem: string; createdAt: string } {
  const key = loadMeshKey();
  return { keyId: key.keyId, publicKeyPem: key.publicKeyPem, createdAt: key.createdAt };
}

/**
 * Sign an envelope's canonical payload. Throws only if the local key is
 * unreadable, which is a daemon-level misconfiguration, not a message-level
 * error — silently emitting an unsigned envelope would reintroduce #594.
 */
export function signEnvelopeAuth(payload: string): KnownEnvelopeAuth {
  const key = loadMeshKey();
  const signature = cryptoSign(null, Buffer.from(payload, "utf8"), createPrivateKey(key.privateKeyPem));
  return { v: 1, alg: AUTH_ALG, keyId: key.keyId, sig: encodeSignature(signature) };
}

/** A signer bound to the payload shape expected by `buildXCommsEnvelope`. */
export function meshSigner(): (payload: string) => KnownEnvelopeAuth {
  return signEnvelopeAuth;
}

/**
 * Build a verifier over an already-pinned set of peer keys. The returned
 * function returns `null` for an unknown `keyId` so `verifyEnvelopeAuth` can
 * tell "no key yet" apart from "signature did not match", and refuses a
 * `keyId` whose bytes do not hash to the claimed fingerprint.
 */
export function verifierFor(keys: Iterable<MeshVerifyKey>): EnvelopeAuthVerifier {
  const byKeyId = new Map<string, string>();
  for (const key of keys) byKeyId.set(key.keyId, key.publicKeyPem);
  return (payload, auth: KnownEnvelopeAuth) => {
    const pem = byKeyId.get(auth.keyId);
    if (!pem) return null;
    let publicKey;
    try {
      publicKey = createPublicKey(pem);
    } catch {
      return false;
    }
    // The claimed fingerprint must be the one these key bytes actually produce,
    // so a pinned id cannot be pointed at a substituted key.
    if (keyIdFor(pem) !== auth.keyId) return false;
    const signature = decodeSignature(auth.sig);
    if (!signature) return false;
    try {
      return cryptoVerify(null, Buffer.from(payload, "utf8"), publicKey, signature);
    } catch {
      return false;
    }
  };
}

/**
 * Reject a key whose declared fingerprint does not match its bytes, and reject
 * a keyId already pinned to a different key. A substituted key would let anyone
 * who can reach the link mint envelopes the receiver attributes to that peer.
 */
export function acceptPinnedKey(
  pins: Map<string, string>,
  incoming: MeshVerifyKey,
): { ok: true } | { ok: false; reason: string } {
  let derived: string;
  try {
    derived = keyIdFor(incoming.publicKeyPem);
  } catch {
    return { ok: false, reason: "unreadable public key" };
  }
  if (derived !== incoming.keyId) {
    return { ok: false, reason: "keyId does not match the public key" };
  }
  const existing = pins.get(incoming.serverId);
  if (existing !== undefined && existing !== incoming.keyId) {
    return { ok: false, reason: "keyId changed for an already pinned peer" };
  }
  pins.set(incoming.serverId, incoming.keyId);
  return { ok: true };
}
