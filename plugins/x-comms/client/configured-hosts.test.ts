import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEnvelope, buildXCommsEnvelope } from "../shared/envelope.ts";
import {
  configuredHostAgentKey,
  listConfiguredHostAgents,
  sendConfiguredHostAgent,
} from "./configured-hosts.ts";

function client(entries: Array<{ id: string; title: string; status?: string }>, sent: Array<{ value: string; messageId?: string }> = []) {
  return {
    agents: {
      list: async () => ({ entries: entries.map((agent) => ({ agent })) }),
      ref: (agentId: string) => ({ send: async (message: string, options?: { messageId?: string }) => { sent.push({ value: `${agentId}:${message}`, messageId: options?.messageId }); } }),
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

  it("sends the preserved envelope to only the selected configured-host agent", async () => {
    const sent: Array<{ value: string; messageId?: string }> = [];
    const stamped = `${buildXCommsEnvelope({
      sender: { agentId: "source", agentName: "User", host: "paseo-client", daemonServerId: null, cwd: null },
      target: { daemon: "srv_two", agentId: "target" },
      sentAt: "2026-09-20T00:00:00.000Z",
    })}\n\nhello`;
    await sendConfiguredHostAgent({
      serverId: "srv_two",
      agentId: "target",
      message: stamped,
      messageId: "msg-configured-1",
      getClient: () => client([], sent) as never,
    });
    assert.equal(sent.length, 1);
    assert.match(sent[0].value, /^target:<x-comms-message>/);
    assert.equal(sent[0].messageId, "msg-configured-1");
    assert.equal(parseEnvelope(stamped)?.envelope.xComms.target.daemon, "srv_two");
  });

  it("surfaces a released or disconnected target handle without trying another host", async () => {
    let acquired = 0;
    await assert.rejects(
      sendConfiguredHostAgent({
        serverId: "srv_one",
        agentId: "agent", message: "message", messageId: "msg-released",
        getClient: () => {
          acquired += 1;
          return { agents: { ref: () => ({ send: async () => { throw new Error("handle released"); } }) } } as never;
        },
      }),
      /handle released/,
    );
    assert.equal(acquired, 1);
  });

  it("reuses a caller-provided messageId on a duplicate native send", async () => {
    const sent: Array<{ value: string; messageId?: string }> = [];
    const args = {
      serverId: "srv_two",
      agentId: "target",
      message: "[x-comms] duplicate-safe",
      messageId: "msg-stable-retry",
      getClient: () => client([], sent) as never,
    };
    await sendConfiguredHostAgent(args);
    await sendConfiguredHostAgent(args);
    assert.deepEqual(sent.map((entry) => entry.messageId), ["msg-stable-retry", "msg-stable-retry"]);
  });
});
