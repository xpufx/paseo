// Hermetic protocol tests for paseo-x-comms.
//
// Everything runs against a fake paseo CLI (test/fixtures/fake-paseo.mjs) and a
// temp remotes registry; never a real paseo daemon, never ~/.paseo, never the
// live cross_* installs. The correctness bar is the official MCP SDK client,
// the same one pi-mcp-adapter and opencode use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "paseo-x-comms.mjs");
const FAKE = join(HERE, "fixtures", "fake-paseo.mjs");
const EXTENSIONS = join(HERE, "fixtures", "extensions");

// Extensions are loaded from disk on server start; tests must never read the
// operator's real ~/.paseo/paseo-x-comms/extensions tree. Default to an empty
// temp dir and point individual tests at the fixture dirs.
const NO_EXTENSIONS = mkdtempSync(join(tmpdir(), "paseo-x-comms-no-ext-"));

function extensionDir(name) {
  return join(EXTENSIONS, name);
}

// Bare base64 payload (old `paseo daemon pair` format). The new implementation
// does NOT wrap it; the registry must hold canonical forms (full pairing URL
// or direct host). Passed through as-is, so paseo fails visibly on it.
const B64_OFFER = "eyJ2IjoyLCJzZXJ2ZXJJZCI6InNydl9mYWtlIiwiZGFlbW9uUHVibGljS2V5QjY0IjoieCIsInJlbGF5Ijp7fX0";
const RELAY_URL = `https://app.paseo.sh/#offer=${B64_OFFER}`;
const DIRECT_HOST = "10.0.0.5:6767";

const PREFIX = "x_comms_";

function baseEnv(extra = {}) {
  return {
    ...process.env,
    PASEO_X_COMMS_PASEO: FAKE,
    PASEO_AGENT_ID: "agent-test-1",
    PASEO_AGENT_CWD: "/tmp/test-cwd",
    PASEO_X_COMMS_EXTENSIONS: NO_EXTENSIONS,
    ...extra,
  };
}

function tempRemotes(entries = {}) {
  const dir = mkdtempSync(join(tmpdir(), "paseo-x-comms-test-"));
  const file = join(dir, "remotes.json");
  writeFileSync(file, JSON.stringify(entries, null, 2) + "\n");
  return file;
}

function tempHosts(entries = []) {
  const dir = mkdtempSync(join(tmpdir(), "paseo-hosts-test-"));
  const file = join(dir, "hosts.json");
  writeFileSync(file, JSON.stringify(entries, null, 2) + "\n");
  return file;
}

async function startClient(extraEnv = {}, remotesFile = tempRemotes()) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    env: baseEnv({ PASEO_X_COMMS_REMOTES: remotesFile, ...extraEnv }),
    stderr: "inherit",
  });
  const client = new Client({ name: "paseo-x-comms-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport, remotesFile };
}

function textOf(callResult) {
  assert.ok(callResult.content?.[0], "expected text content in result");
  return callResult.content[0].text;
}

// Extract and parse the structured sender-meta envelope from a stamped prompt.
function metaOf(stampedPrompt) {
  const m = stampedPrompt.match(/^\[x-comms\] (\{.*\})/);
  assert.ok(m, `no meta envelope in: ${stampedPrompt.slice(0, 120)}…`);
  return JSON.parse(m[1]);
}

test("lists 11 tools under paseo_cross_daemon_*", async () => {
  const { client, transport } = await startClient();
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 11);
    const names = tools.map((t) => t.name).sort();
    assert.ok(names.every((n) => n.startsWith(PREFIX)), `unexpected names: ${names.join(", ")}`);
    assert.deepEqual(names, [
      PREFIX + "add_daemon",
      PREFIX + "allow_permission",
      PREFIX + "deny_permission",
      PREFIX + "inspect",
      PREFIX + "list_agents",
      PREFIX + "list_daemons",
      PREFIX + "list_permissions",
      PREFIX + "logs",
      PREFIX + "remove_daemon",
      PREFIX + "send",
      PREFIX + "wait",
    ]);
    for (const t of tools) {
      assert.ok(t.description?.length > 0, `missing description on ${t.name}`);
      assert.ok(t.inputSchema?.type === "object", `missing inputSchema on ${t.name}`);
    }
  } finally {
    await client.close();
  }
});

test("list_daemons on empty registry returns []", async () => {
  const { client, transport } = await startClient();
  try {
    const res = await client.callTool({ name: `${PREFIX}list_daemons`, arguments: {} });
    assert.equal(textOf(res), "[]");
  } finally {
    await client.close();
  }
});

