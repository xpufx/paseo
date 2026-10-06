import { describe, it } from "node:test";
import assert from "node:assert/strict";
import contribute from "../index.server.js";

function registeredContractNames(): string[] {
  const names: string[] = [];
  const server = {
    handle(contract: { name: string }) {
      names.push(contract.name);
    },
  };
  const teardown = contribute(server as never);
  if (typeof teardown === "function") {
    teardown();
  }
  return names;
}

describe("uppidi-fleet server registration (issue #761)", () => {
  it("contributes forge ticket RPC contracts", () => {
    const names = registeredContractNames();
    for (const name of [
      "forge.open-issues",
      "forge.search-issues",
      "forge.context",
      "forge.forge-context",
      "forge.issue-detail",
      "forge.set-label",
      "forge.add-comment",
      "forge.create-issue",
    ]) {
      assert.ok(names.includes(name), `${name} should be registered`);
    }
  });

  it("does not register operator-only forge.install-labels", () => {
    assert.equal(registeredContractNames().includes("forge.install-labels"), false);
  });

  it("registers the fleet HALT / RESUME contracts (#1013)", () => {
    const names = registeredContractNames();
    assert.ok(names.includes("uppidi-fleet.fleet-halt"), "fleet-halt should be registered");
    assert.ok(names.includes("uppidi-fleet.fleet-resume"), "fleet-resume should be registered");
  });
});
