import { describe, it } from "node:test";
import assert from "node:assert/strict";
import contribute from "../index.server.ts";
import { handleInstallLabels } from "./issues.ts";

/** Captures the contract names a server context is asked to register. */
function registeredContractNames(): string[] {
  const names: string[] = [];
  const server = {
    handle(contract: { name: string }) {
      names.push(contract.name);
    },
  };
  contribute(server as never);
  return names;
}

describe("forges server registration gate (issue #163)", () => {
  it("does not register forge.install-labels", () => {
    assert.equal(registeredContractNames().includes("forge.install-labels"), false);
  });

  it("still registers the shipped contracts", () => {
    const names = registeredContractNames();
    for (const name of [
      "forge.open-issues",
      "forge.search-issues",
      "forge.set-label",
      "forge.add-comment",
    ]) {
      assert.ok(names.includes(name), `${name} should be registered`);
    }
  });

  it("keeps the gated handler available in the codebase", () => {
    assert.equal(typeof handleInstallLabels, "function");
  });
});