test("list_daemons returns configured hosts and supports detailed: true", async () => {
  const hostsFile = tempHosts([
    { label: "desktop-node", endpoint: "tcp://192.168.1.55:6767" },
  ]);
  const { client } = await startClient({ PASEO_HOSTS_FILE: hostsFile });
  try {
    const res = await client.callTool({ name: `${PREFIX}list_daemons`, arguments: {} });
    assert.deepEqual(JSON.parse(textOf(res)), ["desktop-node"]);

    const detailedRes = await client.callTool({
      name: `${PREFIX}list_daemons`,
      arguments: { detailed: true },
    });
    const parsed = JSON.parse(textOf(detailedRes));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].name, "desktop-node");
    assert.equal(parsed[0].target, "tcp://192.168.1.55:6767");
    assert.equal(parsed[0].status, "online");
    assert.equal(parsed[0].source, "configured-host");
  } finally {
    await client.close();
  }
});

test("remove_daemon rejects removal of configured hosts", async () => {
  const hostsFile = tempHosts([
    { label: "desktop-node", endpoint: "tcp://192.168.1.55:6767" },
  ]);
  const { client } = await startClient({ PASEO_HOSTS_FILE: hostsFile });
  try {
    const res = await client.callTool({
      name: `${PREFIX}remove_daemon`,
      arguments: { name: "desktop-node" },
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /daemon is managed via configured hosts/);
  } finally {
    await client.close();
  }
});

test("add_daemon persists to the registry file", async () => {
  const { client, transport, remotesFile } = await startClient();
  try {
    const res = await client.callTool({
      name: `${PREFIX}add_daemon`,
      arguments: { name: "hsi", offer: RELAY_URL },
    });
    assert.equal(JSON.parse(textOf(res)).ok, true);
    const onDisk = JSON.parse(readFileSync(remotesFile, "utf8"));
    assert.deepEqual(onDisk, { hsi: RELAY_URL });
  } finally {
    await client.close();
  }
});

test("add_daemon rejects missing required args", async () => {
  const { client, transport } = await startClient();
  try {
    const res = await client.callTool({
      name: `${PREFIX}add_daemon`,
      arguments: { name: "x" },
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /offer/);
  } finally {
    await client.close();
  }
});

test("unknown tool is rejected", async () => {
  const { client, transport } = await startClient();
  try {
    const res = await client.callTool({ name: "cross_list_remotes", arguments: {} });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /not found/);
  } finally {
    await client.close();
  }
});

test("remove_daemon on unknown name fails visibly", async () => {
  const { client, transport } = await startClient();
  try {
    const res = await client.callTool({
      name: `${PREFIX}remove_daemon`,
      arguments: { name: "nope" },
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /unknown daemon 'nope'/);
  } finally {
    await client.close();
  }
});

test("bare base64 payload is passed through unwrapped (no legacy wrap)", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ hsi: B64_OFFER }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}list_agents`,
      arguments: { daemon: "hsi" },
    });
    const agents = JSON.parse(textOf(res));
    assert.equal(agents[0].sawHost, B64_OFFER);
  } finally {
    await client.close();
  }
});

test("direct host passes through untouched (no relay wrap)", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ dev: DIRECT_HOST }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}list_agents`,
      arguments: { daemon: "dev" },
    });
    const agents = JSON.parse(textOf(res));
    assert.equal(agents[0].sawHost, DIRECT_HOST);
  } finally {
    await client.close();
  }
});

