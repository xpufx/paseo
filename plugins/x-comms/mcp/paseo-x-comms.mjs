#!/usr/bin/env node
// paseo-x-comms: MCP server for x-comms agent conversation over Paseo Relay.
//
// Lets agents on one paseo daemon talk to agents on another paseo daemon, even
// across hosts, via the paseo CLI's `--host <opaque>` flag. paseo classifies
// the host string itself: a value containing `#offer=<b64>` is a relay
// connection (E2EE); anything else is a direct host target (`host:port`,
// `tcp://…`, `unix://…`, IPC paths, bare port).
//
//   Daemons:  ~/.paseo/paseo-x-comms/registry.json   { name: "<offer URL | direct host>" }
//             (the registry file is the primary way to configure daemons;
//              offer from `paseo daemon pair` on the target, or a direct host)
//
// Built on the official MCP SDK (`McpServer` + `StdioServerTransport`), the
// same server paseo itself uses for its agent MCP control plane. The SDK owns
// framing, JSON-RPC, schema validation, and cancellation signals; this file
// only implements the tool logic.
//
// Env overrides (testability / power users):
//   PASEO_X_COMMS_REMOTES    registry file path
//                                     (default ~/.paseo/paseo-x-comms/registry.json)
//   PASEO_X_COMMS_PASEO      paseo binary (default "paseo")
//   PASEO_X_COMMS_TIMEOUT_MS per paseo call timeout (default 120000)
//   PASEO_X_COMMS_EXTENSIONS extension dir (default <registry dir>/extensions)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const VERSION = "0.3.0";
import { z } from "zod";

const REMOTES_DIR = join(homedir(), ".paseo", "paseo-x-comms");

const REMOTES_FILE =
  process.env.PASEO_X_COMMS_REMOTES ||
  join(REMOTES_DIR, "registry.json");

const HOSTS_FILE =
  process.env.PASEO_HOSTS_FILE ||
  join(homedir(), ".paseo", "hosts.json");

const PASEO = process.env.PASEO_X_COMMS_PASEO || "paseo";
const DEFAULT_TIMEOUT_MS = Number(process.env.PASEO_X_COMMS_TIMEOUT_MS || 120000);

const EXTENSIONS_DIR =
  process.env.PASEO_X_COMMS_EXTENSIONS || join(REMOTES_DIR, "extensions");

// daemons registry

