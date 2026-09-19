import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFeaturePrefsUpdate,
  resolveDaemonEnabled,
  resolveFeatureFlags,
  resolveInjectionEnabled,
  resolveOutboxExpiryMs,
  resolvePresenceEnabled,
  OUTBOX_EXPIRY_DEFAULT_SECONDS,
} from "./settings.ts";

describe("feature flags", () => {
  it("defaults both flags on when keys are absent", () => {
    assert.equal(resolvePresenceEnabled({}), true);
    assert.equal(resolveInjectionEnabled({}), true);
    assert.deepEqual(resolveFeatureFlags({}), { presenceEnabled: true, injectionEnabled: true });
  });

  it("honors explicit true and false", () => {
    assert.equal(resolvePresenceEnabled({ presenceEnabled: false }), false);
    assert.equal(resolveInjectionEnabled({ injectionEnabled: false }), false);
    assert.equal(resolvePresenceEnabled({ presenceEnabled: true }), true);
    assert.equal(resolveInjectionEnabled({ injectionEnabled: true }), true);
  });

  it("round-trips a toggle update without touching the other flag", () => {
    const stored = { presenceEnabled: true };
    const next = applyFeaturePrefsUpdate(stored, { injectionEnabled: false });
    assert.deepEqual(next, { presenceEnabled: true, injectionEnabled: false });
    assert.deepEqual(resolveFeatureFlags(next), { presenceEnabled: true, injectionEnabled: false });
    const back = applyFeaturePrefsUpdate(next, { injectionEnabled: true });
    assert.deepEqual(resolveFeatureFlags(back), { presenceEnabled: true, injectionEnabled: true });
  });

  it("keeps stored values when the update omits them", () => {
    const stored = { presenceEnabled: false, injectionEnabled: false };
    assert.deepEqual(applyFeaturePrefsUpdate(stored, {}), stored);
  });
});

describe("outbox expiry", () => {
  it("defaults to 10 minutes when absent", () => {
    assert.equal(resolveOutboxExpiryMs({}), OUTBOX_EXPIRY_DEFAULT_SECONDS * 1000);
  });

  it("honors an explicit value and clamps to a sane range", () => {
    assert.equal(resolveOutboxExpiryMs({ outboxExpirySeconds: 120 }), 120_000);
    assert.equal(resolveOutboxExpiryMs({ outboxExpirySeconds: 1 }), 10_000);
    assert.equal(resolveOutboxExpiryMs({ outboxExpirySeconds: 999_999 }), 24 * 60 * 60 * 1000);
    assert.equal(resolveOutboxExpiryMs({ outboxExpirySeconds: Number.NaN }), OUTBOX_EXPIRY_DEFAULT_SECONDS * 1000);
  });

  it("round-trips an expiry update without touching the flags", () => {
    const stored = { presenceEnabled: false, injectionEnabled: false };
    const next = applyFeaturePrefsUpdate(stored, { outboxExpirySeconds: 300 });
    assert.deepEqual(next, { presenceEnabled: false, injectionEnabled: false, outboxExpirySeconds: 300 });
  });
});

describe("per-daemon enablement", () => {
  it("treats absent entries as enabled", () => {
    assert.equal(resolveDaemonEnabled({}, "alpha"), true);
    assert.equal(resolveDaemonEnabled({ daemonEnabled: {} }, "alpha"), true);
    assert.equal(resolveDaemonEnabled({ daemonEnabled: { beta: false } }, "alpha"), true);
  });

  it("honors an explicit false", () => {
    assert.equal(resolveDaemonEnabled({ daemonEnabled: { alpha: false } }, "alpha"), false);
    assert.equal(resolveDaemonEnabled({ daemonEnabled: { alpha: true } }, "alpha"), true);
  });

  it("merges per-daemon updates without dropping other daemons", () => {
    const stored = { daemonEnabled: { alpha: false, beta: true } };
    const next = applyFeaturePrefsUpdate(stored, { daemonEnabled: { beta: false } });
    assert.deepEqual(next.daemonEnabled, { alpha: false, beta: false });
    assert.deepEqual(stored.daemonEnabled, { alpha: false, beta: true });
  });
});