test("full pairing URL passes through untouched", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}list_agents`,
      arguments: { daemon: "hsi" },
    });
    const agents = JSON.parse(textOf(res));
    assert.equal(agents[0].sawHost, RELAY_URL);
  } finally {
    await client.close();
  }
});

test("send stamps a structured sender-meta envelope and reaches the remote agent", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}send`,
      arguments: { daemon: "hsi", agentId: "agent-9", prompt: "hello there", messageId: "msg-headless-1" },
    });
    const sent = JSON.parse(textOf(res));
    assert.equal(sent.to, "agent-9");
    assert.equal(sent.sawHost, RELAY_URL);
    assert.equal(sent.sawNoWait, true, "send must dispatch fire-and-forget (--no-wait)");
    assert.equal(sent.sawMessageId, "msg-headless-1");
    assert.equal(sent.promptHead.split("\n\n")[1], "hello there", "prompt must stay prose");
    const meta = metaOf(sent.promptHead);
    assert.equal(meta.xComms.version, 5);
    assert.equal(meta.xComms.type, "x-comms.message");
    assert.equal(meta.xComms.direction, "outgoing");
    assert.equal(meta.xComms.sender.agentId, "agent-test-1");
    assert.equal(meta.xComms.sender.agentName, "fake-agent");
    assert.equal(meta.xComms.sender.host, "fakehost");
    assert.equal(meta.xComms.sender.daemonServerId, "srv_fake");
    assert.equal(meta.xComms.sender.cwd, "/tmp/test-cwd");
    assert.equal(meta.xComms.target.agentId, "agent-9");
    assert.equal(meta.xComms.target.daemon, "hsi");
    assert.equal(meta.xComms.messageId, "msg-headless-1");
    assert.ok(!Number.isNaN(Date.parse(meta.xComms.sentAt)), "sentAt must be ISO");
  } finally {
    await client.close();
  }
});

test("inspect and logs round-trip through the fake CLI", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const insp = await client.callTool({
      name: `${PREFIX}inspect`,
      arguments: { daemon: "hsi", agentId: "agent-7" },
    });
    assert.equal(JSON.parse(textOf(insp)).Name, "fake-agent");

    const logs = await client.callTool({
      name: `${PREFIX}logs`,
      arguments: { daemon: "hsi", agentId: "agent-7" },
    });
    assert.deepEqual(JSON.parse(textOf(logs)).events, []);
  } finally {
    await client.close();
  }
});

test("wait blocks until idle and passes through timeoutSeconds", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}wait`,
      arguments: { daemon: "hsi", agentId: "agent-9", timeoutSeconds: 30 },
    });
    const w = JSON.parse(textOf(res));
    assert.equal(w.status, "idle");
    assert.equal(w.agentId, "agent-9");
    assert.equal(w.sawHost, RELAY_URL);
    assert.equal(w.sawTimeout, "30");
  } finally {
    await client.close();
  }
});

test("wait surfaces the permission kind when the agent is blocked", async () => {
  const { client, transport } = await startClient(
    { FAKE_PASEO_WAIT_STATUS: "permission" },
    tempRemotes({ hsi: RELAY_URL }),
  );
  try {
    const res = await client.callTool({
      name: `${PREFIX}wait`,
      arguments: { daemon: "hsi", agentId: "agent-9" },
    });
    const w = JSON.parse(textOf(res));
    assert.equal(w.status, "permission");
    assert.match(w.message, /permission: external_directory/);
  } finally {
    await client.close();
  }
});

test("list_permissions returns pending requests", async () => {
  const pending = JSON.stringify([
    { id: "per_0009", agentId: "agent-9", name: "external_directory", description: "Scope: /tmp/*" },
  ]);
  const { client, transport } = await startClient(
    { FAKE_PASEO_PERMISSIONS: pending },
    tempRemotes({ hsi: RELAY_URL }),
  );
  try {
    const res = await client.callTool({
      name: `${PREFIX}list_permissions`,
      arguments: { daemon: "hsi" },
    });
    const perms = JSON.parse(textOf(res));
    assert.equal(perms[0].id, "per_0009");
    assert.match(perms[0].description, /\/tmp\/\*/);
  } finally {
    await client.close();
  }
});

test("allow_permission targets a request and reaches the remote daemon", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}allow_permission`,
      arguments: { daemon: "hsi", agentId: "agent-9", reqId: "per_0009" },
    });
    const granted = JSON.parse(textOf(res));
    assert.equal(granted[0].result, "allowed");
    assert.equal(granted[0].requestId, "per_0009");
    assert.equal(granted[0].sawHost, RELAY_URL);
  } finally {
    await client.close();
  }
});

test("allow_permission requires reqId or all", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}allow_permission`,
      arguments: { daemon: "hsi", agentId: "agent-9" },
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /reqId or all/);
  } finally {
    await client.close();
  }
});

test("deny_permission supports --all and message", async () => {
  const { client, transport } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}deny_permission`,
      arguments: { daemon: "hsi", agentId: "agent-9", all: true, message: "no" },
    });
    const denied = JSON.parse(textOf(res));
    assert.equal(denied.data[0].result, "denied");
    assert.equal(denied.data[0].sawAll, true);
  } finally {
    await client.close();
  }
});

// raw-pipe tests (the handover's raw handshake method)

