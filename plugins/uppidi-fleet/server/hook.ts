import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type HookStatusOutput,
  type HookQueuesOutput,
  type HookQueueActionOutput,
  type HookServiceStatusOutput,
  type HookServiceActionOutput,
  type HookLogTailOutput,
  type HookServiceConfigInput,
  type HookServiceConfigOutput,
} from "../shared/contracts.js";
import {
  getHookServiceStatus,
  executeHookServiceAction,
  getHookLogTail,
  configureHookService,
} from "./hook-router.js";
import { getUppidiFleetSettingsStorage } from "./settings.js";

const DEFAULT_HOOK_URL = process.env.FORGE_HOOK_URL || "http://127.0.0.1:8099";

export function resolveHookUrl(provided?: string): string {
  if (provided && typeof provided === "string" && provided.trim()) {
    return provided.trim().replace(/\/+$/, "");
  }
  return DEFAULT_HOOK_URL.replace(/\/+$/, "");
}

export async function handleHookStatus(
  input: { hookUrl?: string },
  _context?: PluginHandlerContext,
): Promise<HookStatusOutput> {
  const url = `${resolveHookUrl(input.hookUrl)}/status`;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return { ok: false, totalQueued: 0, repoCount: 0, paused: [], error: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data = (await res.json()) as HookStatusOutput;
    return { ...data, ok: true, paused: data.paused ?? [], totalQueued: data.totalQueued ?? 0, repoCount: data.repoCount ?? 0 };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, totalQueued: 0, repoCount: 0, paused: [], error: `Unreachable: ${msg}` };
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
