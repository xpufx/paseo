import { randomUUID } from "node:crypto";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createPluginLogger } from "./vendor/paseo-plugin-helper/index";
import { withTimeout } from "../shared/vendor/paseo-plugin-helper/async";
import { currentRegistryPath, readRegistry } from "./registry";
import { resolvePeerTarget } from "./peer-channel";

const log = createPluginLogger("paseo-x-comms", { subsystem: "peer-status" });

const PROBE_TIMEOUT_MS = 10_000;

export interface RegistryDaemon {
  name: string;
  value: string;
  valid: boolean;
  error: string | null;
}

/**
 * One row of the known-peer surface. Every field beyond reachability is
 * best-effort: a peer that answers the handshake but not `daemon.get_status`
 * still counts as up with only the handshake identity populated.
 */
export interface PeerStatusResult {
  name: string;
  value: string;
  valid: boolean;
  reachable: boolean;
  error: string | null;
  transport: "relay" | "direct" | "unknown";
  serverId: string | null;
  hostname: string | null;
  version: string | null;
  pid: number | null;
  listen: string | null;
  relayEnabled: boolean | null;
  relayEndpoint: string | null;
  providerCount: number | null;
  providersAvailable: number | null;
  hubState: string | null;
  hubDaemonId: string | null;
  hubOrigin: string | null;
  hubLastError: string | null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function unreachableResult(
  daemon: RegistryDaemon,
  transport: PeerStatusResult["transport"],
  error: string,
): PeerStatusResult {
  return {
    name: daemon.name,
    value: daemon.value,
    valid: daemon.valid,
    reachable: false,
    error,
    transport,
    serverId: null,
    hostname: null,
    version: null,
    pid: null,
    listen: null,
    relayEnabled: null,
    relayEndpoint: null,
    providerCount: null,
    providersAvailable: null,
    hubState: null,
    hubDaemonId: null,
    hubOrigin: null,
    hubLastError: null,
  };
}

/** Relay block from a `daemon.get_status` payload (object form, not the CLI string). */
export function mapRelayStatus(raw: unknown): { enabled: boolean | null; endpoint: string | null } {
  if (!raw || typeof raw !== "object") return { enabled: null, endpoint: null };
  const relay = raw as Record<string, unknown>;
  return {
    enabled: typeof relay.enabled === "boolean" ? relay.enabled : null,
    endpoint: nullableString(relay.publicEndpoint) ?? nullableString(relay.endpoint),
  };
}

export function mapProviderCounts(raw: unknown): { total: number | null; available: number | null } {
  if (!Array.isArray(raw)) return { total: null, available: null };
  return {
    total: raw.length,
    available: raw.filter((provider) => (provider as { available?: unknown })?.available === true).length,
  };
}

export function mapHubStatus(raw: unknown): Pick<PeerStatusResult, "hubState" | "hubDaemonId" | "hubOrigin" | "hubLastError"> {
  const status = (raw as { status?: unknown })?.status;
  if (!status || typeof status !== "object") {
    return { hubState: null, hubDaemonId: null, hubOrigin: null, hubLastError: null };
  }
  const hub = status as Record<string, unknown>;
  return {
    hubState: nullableString(hub.state),
    hubDaemonId: nullableString(hub.daemonId),
    hubOrigin: nullableString(hub.hubOrigin),
    hubLastError: nullableString(hub.lastError),
  };
}

export type PeerProber = (daemon: RegistryDaemon) => Promise<PeerStatusResult>;

/**
 * Probe every daemon concurrently. A thrown prober is converted to a down
 * entry, so one unreachable peer can never fail the whole surface.
 */
export async function collectPeerStatus(
  daemons: RegistryDaemon[],
  prober: PeerProber,
): Promise<{ results: PeerStatusResult[] }> {
  const results = await Promise.all(
    daemons.map(async (daemon) => {
      try {
        return await prober(daemon);
      } catch (cause) {
        return unreachableResult(daemon, "unknown", cause instanceof Error ? cause.message : String(cause));
      }
    }),
  );
  return { results };
}

/**
 * Dial a registered peer and read its own `daemon.get_status` (identity,
 * listen, relay, providers) plus a best-effort hub relationship. The
 * registry endpoint is resolved the same way presence uses it, so an
 * undialable endpoint surfaces as down rather than throwing.
 */
export const probePeer: PeerProber = async (daemon) => {
  if (!daemon.valid) {
    return unreachableResult(daemon, "unknown", daemon.error ?? "invalid registry entry");
  }
  let target;
  try {
    target = resolvePeerTarget(daemon.name, daemon.value);
  } catch (cause) {
    return unreachableResult(daemon, "unknown", cause instanceof Error ? cause.message : String(cause));
  }
  const transport = target.expectedServerId ? "relay" : "direct";

  const client = new DaemonClient({
    url: target.url,
    clientId: randomUUID(),
    clientType: "cli",
    appVersion: "paseo-x-comms/0.3.0",
    e2ee: target.e2eePublicKeyB64 ? { enabled: true, daemonPublicKeyB64: target.e2eePublicKeyB64 } : undefined,
    connectTimeoutMs: PROBE_TIMEOUT_MS,
    reconnect: { enabled: false },
  });

  try {
    await withTimeout(client.connect(), PROBE_TIMEOUT_MS, `connect ${daemon.name}`);
    const handshake = client.getLastServerInfoMessage();
    const handshakeServerId = handshake?.serverId ?? null;
    if (target.expectedServerId && handshakeServerId && handshakeServerId !== target.expectedServerId) {
      return unreachableResult(
        daemon,
        transport,
        `peer identity mismatch: link reports ${handshakeServerId}`,
      );
    }

    const result: PeerStatusResult = {
      ...unreachableResult(daemon, transport, ""),
      reachable: true,
      error: null,
      serverId: handshakeServerId,
      hostname: nullableString(handshake?.hostname),
      version: nullableString(handshake?.version),
    };

    // Identity from the peer's own status is authoritative when available; a
    // peer that does not implement the RPC is still up via the handshake.
    try {
      const status = await withTimeout(
        client.getDaemonStatus({ timeout: PROBE_TIMEOUT_MS }),
        PROBE_TIMEOUT_MS,
        `daemon status ${daemon.name}`,
      );
      const relay = mapRelayStatus(status.relay);
      const providers = mapProviderCounts(status.providers);
      result.serverId = nullableString(status.serverId) ?? result.serverId;
      result.version = nullableString(status.version) ?? result.version;
      result.pid = nullableNumber(status.pid);
      result.listen = nullableString(status.listen);
      result.relayEnabled = relay.enabled;
      result.relayEndpoint = relay.endpoint;
      result.providerCount = providers.total;
      result.providersAvailable = providers.available;
    } catch (cause) {
      log.warn(
        `peer status for '${daemon.name}' unavailable, using handshake identity: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    try {
      Object.assign(result, mapHubStatus(await withTimeout(client.getHubStatus(), PROBE_TIMEOUT_MS, `hub status ${daemon.name}`)));
    } catch {
      // Hub relationship is optional; peers without hub support stay null.
    }

    return result;
  } catch (cause) {
    return unreachableResult(daemon, transport, cause instanceof Error ? cause.message : String(cause));
  } finally {
    await client.close().catch((cause: unknown) => {
      log.error(`peer close failed for '${daemon.name}': ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  }
};

/** Registry read + live per-peer probe; the handler the client surface calls. */
export async function handlePeerStatus(
  _input?: unknown,
  _context?: unknown,
  prober: PeerProber = probePeer,
): Promise<{ results: PeerStatusResult[] }> {
  const current = readRegistry(currentRegistryPath());
  return collectPeerStatus(current.ok ? current.daemons : [], prober);
}
