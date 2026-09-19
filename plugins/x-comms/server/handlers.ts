import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPeriodicTask, createPluginLogger, safeSpawn } from "paseo-plugin-helper/server";
import type { PaseoApi } from "@getpaseo/client";
import { withTimeout } from "paseo-plugin-helper/shared";
import { getSnapshotFresh, agentCountFor, refreshSnapshot, initializeSnapshot } from "./snapshot";
import {
  registryReadRpc,
  daemonAddRpc,
  daemonUpdateRpc,
  daemonRemoveRpc,
  daemonHealthRpc,
} from "../shared/registry";
import {
  parseRegistry,
  validateDaemonHost,
  validateDaemonName,
  currentRegistryPath,
  readRegistry,
  mutateRegistry,
  deriveHostFromValue,
} from "./registry";
import { serverPath } from "./server-status";
import { readRelayStatus } from "./relay-status";

// Startup check: validate whatever is already in the registry as soon as the
// plugin backend loads, so a corrupt or invalid config is caught early and
// visible in `paseo plugin logs`.
const log = createPluginLogger("paseo-x-comms");

// The host Paseo API, remembered from the most recent handler/hook context so
// the periodic outbox worker can append expiry notices to a local agent's
// timeline even when no RPC is in flight.
let paseoRef: PaseoApi | null = null;

export function rememberPaseo(paseo: PaseoApi | null | undefined): void {
  if (paseo) paseoRef = paseo;
}

export function runStartupCheck(): void {
  const registryPath = currentRegistryPath();
  const current = readRegistry(registryPath);
  if (!current.exists) {
    log.info(`no registry at ${registryPath} (will be created on first save)`);
    return;
  }
  if (!current.ok) {
    log.error(`existing registry at ${registryPath} is corrupt: ${current.parseError}`);
    return;
  }
  const invalid = current.daemons.filter((daemon) => !daemon.valid);
  if (invalid.length > 0) {
    log.error(
      `${invalid.length} invalid entr${invalid.length === 1 ? "y" : "ies"} at ${registryPath}: ${invalid
        .map((daemon) => `${daemon.name} (${daemon.error})`)
        .join(", ")}`,
    );
  } else {
    log.info(`${current.daemons.length} daemon(s) at ${registryPath}, all valid`);
  }
  const flags = resolveFeatureFlags(readUiPrefs());
  log.info(`presence ${flags.presenceEnabled ? "enabled" : "disabled"}, injection ${flags.injectionEnabled ? "enabled" : "disabled"}`);
}

// Runs when this module has fully evaluated (invoked at the bottom of this
// file): module-level const initializers below must exist first, since the
// daemon compiles to CJS where top-level calls execute in source order.

export function hostnameFor(daemon: string): string | null {
  const hostnames = readUiPrefs().daemonHostnames ?? {};
  return hostnames[daemon] ?? null;
}

export async function handleRegistryRead() {
  const registryPath = currentRegistryPath();
  const current = readRegistry(registryPath);
  const daemons = current.daemons.map((daemon) => ({
    ...daemon,
    serverId: identityFor(daemon.name),
    hostname: hostnameFor(daemon.name),
  }));
  return { registryPath, exists: current.exists, validJson: current.ok, parseError: current.parseError, daemons };
}

export async function handleDaemonAdd(input: { name: string; value: string }) {
  const registryPath = currentRegistryPath();
  const nameCheck = validateDaemonName(input.name);
  if (!nameCheck.valid) {
    return { saved: false, error: nameCheck.error, registryPath, daemons: readRegistry(registryPath).daemons };
  }
  const result = mutateRegistry(registryPath, (daemons) => {
    if (daemons[input.name] !== undefined) {
      throw new Error(`daemon '${input.name}' already exists`);
    }
    return { ...daemons, [input.name]: input.value };
  });
  if (result.saved) await refreshSnapshot();
  return result;
}

export async function handleDaemonUpdate(input: { name: string; rename?: string; value?: string }) {
  const registryPath = currentRegistryPath();
  const nameCheck = validateDaemonName(input.name);
  if (!nameCheck.valid) {
    return { saved: false, error: nameCheck.error, registryPath, daemons: readRegistry(registryPath).daemons };
  }
  const rename = input.rename?.trim();
  if (rename !== undefined) {
    const renameCheck = validateDaemonName(rename);
    if (!renameCheck.valid) {
      return { saved: false, error: renameCheck.error, registryPath, daemons: readRegistry(registryPath).daemons };
    }
  }
  const result = mutateRegistry(registryPath, (daemons) => {
    if (daemons[input.name] === undefined) {
      throw new Error(`daemon '${input.name}' does not exist`);
    }
    const target = rename && rename !== input.name ? rename : input.name;
    if (target !== input.name && daemons[target] !== undefined) {
      throw new Error(`daemon '${target}' already exists`);
    }
    const value = input.value?.trim() ?? daemons[input.name];
    const next = { ...daemons };
    delete next[input.name];
    return { ...next, [target]: value };
  });
  if (result.saved) await refreshSnapshot();
  return result;
}

