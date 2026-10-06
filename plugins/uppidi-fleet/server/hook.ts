import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type HookStatusOutput,
  type HookQueuesOutput,
  type HookQueueActionOutput,
  type HookServiceStatusOutput,
  type HookServiceActionOutput,
  type HookLogTailOutput,
  type HookServiceConfigInput,
  type HookServiceConfigOutput,
  type HookInfoOutput,
} from "../shared/contracts.js";
import {
  getHookServiceStatus,
  executeHookServiceAction,
  getHookLogTail,
  configureHookService,
  getActiveHookRouter,
  getHookRouterInfo,
} from "./hook-router.js";
import { getUppidiFleetSettingsStorage } from "./settings.js";
import { isPluginInstalled } from "paseo-plugin-helper/server";

const FALLBACK_HOOK_URL = "http://127.0.0.1:8099";
const DEFAULT_HOOK_HOST = "127.0.0.1";
const DEFAULT_HOOK_PORT = 8099;

function loopbackHost(host: string | null | undefined): string {
  if (!host || host === "0.0.0.0" || host === "::") return "127.0.0.1";
  return host;
}

function formatHookUrl(host: string | null | undefined, port: number | null | undefined): string | null {
  if (port === undefined || port === null || port <= 0) return null;
  return `http://${loopbackHost(host)}:${port}`;
}

/** Which rung of the resolution chain supplied the endpoint. */
export type HookEndpointSource =
  | "explicit"
  | "env"
  | "active-router"
  | "plugin-settings"
  | "default";

export interface ResolvedHookEndpoint {
  host: string;
  port: number;
  baseUrl: string;
  source: HookEndpointSource;
}

export interface HookAuthPosture {
  /** True when a shared secret is present; the value is never returned. */
  available: boolean;
  /** Where the secret lives or is expected — a path or env-var name, never its value. */
  location: string;
  note?: string;
}

function parseEndpointUrl(raw: string): { host: string; port: number; baseUrl: string } | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const explicitPort = parsed.port ? Number(parsed.port) : undefined;
    const port = explicitPort ?? (parsed.protocol === "https:" ? 443 : 80);
    const baseUrl = explicitPort
      ? `${parsed.protocol}//${parsed.hostname}:${explicitPort}`
      : `${parsed.protocol}//${parsed.hostname}`;
    return { host: parsed.hostname, port, baseUrl };
  } catch {
    return null;
  }
}

/**
 * Resolves the hook router endpoint (#464, #903) into host/port/baseUrl plus the
 * rung that supplied it. This is the chain the Front Desk intro prompt reads and
 * that `resolveHookUrl` delegates to for the router/settings rungs:
 * explicit argument, `FORGE_HOOK_URL`, the active router's bound/configured
 * address, plugin settings, then the loopback default. Wildcard binds map to
 * 127.0.0.1.
 */
export function resolveHookEndpoint(provided?: string): ResolvedHookEndpoint {
  if (provided && typeof provided === "string" && provided.trim()) {
    const parsed = parseEndpointUrl(provided);
    if (parsed) return { ...parsed, source: "explicit" };
  }

  const envUrl = process.env.FORGE_HOOK_URL;
  if (envUrl && envUrl.trim()) {
    const parsed = parseEndpointUrl(envUrl);
    if (parsed) return { ...parsed, source: "env" };
  }

  const router = getActiveHookRouter();
  if (router) {
    const status = router.getLifecycleStatus();
    const host = status.listening ? status.host : status.configuredHost;
    const port = status.listening ? status.port : status.configuredPort;
    const activeUrl = formatHookUrl(host, port);
    if (activeUrl) return { host: loopbackHost(host), port, baseUrl: activeUrl, source: "active-router" };
  }

  try {
    const settings = getUppidiFleetSettingsStorage().read();
    const port = settings?.hookPort;
    const settingsUrl = formatHookUrl(settings?.hookHost, port);
    if (settingsUrl && port !== undefined && port !== null) {
      return { host: loopbackHost(settings?.hookHost), port, baseUrl: settingsUrl, source: "plugin-settings" };
    }
  } catch {
    // ignore storage read failures
  }

  return { host: DEFAULT_HOOK_HOST, port: DEFAULT_HOOK_PORT, baseUrl: FALLBACK_HOOK_URL, source: "default" };
}

/**
 * Resolves the hook router endpoint (#464). An explicit `provided` URL wins
 * verbatim (trailing slashes trimmed), then `FORGE_HOOK_URL`; otherwise the
 * shared `resolveHookEndpoint` chain decides.
 */
export function resolveHookUrl(provided?: string): string {
  if (provided && typeof provided === "string" && provided.trim()) {
    return provided.trim().replace(/\/+$/, "");
  }

  const envUrl = process.env.FORGE_HOOK_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, "");
  }

  return resolveHookEndpoint().baseUrl;
}

