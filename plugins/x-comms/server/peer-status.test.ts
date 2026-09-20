import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectPeerStatus,
  mapHubStatus,
  mapProviderCounts,
  mapRelayStatus,
  unreachableResult,
  type PeerProber,
  type PeerStatusResult,
  type RegistryDaemon,
} from "./peer-status.ts";

function daemon(overrides: Partial<RegistryDaemon> = {}): RegistryDaemon {
  return { name: "peer", value: "10.0.0.5:6767", valid: true, error: null, ...overrides };
}

describe("peer status mapping", () => {
  it("maps the object relay block from daemon.get_status", () => {
    assert.deepEqual(
      mapRelayStatus({ enabled: true, endpoint: "relay.paseo.sh:443", publicEndpoint: "wss://relay.paseo.sh:443" }),
      { enabled: true, endpoint: "wss://relay.paseo.sh:443" },
    );
  });

  it("falls back to the private endpoint and reports disabled", () => {
    assert.deepEqual(
      mapRelayStatus({ enabled: false, endpoint: "relay.paseo.sh:443", publicEndpoint: "" }),
      { enabled: false, endpoint: "relay.paseo.sh:443" },
    );
  });

  it("returns nulls when relay is absent or the wrong shape", () => {
    assert.deepEqual(mapRelayStatus(undefined), { enabled: null, endpoint: null });
    assert.deepEqual(mapRelayStatus("wss://relay.paseo.sh:443"), { enabled: null, endpoint: null });
  });

  it("counts providers and how many are available", () => {
    assert.deepEqual(
      mapProviderCounts([
        { provider: "a", available: true },
        { provider: "b", available: false },
        { provider: "c", available: true },
      ]),
      { total: 3, available: 2 },
    );
    assert.deepEqual(mapProviderCounts(undefined), { total: null, available: null });
  });

  it("maps the hub relationship status and tolerates a missing one", () => {
    assert.deepEqual(
      mapHubStatus({
        status: { state: "connected", daemonId: "d1", hubOrigin: "hub", lastError: null },
      }),
      { hubState: "connected", hubDaemonId: "d1", hubOrigin: "hub", hubLastError: null },
    );
    assert.deepEqual(mapHubStatus({}), { hubState: null, hubDaemonId: null, hubOrigin: null, hubLastError: null });
  });
});

describe("peer status collection", () => {
  it("probes every daemon concurrently", async () => {
    const seen: string[] = [];
    const prober: PeerProber = async (entry) => {
      seen.push(entry.name);
      return { ...unreachableResult(entry, "direct", ""), reachable: true, error: null };
    };
    const result = await collectPeerStatus([daemon({ name: "a" }), daemon({ name: "b" })], prober);
    assert.deepEqual(result.results.map((entry) => entry.name).sort(), ["a", "b"]);
    assert.deepEqual(seen.sort(), ["a", "b"]);
  });

  it("keeps a single peer failure from failing the rest", async () => {
    const prober: PeerProber = async (entry) => {
      if (entry.name === "bad") throw new Error("boom");
      return { ...unreachableResult(entry, "direct", ""), reachable: true, error: null };
    };
    const result = await collectPeerStatus(
      [daemon({ name: "good" }), daemon({ name: "bad" })],
      prober,
    );
    const good = result.results.find((entry) => entry.name === "good");
    const bad = result.results.find((entry) => entry.name === "bad");
    assert.equal(good?.reachable, true);
    assert.equal(bad?.reachable, false);
    assert.equal(bad?.error, "boom");
  });

  it("produces a fully-null identity for an unreachable peer", () => {
    const result: PeerStatusResult = unreachableResult(daemon({ name: "gone" }), "relay", "connect timed out");
    assert.equal(result.reachable, false);
    assert.equal(result.error, "connect timed out");
    assert.equal(result.transport, "relay");
    assert.equal(result.serverId, null);
    assert.equal(result.relayEnabled, null);
    assert.equal(result.hubState, null);
  });
});
