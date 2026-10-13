import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildAgentLink,
  buildDashboardAgentLink,
  buildHappierAgentLink,
  buildPaseoAgentLink,
  createAgentLinkResolver,
  defaultAgentLink,
  resolveAgentLinkConfig,
  resolveEnvelopeAgentLink,
} from "./agent-links.js";

describe("agent deep-links (issue #1297)", () => {
  it("defaults to the historical paseo:// template", () => {
    assert.equal(buildAgentLink({ agentId: "a1" }), "paseo://agent/a1");
    assert.equal(defaultAgentLink("a1"), "paseo://agent/a1");
  });

  it("builds every supported template", () => {
    assert.equal(
      buildPaseoAgentLink({ agentId: "a1", workspaceId: "ws-9" }),
      "paseo://agent/a1?workspace=ws-9",
    );
    assert.equal(
      buildPaseoAgentLink({ agentId: "a1", serverId: "h1" }),
      "paseo://h/h1/agent/a1",
    );
    assert.equal(buildHappierAgentLink({ agentId: "a1" }), "happier://agent/a1");
    assert.equal(
      buildDashboardAgentLink({ agentId: "a1", dashboardHost: "dash.example.com" }),
      "https://dash.example.com/agents/a1",
    );
  });

  it("falls back to paseo:// when the dashboard host is missing", () => {
    assert.equal(buildDashboardAgentLink({ agentId: "a1" }), "paseo://agent/a1");
  });

  it("creates host-configured resolvers", () => {
    assert.equal(createAgentLinkResolver()({ agentId: "a1" }), "paseo://agent/a1");
    assert.equal(
      createAgentLinkResolver({ scheme: "happier" })({ agentId: "a1" }),
      "happier://agent/a1",
    );
    assert.equal(
      createAgentLinkResolver({ scheme: "https", dashboardHost: "dash.example.com" })({
        agentId: "a1",
      }),
      "https://dash.example.com/agents/a1",
    );
    assert.equal(
      createAgentLinkResolver({ scheme: "paseo", workspaceId: "ws-9" })({ agentId: "a1" }),
      "paseo://agent/a1?workspace=ws-9",
    );
  });

  it("resolves config from explicit input with a paseo default", () => {
    for (const key of ["PASEO_AGENT_LINK_SCHEME", "PASEO_AGENT_DASHBOARD_HOST", "PASEO_AGENT_SERVER_ID"]) {
      delete process.env[key];
    }
    assert.deepEqual(resolveAgentLinkConfig(), {
      scheme: "paseo",
      dashboardHost: null,
      serverId: null,
      workspaceId: null,
    });
    assert.equal(resolveAgentLinkConfig({ scheme: "https" }).scheme, "https");
  });

  it("prefers agentLinks with a paseoLinks fallback", () => {
    assert.equal(
      resolveEnvelopeAgentLink({ agentLinks: ["happier://agent/a1"], paseoLinks: ["paseo://agent/a1"] }),
      "happier://agent/a1",
    );
    assert.equal(resolveEnvelopeAgentLink({ paseoLinks: ["paseo://agent/a1"] }), "paseo://agent/a1");
    assert.equal(resolveEnvelopeAgentLink({ agentLinks: [], paseoLinks: [] }), null);
    assert.equal(resolveEnvelopeAgentLink(null), null);
  });
});
