import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readRelayStatus } from "./relay-status.ts";

describe("daemon.dump relay status", () => {
  it("maps a configured relay URL to enabled plus endpoint", () => {
    assert.deepEqual(readRelayStatus("wss://relay.paseo.sh:443"), {
      enabled: true,
      endpoints: ["wss://relay.paseo.sh:443"],
    });
    assert.deepEqual(readRelayStatus("ws://10.20.30.24:6767"), {
      enabled: true,
      endpoints: ["ws://10.20.30.24:6767"],
    });
  });

  it("maps the daemon's 'disabled' sentinel to disabled", () => {
    assert.deepEqual(readRelayStatus("disabled"), { enabled: false, endpoints: null });
  });

  it("reports unknown when the status payload omits relay", () => {
    assert.deepEqual(readRelayStatus(undefined), { enabled: null, endpoints: null });
    assert.deepEqual(readRelayStatus(null), { enabled: null, endpoints: null });
  });
});
