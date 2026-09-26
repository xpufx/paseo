// Regression: `x_comms_list_daemons --detailed` used to return each daemon's
// raw `target`. For a relay daemon that value IS the pairing offer — a daemon
// control token — so any agent able to call the tool could obtain it, including
// an agent for whom the offer was never in context (#606).
//
// Scoped deliberately: only the offer token is removed. The URL around it and
// every direct tcp:// target survive, because "where is this daemon" is the
// tool's actual purpose.
import { test } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { redactDaemonTarget, REDACTED_OFFER } from "../daemon-target.mjs";

const SERVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "paseo-x-comms.mjs"),
  "utf8",
);

test("a relay offer token is never returned in the clear", () => {
  const offer =
    "https://app.paseo.sh/#offer=eyJzZXJ2ZXJJZCI6InNydl9yZW1vdGUxMjMiLCJrZXkiOiJ4eXoifQ==";
  const redacted = redactDaemonTarget(offer);
  assert.equal(redacted, "https://app.paseo.sh/#offer=[REDACTED]");
  assert.ok(!redacted.includes("eyJzZXJ2ZXJJZCI6"), "base64 offer body must not survive");
});

test("a self-hosted relay is redacted too", () => {
  // The reason this does not reuse redactSecrets(): that helper matches
  // app.paseo.sh specifically, but validateDaemonHost accepts a pairing URL on
  // any https host. Keying on the host would have leaked every self-hosted
  // relay, which is the case most likely to be a private deployment.
  const offer = "https://relay.internal.example:8443/#offer=c2VjcmV0S2V5VmFsdWU";
  const redacted = redactDaemonTarget(offer);
  assert.equal(redacted, "https://relay.internal.example:8443/#offer=[REDACTED]");
  assert.ok(!redacted.includes("c2VjcmV0S2V5VmFsdWU"));
});

test("a direct tcp target is returned untouched", () => {
  // No token, so no reason to hide it — the tool exists to answer "where".
  for (const value of [
    "tcp://10.20.30.24:8099",
    "tcp://10.20.30.24:8099?ssl=true",
  ]) {
    assert.equal(redactDaemonTarget(value), value);
  }
});

test("redaction is total even when the offer is not the last segment", () => {
  const value = "https://app.paseo.sh/#offer=QUJDREVGRw==/extra/path";
  const redacted = redactDaemonTarget(value);
  assert.ok(!redacted.includes("QUJDREVGRw"), "a trailing path must not smuggle the token");
});

test("non-string and empty values do not throw", () => {
  assert.equal(redactDaemonTarget(undefined), "");
  assert.equal(redactDaemonTarget(null), "");
  assert.equal(redactDaemonTarget(""), "");
});

test("the tool description tells the caller the target is redacted", () => {
  // Silently shortening a field reads as a bug to the agent consuming it.
  assert.ok(
    SERVER_SRC.includes("[REDACTED]"),
    "the detailed flag must document the redaction",
  );
});
