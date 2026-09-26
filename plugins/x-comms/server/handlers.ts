import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPeriodicTask, createPluginLogger, safeSpawn } from "./vendor/paseo-plugin-helper/index";
import type { PaseoApi } from "@getpaseo/client";
import { withTimeout } from "../shared/vendor/paseo-plugin-helper/async";
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
  findDaemonByRef,
  type RegistryDaemon,
} from "./registry";
import { serverPath } from "./server-status";
import { readRelayStatus } from "./relay-status";
import { resolveSendRoute, sendLocalNative } from "./local-send";
import { unknownDaemonMessage } from "./unknown-daemon";

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

// Introduce sends go through the bundled paseo-x-comms server over stdio MCP,
// so every message carries the meta envelope (sender identity) stamped by the
// server itself. (Local `conversation.send` targets skip this path and send
// natively; see deliverConversationMessage.) Each recipient gets the other
// party's address so a real two-way reply is possible, not just two one-way drops.
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
  /** Stable across the initial attempt and every outbox retry. */
  messageId?: string;
  /**
   * Ask for a notice back on this sender once the message reaches the target.
   * Defaults to true; the notice is itself queued, so it waits rather than
   * steering the sender's turn.
   */
  notifyOnFinish?: boolean;
  /**
   * `prompt` already carries its envelope and signature, and is delivered
   * verbatim — never re-stamped, which would move `sentAt` and invalidate the
   * #594 signature.
   *
   * Only the Desktop configured-host route sets this. It stamps its own envelope
   * because it has no mesh key, and it is a local trusted caller: it could
   * already put arbitrary bytes in front of a configured host before this
   * existed, so this widens no capability. The agent-facing MCP route omits it
   * and keeps having the server stamp, which is what makes that path signed.
   */
  stamped?: boolean;
}

/**
 * How the message was handled: sent now, held for a busy target, held in the
 * outbox after a transport failure, or refused.
 */
export type SendDelivery = "dispatched" | "queued" | "outbox" | "dropped";

export interface ConversationSendResult {
  daemon: string;
  agentId: string;
  ok: boolean;
  error: string | null;
  delivery: SendDelivery;
  /** Items already waiting for this target after the call (0 when dispatched). */
  queueDepth: number;
  /** When a queued item gives up, or null when it was sent/refused outright. */
  expiresAt: string | null;
}

/**
 * Deliver to a target that resolves to THIS daemon: native SDK send. Falls
 * back to null when the target is remote, so callers use the MCP/CLI path.
 * `paseo` is required — without a local handle there is no native route.
 */
async function tryDeliverLocalNative(
  input: ConversationSendInput,
  paseo: PaseoApi | null,
): Promise<boolean> {
  if (!paseo) return false;
  const targetServerId = targetServerIdFor(input.daemon);
  if (!targetServerId) return false;
  let self: string | null = null;
  try {
    self = await localServerId();
  } catch {
    return false;
  }
  if (resolveSendRoute({ hasLocalPaseo: true, targetServerId, selfServerId: self }) !== "local") {
    return false;
  }
  await sendLocalNative(paseo, {
    agentId: input.agentId,
    prompt: input.prompt,
    fromAgentId: input.fromAgentId ?? null,
    fromAgentName: input.fromAgentName ?? null,
    targetDaemon: input.daemon,
    messageId: input.messageId!,
  });
  return true;
}

/**
 * Send text that already carries its envelope, verbatim, over
 * `paseo send --host`.
 *
 * Re-stamping is never an option here: it would move `sentAt` and invalidate the
 * signature from #594. The Desktop client stamps its own envelope (it has no
 * mesh key) and hands over finished bytes, so this is the only route that can
 * deliver them intact.
 *
 * Both the dispatch-now path and the drain use this, so a message takes the same
 * route whether it went out immediately or waited for the target's turn. The
 * alternative — the borrowed-client route for an immediate send, this one for a
 * queued one — would mean the same conversation taking two delivery mechanisms
 * depending on whether the target happened to be busy.
 */