function deriveHostFromOffer(value) {
  const match = String(value).match(/#offer=([A-Za-z0-9_-]+)/);
  if (!match) return null;
  try {
    const payload = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    return typeof payload.serverId === "string" ? payload.serverId : null;
  } catch {
    return null;
  }
}

function loadConfiguredHosts() {
  if (!existsSync(HOSTS_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(HOSTS_FILE, "utf8"));
    const map = {};
    const items = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object"
      ? Array.isArray(raw.hosts)
        ? raw.hosts
        : Object.entries(raw).map(([key, val]) =>
            typeof val === "string"
              ? { name: key, endpoint: val }
              : { name: key, ...(val && typeof val === "object" ? val : {}) },
          )
      : [];
    for (const h of items) {
      if (!h) continue;
      const endpoint =
        h.endpoint ?? h.target ?? h.url ?? h.offer ?? (typeof h === "string" ? h : null);
      if (!endpoint || typeof endpoint !== "string") continue;
      const name = h.label ?? h.name ?? h.serverId ?? deriveHostFromOffer(endpoint);
      if (name && typeof name === "string") {
        map[name.trim()] = endpoint.trim();
      }
    }
    return map;
  } catch {
    return {};
  }
}

function loadManualDaemons() {
  if (!existsSync(REMOTES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(REMOTES_FILE, "utf8"));
  } catch {
    throw new Error(`cannot read daemons registry at ${REMOTES_FILE} (corrupt JSON?)`);
  }
}

function loadDaemons() {
  const manual = loadManualDaemons();
  const configured = loadConfiguredHosts();
  return { ...configured, ...manual };
}

function saveManualDaemons(daemons) {
  mkdirSync(dirname(REMOTES_FILE), { recursive: true });
  writeFileSync(REMOTES_FILE, JSON.stringify(daemons, null, 2) + "\n", "utf8");
}

// `--host` is opaque; paseo classifies it (a value containing `#offer=` is a
// relay connection, anything else is a direct host target). We pass the value
// through untouched (no wrapping, no legacy formats).
//
// The alias is resolved to a host target up front, so an unknown alias fails
// before any paseo attempt with the exact string and the reason (pairing).
const PAIRING_HINT = `pairing is required: run \`paseo daemon pair\` on the target and register the offer, or add a direct host, via x_comms_add_daemon (registry: ${REMOTES_FILE})`;

function hostTargetFor(daemon, daemons) {
  const value = daemons[daemon];
  if (value === undefined) {
    throw new Error(`unknown daemon '${daemon}' — ${PAIRING_HINT}`);
  }
  const trimmed = String(value).trim();
  if (!trimmed) throw new Error(`daemon '${daemon}' has an empty host value`);
  return trimmed;
}

// Sending a message to your own agent is almost always a mistake (the envelope
// tells the recipient it is from itself). Fixed, labeled error so it is
// greppable and testable.
const SELF_MESSAGE_LABEL = "x-comms self-message";

async function assertNotSelfMessage(message, signal) {
  const sender = await gatherSenderMeta(signal);
  const senderAgentId = message.fromAgentId ?? sender.agentId;
  if (senderAgentId && message.agentId === senderAgentId) {
    throw new Error(
      `${SELF_MESSAGE_LABEL}: target agentId '${senderAgentId}' is your own agent — choose a different agent.`,
    );
  }
  // TODO(#9): same-daemon-but-different-agent is the locality rule, not self.
  // Once #9 lands, route those natively instead of via x_comms.
}

// paseo shell-out with cancellation

function runPaseo(args, { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      PASEO,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if (signal?.aborted) {
            reject(Object.assign(new Error("request cancelled"), { code: "CANCELLED" }));
            return;
          }
          if (err.killed) {
            reject(new Error(`paseo ${args[0]} timed out after ${timeoutMs}ms`));
            return;
          }
          reject(new Error((stderr || err.message || "").trim().split("\n")[0] || String(err)));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve(stdout.trim());
        }
      },
    );
    if (signal) {
      if (signal.aborted) {
        child.kill("SIGTERM");
      } else {
        signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
      }
    }
  });
}

// sender identity (so recipients know who is talking and from where)

let senderCache = null;

async function gatherSenderMeta(signal) {
  if (senderCache) return senderCache;
  const meta = {
    agentId: process.env.PASEO_AGENT_ID || null,
    agentName: null,
    cwd: process.env.PASEO_AGENT_CWD || null,
    host: hostname(),
    serverId: null,
  };
  try {
    const status = await runPaseo(["daemon", "status", "--json"], {
      timeoutMs: 15000,
      signal,
    });
    if (status && typeof status === "object") {
      if (status.hostname) meta.host = status.hostname;
      meta.serverId = status.serverId || null;
    }
  } catch (err) {
    if (err?.code === "CANCELLED") throw err;
    /* keep os hostname */
  }
  if (meta.agentId) {
    try {
      const info = await runPaseo(["inspect", meta.agentId, "--json"], {
        timeoutMs: 15000,
        signal,
      });
      if (info && typeof info === "object" && info.Name) meta.agentName = info.Name;
    } catch (err) {
      if (err?.code === "CANCELLED") throw err;
      /* id only is fine */
    }
  }
  senderCache = meta;
  return meta;
}

async function senderMetaBlock(signal, target = {}, sender = {}, messageId = null) {
  const m = await gatherSenderMeta(signal);
  const envelope = {
    xComms: {
      version: 6,
      // Neutral type: at stamp time the message is leaving, not arriving.
      // Direction of travel lives in `direction`; viewers derive
      // incoming vs outgoing by comparing sender.agentId to self.
      type: "x-comms.message",
      // Direction of travel as stamped by the sender. Every message leaves
      // its sender, so this is always "outgoing" on the wire; viewers
      // derive incoming vs outgoing by comparing sender.agentId to self.
      direction: "outgoing",
      sender: {
        agentId: sender.agentId ?? m.agentId,
        agentName: sender.agentName ?? m.agentName,
        host: m.host,
        daemonServerId: m.serverId,
        cwd: m.cwd,
      },
      target: {
        daemon: target.daemon ?? null,
        agentId: target.agentId ?? null,
      },
      ...(messageId ? { messageId } : {}),
      sentAt: new Date().toISOString(),
    },
  };
  return `<x-comms-message>${JSON.stringify(envelope)}</x-comms-message>`;
}