function startRawServer(remotesFile, extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: baseEnv({ PASEO_X_COMMS_REMOTES: remotesFile, ...extraEnv }),
    stdio: ["pipe", "pipe", "inherit"],
  });
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const pending = new Map();
  const misc = [];
  rl.on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else {
      misc.push(msg);
    }
  });
  return {
    child,
    send(obj) {
      child.stdin.write(JSON.stringify(obj) + "\n");
    },
    wait(id) {
      return new Promise((resolve) => pending.set(id, resolve));
    },
    async close() {
      child.stdin.end();
      const [code] = await Promise.race([
        new Promise((resolve) => child.once("exit", (c) => resolve([c]))),
        sleep(5000).then(() => [null]),
      ]);
      return code;
    },
  };
}

async function rawHandshake(s) {
  const init = s.wait(1);
  s.send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
  });
  const res = await init;
  assert.equal(res.jsonrpc, "2.0");
  assert.equal(res.result.protocolVersion, "2025-03-26");
  assert.equal(res.result.serverInfo.name, "paseo-x-comms");
  assert.equal(res.result.capabilities.tools.listChanged, true); // SDK forces true when tools are registered
  assert.match(res.result.instructions, /\[x-comms\]/);
  s.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}

test("cancellation kills the in-flight paseo child promptly", async () => {
  const s = startRawServer(tempRemotes({ hsi: RELAY_URL }), { FAKE_PASEO_DELAY_MS: "8000" });
  await rawHandshake(s);
  const t0 = Date.now();
  const call = s.wait(7);
  s.send({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: `${PREFIX}list_agents`, arguments: { daemon: "hsi" } },
  });
  await sleep(400); // let the fake paseo spawn and start sleeping
  s.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } });

  // Per spec the cancelled request is dropped; no response should arrive.
  const got = await Promise.race([call.then(() => true), sleep(1000).then(() => false)]);
  assert.equal(got, false, "cancelled request produced a response");

  // Close stdin; the server must exit promptly (child was killed on abort),
  // well before the 8s fake delay would have completed the call.
  s.child.stdin.end();
  const [code] = await Promise.race([
    new Promise((resolve) => s.child.once("exit", (c) => resolve([c]))),
    sleep(5000).then(() => [null]),
  ]);
  assert.equal(code, 0, "server did not exit cleanly after cancellation");
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 5000, `server lingered after cancellation (${elapsed}ms); child was not killed`);
});

test("server does not exit while a call is in flight after stdin closes", async () => {
  const s = startRawServer(tempRemotes({ hsi: RELAY_URL }), { FAKE_PASEO_DELAY_MS: "2000" });
  await rawHandshake(s);
  const t0 = Date.now();
  const call = s.wait(5);
  s.send({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: `${PREFIX}list_agents`, arguments: { daemon: "hsi" } },
  });
  await sleep(300);
  s.child.stdin.end(); // close stdin while the call is in flight
  await sleep(800);
  assert.equal(s.child.exitCode, null, "server exited while a call was in flight");
  const result = await Promise.race([call, sleep(4000).then(() => null)]);
  assert.ok(result, "in-flight call never completed");
  const [code] = await Promise.race([
    new Promise((resolve) => s.child.once("exit", (c) => resolve([c]))),
    sleep(5000).then(() => [null]),
  ]);
  assert.equal(code, 0, "server did not exit cleanly");
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 1800, `server exited before the 2s call completed (${elapsed}ms)`);
});

// extensions

function extEnv(name, remotes) {
  return startClient({ PASEO_X_COMMS_EXTENSIONS: extensionDir(name) }, remotes);
}

test("extensions: onSend transform rewrites the stamped prompt", async () => {
  const { client } = await extEnv("transform", tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}send`,
      arguments: { daemon: "hsi", agentId: "agent-9", prompt: "hello there" },
    });
    const sent = JSON.parse(textOf(res));
    assert.equal(sent.promptHead.split("\n\n")[1], "[EXT] hello there");
  } finally {
    await client.close();
  }
});

test("extensions: onToolCall transforms args and onReceive transforms the response", async () => {
  const { client } = await extEnv("transform", tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}inspect`,
      arguments: { daemon: "hsi", agentId: "agent-7" },
    });
    const parsed = JSON.parse(textOf(res));
    assert.equal(parsed.Id, "agent-7-rewritten", "onToolCall must rewrite the args");
    assert.equal(parsed.extTag, "seen", "onReceive must rewrite the response");
  } finally {
    await client.close();
  }
});

