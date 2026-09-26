import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  configuredHostAgentKey,
  listConfiguredHostAgents,
} from "./configured-hosts.ts";

function client(entries: Array<{ id: string; title: string; status?: string }>) {
  return {
    agents: {
      list: async () => ({ entries: entries.map((agent) => ({ agent })) }),
    },
  };
}

describe("configured-host picker", () => {
  it("lists agents from two online configured hosts and keeps duplicate ids distinct", async () => {
    const clients = new Map([
      ["srv_one", client([{ id: "agent_same", title: "One" }])],
      ["srv_two", client([{ id: "agent_same", title: "Two" }])],
    ]);
    const results = await listConfiguredHostAgents([
      { serverId: "srv_one", label: "One", status: "online" },
      { serverId: "srv_two", label: "Two", status: "online" },
    ], (serverId) => clients.get(serverId) as never);
    const rows = results.flatMap((result) => result.agents);
    assert.equal(rows.length, 2);
    assert.notEqual(
      configuredHostAgentKey(rows[0].serverId, rows[0].agentId),
      configuredHostAgentKey(rows[1].serverId, rows[1].agentId),
    );
  });

  it("does not acquire an offline host and reacquires it after reconnect", async () => {
    let acquired = 0;
    const getClient = () => { acquired += 1; return client([]) as never; };
    const offline = await listConfiguredHostAgents([
      { serverId: "srv_one", label: "One", status: "offline" },
    ], getClient);
    assert.equal(offline[0].agents.length, 0);
    assert.equal(acquired, 0);
    await listConfiguredHostAgents([
      { serverId: "srv_one", label: "One", status: "online" },
    ], getClient);
    assert.equal(acquired, 1);
  });

  it("reports an unreadable host without failing the other hosts", async () => {
    const results = await listConfiguredHostAgents([
      { serverId: "srv_one", label: "One", status: "online" },
      { serverId: "srv_two", label: "Two", status: "online" },
    ], (serverId) => {
      if (serverId === "srv_one") throw new Error("handle released");
      return client([{ id: "agent_same", title: "Two" }]) as never;
    });
    assert.match(results[0].error ?? "", /handle released/);
    assert.equal(results[0].agents.length, 0);
    assert.equal(results[1].error, null);
    assert.equal(results[1].agents.length, 1);
  });
});