async function sendPreStampedViaHost(input: {
  daemon: string;
  agentId: string;
  prompt: string;
  messageId: string;
}): Promise<void> {
  const entry = targetRegistryEntry(input.daemon);
  if (!entry) throw new Error(unknownDaemonMessage(input.daemon));
  const r = await withTimeout(
    safeSpawn(
      "paseo",
      ["send", input.agentId, "--host", entry.value, "--message-id", input.messageId, "--json", "--no-wait", input.prompt],
      { timeoutMs: 20000 },
    ),
    20000,
    "send pre-stamped",
  );
  if (r.code !== 0) throw new Error((r.stderr || `exit ${r.code}`).trim().slice(0, 200));
}

/**
 * Deliver a conversation message. Local targets go out natively via the host
 * PaseoApi; remote targets go through the bundled MCP server, which stamps the
 * envelope and shells out to `paseo send --host` (no host-targeted SDK call
 * exists). Rejects on failure; callers record the send or hold it in the outbox.
 */
async function deliverConversationMessage(
  input: ConversationSendInput & { messageId: string },
  paseo: PaseoApi | null = paseoRef,
): Promise<void> {
  // Checked before the local-native route, which would re-stamp. `stamped` means
  // these bytes are final, so no route below may rewrite them.
  if (input.stamped) {
    await sendPreStampedViaHost(input);
    return;
  }
  if (await tryDeliverLocalNative(input, paseo)) return;
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
      messageId: input.messageId,
    });
  } finally {
    client.close();
  }
}

export async function handleConversationSend(
  input: ConversationSendInput,
  context?: PluginHandlerContext,
): Promise<ConversationSendResult> {
  rememberPaseo(context?.paseo);
  // Generate once at the edge. The normalized input is also what gets held in
  // the outbox or the defer queue, so an ambiguous failure cannot turn a retry
  // into a new daemon message.
  const message: ConversationSendInput & { messageId: string } = {
    ...input,
    messageId: input.messageId ?? randomUUID(),
  };
  const paseo = context?.paseo ?? paseoRef;
  const target = { daemon: message.daemon, agentId: message.agentId };

  // The busy gate. A send starts a turn, and Paseo's daemon sends with
  // replaceRunning: true, so dispatching into a running target cuts its turn
  // short. Defer instead (#598) — the target picks the message up at the start
  // of its next turn and nothing is interrupted in either direction.
  if (await busyGate().isBusy(target)) {
    return deferForBusyTarget(message, target);
  }

  try {
    await deliverConversationMessage(message, paseo);
  } catch (cause) {
    // Transport failure, not a busy target: the outbox owns that case, with its
    // own backoff and its own (shorter) expiry. See the module comment in
    // defer-queue.ts for why the two queues are not the same thing.
    const error = cause instanceof Error ? cause.message : String(cause);
    const entry = await withOutboxLock(() => {
      const state = readOutbox();
      const held = holdMessage(state, message, {
        nowMs: Date.now(),
        expiryMs: resolveOutboxExpiryMs(readUiPrefs()),
        error,
      });
      writeOutbox(state);
      return held;
    });
    log.warn(`outbox: held ${entry.id} for '${message.daemon}/${message.agentId}' until ${entry.expiresAt}: ${error}`);
    return {
      daemon: message.daemon,
      agentId: message.agentId,
      ok: false,
      error: `undelivered; held in the outbox for retry until ${entry.expiresAt}: ${error}`,
      delivery: "outbox",
      queueDepth: 0,
      expiresAt: entry.expiresAt,
    };
  }
  noteTargetDispatched(target);
  recordOutboundSend({
    daemon: message.daemon,
    agentId: message.agentId,
    localAgentId: message.fromAgentId ?? null,
  });
  if (message.notifyOnFinish !== false) {
    queueDeliveryNotice(message, target, new Date().toISOString());
  }
  return {
    daemon: message.daemon,
    agentId: message.agentId,
    ok: true,
    error: null,
    delivery: "dispatched",
    queueDepth: 0,
    expiresAt: null,
  };
}

