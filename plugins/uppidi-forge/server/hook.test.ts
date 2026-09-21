import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveHookUrl, handleHookServiceStatus } from "./hook.js";

describe("uppidi-forge hook server handlers", () => {
  it("resolves default hook URL when omitted or empty", () => {
    assert.equal(resolveHookUrl(), "http://127.0.0.1:8099");
    assert.equal(resolveHookUrl(""), "http://127.0.0.1:8099");
    assert.equal(resolveHookUrl("   "), "http://127.0.0.1:8099");
  });

  it("normalizes trailing slashes in custom hook URL", () => {
    assert.equal(resolveHookUrl("http://localhost:9000/"), "http://localhost:9000");
    assert.equal(resolveHookUrl("http://localhost:9000///"), "http://localhost:9000");
  });

  it("queries hook service status via systemd without throwing", async () => {
    const res = await handleHookServiceStatus();
    assert.equal(res.ok, true);
    assert.ok(typeof res.active === "boolean");
    assert.ok(typeof res.state === "string");
  });
});