// tools

const TOOL_SCHEMAS = {
  listDaemons: {
    detailed: z
      .boolean()
      .optional()
      .describe(
        "If true, returns detailed metadata objects including daemon name, host target, serverId, status, and source.",
      ),
  },
  addDaemon: {
    name: z.string(),
    offer: z
      .string()
      .describe(
        "Full pairing link (https://app.paseo.sh/#offer=…) or a direct daemon host (host:port, tcp://…, unix://…).",
      ),
  },
  removeDaemon: { name: z.string() },
  listAgents: { daemon: z.string() },
  inspect: { daemon: z.string(), agentId: z.string() },
  send: { daemon: z.string(), agentId: z.string(), prompt: z.string(), fromAgentId: z.string().nullable().optional(), fromAgentName: z.string().nullable().optional(), messageId: z.string().min(1).max(128).optional() },
  logs: { daemon: z.string(), agentId: z.string() },
  wait: {
    daemon: z.string(),
    agentId: z.string(),
    timeoutSeconds: z.number().int().positive().optional(),
  },
  listPermissions: { daemon: z.string() },
  allowPermission: {
    daemon: z.string(),
    agentId: z.string(),
    reqId: z.string().optional(),
    all: z.boolean().optional(),
    input: z.string().optional(),
  },
  denyPermission: {
    daemon: z.string(),
    agentId: z.string(),
    reqId: z.string().optional(),
    all: z.boolean().optional(),
    message: z.string().optional(),
    interrupt: z.boolean().optional(),
  },
};

const PREFIX = "x_comms_";

// Surfaced to clients via the MCP `instructions` field (initialize result) so
// every model using this server gets the behavioral contract automatically.
const INSTRUCTIONS = `paseo-x-comms: Cross-daemon messaging between Paseo agents on DIFFERENT daemons or remote hosts. A client may prefix the x_comms_* tool names with its registration name; match the tools actually exposed.

SCOPE & LOCAL VS REMOTE BOUNDARIES:
- LOCAL AGENTS: Do NOT use x_comms_* for agents running on the SAME local daemon or machine. Use native local 'paseo send' or MCP send_agent_prompt directly.
- ISSUE TRACKERS & PRs: Never emit '<x-comms-message>' or JSON envelopes into Forgejo or GitHub issue/PR comments. Ticket comments are strictly for human readers in standard Markdown.
- WIRE ENVELOPE: '<x-comms-message>' is an internal wire protocol generated automatically by this MCP server. Do not manually format, craft, or output raw '<x-comms-message>' tags in chat or ticket comments.

CROSS-DAEMON PROTOCOL:
- An inbound message carrying the <x-comms-message> envelope is from a remote daemon's agent, not a user: reply to the sender via x_comms_send (daemon=sender.daemon, agentId=sender.agentId); on finish, error, or permission block, notify the sender the same way (include permission details when blocked).
- x_comms_send is preemptive: if the target may be busy, x_comms_wait first. x_comms_wait -> idle | permission | timeout; on permission, list_permissions to see prompts, then allow_permission/deny_permission, then wait again.`;

// One tool result shape, mirroring paseo's own PaseoToolResult: text content for
// every client plus structuredContent (a record) for clients that consume it.
// Arrays are wrapped so structuredContent stays a record, matching paseo's
// `ensureValidJson({ … })` convention.
function result(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const isRecord = data !== null && typeof data === "object" && !Array.isArray(data);
  return {
    content: [{ type: "text", text }],
    ...(isRecord ? { structuredContent: data } : {}),
  };
}