/** Hold a message whose target is mid-turn and report the queue position. */
function deferForBusyTarget(
  message: ConversationSendInput & { messageId: string },
  target: { daemon: string; agentId: string },
): ConversationSendResult {
  const queued = enqueueDefer({ ...message, kind: "message" }, { nowMs: Date.now() });
  for (const evicted of queued.evicted) {
    log.warn(`defer: queue full for '${evicted.daemon}/${evicted.agentId}', evicted ${evicted.id}`);
    void notifyDeferDrop(evicted, "evicted");
  }
  if (!queued.entry) {
    log.error(`defer: refused ${message.messageId} for '${target.daemon}/${target.agentId}': ${queued.error}`);
    return {
      daemon: message.daemon,
      agentId: message.agentId,
      ok: false,
      error: queued.error,
      delivery: "dropped",
      queueDepth: queued.depth,
      expiresAt: null,
    };
  }
  log.info(
    `defer: '${target.daemon}/${target.agentId}' is busy, queued ${queued.entry.id} at position ${queued.depth} until ${queued.entry.expiresAt}`,
  );
  recordOutboundSend({
    daemon: message.daemon,
    agentId: message.agentId,
    localAgentId: message.fromAgentId ?? null,
  });
  return {
    daemon: message.daemon,
    agentId: message.agentId,
    ok: true,
    error: null,
    delivery: "queued",
    queueDepth: queued.depth,
    expiresAt: queued.entry.expiresAt,
  };
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



import { PluginStorage } from "./vendor/paseo-plugin-helper/index";
import { resolveFeatureFlags, resolveInjectionEnabled, resolveOutboxExpiryMs, resolvePresenceEnabled, resolveDaemonEnabled, applyFeaturePrefsUpdate } from "./settings.ts";
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
import {
  DEFER_DRAIN_INTERVAL_MS,
  DEFER_MAX_TARGETS_PER_PASS,
  DEFER_NOTICE_KIND,
  DEFER_NOTICE_VERSION,
  LOCAL_DAEMON,
  claimNextDefer,
  completeDeferItem,
  deferDepth,
  deferDropReason,
  deferQueueDir,
  deliveryNoticeText,
  enqueueDefer,
  expiredDeferEntries,
  listStaleClaims,
  listWaiting,
  pendingDeferTargets,
  releaseDeferItem,
  removeDeferItem,
  type DeferEntry,
  type DeferTarget,
} from "./defer-queue.ts";
import { BusyGate, readLifecycleStatus } from "./busy.ts";
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

/**
 * The daemon serverId a send target resolves to, when it can be determined
 * without a network probe: a raw `srv_…` id, a synced alias, or an embedded
 * relay-offer id. A bare direct host has no identity, so it returns null and
 * the send conservatively stays on the remote path.
 */
export function targetServerIdFor(daemon: string): string | null {
  if (daemon.startsWith("srv_")) return daemon;
  const byIdentity = identityFor(daemon);
  if (byIdentity) return byIdentity;
  const entry = readRegistry(currentRegistryPath()).daemons.find((d) => d.name === daemon);
  return deriveHostFromValue(entry?.value ?? daemon);
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

/**
 * The registry entry a send target names, or null when it names nothing known.
 *
 * `readRegistry` merges Paseo's configured hosts alongside the manual registry,
 * so a configured host is reachable here. Matching is by name or serverId (see
 * `findDaemonByRef`); the identity map is consulted first because that is how a
 * peer's serverId is matched to its registered alias.
 *
 * This is the single lookup the gate and the drain both use. They must agree:
 * if the drain could resolve a target the gate could not, the gate would have
 * dispatched a busy target, and if the gate could resolve a target the drain
 * could not, a queued message would sit until it expired.
 */
function targetRegistryEntry(ref: string): RegistryDaemon | null {
  const daemons = readRegistry(currentRegistryPath()).daemons;
  const aliased = daemonNameForServerId(ref);
  if (aliased) {
    const byName = findDaemonByRef(daemons, aliased);
    if (byName) return chatEnabledDaemon(byName);
  }
  return findDaemonByRef(daemons, ref) ?? null;
}

/**
 * A daemon the user has not switched off in settings, or null.
 *
 * `resolveDaemonEnabled` existed from the start but nothing called it, so the
 * per-daemon toggle in the settings surface persisted, round-tripped through
 * its RPC and changed nothing: every chat target still resolved. The control
 * was asserting something false.
 *
 * Matching is by registry *name*, which is the key settings-prototype.tsx
 * persists under. A caller arriving by serverId is folded to its registered
 * alias by `targetRegistryEntry` before this runs, so both spellings of the
 * same daemon are filtered consistently — otherwise switching a daemon off would
 * work when addressed by name and silently do nothing when addressed by id.
 */
function chatEnabledDaemon(daemon: RegistryDaemon): RegistryDaemon | null {
  if (resolveDaemonEnabled(readUiPrefs(), daemon.name)) return daemon;
  log.info(`chat: target '${daemon.name}' is disabled in settings; not treating it as reachable`);
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
  if (context?.paseo) await reconcileInbound(context.paseo, await peerAuthVerifier());
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
    return notReachedResult(input.daemon, unknownDaemonMessage(input.daemon), null, "");
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
import {
  fetchPeerMeshKey,
  invokePeerRpc,
  isLinkAuthenticated,
  localServerId,
  resolvePeerTarget,
  type PeerTarget,
} from "./peer-channel";
import { meshPublicKey, verifierFor } from "./mesh-identity.ts";
import { pinnedKeys, readMeshKeys, recordPeerKey, writeMeshKeys } from "./mesh-keys.ts";
import type { EnvelopeAuthVerifier } from "../shared/envelope.ts";
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
 *
 * `verify` decides whether a claimed sender is authenticated; anything that does
 * not verify is dropped rather than turned into a thread (#594).
 */
async function reconcileInbound(paseo: TimelineScanner, verify: EnvelopeAuthVerifier): Promise<void> {
  try {
    const timelines = await scanLocalTimelines(paseo);
    const snapshot = readConversationsSnapshot();
    writeConversationsSnapshot(reconcileTimelines(snapshot, timelines, peerAliasFor, verify));
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
    // Same opt-out as the send path, so a daemon switched off in settings is not
    // dialled for presence either. Applied here rather than at the call site
    // because this is the only presence entry point.
    if (!resolveDaemonEnabled(readUiPrefs(), daemon.name)) continue;
    try {
      targets.push(resolvePeerTarget(daemon.name, daemon.value));
    } catch (cause) {
      log.error(`presence: skipping undialable peer '${daemon.name}': ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  return targets;
}

/**
 * How long a completed pin pass is trusted before we dial peers again. A
 * snapshot refresh is a user-visible RPC, and dialling every relay peer on each
 * one would put an 8s connect timeout per unreachable peer in front of the UI.
 * Keys are pinned permanently, so this only bounds *discovery* of a newly paired
 * peer — never a re-fetch of a known one.
 */
const MESH_KEY_REFRESH_MS = 5 * 60 * 1000;

/** Whole-pass deadline, so a fleet of dead peers cannot stall a refresh. */
const MESH_KEY_PASS_DEADLINE_MS = 5000;

let lastMeshKeyPassAt = 0;
let meshKeyPassInFlight: Promise<void> | null = null;

/**
 * Pull each peer's x-comms verify key over the authenticated link and pin it.
 * The key is what makes an inbound envelope's `sender` block checkable instead
 * of merely asserted (#594).
 *
 * Rate-limited and deadline-bounded: a slow or unreachable peer must not hold up
 * a timeline reconcile, and whatever it does not return is picked up next pass.
 */
async function pinPeerMeshKeys(): Promise<void> {
  if (Date.now() - lastMeshKeyPassAt < MESH_KEY_REFRESH_MS) return;
  // Concurrent refreshes share one pass rather than each dialling the fleet.
  if (meshKeyPassInFlight) return meshKeyPassInFlight;
  lastMeshKeyPassAt = Date.now();
  meshKeyPassInFlight = (async () => {
    const pass = (async () => {
      for (const target of validPeerTargets()) {
        if (!isLinkAuthenticated(target)) continue;
        try {
          const key = await fetchPeerMeshKey(target);
          if (!key) continue;
          const state = readMeshKeys();
          const outcome = recordPeerKey(state, key);
          if (!outcome.pinned) {
            log.error(
              `auth: refusing mesh key for '${target.name}': ${outcome.reason} — its envelopes stay unattributable`,
            );
            continue;
          }
          if (!outcome.changed) continue;
          writeMeshKeys(state);
          log.info(`auth: pinned mesh key ${key.keyId} for '${target.name}' (${key.serverId})`);
        } catch (cause) {
          log.error(
            `auth: could not fetch a mesh key from '${target.name}': ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }
    })();
    // Resolves either way: a missed pass is recoverable, a rejected promise here
    // would reject every reconcile that shares it.
    await Promise.race([pass, withTimeout(Promise.resolve(), MESH_KEY_PASS_DEADLINE_MS, "mesh key pass").catch(() => {})]);
  })().finally(() => {
    meshKeyPassInFlight = null;
  });
  return meshKeyPassInFlight;
}

/**
 * The envelope signature checker used on every inbound attribution. Backed by
 * the pinned peer keys; an envelope from a peer we have no key for verifies as
 * nothing, which is the intended conservative answer.
 */
export async function peerAuthVerifier(): Promise<EnvelopeAuthVerifier> {
  await pinPeerMeshKeys();
  return verifierFor(pinnedKeys(readMeshKeys()));
}

/**
 * Hand this daemon's x-comms verify key to an authenticated peer, so it can
 * check the envelopes we stamp. The `serverId` in the response is the link's own
 * verified identity — the caller overwrites whatever this process believes, so a
 * buggy or spoofed local id cannot launder a key onto the wrong peer.
 */
export async function handleMeshKeyGet() {
  const key = meshPublicKey();
  let serverId: string | null = null;
  try {
    serverId = await localServerId();
  } catch {
    // Unreadable identity: the peer cannot pin a key to a serverId, so it will
    // treat the key as unusable. Better than publishing an unownable one.
  }
  return { serverId, keyId: key.keyId, publicKeyPem: key.publicKeyPem };
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
// Defer queue: hold sends to a busy target instead of preempting its turn
// (#598). The queue storage and its bounds live in defer-queue.ts; this is the
// wiring: the busy gate, the drain, and the notices.

let busyGateRef: BusyGate | null = null;

/**
 * Short on purpose. This probe sits in front of every send, and a late verdict
 * is better than a stale one — a caller blocked 20s to learn "busy" has already
 * moved on to something else.
 */
const BUSY_PROBE_TIMEOUT_MS = 5000;

async function runBusyProbe(args: string[]): Promise<unknown> {
  const r = await withTimeout(
    safeSpawn("paseo", args, { timeoutMs: BUSY_PROBE_TIMEOUT_MS }),
    BUSY_PROBE_TIMEOUT_MS,
    "busy probe",
  );
  if (r.code !== 0) throw new Error((r.stderr || `exit ${r.code}`).trim().slice(0, 200));
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error("non-JSON busy probe output");
  }
}

/**
 * Read the target's lifecycle. A local agent comes from the SDK snapshot (and
 * from the turn hooks, which need no probe at all); a peer comes from
 * `paseo inspect --host`, the only route to another daemon's agent state —
 * there is no cross-daemon turn subscription to wait on.
 */
async function probeTargetLifecycle(target: DeferTarget): Promise<string | null> {
  if (target.daemon === LOCAL_DAEMON) {
    const paseo = paseoRef;
    if (!paseo) return null;
    try {
      const refreshed = await paseo.agents.ref(target.agentId).refresh();
      return readLifecycleStatus(refreshed?.agent);
    } catch {
      return null;
    }
  }
  const entry = targetRegistryEntry(target.daemon);
  if (!entry) return null;
  try {
    return readLifecycleStatus(await runBusyProbe(["inspect", target.agentId, "--host", entry.value, "--json"]));
  } catch {
    return null;
  }
}

function busyGate(): BusyGate {
  if (!busyGateRef) busyGateRef = new BusyGate({ probe: probeTargetLifecycle });
  return busyGateRef;
}

export function noteLocalTurnStarted(agentId: string): void {
  busyGate().noteLocalTurnStarted(agentId);
}

function noteTargetDispatched(target: DeferTarget): void {
  busyGate().noteDispatched(target);
}

/**
 * Tell a sender that a message aimed at it will not be delivered. Appended to
 * the sender's timeline rather than sent, so the sender reads it on a turn it
 * starts itself and is never interrupted to learn about it.
 */
async function notifyDeferDrop(
  entry: DeferEntry,
  cause: "expired" | "evicted" | "unknown",
): Promise<void> {
  const paseo = paseoRef;
  const reason = deferDropReason(entry, cause);
  if (!entry.fromAgentId || !paseo) {
    log.warn(
      `defer: drop notice for ${entry.id} not appended (${entry.fromAgentId ? "no paseo handle" : "no local sender agent"}): ${reason}`,
    );
    return;
  }
  try {
    await paseo.agents.ref(entry.fromAgentId).timeline.append({
      type: "plugin",
      id: `x-comms-defer-${cause}-${entry.id}`,
      kind: DEFER_NOTICE_KIND,
      version: DEFER_NOTICE_VERSION,
      data: {
        daemon: entry.daemon,
        agentId: entry.agentId,
        messageId: entry.messageId,
        cause,
        reason,
        waitedMs: Math.max(0, Date.now() - Date.parse(entry.createdAt)),
      },
    });
  } catch (err) {
    log.error(`defer: drop notice for ${entry.id} failed: ${cause0(err)}`);
  }
}

function cause0(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Queue the `notifyOnFinish` notice back to the sender.
 *
 * The notice is addressed to a LOCAL agent — an x-comms sender is always an
 * agent on this daemon — and it goes through the same queue, so a sender that is
 * itself mid-turn has its notice held rather than steered. Paseo's own
 * notify-on-finish path steers the caller's turn; doing that here would
 * reintroduce the preemption this queue exists to remove, in the other
 * direction.
 */
export function queueDeliveryNotice(
  message: {
    daemon: string;
    agentId: string;
    messageId: string;
    fromAgentId?: string | null;
    fromAgentName?: string | null;
  },
  target: DeferTarget,
  landedAt: string,
): void {
  const senderId = message.fromAgentId ?? null;
  if (!senderId) return;
  if (!paseoRef) {
    log.warn(`defer: delivery notice for ${message.messageId} not queued (no paseo handle)`);
    return;
  }
  const queued = enqueueDefer(
    {
      kind: "notice",
      daemon: LOCAL_DAEMON,
      agentId: senderId,
      fromAgentId: null,
      fromAgentName: message.fromAgentName ?? null,
      prompt: deliveryNoticeText(
        {
          id: message.messageId,
          kind: "message",
          daemon: target.daemon,
          agentId: target.agentId,
          fromAgentId: null,
          fromAgentName: null,
          prompt: "",
          messageId: message.messageId,
          stamped: true,
          notifyOnFinish: false,
          createdAt: landedAt,
          expiresAt: landedAt,
        },
        landedAt,
      ),
      messageId: randomUUID(),
      notifyOnFinish: false,
      reportsOnEntryId: message.messageId,
    },
    { nowMs: Date.now() },
  );
  if (!queued.entry) {
    log.error(`defer: delivery notice for ${message.messageId} refused: ${queued.error}`);
  }
}

/**
 * Deliver a queued item. A notice is a local send. A message goes out over the
 * route its original send would have taken, except when the text is already
 * stamped by the MCP server's path — that text must be sent verbatim, because
 * re-stamping would move `sentAt` and invalidate the signature from #594.
 */
async function deliverDeferEntry(entry: DeferEntry): Promise<void> {
  if (entry.kind === "notice") {
    const paseo = paseoRef;
    if (!paseo) throw new Error("no local paseo handle for a delivery notice");
    await paseo.agents.ref(entry.agentId).send(entry.prompt, { messageId: entry.messageId });
    return;
  }
  if (entry.stamped) {
    // `paseo send --host`, so the pre-stamped bytes reach the target unchanged.
    await sendPreStampedViaHost(entry);
    return;
  }
  await deliverConversationMessage({
    daemon: entry.daemon,
    agentId: entry.agentId,
    prompt: entry.prompt,
    fromAgentId: entry.fromAgentId,
    fromAgentName: entry.fromAgentName,
    messageId: entry.messageId,
  });
}

export interface DeferDrainSummary {
  delivered: number;
  failed: number;
  expired: number;
  /** Claims left in flight by a dead process; reported, never re-dispatched. */
  unknown: number;
  skipped: number;
}

export interface DeferDrainOptions {
  nowMs?: number;
  /** Drain only this target (a local agent just went idle). */
  target?: DeferTarget;
  /** Reusable for tests; defaults to the real queue directory. */
  dir?: string;
  /** Injected so a drain can be exercised without a daemon. */
  deliver?: (entry: DeferEntry) => Promise<void>;
  notify?: (entry: DeferEntry, cause: "expired" | "evicted" | "unknown") => void;
}

/**
 * One drain pass.
 *
 * At most ONE item per target per pass. A delivery starts the target's turn, so
 * handing it a second message in the same pass would preempt the first — the
 * exact behaviour the queue exists to prevent. Throughput is therefore one
 * message per observed turn, which is what the target's own pace implies.
 *
 * The `.json` to `.sending` rename inside claimNextDefer happens BEFORE the
 * send, so a crash in the middle of a delivery leaves a claim a later pass
 * reports as unknown rather than redelivering.
 */
export async function drainDeferQueue(options: DeferDrainOptions = {}): Promise<DeferDrainSummary> {
  const dir = options.dir ?? deferQueueDir();
  const nowMs = options.nowMs ?? Date.now();
  const deliver = options.deliver ?? deliverDeferEntry;
  const notify = options.notify ?? notifyDeferDrop;
  const summary: DeferDrainSummary = { delivered: 0, failed: 0, expired: 0, unknown: 0, skipped: 0 };

  // A claim still present here belongs to a process that died mid-send. The
  // target may already have the message, so report the ambiguity rather than
  // replaying it.
  for (const entry of listStaleClaims(dir)) {
    summary.unknown += 1;
    removeDeferItem(dir, entry.id);
    notify(entry, "unknown");
  }

  for (const entry of expiredDeferEntries(listWaiting(dir), nowMs)) {
    summary.expired += 1;
    removeDeferItem(dir, entry.id);
    notify(entry, "expired");
  }

  const targets = pendingDeferTargets(dir)
    .filter(
      (target) =>
        !options.target ||
        (target.daemon === options.target.daemon && target.agentId === options.target.agentId),
    )
    .slice(0, DEFER_MAX_TARGETS_PER_PASS);
  for (const target of targets) {
    if (await busyGate().isBusy(target)) {
      summary.skipped += deferDepth(dir, target);
      continue;
    }
    const entry = claimNextDefer(dir, target, nowMs);
    if (!entry) continue;
    try {
      await deliver(entry);
    } catch (cause) {
      summary.failed += 1;
      log.error(
        `defer: delivery of ${entry.id} to '${entry.daemon}/${entry.agentId}' failed, still queued: ${cause0(cause)}`,
      );
      releaseDeferItem(dir, entry.id);
      continue;
    }
    completeDeferItem(dir, entry.id);
    summary.delivered += 1;
    noteTargetDispatched(target);
    if (entry.kind !== "message") continue;
    recordOutboundSend({
      daemon: entry.daemon,
      agentId: entry.agentId,
      localAgentId: entry.fromAgentId,
    });
    if (entry.notifyOnFinish && entry.fromAgentId) {
      queueDeliveryNotice(entry, target, new Date().toISOString());
    }
  }
  if (summary.delivered || summary.expired || summary.unknown) {
    log.info(
      `defer: delivered ${summary.delivered}, failed ${summary.failed}, expired ${summary.expired}, unknown ${summary.unknown}, still waiting ${summary.skipped} (dir: ${dir})`,
    );
  }
  return summary;
}

/**
 * A local agent just went idle: drain whatever was waiting for it, so a local
 * target's backlog clears at turn speed instead of at the poll interval.
 */
export function onLocalTurnEnded(agentId: string): void {
  busyGate().noteLocalTurnEnded(agentId);
  void drainDeferQueue({ target: { daemon: LOCAL_DAEMON, agentId } }).catch((cause) => {
    log.error(`defer: drain for '${agentId}' failed: ${cause0(cause)}`);
  });
}

export const deferWorker = createPeriodicTask({
  intervalMs: DEFER_DRAIN_INTERVAL_MS,
  runImmediately: true,
  task: async () => {
    await drainDeferQueue();
  },
  onError: (cause) => {
    log.error(`defer: periodic drain failed: ${cause0(cause)}`);
  },
});

export function stopDeferWorker(): void {
  deferWorker.stop();
}


// Runs when this module has fully evaluated. Placed last so every
// module-level const above (stores, registries) exists before the first
// startup read in the daemon's CJS-compiled bundle.
runStartupCheck();
// Prime the fleet snapshot so daemon health, agent counts, and the Introduce
// pickers are ready immediately instead of fetching lazily on first request.
initializeSnapshot();
