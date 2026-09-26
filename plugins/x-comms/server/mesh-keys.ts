import { PluginStorage } from "./vendor/paseo-plugin-helper/index";
import { acceptPinnedKey, type MeshVerifyKey } from "./mesh-identity.ts";

/**
 * Pinned x-comms verify keys, one per paired peer daemon.
 *
 * A key arrives over the authenticated peer link (peer-channel.ts) and is
 * pinned here forever. Pin-on-first-sight is the whole point: a later
 * announcement claiming a different keyId for an already pinned peer is refused
 * rather than adopted, so nobody who can reach the link can swap a peer's key
 * and start minting envelopes the receiver attributes to it (#594).
 */

export const MESH_KEYS_FILE = "mesh-keys.json";

export interface MeshKeysState {
  /** serverId -> pinned keyId. */
  pinned: Record<string, string>;
  /** serverId -> PEM, only for pins that are still current. */
  keys: Record<string, string>;
}

export function emptyMeshKeysState(): MeshKeysState {
  return { pinned: {}, keys: {} };
}

const meshKeysStore = new PluginStorage<MeshKeysState>("paseo-x-comms", MESH_KEYS_FILE, {
  defaultData: emptyMeshKeysState(),
});

export function readMeshKeys(): MeshKeysState {
  try {
    const data = meshKeysStore.read();
    if (data && typeof data === "object") {
      return {
        pinned: typeof data.pinned === "object" && data.pinned ? data.pinned : {},
        keys: typeof data.keys === "object" && data.keys ? data.keys : {},
      };
    }
  } catch {
    // Corrupt state falls back to empty; a refetch re-pins from the link.
  }
  return emptyMeshKeysState();
}

export function writeMeshKeys(state: MeshKeysState): void {
  meshKeysStore.write(state);
}

/** Every currently pinned key, ready for `verifierFor`. */
export function pinnedKeys(state: MeshKeysState): MeshVerifyKey[] {
  return Object.entries(state.pinned)
    .filter(([serverId, keyId]) => state.keys[serverId] !== undefined)
    .map(([serverId, keyId]) => ({ serverId, keyId, publicKeyPem: state.keys[serverId] }));
}

export type PinOutcome = { pinned: boolean; changed: boolean; reason: string | null };

/**
 * Pin a peer key into `state`, refusing a keyId that contradicts an existing
 * pin. Reports whether it was stored and whether that changed the pin, so the
 * caller can log a refusal loudly instead of silently degrading.
 */
export function recordPeerKey(state: MeshKeysState, incoming: MeshVerifyKey): PinOutcome {
  const outcome = acceptPinnedKey(new Map(Object.entries(state.pinned)), incoming);
  if (!outcome.ok) return { pinned: false, changed: false, reason: outcome.reason };
  const changed = state.pinned[incoming.serverId] !== incoming.keyId;
  state.pinned[incoming.serverId] = incoming.keyId;
  state.keys[incoming.serverId] = incoming.publicKeyPem;
  return { pinned: true, changed, reason: null };
}
