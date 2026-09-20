import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_PLUGIN_UPDATE_BLOCKER, nativePluginUpdateCapability } from "./native-lifecycle";

test("keeps managed Git, npm, and directory sources diagnostics-only", () => {
  for (const source of ["git", "npm", "directory"]) {
    const capability = nativePluginUpdateCapability(source);
    assert.equal(capability.supported, false);
    assert.equal(capability.source, source);
    assert.equal(capability.hostTarget, null);
  }
});

test("does not target a configured but wrong host as an update lifecycle substitute", () => {
  const capability = nativePluginUpdateCapability("git");
  assert.equal(capability.hostTarget, null);
  assert.match(capability.blocker, /plugin-facing PaseoApi/);
  assert.equal(capability.blocker, NATIVE_PLUGIN_UPDATE_BLOCKER);
});