export async function handleDaemonRemove(input: { name: string }) {
  const registryPath = currentRegistryPath();
  const nameCheck = validateDaemonName(input.name);
  if (!nameCheck.valid) {
    return { saved: false, error: nameCheck.error, registryPath, daemons: readRegistry(registryPath).daemons };
  }
  const result = mutateRegistry(registryPath, (daemons) => {
    if (daemons[input.name] === undefined) {
      throw new Error(`daemon '${input.name}' does not exist`);
    }
    const next = { ...daemons };
    delete next[input.name];
    return next;
  });
  if (result.saved) await refreshSnapshot();
  return result;
}

export async function handleDaemonHealth(_input?: unknown, context?: PluginHandlerContext) {
  rememberPaseo(context?.paseo);
  const snapshot = await getSnapshotFresh();
  for (const entry of snapshot.daemons) notePeerReachability(entry.name, entry.reachable);
  return {
    results: snapshot.daemons.map((entry) => ({
      name: entry.name,
      reachable: entry.reachable,
      error: entry.error,
      agentCount: agentCountFor(entry),
    })),
  };
}

export async function handleIntrospectAgents() {
  const snapshot = await getSnapshotFresh();
  return {
    daemons: snapshot.daemons.map(({ name, reachable, error, projects }) => ({ name, reachable, error, projects })),
  };
}

import { McpStdioClient } from "./mcp-client";

// Sends go through the bundled paseo-x-comms server over stdio MCP,
// so every message carries the meta envelope (sender identity) stamped by the
// server itself. Each recipient gets the other party's address so a real
// two-way reply is possible, not just two one-way drops.
export async function handleIntroduceAgents(input: {
  first: { daemon: string; agentId: string; shortId: string; name: string };
  second: { daemon: string; agentId: string; shortId: string; name: string };
  message: string;
}) {
  let path: string;
  try {
    path = serverPath();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    return { sends: [{ daemon: input.first.daemon, agentId: input.first.agentId, ok: false, error: msg }, { daemon: input.second.daemon, agentId: input.second.agentId, ok: false, error: msg }] };
  }
  const firstLabel = `Agent ${input.first.shortId} (${input.first.name}) on daemon "${input.first.daemon}"`;
  const secondLabel = `Agent ${input.second.shortId} (${input.second.name}) on daemon "${input.second.daemon}"`;
  const firstMessage = `${input.message.trim()}\n\nYou have been introduced to ${secondLabel}. To reply, use x_comms_send with daemon="${input.second.daemon}" and agentId="${input.second.agentId}". Your messages will be delivered with a sender envelope the other agent can use to reply.`;
  const secondMessage = `${input.message.trim()}\n\nYou have been introduced to ${firstLabel}. To reply, use x_comms_send with daemon="${input.first.daemon}" and agentId="${input.first.agentId}". Your messages will be delivered with a sender envelope the other agent can use to reply.`;

  const client = new McpStdioClient(path);
  try {
    await client.connect();
    const targets = [
      { daemon: input.first.daemon, agentId: input.first.agentId, fromAgentId: input.first.agentId, fromAgentName: input.first.name, message: firstMessage },
      { daemon: input.second.daemon, agentId: input.second.agentId, fromAgentId: input.second.agentId, fromAgentName: input.second.name, message: secondMessage },
    ];
    const sends = await Promise.all(
      targets.map(async (target) => {
        try {
          await client.callTool("x_comms_send", {
            daemon: target.daemon,
            agentId: target.agentId,
            prompt: target.message,
            fromAgentId: target.fromAgentId ?? null,
            fromAgentName: target.fromAgentName ?? null,
          });
          return { daemon: target.daemon, agentId: target.agentId, ok: true, error: null };
        } catch (cause) {
          return {
            daemon: target.daemon,
            agentId: target.agentId,
            ok: false,
            error: cause instanceof Error ? cause.message : String(cause),
          };
        }
      }),
    );
    for (const send of sends) {
      if (!send.ok) continue;
      const target = targets.find((t) => t.agentId === send.agentId && t.daemon === send.daemon);
      const introduced = send.agentId === input.first.agentId && send.daemon === input.first.daemon
        ? input.first
        : input.second;
      recordOutboundSend({
        daemon: send.daemon,
        agentId: send.agentId,
        peerAgentName: introduced.name,
        localAgentId: target?.fromAgentId ?? null,
      });
    }
    return { sends };
  } finally {
    client.close();
  }
}