/**
 * Reports whether the shared webhook secret is available and where it lives,
 * mirroring `scripts/frontdesk-info`'s auth_state: `FORGEJO_WEBHOOK_SECRET`,
 * then `~/.paseo/forgejo-hook.secret` (overridable for tests and non-standard
 * installs via `PASEO_FORGEJO_HOOK_SECRET_FILE`). The secret value is never
 * returned or logged.
 */
export function resolveHookAuthPosture(): HookAuthPosture {
  if (process.env.FORGEJO_WEBHOOK_SECRET?.trim()) {
    return { available: true, location: "FORGEJO_WEBHOOK_SECRET" };
  }

  const override = process.env.PASEO_FORGEJO_HOOK_SECRET_FILE?.trim();
  const location = override || join(process.env.HOME || homedir(), ".paseo", "forgejo-hook.secret");
  try {
    if (readFileSync(location, "utf8").trim()) {
      return { available: true, location };
    }
    return { available: false, location, note: "secret file empty" };
  } catch {
    return {
      available: false,
      location,
      note: "non-loopback hook endpoints will answer 401 without it",
    };
  }
}

export async function handleHookStatus(
  input: { hookUrl?: string },
  context?: PluginHandlerContext,
): Promise<HookStatusOutput> {
  const capabilities = { xCommsInstalled: await resolveXCommsInstalled(context) };
  const url = `${resolveHookUrl(input.hookUrl)}/status`;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return { ok: false, totalQueued: 0, repoCount: 0, paused: [], halted: false, teardownInProgress: false, capabilities, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data = (await res.json()) as HookStatusOutput;
    return {
      ...data,
      ok: true,
      paused: data.paused ?? [],
      halted: data.halted ?? false,
      teardownInProgress: data.teardownInProgress ?? false,
      totalQueued: data.totalQueued ?? 0,
      repoCount: data.repoCount ?? 0,
      capabilities,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, totalQueued: 0, repoCount: 0, paused: [], halted: false, teardownInProgress: false, capabilities, error: `Unreachable: ${msg}` };
  }
}

/**
 * Seed consumer for the helper plugin-registry presence API (#572): notes
 * whether x-comms is usable, resolved per call from the daemon. Absence — no
 * context, no daemon surface, unreachable daemon — tolerates to false and never
 * throws, so hook status stays answerable even when x-comms is missing.
 */
async function resolveXCommsInstalled(context?: PluginHandlerContext): Promise<boolean> {
  try {
    return await isPluginInstalled(context, "x-comms");
  } catch {
    return false;
  }
}

export async function handleHookQueues(
  input: { hookUrl?: string },
  _context?: PluginHandlerContext,
): Promise<HookQueuesOutput> {
  const url = `${resolveHookUrl(input.hookUrl)}/queues`;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      return { ok: false, paused: [], queues: [], error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data = (await res.json()) as HookQueuesOutput;
    return { ...data, ok: true, paused: data.paused ?? [], queues: data.queues ?? [] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, paused: [], queues: [], error: `Unreachable: ${msg}` };
  }
}

export async function handleHookPause(
  input: { hookUrl?: string; repo?: string },
  _context?: PluginHandlerContext,
): Promise<HookQueueActionOutput> {
  const url = `${resolveHookUrl(input.hookUrl)}/queue/pause`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: input.repo || "all" }),
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, message: data.message, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function handleHookResume(
  input: { hookUrl?: string; repo?: string },
  _context?: PluginHandlerContext,
): Promise<HookQueueActionOutput> {
  const url = `${resolveHookUrl(input.hookUrl)}/queue/resume`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: input.repo || "all" }),
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, message: data.message, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function handleHookDrain(
  input: { hookUrl?: string; repo?: string },
  _context?: PluginHandlerContext,
): Promise<HookQueueActionOutput> {
  const url = `${resolveHookUrl(input.hookUrl)}/queue/drain`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: input.repo || "all" }),
      signal: AbortSignal.timeout(4000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, message: data.message, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function handleHookServiceStatus(): Promise<HookServiceStatusOutput> {
  return getHookServiceStatus();
}

export async function handleHookInfo(): Promise<HookInfoOutput> {
  return getHookRouterInfo();
}

export async function handleHookServiceAction(input: {
  action: "start" | "stop" | "restart" | "reload";
}): Promise<HookServiceActionOutput> {
  return executeHookServiceAction(input.action);
}

export async function handleHookConfigure(
  input: HookServiceConfigInput,
  _context?: PluginHandlerContext,
): Promise<HookServiceConfigOutput> {
  const result = await configureHookService(input);
  if (result.ok) {
    try {
      const storage = getUppidiFleetSettingsStorage();
      storage.update((prev) => ({
        ...prev,
        hookHost: result.configuredHost,
        hookPort: result.configuredPort,
      }));
    } catch {
      // ignore
    }
  }
  return result;
}

export async function handleHookLogTail(input?: { lines?: number }): Promise<HookLogTailOutput> {
  return getHookLogTail(input?.lines);
}
