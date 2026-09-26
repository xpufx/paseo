import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unknownDaemonMessage, UNKNOWN_DAEMON_HINT } from "./unknown-daemon.ts";
import { validateDaemonHost } from "./registry.ts";

/**
 * The unknown-daemon diagnostic must not claim pairing is mandatory (#672).
 *
 * Both call sites (the pre-stamped send and the daemon dump) fire on a
 * registry-name miss, not on a real pairing requirement, so the wording is the
 * whole bug: it sends the caller after a relay/E2EE setup for what is usually a
 * misspelled name or an unregistered direct host.
 *
 * This lives in its own file because `handlers.ts` reaches the vendored helper,
 * whose TypeScript parameter properties Node's strip-only loader rejects — so a
 * test could not import the diagnostic from there and this coverage would not
 * exist.
 */
describe("unknown-daemon diagnostic", () => {
  it("names the daemon that was not found", () => {
    assert.match(unknownDaemonMessage("ghost"), /unknown daemon 'ghost'/);
  });

  it("states the real cause: no registry entry for that name", () => {
    assert.match(unknownDaemonMessage("ghost"), /no registry entry for that name/);
  });

  it("never claims pairing is required", () => {
    // The exact strings #672 removed, kept here so they cannot creep back in.
    assert.doesNotMatch(UNKNOWN_DAEMON_HINT, /pairing is required/i);
    assert.doesNotMatch(UNKNOWN_DAEMON_HINT, /pair the target daemon first/i);
  });

  it("offers the non-pairing route first, and the relay route second", () => {
    const direct = UNKNOWN_DAEMON_HINT.indexOf("x_comms_add_daemon");
    const relay = UNKNOWN_DAEMON_HINT.indexOf("paseo daemon pair");
    assert.notEqual(direct, -1, "must name x_comms_add_daemon (a direct host needs no offer)");
    assert.notEqual(relay, -1, "must still name pairing as one of the routes");
    assert.ok(direct < relay, "the direct route must not be presented as the afterthought");
  });

  it("tells the caller how to find the names that do exist", () => {
    assert.match(UNKNOWN_DAEMON_HINT, /x_comms_list_daemons/);
  });
});

/**
 * The direct forms the diagnostic advertises must be forms the validator really
 * accepts. This is the case the old message contradicted: a daemon registered
 * as a plain `host:port` with no pairing anywhere, and then told to pair.
 */
describe("the diagnostic's direct-host claim matches validateDaemonHost", () => {
  const directForms = ["10.0.0.5:6767", "[::1]:6767", "tcp://10.0.0.5:6767", "tcp://host:6767?ssl=true", "unix:///tmp/paseo.sock", "pipe://x", "/abs/path.sock", "8099"];

  for (const value of directForms) {
    it(`accepts the direct form the hint advertises: ${value}`, () => {
      assert.equal(validateDaemonHost(value).valid, true, `${value} must be a valid direct --host`);
    });
  }

  it("still accepts a relay offer, so pairing remains a route and not a gate", () => {
    assert.equal(validateDaemonHost("https://app.paseo.sh/#offer=abc").valid, true);
  });
});