export async function handleServerStatus() {
  try {
    const path = serverPath();
    const version = extractServerVersion(path);
    return { installPath: path, installed: true, configured: true, version, syntaxOk: true, error: null };
  } catch (cause) {
    return { installPath: "", installed: false, configured: false, version: null, syntaxOk: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

// Best-effort scrape of the version constant from the bundled server source;
// a null version never fails the status diagnostic.
function extractServerVersion(serverPath: string): string | null {
  try {
    const source = readFileSync(serverPath, "utf8");
    const match = source.match(/\bVERSION\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export interface ConversationSendInput {
  daemon: string;
  agentId: string;
  prompt: string;
  fromAgentId?: string | null;
  fromAgentName?: string | null;
}

/**
 * The existing send path, unchanged: bundled server over stdio MCP, which
 * stamps the envelope and shells out to `paseo send`. Rejects on failure;
 * callers either record the send or hold it in the outbox for retry.
 */
async function deliverConversationMessage(input: ConversationSendInput): Promise<void> {
  let sendDaemon = daemonNameForServerId(input.daemon) ?? input.daemon;
  // Fallback: if daemon is a serverId (srv_…) and not in registry, scan registry values' offer serverId
  if (sendDaemon === input.daemon && input.daemon.startsWith("srv_")) {
    const byOffer = readRegistry(currentRegistryPath()).daemons.find((d) => parseOffer(d.value)?.serverId === input.daemon);
    if (byOffer) sendDaemon = byOffer.name;
  }
  const client = new McpStdioClient(serverPath());
  try {
    await client.connect();
    await client.callTool("x_comms_send", {
      daemon: sendDaemon,
      agentId: input.agentId,
      prompt: input.prompt,
      fromAgentId: input.fromAgentId ?? null,
      fromAgentName: input.fromAgentName ?? null,
    });
  } finally {
    client.close();
  }
}

export async function handleConversationSend(input: ConversationSendInput, context?: PluginHandlerContext) {
  rememberPaseo(context?.paseo);
  try {
    await deliverConversationMessage(input);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    const entry = await withOutboxLock(() => {
      const state = readOutbox();
      const held = holdMessage(state, input, {
        nowMs: Date.now(),
        expiryMs: resolveOutboxExpiryMs(readUiPrefs()),
        error,
      });
      writeOutbox(state);
      return held;
    });
    log.warn(`outbox: held ${entry.id} for '${input.daemon}/${input.agentId}' until ${entry.expiresAt}: ${error}`);
    return {
      daemon: input.daemon,
      agentId: input.agentId,
      ok: false,
      error: `undelivered; held in the outbox for retry until ${entry.expiresAt}: ${error}`,
    };
  }
  recordOutboundSend({
    daemon: input.daemon,
    agentId: input.agentId,
    localAgentId: input.fromAgentId ?? null,
  });
  return { daemon: input.daemon, agentId: input.agentId, ok: true, error: null };
}


const PROBE_TIMEOUT_MS = 8000;

function runProbe(value: string): Promise<void> {
  return withTimeout(
    safeSpawn("paseo", ["ls", "--host", value, "--json"], { timeoutMs: PROBE_TIMEOUT_MS }).then((r) => {
      if (r.code !== 0) throw new Error((r.stderr || `exit ${r.code}`).trim());
    }),
    PROBE_TIMEOUT_MS,
    "daemon probe",
  );
}

export async function handleDaemonProbe(input: { value: string }) {
  const format = validateDaemonHost(input.value);
  if (!format.valid) {
    return { valid: false, formatError: format.error, reachable: false, error: null };
  }
  try {
    await runProbe(input.value);
    return { valid: true, formatError: null, reachable: true, error: null };
  } catch (cause) {
    return {
      valid: true,
      formatError: null,
      reachable: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}



import { PluginStorage } from "paseo-plugin-helper/server";
import { resolveFeatureFlags, resolveInjectionEnabled, resolveOutboxExpiryMs, resolvePresenceEnabled, applyFeaturePrefsUpdate } from "./settings.ts";
import {
  OUTBOX_POLL_INTERVAL_MS,
  holdMessage,
  outboxPath,
  readOutbox,
  runOutboxPass,
  writeOutbox,
  type OutboxEntry,
} from "./outbox";
import { OUTBOX_NOTICE_KIND, OUTBOX_NOTICE_VERSION } from "../shared/outbox.ts";
import { stateDir, migrateFromRoot } from "./registry";

const UI_PREFS_FILE = join(stateDir(), "plugin.json");
migrateFromRoot("paseo-x-comms-plugin.json", UI_PREFS_FILE);

interface UiPrefsState {
  prereqsCollapsed?: boolean;
  presenceEnabled?: boolean;
  injectionEnabled?: boolean;
  outboxExpirySeconds?: number;
  daemonEnabled?: Record<string, boolean>;
  daemonIdentities?: Record<string, string>;
  daemonHostnames?: Record<string, string>;
  serverPath?: string;
  serverPathSet?: boolean;
}

const uiPrefsStore = new PluginStorage<UiPrefsState>("paseo-x-comms", "plugin.json", { defaultData: {} });

function readUiPrefs(): UiPrefsState {
  try {
    return uiPrefsStore.read();
  } catch (err) {
    log.error(`corrupt ${UI_PREFS_FILE}, ignoring: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {};
}

function writeUiPrefs(state: UiPrefsState): void {
  uiPrefsStore.write(state);
}

export function identityFor(daemon: string): string | null {
  const identities = readUiPrefs().daemonIdentities ?? {};
  return identities[daemon] ?? null;
}

// The registry is keyed by daemon *name*, but x-comms envelopes carry the
// peer's serverId. identitySync stores name -> serverId, so invert it to map a
// sender's serverId back to the registered daemon name the send tool expects.
export function daemonNameForServerId(serverId: string | null): string | null {
  if (!serverId) return null;
  const identities = readUiPrefs().daemonIdentities ?? {};
  for (const [name, id] of Object.entries(identities)) {
    if (id === serverId) return name;
  }
  return null;
}

async function fetchPeerServerInfo(value: string): Promise<{ serverId: string; hostname: string | null } | null> {
  const offer = parseOffer(value);
  if (offer?.serverId) return { serverId: offer.serverId, hostname: null };
  return null;
}

/**
 * Fetch the real serverId from every registered daemon and store it in the
 * plugin state (name -> serverId). Keeps the registry untouched so the MCP
 * server's string-host contract is unaffected; identity is additive.
 */
export async function handleIdentitySync() {
  const daemons = readRegistry(currentRegistryPath()).daemons;
  const state = readUiPrefs();
  const identities: Record<string, string> = { ...(state.daemonIdentities ?? {}) };
  const hostnames: Record<string, string> = { ...(state.daemonHostnames ?? {}) };
  for (const daemon of daemons) {
    const info = await fetchPeerServerInfo(daemon.value);
    if (info?.serverId) identities[daemon.name] = info.serverId;
    if (info?.hostname) hostnames[daemon.name] = info.hostname;
  }
  writeUiPrefs({ ...state, daemonIdentities: identities, daemonHostnames: hostnames });
  return { identities, hostnames };
}

export async function handleUiPrefsGet() {
  const prefs = readUiPrefs();
  return {
    prereqsCollapsed: prefs.prereqsCollapsed === true,
    daemonEnabled: prefs.daemonEnabled ?? {},
    outboxExpirySeconds: prefs.outboxExpirySeconds,
    ...resolveFeatureFlags(prefs),
  };
}

export async function handleUiPrefsSet(input: { prereqsCollapsed: boolean; presenceEnabled?: boolean; injectionEnabled?: boolean; outboxExpirySeconds?: number; daemonEnabled?: Record<string, boolean> }) {
  const state = readUiPrefs();
  writeUiPrefs({
    ...state,
    prereqsCollapsed: input.prereqsCollapsed,
    ...applyFeaturePrefsUpdate(state, input),
  });
  const next = readUiPrefs();
  return {
    prereqsCollapsed: next.prereqsCollapsed === true,
    daemonEnabled: next.daemonEnabled ?? {},
    outboxExpirySeconds: next.outboxExpirySeconds,
    ...resolveFeatureFlags(next),
  };
}

export function presenceEnabled(): boolean {
  return resolvePresenceEnabled(readUiPrefs());
}

export function injectionEnabled(): boolean {
  return resolveInjectionEnabled(readUiPrefs());
}

export async function handleSnapshotRefresh(_input?: unknown, context?: PluginHandlerContext) {
  rememberPaseo(context?.paseo);
  const snapshot = await refreshSnapshot();
  for (const entry of snapshot.daemons) notePeerReachability(entry.name, entry.reachable);
  if (context?.paseo) await reconcileInbound(context.paseo);
  return { updatedAt: snapshot.updatedAt };
}

async function runPaseoDumpJson(args: string[]): Promise<unknown> {
  const r = await withTimeout(safeSpawn("paseo", args, { timeoutMs: 20000 }), 20000, "paseo dump");
  if (r.code !== 0) throw new Error((r.stderr || `exit ${r.code}`).trim().slice(0, 200));
  try { return JSON.parse(r.stdout); } catch { throw new Error("non-JSON output"); }
}

function parseOffer(value: string): {
  serverId: string | null;
  daemonPublicKeyB64: string | null;
  relayEndpoint: string | null;
  useTls: boolean;
} | null {
  const m = value.match(/#offer=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const payload = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    return {
      serverId: typeof payload.serverId === "string" ? payload.serverId : null,
      daemonPublicKeyB64: typeof payload.daemonPublicKeyB64 === "string" ? payload.daemonPublicKeyB64 : null,
      relayEndpoint: typeof payload.relay?.endpoint === "string" ? payload.relay.endpoint : null,
      useTls: payload.relay?.useTls === true,
    };
  } catch {
    return null;
  }
}

function safe<T,>(raw: unknown, selector: (x: Record<string, unknown>) => T): T[] {
  return Array.isArray(raw) ? (raw as Record<string, unknown>[]).map(selector) : [];
}
function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

// The paseo CLI has varied its output shape across versions: some commands wrap
// their list in { data: [...] }, { schedules: [...] }, { terminals: [...] },
// etc. unwrapList tries the known wrapper keys in order before falling back to
// treating the raw value itself as a list.
function unwrapList(raw: unknown, ...subkeys: string[]): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") return [];
  for (const key of subkeys) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

// daemon status is sometimes { data: { ... } } and sometimes the payload directly.
function unwrapStatusPayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const data = obj.data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return obj;
}

// Null-safe field access on an unwrapped status payload.
function field(payload: Record<string, unknown> | null, ...keys: string[]): unknown {
  if (!payload) return undefined;
  for (const key of keys) {
    if (payload[key] !== undefined && payload[key] !== null && payload[key] !== "") return payload[key];
  }
  return undefined;
}

function notReachedResult(name: string, error: string, offer: ReturnType<typeof parseOffer>, transport: string): { name: string; reached: boolean; error: string | null; serverId: string | null; hostname: string | null; version: string | null; desktopManaged: boolean | null; capabilities: Record<string, unknown> | null; features: Record<string, boolean> | null; listen: string | null; pid: number | null; nodePath: string | null; startedAt: string | null; relayEndpoints: string[] | null; relayEnabled: boolean | null; transport: string; agents: { agentId: string; shortId: string; name: string; status: string; provider: string; model: string | null; providerOptions: Record<string, unknown> | null; cwd: string | null; workspaceId: string | null; projectName: string | null; createdAt: string | null; archived: boolean | null }[]; workspaces: { id: string; name: string; project: string; isolation: string; cwd: string | null }[]; projects: { id: string; name: string; source: string | null }[]; providers: { provider: string; available: boolean; error: string | null }[]; providerCount: number; permissions: { id: string; agentId: string; name: string }[]; schedules: { id: string; name: string; state: string }[]; terminals: { id: string; name: string; cwd: string | null; status: string | null }[] } {
  return { name, reached: false, error, serverId: offer?.serverId ?? null, hostname: null, version: null, desktopManaged: null, capabilities: null, features: null, listen: null, pid: null, nodePath: null, startedAt: null, relayEndpoints: null, relayEnabled: null, transport, agents: [], workspaces: [], projects: [], providers: [], providerCount: 0, permissions: [], schedules: [], terminals: [] };
}

export async function handleDaemonDump(input: { daemon: string }) {
  const daemons = readRegistry(currentRegistryPath()).daemons;
  const entry = daemons.find((d) => d.name === input.daemon);
  if (!entry) {
    return notReachedResult(input.daemon, `unknown daemon '${input.daemon}' — pairing is required: add it via x_comms_add_daemon or pair the target daemon first`, null, "");
  }
  const offer = parseOffer(entry.value);
  const transport = offer ? "relay" : "direct";
  const hostValue = entry.value;
  async function tryHost(args: string[]): Promise<unknown> {
    try {
      return await runPaseoDumpJson([...args, "--host", hostValue, "--json"]);
    } catch {
      return null;
    }
  }
  try {
    const [status, agentsRes, workspacesRes, projectsRes, schedRes, termRes] = await Promise.all([
      tryHost(["daemon", "status"]),
      tryHost(["ls", "--global"]),
      tryHost(["workspace", "ls"]),
      tryHost(["project", "ls"]),
      tryHost(["schedule", "ls"]),
      tryHost(["terminal", "ls"]),
    ]);

    const p = unwrapStatusPayload(status);
    const agentsEntries    = unwrapList(agentsRes,    "data");
    const workspacesEntries = unwrapList(workspacesRes, "data");
    const projectsEntries  = unwrapList(projectsRes,  "data", "projects");
    const schedEntries     = unwrapList(schedRes,     "schedules", "data");
    const termEntries      = unwrapList(termRes,      "terminals", "data");

    const providersRaw = field(p, "providers") ?? field({ providers: (status as Record<string, unknown>)?.providers }, "providers") ?? [];
    const providersFromStatus = safe(providersRaw, (prov) => ({
      provider: str(prov.provider),
      available: (prov as Record<string, unknown>).available === true,
      error: ((prov as Record<string, unknown>).error as string | null) ?? null,
    }));

    const serverId = str(field(p, "serverId") ?? offer?.serverId ?? "");
    const hostname = str(field(p, "hostname") ?? "");
    const version  = str(field(p, "daemonVersion", "version") ?? "");
    const relay    = readRelayStatus(field(p, "relay"));

    const reached = status !== null || agentsRes !== null || workspacesRes !== null;
    if (!reached) throw new Error("all peer probes failed");

    return {
      name: input.daemon,
      reached: true,
      error: null,
      serverId,
      hostname,
      version,
      desktopManaged: (field(p, "desktopManaged") as boolean | null) ?? null,
      capabilities: null,
      features: null,
      listen: str(field(p, "listen") ?? ""),
      pid: (field(p, "pid") as number | null) ?? null,
      nodePath: str(field(p, "daemonNode", "nodePath") ?? ""),
      startedAt: str(field(p, "startedAt") ?? ""),
      relayEndpoints: relay.endpoints,
      relayEnabled: relay.enabled,
      transport,
      agents: agentsEntries.map((a) => {
        // ls entries are sometimes { agent: { ... }, project: { ... } }, sometimes flat.
        const agent = (a.agent as Record<string, unknown>) ?? a;
        return {
          agentId: str(agent.id), shortId: str(agent.shortId), name: str(agent.name), status: str(agent.status),
          provider: str(agent.provider),
          model: (agent.model as string | null) ?? null,
          providerOptions: (agent.providerOptions as Record<string, unknown> | null) ?? null,
          cwd: str(agent.cwd ?? ""),
          workspaceId: str((a.project as Record<string, unknown>)?.workspaceId ?? agent.workspaceId ?? ""),
          projectName: str((a.project as Record<string, unknown>)?.name ?? agent.project ?? ""),
          createdAt: str(agent.created ?? agent.createdAt ?? ""),
          archived: (agent.archived as boolean | null) ?? null,
        };
      }),
      workspaces: workspacesEntries.map((w) => ({
        id: str(w.id ?? w.workspaceId ?? ""), name: str(w.name), project: str(w.project), isolation: str(w.isolation), cwd: str(w.cwd ?? ""),
      })),
      projects: projectsEntries.map((pr) => ({
        id: str(pr.id ?? pr.projectId ?? ""), name: str(pr.name), source: str(pr.source ?? ""),
      })),
      providers: providersFromStatus,
      providerCount: providersFromStatus.length,
      permissions: [],
      schedules: schedEntries.map((sc) => ({
        id: str(sc.id ?? sc.scheduleId ?? ""), name: str(sc.name ?? ""), state: str(sc.state ?? sc.enabled ?? ""),
      })),
      terminals: termEntries.map((t) => ({
        id: str(t.id ?? t.terminalId ?? ""), name: str(t.name ?? t.title ?? ""),
        cwd: (t.cwd as string | null) ?? null, status: (t.status as string | null) ?? null,
      })),
    };
  } catch (cause) {
    return notReachedResult(input.daemon, cause instanceof Error ? cause.message : String(cause), offer, transport);
  }
}

import { randomUUID } from "node:crypto";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  applyAnnounce,
  applyRetract,
  pendingForPeer,
  queueRetract,
  readPresence,
  sweepExpired,
  writePresence,
  type PresenceBirth,
} from "./presence";
import { invokePeerRpc, localServerId, resolvePeerTarget, type PeerTarget } from "./peer-channel";
import {
  detachLocalAgent,
  prunePeer,
  readConversationsSnapshot,
  reconcileTimelines,
  recordSend,
  scanLocalTimelines,
  writeConversationsSnapshot,
  type TimelineScanner,
} from "./conversations-snapshot.ts";

/**
 * serverId to registry alias for snapshot display. Offer-embedded ids first,
 * synced identities second. Unknown ids render with a fallback alias.
 */
function peerAliasMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const daemon of readRegistry(currentRegistryPath()).daemons) {
    if (!daemon.valid) continue;
    const offerId = deriveHostFromValue(daemon.value);
    if (offerId && !map.has(offerId)) map.set(offerId, daemon.name);
  }
  for (const [name, id] of Object.entries(readUiPrefs().daemonIdentities ?? {})) {
    if (id && !map.has(id)) map.set(id, name);
  }
  return map;
}

function peerAliasFor(serverId: string): string | null {
  return peerAliasMap().get(serverId) ?? null;
}

function recordOutboundSend(args: {
  daemon: string;
  agentId: string;
  peerAgentName?: string | null;
  localAgentId?: string | null;
}): void {
  const sendDaemon = daemonNameForServerId(args.daemon) ?? args.daemon;
  const entry = readRegistry(currentRegistryPath()).daemons.find((d) => d.name === sendDaemon);
  const peerServerId = identityFor(sendDaemon) ?? (entry ? deriveHostFromValue(entry.value) : null) ?? "";
  const snapshot = readConversationsSnapshot();
  writeConversationsSnapshot(recordSend(snapshot, {
    peerAlias: sendDaemon,
    peerServerId,
    peerAgentId: args.agentId,
    peerAgentName: args.peerAgentName ?? null,
    localAgentId: args.localAgentId ?? null,
    at: new Date().toISOString(),
  }));
}

/**
 * Reconcile inbound envelopes from local timelines into the snapshot.
 * Best-effort: timeline failures never fail the calling RPC.
 */
async function reconcileInbound(paseo: TimelineScanner): Promise<void> {
  try {
    const timelines = await scanLocalTimelines(paseo);
    const snapshot = readConversationsSnapshot();
    writeConversationsSnapshot(reconcileTimelines(snapshot, timelines, peerAliasFor));
  } catch (cause) {
    log.error(`conversations: timeline reconcile failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
function knownPeerServerIds(): Set<string> {
  const ids = new Set<string>();
  for (const daemon of readRegistry(currentRegistryPath()).daemons) {
    if (!daemon.valid) continue;
    const id = deriveHostFromValue(daemon.value);
    if (id) ids.add(id);
  }
  return ids;
}

function validPeerTargets(): PeerTarget[] {
  const targets: PeerTarget[] = [];
  for (const daemon of readRegistry(currentRegistryPath()).daemons) {
    if (!daemon.valid) continue;
    try {
      targets.push(resolvePeerTarget(daemon.name, daemon.value));
    } catch (cause) {
      log.error(`presence: skipping undialable peer '${daemon.name}': ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return targets;
}

export async function handlePresenceAnnounce(input: { messageId: string; entries: PresenceBirth[] }) {
  const known = knownPeerServerIds();
  const state = readPresence();
  let accepted = 0;
  let rejected = 0;
  for (const entry of input.entries.slice(0, 500)) {
    if (!known.has(entry.serverId)) {
      rejected += 1;
      continue;
    }
    const outcome = applyAnnounce(state, entry, `${input.messageId}:${entry.serverId}/${entry.agentId}`, "remote");
    if (outcome.result === "accepted") accepted += 1;
    else rejected += 1;
  }
  writePresence(state);
  return { accepted, rejected };
}

export async function handlePresenceRetract(input: { messageId: string; serverId: string; agentId: string; timestamp: string }) {
  const known = knownPeerServerIds();
  if (!known.has(input.serverId)) return { applied: false };
  const state = readPresence();
  const outcome = applyRetract(state, input.serverId, input.agentId, input.timestamp, input.messageId);
  writePresence(state);
  if (outcome.applied) {
    const conversations = readConversationsSnapshot();
    const pruned = prunePeer(conversations, input.serverId, input.agentId);
    if (pruned.removed) writeConversationsSnapshot(pruned.snapshot);
  }
  return { applied: outcome.applied };
}

export async function handlePresenceList() {
  const state = readPresence();
  const swept = sweepExpired(state);
  if (swept.expiredLive.length > 0 || swept.expiredTombstones.length > 0) {
    log.error(
      `presence: TTL sweep fired (live: ${swept.expiredLive.join(", ") || "none"}; tombstones: ${swept.expiredTombstones.join(", ") || "none"}). ` +
      `TTL is a safety net only; announcements or retracts stopped flowing.`,
    );
    writePresence(state);
  }
  return {
    live: Object.values(state.live),
    tombstones: Object.values(state.tombstones),
    pendingRetracts: state.pendingRetracts.length,
  };
}

async function flushPendingRetracts(target: PeerTarget): Promise<void> {
  const state = readPresence();
  const pending = pendingForPeer(state, target.name);
  for (const item of pending) {
    try {
      await invokePeerRpc(target, "presence.retract", {
        messageId: item.messageId,
        serverId: item.serverId,
        agentId: item.agentId,
        timestamp: item.timestamp,
      });
      state.pendingRetracts = state.pendingRetracts.filter((p) => p.messageId !== item.messageId);
      writePresence(state);
    } catch (cause) {
      item.attempts += 1;
      writePresence(state);
      log.error(`presence: queued retract still failing for '${target.name}': ${cause instanceof Error ? cause.message : String(cause)}`);
      return;
    }
  }
}

/**
 * Local hook: buffer a birth and announce it to every dialable peer.
 * Retries for queued retracts piggyback on the same outbound pass.
 * Missed births while a peer is offline are not backfilled in this slice.
 */
export async function onLocalAgentCreated(agent: { id: string; title: string | null; provider: string }): Promise<void> {
  if (!presenceEnabled()) return;
  let self: string;
  try {
    self = await localServerId();
  } catch (cause) {
    log.error(`presence: cannot announce birth without local serverId: ${cause instanceof Error ? cause.message : String(cause)}`);
    return;
  }
  const now = new Date().toISOString();
  const birth: PresenceBirth = {
    serverId: self,
    agentId: agent.id,
    name: agent.title ?? agent.id.slice(0, 8),
    provider: agent.provider,
    timestamp: now,
  };
  const state = readPresence();
  applyAnnounce(state, birth, randomUUID(), "local", now);
  writePresence(state);
  for (const target of validPeerTargets()) {
    await flushPendingRetracts(target);
    try {
      await invokePeerRpc(target, "presence.announce", { messageId: randomUUID(), entries: [birth] });
    } catch (cause) {
      log.error(`presence: announce to '${target.name}' failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
}

/**
 * Local hook: tombstone immediately, retract everywhere now, queue the
 * retract for peers that are offline and retry on the next outbound pass.
 */
export async function onLocalAgentArchived(agent: { id: string }): Promise<void> {
  if (!presenceEnabled()) return;
  let self: string;
  try {
    self = await localServerId();
  } catch (cause) {
    log.error(`presence: cannot retract without local serverId: ${cause instanceof Error ? cause.message : String(cause)}`);
    return;
  }
  const now = new Date().toISOString();
  const state = readPresence();
  applyRetract(state, self, agent.id, now, randomUUID());
  writePresence(state);
  const conversations = readConversationsSnapshot();
  const detached = detachLocalAgent(conversations, agent.id);
  if (detached.removed) writeConversationsSnapshot(detached.snapshot);
  for (const target of validPeerTargets()) {
    await flushPendingRetracts(target);
    const messageId = randomUUID();
    try {
      await invokePeerRpc(target, "presence.retract", {
        messageId,
        serverId: self,
        agentId: agent.id,
        timestamp: now,
      });
    } catch (cause) {
      log.error(`presence: retract to '${target.name}' failed, queued: ${cause instanceof Error ? cause.message : String(cause)}`);
      const retry = readPresence();
      queueRetract(retry, {
        peer: target.name,
        serverId: self,
        agentId: agent.id,
        timestamp: now,
        messageId,
        queuedAt: now,
        attempts: 1,
      });
      writePresence(retry);
    }
  }
}

// Outbox: retry, expiry, and sender notification for undelivered messages.
// Idempotency (UUID-keyed receiver dedup) is out of scope here — the
// conversation protocol has no message-UUID slot (see #12).

const peerReachability = new Map<string, boolean>();

// The outbox read-modify-write straddles awaits (delivery/notification), so a
// hold landing mid-pass could otherwise be clobbered by the pass's write.
let outboxLock: Promise<unknown> = Promise.resolve();

function withOutboxLock<T>(operation: () => Promise<T> | T): Promise<T> {
  const run = outboxLock.then(operation, operation);
  outboxLock = run.catch(() => {});
  return run;
}

/**
 * Track a peer's reachability and kick an immediate outbox retry when it flips
 * from unreachable back to reachable. First observation is not a reconnect.
 */
function notePeerReachability(name: string, reachable: boolean): void {
  const previous = peerReachability.get(name);
  peerReachability.set(name, reachable);
  if (!reachable || previous !== false) return;
  log.info(`outbox: peer '${name}' reconnected; retrying held messages`);
  void flushOutbox(name).catch((cause) => {
    log.error(`outbox: reconnect flush for '${name}' failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  });
}

/**
 * Append the expiry notice to the sender's local timeline. `fromAgentId` is the
 * local sender agent; without it (or without a remembered Paseo API) there is
 * no timeline to notify, so this resolves after logging.
 */
async function notifyOutboxExpiry(entry: OutboxEntry, reason: string): Promise<void> {
  const paseo = paseoRef;
  if (!entry.fromAgentId || !paseo) {
    log.warn(`outbox: expiry notice for ${entry.id} not appended (${entry.fromAgentId ? "no paseo handle" : "no local sender agent"}): ${reason}`);
    return;
  }
  await paseo.agents.ref(entry.fromAgentId).timeline.append({
    type: "plugin",
    id: `x-comms-outbox-${entry.id}`,
    kind: OUTBOX_NOTICE_KIND,
    version: OUTBOX_NOTICE_VERSION,
    data: {
      daemon: entry.daemon,
      agentId: entry.agentId,
      reason,
      attempts: entry.attempts,
      heldForMs: Math.max(0, Date.now() - Date.parse(entry.createdAt)),
    },
  });
}

export interface OutboxFlushSummary {
  delivered: number;
  retried: number;
  expired: number;
  notified: number;
}

/** One outbox sweep: expire overdue held messages, then retry the due ones. */
export async function flushOutbox(forceDaemon?: string): Promise<OutboxFlushSummary> {
  return withOutboxLock(async () => {
    const state = readOutbox();
    if (state.entries.length === 0) return { delivered: 0, retried: 0, expired: 0, notified: 0 };
    const result = await runOutboxPass(
      state,
      {
        deliver: async (entry) => {
          await deliverConversationMessage(entry);
          recordOutboundSend({ daemon: entry.daemon, agentId: entry.agentId, localAgentId: entry.fromAgentId });
        },
        notify: notifyOutboxExpiry,
      },
      { nowMs: Date.now(), forceDaemon },
    );
    writeOutbox(state);
    if (result.delivered.length || result.retried.length || result.expired.length) {
      log.info(`outbox: delivered ${result.delivered.length}, retried ${result.retried.length}, expired ${result.expired.length} (path: ${outboxPath()})`);
    }
    return {
      delivered: result.delivered.length,
      retried: result.retried.length,
      expired: result.expired.length,
      notified: result.notified.length,
    };
  });
}

export const outboxWorker = createPeriodicTask({
  intervalMs: OUTBOX_POLL_INTERVAL_MS,
  runImmediately: true,
  task: async () => {
    await flushOutbox();
  },
  onError: (cause) => {
    log.error(`outbox: periodic flush failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  },
});

export function stopOutboxWorker(): void {
  outboxWorker.stop();
}

// Runs when this module has fully evaluated. Placed last so every
// module-level const above (stores, registries) exists before the first
// startup read in the daemon's CJS-compiled bundle.
runStartupCheck();
// Prime the fleet snapshot so daemon health, agent counts, and the Introduce
// pickers are ready immediately instead of fetching lazily on first request.
initializeSnapshot();
