import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findDaemonByRef, type RegistryDaemon } from "./registry.ts";

/**
 * Target resolution for the busy gate (#611).
 *
 * A registered peer can be addressed by its configured registry name or by its
 * derived `serverId` (e.g. from relay pairing offers). Resolving those by name
 * alone misses, and every miss downstream reads as "cannot tell" — which the gate
 * treats as "not busy" and dispatches. That is the preemption this lookup prevents.
 */

function host(over: Partial<RegistryDaemon> = {}): RegistryDaemon {
  return { name: "lab", value: "10.0.0.5:6767", valid: true, error: null, source: "registry", ...over };
}

describe("findDaemonByRef", () => {
  it("matches a registered host by serverId when its name differs", () => {
    const daemons = [host({ name: "lab", serverId: "srv_two" })];
    assert.equal(findDaemonByRef(daemons, "srv_two")?.name, "lab");
  });

  it("matches by name, so every caller that resolved by name is unchanged", () => {
    const daemons = [host({ name: "lab", serverId: "srv_two" })];
    assert.equal(findDaemonByRef(daemons, "lab")?.serverId, "srv_two");
  });

  it("prefers an exact name over another entry's serverId", () => {
    // A name collision with a peer's id must not silently redirect the send.
    const daemons = [
      host({ name: "srv_two", serverId: "srv_other" }),
      host({ name: "lab", serverId: "srv_two" }),
    ];
    assert.equal(findDaemonByRef(daemons, "srv_two")?.serverId, "srv_other");
  });

  it("does not match a host whose serverId is absent", () => {
    const daemons = [host({ name: "lab", serverId: null })];
    assert.equal(findDaemonByRef(daemons, "srv_two"), undefined);
  });

  it("returns nothing for an unknown ref, which the gate reads as not busy", () => {
    assert.equal(findDaemonByRef([], "srv_missing"), undefined);
  });

  it("resolves a labelled registered host by serverId", () => {
    const daemons: RegistryDaemon[] = [
      { name: "lab box", value: "10.0.0.5:6767", valid: true, error: null, serverId: "srv_two", source: "registry" },
    ];
    const entry = findDaemonByRef(daemons, "srv_two");
    assert.equal(entry?.name, "lab box");
    assert.equal(entry?.value, "10.0.0.5:6767", "the --host value the probe needs");
  });

  it("resolves a relay-paired host by the id embedded in its offer", () => {
    const offer = `https://app.paseo.sh/#offer=${Buffer.from(
      JSON.stringify({ v: 1, serverId: "srv_relay", relayPublicKeyB64: "k" }),
    ).toString("base64")}`;
    const daemons: RegistryDaemon[] = [
      { name: "relay", value: offer, valid: true, error: null, serverId: "srv_relay", source: "registry" },
    ];
    const entry = findDaemonByRef(daemons, "srv_relay");
    assert.equal(entry?.name, "relay");
    assert.equal(entry?.value, offer);
  });
});
