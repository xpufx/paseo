import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ForgeGuard, NEGATIVE_PROBE_TTL_MS } from "./forge-guard.ts";

describe("ForgeGuard host probe cache (issue #114)", () => {
  it("reports a miss until the host is probed", () => {
    assert.equal(new ForgeGuard().cachedProbe("forge.example.com"), null);
  });

  it("keeps a positive verdict cached", () => {
    const guard = new ForgeGuard({ now: () => 0 });
    guard.recordProbe("forge.example.com", true);
    assert.equal(guard.cachedProbe("forge.example.com"), true);
  });

  it("expires a negative verdict so a transiently unreachable forge recovers", () => {
    let clock = 0;
    const guard = new ForgeGuard({ now: () => clock });
    guard.recordProbe("forge.example.com", false);
    assert.equal(guard.cachedProbe("forge.example.com"), false);
    clock += NEGATIVE_PROBE_TTL_MS;
    assert.equal(guard.cachedProbe("forge.example.com"), null);
  });
});

describe("ForgeGuard quiet logging (issue #114)", () => {
  it("logs a non-forge host at info once, then debug", () => {
    const guard = new ForgeGuard();
    assert.equal(guard.skipLogLevel("github.com"), "info");
    assert.equal(guard.skipLogLevel("github.com"), "debug");
    assert.equal(guard.skipLogLevel("github.com"), "debug");
  });

  it("keeps the first line per host", () => {
    const guard = new ForgeGuard();
    assert.equal(guard.skipLogLevel("github.com"), "info");
    assert.equal(guard.skipLogLevel("gitlab.com"), "info");
  });
});

describe("ForgeGuard list-failure backoff (issue #114)", () => {
  it("warns once then degrades to debug", () => {
    const guard = new ForgeGuard();
    assert.equal(guard.failureLogLevel("forge.example.com", "o/r"), "warn");
    assert.equal(guard.failureLogLevel("forge.example.com", "o/r"), "debug");
    assert.equal(guard.failureLogLevel("forge.example.com", "o/r"), "debug");
  });

  it("backs off per host/repo", () => {
    const guard = new ForgeGuard();
    assert.equal(guard.failureLogLevel("forge.example.com", "o/a"), "warn");
    assert.equal(guard.failureLogLevel("forge.example.com", "o/b"), "warn");
    assert.equal(guard.failureLogLevel("other.example.com", "o/a"), "warn");
  });

  it("resets the backoff after a success", () => {
    const guard = new ForgeGuard();
    assert.equal(guard.failureLogLevel("forge.example.com", "o/r"), "warn");
    guard.noteSuccess("forge.example.com", "o/r");
    assert.equal(guard.failureLogLevel("forge.example.com", "o/r"), "warn");
  });
});