// Third-party extensions
//
// ⚠️ TRUSTED, UNSANDBOXED SERVER-TIER CODE. An extension is a `.mjs` file in the
// extension dir that exports `register(api)` (default or named). It runs in
// THIS process with full Node privileges — filesystem, network, child
// processes — exactly like the server itself and like any installed paseo
// plugin. There is no sandbox, no permission prompt, and no isolation boundary.
// Only drop in extensions you would run yourself.
//
// API (version 1; bump API_VERSION on any breaking change to the surface):
//   api.version                     -> 1
//   api.onSend(fn)                  -> outbound message filter
//   api.onReceive(fn)               -> payload received from a daemon
//   api.onToolCall(fn)              -> every tool invocation (raw args)
//   api.registerTool(name, cfg, fn) -> register on this same McpServer
//   api.log(message)                -> stderr
//
// A filter is `(payload, context) => outcome`, run in filename order, and
// returns one of:
//   undefined | null | { action: "pass" }       -> passthrough
//   any other value                             -> transform (new payload)
//   { action: "transform", value: <payload> }   -> transform
//   { action: "block", reason: "<why>" }        -> block (reason is surfaced)
//
// A block stops the chain. A hook that throws is logged and treated as
// passthrough; a file that fails to import or register is skipped. One bad
// extension cannot take down the server or the other extensions.

const API_VERSION = 1;

const extensionHooks = { onSend: [], onReceive: [], onToolCall: [] };

function extensionLog(message) {
  process.stderr.write(`[paseo-x-comms:extensions] ${message}\n`);
}

function describeError(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}

async function runFilter(hookName, payload, context) {
  let current = payload;
  for (const { filename, fn } of extensionHooks[hookName]) {
    let outcome;
    try {
      outcome = await fn(current, context);
    } catch (cause) {
      extensionLog(`${filename}: ${hookName} threw, passing through: ${describeError(cause)}`);
      continue;
    }
    if (outcome === undefined || outcome === null) continue;
    if (typeof outcome === "object" && typeof outcome.action === "string") {
      if (outcome.action === "pass" || outcome.action === "passthrough") continue;
      if (outcome.action === "block") {
        const reason =
          typeof outcome.reason === "string" && outcome.reason.trim()
            ? outcome.reason.trim()
            : `${filename} blocked this ${hookName}`;
        return { blocked: true, reason };
      }
      if (outcome.action === "transform") {
        current = outcome.value;
        continue;
      }
      extensionLog(`${filename}: unknown ${hookName} action '${outcome.action}', passing through`);
      continue;
    }
    current = outcome;
  }
  return { blocked: false, value: current };
}

async function filterOrThrow(hookName, payload, context) {
  const outcome = await runFilter(hookName, payload, context);
  if (outcome.blocked) throw new Error(`x-comms extension blocked ${context.tool}: ${outcome.reason}`);
  return outcome.value;
}

function extensionApi(filename) {
  const add = (hookName) => (fn) => {
    if (typeof fn !== "function") {
      extensionLog(`${filename}: ${hookName} expects a function, ignoring`);
      return;
    }
    extensionHooks[hookName].push({ filename, fn });
  };
  return {
    version: API_VERSION,
    onSend: add("onSend"),
    onReceive: add("onReceive"),
    onToolCall: add("onToolCall"),
    registerTool: (name, config, handler) => registerTool(name, config, handler),
    log: (message) => extensionLog(`${filename}: ${message}`),
  };
}

async function loadExtensions(dir = EXTENSIONS_DIR) {
  let files;
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".mjs")).sort();
  } catch (cause) {
    if (cause?.code !== "ENOENT") extensionLog(`cannot read ${dir}: ${describeError(cause)}`);
    return;
  }
  if (files.length === 0) return;
  extensionLog(`loading ${files.length} extension(s) from ${dir} (trusted, unsandboxed)`);
  for (const filename of files) {
    try {
      const mod = await import(pathToFileURL(join(dir, filename)).href);
      const register = mod.default ?? mod.register;
      if (typeof register !== "function") {
        extensionLog(`${filename}: no default/register export, skipping`);
        continue;
      }
      await register(extensionApi(filename));
      extensionLog(`${filename}: loaded`);
    } catch (cause) {
      extensionLog(`${filename}: failed to load, skipping: ${describeError(cause)}`);
    }
  }
}

// Every tool — built-in or extension-registered — runs its raw args through
// the onToolCall chain first. A block becomes a tool error; a transform
// replaces the args.
function registerTool(name, config, handler) {
  server.registerTool(name, config, async (input, extra) => {
    const args = await filterOrThrow("onToolCall", input, { tool: name });
    return handler(args, extra);
  });
}

// Tool calls that hit a daemon expose the response to onReceive before it
// reaches the model.
async function callPaseo(tool, args, { signal, daemon = null, agentId = null } = {}) {
  const data = await runPaseo(args, { signal });
  return await filterOrThrow("onReceive", data, { tool, daemon, agentId });
}

