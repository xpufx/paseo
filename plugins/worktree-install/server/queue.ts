import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  QueueActionInput,
  QueueActionOutput,
  QueueOutput,
  RepoQueue,
  RouterStatusOutput,
} from "../shared/contracts.js";

const execFileAsync = promisify(execFile);

/**
 * Read-only client for the Forgejo webhook router.
 *
 * The router is the hook server — a core component, not a separate product with
 * its own deployment story. It is managed by `uppidi-fleet`, whose canonical
 * configuration lives in plugin settings storage at
 * `~/.paseo/plugin-data/xpufx/uppidi-fleet/settings.json`. This client resolves
 * `hookHost`/`hookPort` from there rather than assuming loopback, because the
 * daemon can be bound to a LAN address and a loopback miss looks identical to
 * "no work queued" until you read the error.
 *
 * Precedence: explicit override, then `FORGE_HOOK_URL`, then plugin settings,
 * then loopback. The legacy `~/.config/uppidi-fleet/router-config.json` mirror
 * is deliberately never consulted (#1164): reading it allowed the endpoint to
 * drift between two config locations. A degraded fetch is still surfaced as an
 * explicit error rather than reported as an empty queue.
 */
const DEFAULT_URL = "http://127.0.0.1:8099";

/** Canonical uppidi-fleet settings file; the only place router host/port is read. */
function uppidiFleetSettingsPath(): string {
  return join(homedir(), ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "settings.json");
}

function urlFromSettings(): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(uppidiFleetSettingsPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    const rawHost = typeof parsed.hookHost === "string" ? parsed.hookHost.trim() : "";
    const port = typeof parsed.hookPort === "number" && !Number.isNaN(parsed.hookPort) ? parsed.hookPort : null;
    if (!port || port <= 0) return undefined;
    // A wildcard bind is not a usable destination; loopback is.
    const host = !rawHost || rawHost === "0.0.0.0" || rawHost === "::" ? "127.0.0.1" : rawHost;
    return `http://${host}:${port}`;
  } catch {
    return undefined;
  }
}

export function resolveRouterUrl(provided?: string): string {
  if (provided?.trim()) return provided.trim().replace(/\/+$/, "");
  const envUrl = process.env.FORGE_HOOK_URL?.trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  return urlFromSettings() ?? DEFAULT_URL;
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return data;
}

function reachable(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readQueues(hookUrl?: string): Promise<QueueOutput> {
  try {
    const data = await getJson<Partial<QueueOutput>>(`${resolveRouterUrl(hookUrl)}/queues`, 5000);
    return {
      ok: true,
      service: data.service,
      uptime: data.uptime,
      paused: data.paused ?? [],
      queues: Array.isArray(data.queues) ? (data.queues as RepoQueue[]) : [],
    };
  } catch (err: unknown) {
    return { ok: false, paused: [], queues: [], error: `Unreachable: ${reachable(err)}` };
  }
}

/** Shape the router's own `/status` endpoint returns. */
interface RawRouterStatus {
  ok?: boolean;
  service?: string;
  version?: number;
  uptime?: number;
  active?: boolean;
  state?: string;
  host?: string;
  port?: number;
  configuredHost?: string;
  configuredPort?: number;
  availableInterfaces?: string[];
  frontDesk?: { agentId?: string | null } | null;
  paused?: string[];
  totalQueued?: number;
  repoCount?: number;
}

export async function readRouterStatus(
  hookUrl?: string,
  _context?: PluginHandlerContext,
): Promise<RouterStatusOutput> {
  const base = resolveRouterUrl(hookUrl);
  const xComms = await xCommsInstalled();

  let status: RawRouterStatus = {};
  let error: string | undefined;
  try {
    status = await getJson<RawRouterStatus>(`${base}/status`, 4000);
  } catch (err: unknown) {
    error = `Unreachable: ${reachable(err)}`;
  }

  // `/health` answers even while the router is still binding, which is what
  // separates "starting" from "disconnected" in the header badge. Its absence
  // just means the verdict cannot be refined, not that the read failed.
  let health: RawRouterStatus = {};
  try {
    health = await getJson<RawRouterStatus>(`${base}/health`, 3000);
  } catch {
    // Optional endpoint.
  }

  const active = Boolean(health.active ?? status.active ?? (status.ok === true && !error));

  return {
    ok: !error,
    service: status.service ?? health.service,
    version: status.version,
    uptime: status.uptime ?? health.uptime,
    url: base,
    active,
    state: health.state ?? status.state ?? (active ? "active" : error ? "unreachable" : "inactive"),
    host: health.host ?? status.host,
    port: health.port ?? status.port,
    configuredHost: health.configuredHost ?? status.configuredHost,
    configuredPort: health.configuredPort ?? status.configuredPort,
    availableInterfaces: health.availableInterfaces ?? status.availableInterfaces ?? [],
    frontDeskAgentId: status.frontDesk?.agentId ?? null,
    paused: status.paused ?? [],
    totalQueued: status.totalQueued ?? 0,
    repoCount: status.repoCount ?? 0,
    capabilities: { xCommsInstalled: xComms },
    error,
  };
}

/**
 * Cross-plugin presence for `x-comms`, asked of the daemon through its own
 * `paseo plugin ls --json` query. The SDK `PaseoApi` exposes no plugins
 * actions, so this is the same authoritative route the CLI uses. Anything
 * unexpected tolerates to `false` so the queue view still renders.
 */
async function xCommsInstalled(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("paseo", ["plugin", "ls", "--json"], {
      timeout: 3000,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(stdout);
    if (!Array.isArray(parsed)) return false;
    return parsed.some((p) => p?.id === "x-comms" && p?.enabled !== false && p?.status === "running");
  } catch {
    return false;
  }
}

export async function handleQueues(input: { hookUrl?: string }): Promise<QueueOutput> {
  return readQueues(input.hookUrl);
}

export async function handleRouterStatus(
  input: { hookUrl?: string },
  context?: PluginHandlerContext,
): Promise<RouterStatusOutput> {
  return readRouterStatus(input.hookUrl, context);
}

async function queueAction(
  input: QueueActionInput,
  path: string,
  verb: string,
): Promise<QueueActionOutput> {
  try {
    const data = await postJson<{ message?: string }>(
      `${resolveRouterUrl(input.hookUrl)}${path}`,
      { repo: input.repo || "all" },
      4000,
    );
    return { ok: true, message: data?.message || `Queue ${verb}ed` };
  } catch (err: unknown) {
    return { ok: false, error: reachable(err) };
  }
}

export async function handleQueuePause(input: QueueActionInput): Promise<QueueActionOutput> {
  return queueAction(input, "/queue/pause", "paus");
}

export async function handleQueueResume(input: QueueActionInput): Promise<QueueActionOutput> {
  return queueAction(input, "/queue/resume", "resum");
}

export async function handleQueueDrain(input: QueueActionInput): Promise<QueueActionOutput> {
  return queueAction(input, "/queue/drain", "drain");
}
