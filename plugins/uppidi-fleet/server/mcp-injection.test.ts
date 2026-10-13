import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SERENA_MCP_PROFILE } from "../shared/contracts.js";

describe("Serena MCP profile shape (#1020)", () => {
  it("has all required fields", () => {
    assert.ok(SERENA_MCP_PROFILE.id);
    assert.ok(SERENA_MCP_PROFILE.label);
    assert.ok(SERENA_MCP_PROFILE.command);
    assert.ok(SERENA_MCP_PROFILE.description);
    assert.ok(SERENA_MCP_PROFILE.mcpCommand);
    assert.ok(Array.isArray(SERENA_MCP_PROFILE.mcpArgs));
    assert.equal(typeof SERENA_MCP_PROFILE.enabled, "boolean");
  });

  it("command matches operator directive", () => {
    assert.equal(
      SERENA_MCP_PROFILE.command,
      "serena start-mcp-server --project-from-cwd --context ide",
    );
  });

  it("label is Serena", () => {
    assert.equal(SERENA_MCP_PROFILE.label, "Serena");
  });

  it("id is serena", () => {
    assert.equal(SERENA_MCP_PROFILE.id, "serena");
  });

  it("is enabled by default", () => {
    assert.equal(SERENA_MCP_PROFILE.enabled, true);
  });
});