test("extensions: onSend block surfaces the reason and fails the call", async () => {
  const { client } = await extEnv("block", tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}send`,
      arguments: { daemon: "hsi", agentId: "agent-9", prompt: "hello" },
    });
    assert.equal(res.isError, true);
    assert.match(textOf(res), /blocked by fixture/);
  } finally {
    await client.close();
  }
});

test("extensions: onToolCall block surfaces the reason and leaves other tools working", async () => {
  const { client } = await extEnv("tool-block", tempRemotes({ hsi: RELAY_URL }));
  try {
    const blocked = await client.callTool({ name: `${PREFIX}list_daemons`, arguments: {} });
    assert.equal(blocked.isError, true);
    assert.match(textOf(blocked), /denied by fixture/);

    const ok = await client.callTool({
      name: `${PREFIX}list_agents`,
      arguments: { daemon: "hsi" },
    });
    assert.equal(ok.isError, undefined);
    assert.equal(JSON.parse(textOf(ok))[0].sawHost, RELAY_URL);
  } finally {
    await client.close();
  }
});

test("extensions: a bad extension is skipped without affecting the others (load failure)", async () => {
  const { client } = await extEnv("broken-load", tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}send`,
      arguments: { daemon: "hsi", agentId: "agent-9", prompt: "hello" },
    });
    assert.equal(res.isError, undefined, "the good neighbour must still run");
    assert.equal(JSON.parse(textOf(res)).promptHead.split("\n\n")[1], "[GOOD] hello");
  } finally {
    await client.close();
  }
});

test("extensions: a throwing hook is isolated and the others still run (call failure)", async () => {
  const { client } = await extEnv("broken-hook", tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}send`,
      arguments: { daemon: "hsi", agentId: "agent-9", prompt: "hello" },
    });
    assert.equal(res.isError, undefined, "a throwing hook must not fail the call");
    assert.equal(JSON.parse(textOf(res)).promptHead.split("\n\n")[1], "[GOOD] hello");
  } finally {
    await client.close();
  }
});

test("extensions: registerTool adds a tool to the same server", async () => {
  const { client } = await extEnv("custom-tool", tempRemotes({ hsi: RELAY_URL }));
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "x_comms_ext_echo"), "extension tool must be listed");
    const res = await client.callTool({ name: "x_comms_ext_echo", arguments: {} });
    assert.equal(textOf(res), "echo-from-extension");
  } finally {
    await client.close();
  }
});

// preflight + self-message

test("preflight: unknown daemon names the string and asks for pairing", async () => {
  const { client } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    for (const call of [
      { name: `${PREFIX}send`, arguments: { daemon: "ghost", agentId: "agent-9", prompt: "hi" } },
      { name: `${PREFIX}list_agents`, arguments: { daemon: "ghost" } },
    ]) {
      const res = await client.callTool(call);
      assert.equal(res.isError, true, `${call.name} should fail on an unknown daemon`);
      assert.match(textOf(res), /unknown daemon 'ghost'/);
      assert.match(textOf(res), /pairing is required/i);
    }
  } finally {
    await client.close();
  }
});

test("self-message: sending to your own agent is refused with the fixed label", async () => {
  const { client } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const implicit = await client.callTool({
      name: `${PREFIX}send`,
      arguments: { daemon: "hsi", agentId: "agent-test-1", prompt: "hi" },
    });
    assert.equal(implicit.isError, true);
    assert.match(textOf(implicit), /x-comms self-message/);
    assert.match(textOf(implicit), /agent-test-1/);

    const explicit = await client.callTool({
      name: `${PREFIX}send`,
      arguments: { daemon: "hsi", agentId: "agent-a", fromAgentId: "agent-a", prompt: "hi" },
    });
    assert.equal(explicit.isError, true, "fromAgentId must be treated as the sender");
    assert.match(textOf(explicit), /x-comms self-message/);
    assert.match(textOf(explicit), /agent-a/);
  } finally {
    await client.close();
  }
});

test("self-message: a different agent is allowed (same-daemon locality is #9)", async () => {
  const { client } = await startClient({}, tempRemotes({ hsi: RELAY_URL }));
  try {
    const res = await client.callTool({
      name: `${PREFIX}send`,
      arguments: { daemon: "hsi", agentId: "agent-other", prompt: "hi" },
    });
    assert.equal(res.isError, undefined, "a different agent must not be treated as self");
    assert.equal(JSON.parse(textOf(res)).to, "agent-other");
  } finally {
    await client.close();
  }
});