async function handleSend(input, signal) {
  const message = await filterOrThrow(
    "onSend",
    {
      daemon: input.daemon,
      agentId: input.agentId,
      prompt: input.prompt,
      fromAgentId: input.fromAgentId ?? null,
      fromAgentName: input.fromAgentName ?? null,
      messageId: input.messageId ?? randomUUID(),
    },
    { tool: `${PREFIX}send` },
  );
  const target = hostTargetFor(message.daemon, loadDaemons());
  await assertNotSelfMessage(message, signal);
  const stamped = `${await senderMetaBlock(signal, {
    agentId: message.agentId,
    daemon: message.daemon,
  }, {
    agentId: message.fromAgentId ?? null,
    agentName: message.fromAgentName ?? null,
  }, message.messageId)}\n\n${message.prompt}`;
  return await callPaseo(
    `${PREFIX}send`,
    ["send", message.agentId, "--host", target, "--message-id", message.messageId, "--json", "--no-wait", stamped],
    { signal, daemon: message.daemon, agentId: message.agentId },
  );
}

function registerTools(server) {
  registerTool(
    `${PREFIX}list_daemons`,
    {
      title: "List daemons",
      description: "List configured paseo daemons (names only by default, or detailed objects when detailed: true).",
      inputSchema: TOOL_SCHEMAS.listDaemons,
    },
    (input) => {
      const daemons = loadDaemons();
      if (!input?.detailed) {
        return result(Object.keys(daemons));
      }
      const manual = loadManualDaemons();
      const details = Object.entries(daemons).map(([name, target]) => {
        const isManual = manual[name] !== undefined;
        return {
          name,
          target,
          status: "online",
          serverId: deriveHostFromOffer(target),
          source: isManual ? "registry" : "configured-host",
        };
      });
      return result(details);
    },
  );

  registerTool(
    `${PREFIX}add_daemon`,
    {
      title: "Add daemon",
      description:
        "Register a paseo daemon by name. offer is a full pairing link (https://app.paseo.sh/#offer=…) from `paseo daemon pair` or a direct daemon host (host:port, tcp://…, unix://…).",
      inputSchema: TOOL_SCHEMAS.addDaemon,
    },
    (input) => {
      const manual = loadManualDaemons();
      manual[input.name] = input.offer;
      saveManualDaemons(manual);
      return result({ ok: true, daemons: Object.keys(loadDaemons()) });
    },
  );

  registerTool(
    `${PREFIX}remove_daemon`,
    {
      title: "Remove daemon",
      description: "Forget a registered daemon.",
      inputSchema: TOOL_SCHEMAS.removeDaemon,
    },
    (input) => {
      const manual = loadManualDaemons();
      if (manual[input.name] === undefined) {
        const configured = loadConfiguredHosts();
        if (configured[input.name] !== undefined) {
          throw new Error(
            `cannot remove '${input.name}': daemon is managed via configured hosts (~/.paseo/hosts.json)`,
          );
        }
        throw new Error(`unknown daemon '${input.name}'`);
      }
      delete manual[input.name];
      saveManualDaemons(manual);
      return result({ ok: true, daemons: Object.keys(loadDaemons()) });
    },
  );

  registerTool(
    `${PREFIX}list_agents`,
    {
      title: "List agents",
      description: "List agents on a daemon.",
      inputSchema: TOOL_SCHEMAS.listAgents,
    },
    async (input, extra) =>
      result(
        await callPaseo(`${PREFIX}list_agents`, ["ls", "--host", hostTargetFor(input.daemon, loadDaemons()), "--json"], {
          signal: extra.signal,
          daemon: input.daemon,
        }),
      ),
  );

  registerTool(
    `${PREFIX}inspect`,
    {
      title: "Inspect agent",
      description: "Inspect an agent on a daemon.",
      inputSchema: TOOL_SCHEMAS.inspect,
    },
    async (input, extra) =>
      result(
        await callPaseo(
          `${PREFIX}inspect`,
          ["inspect", input.agentId, "--host", hostTargetFor(input.daemon, loadDaemons()), "--json"],
          { signal: extra.signal, daemon: input.daemon, agentId: input.agentId },
        ),
      ),
  );

  registerTool(
    `${PREFIX}send`,
    {
      title: "Send message",
      description:
        "Send a message/task to an agent on a daemon (starts it if idle). Dispatches immediately (fire-and-forget, like paseo send --no-wait). Follow up with wait/logs to track the agent.",
      inputSchema: TOOL_SCHEMAS.send,
    },
    async (input, extra) => result(await handleSend(input, extra.signal)),
  );

  registerTool(
    `${PREFIX}logs`,
    {
      title: "View agent logs",
      description: "View the activity/timeline of an agent on a daemon.",
      inputSchema: TOOL_SCHEMAS.logs,
    },
    async (input, extra) =>
      result(
        await callPaseo(
          `${PREFIX}logs`,
          ["logs", input.agentId, "--host", hostTargetFor(input.daemon, loadDaemons()), "--json"],
          { signal: extra.signal, daemon: input.daemon, agentId: input.agentId },
        ),
      ),
  );

  registerTool(
    `${PREFIX}wait`,
    {
      title: "Wait for agent",
      description:
        "Block until an agent on a daemon becomes idle. Returns status \"permission\" (with kind) the moment the agent is blocked on a permission prompt, \"timeout\" if --timeoutSeconds elapses, or \"idle\" when done.",
      inputSchema: TOOL_SCHEMAS.wait,
    },
    async (input, extra) => {
      const args = ["wait", input.agentId];
      if (input.timeoutSeconds !== undefined) args.push("--timeout", String(input.timeoutSeconds));
      args.push("--host", hostTargetFor(input.daemon, loadDaemons()), "--json");
      return result(await callPaseo(`${PREFIX}wait`, args, { signal: extra.signal, daemon: input.daemon, agentId: input.agentId }));
    },
  );

  registerTool(
    `${PREFIX}list_permissions`,
    {
      title: "List permissions",
      description: "List pending permission requests on a daemon.",
      inputSchema: TOOL_SCHEMAS.listPermissions,
    },
    async (input, extra) =>
      result(
        await callPaseo(
          `${PREFIX}list_permissions`,
          ["permit", "ls", "--host", hostTargetFor(input.daemon, loadDaemons()), "--json"],
          { signal: extra.signal, daemon: input.daemon },
        ),
      ),
  );

  registerTool(
    `${PREFIX}allow_permission`,
    {
      title: "Allow permission",
      description:
        "Allow an agent's permission request (reqId) or all its pending requests (all=true). input is optional modified input JSON.",
      inputSchema: TOOL_SCHEMAS.allowPermission,
    },
    async (input, extra) => {
      if (!input.reqId && !input.all) throw new Error("provide reqId or all=true");
      const args = ["permit", "allow", input.agentId];
      if (input.reqId) args.push(input.reqId);
      if (input.all) args.push("--all");
      if (input.input !== undefined) args.push("--input", input.input);
      args.push("--host", hostTargetFor(input.daemon, loadDaemons()), "--json");
      return result(await callPaseo(`${PREFIX}allow_permission`, args, { signal: extra.signal, daemon: input.daemon, agentId: input.agentId }));
    },
  );

  registerTool(
    `${PREFIX}deny_permission`,
    {
      title: "Deny permission",
      description:
        "Deny an agent's permission request (reqId) or all its pending requests (all=true). Optional message and interrupt.",
      inputSchema: TOOL_SCHEMAS.denyPermission,
    },
    async (input, extra) => {
      if (!input.reqId && !input.all) throw new Error("provide reqId or all=true");
      const args = ["permit", "deny", input.agentId];
      if (input.reqId) args.push(input.reqId);
      if (input.all) args.push("--all");
      if (input.message !== undefined) args.push("--message", input.message);
      if (input.interrupt) args.push("--interrupt");
      args.push("--host", hostTargetFor(input.daemon, loadDaemons()), "--json");
      return result(await callPaseo(`${PREFIX}deny_permission`, args, { signal: extra.signal, daemon: input.daemon, agentId: input.agentId }));
    },
  );
}

// entry

const server = new McpServer(
  {
    name: "paseo-x-comms",
    version: VERSION,
  },
  {
    capabilities: { tools: { listChanged: false } },
    instructions: INSTRUCTIONS,
  },
);

registerTools(server);

await loadExtensions();

const transport = new StdioServerTransport();
await server.connect(transport);
