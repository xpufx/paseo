import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSlashSettingsStorage } from "./settings";

export const DEFAULT_HOOK_URL = "http://127.0.0.1:8099";

const HOOK_TIMEOUT_MS = 10_000;

function readHookSettings(): { hookUrl: string; hookSecretFile: string } {
  try {
    const settings = getSlashSettingsStorage().read();
    return {
      hookUrl: (settings.hookUrl ?? "").trim(),
      hookSecretFile: (settings.hookSecretFile ?? "").trim(),
    };
  } catch {
    return { hookUrl: "", hookSecretFile: "" };
  }
}

/**
 * Resolves the hook endpoint: an explicit binding target wins, then the slash
 * plugin's configured `hookUrl`, then `PASEO_FORGEJO_HOOK_URL`, then the loopback
 * default (issue #544).
 */
function resolveHookUrl(target?: string): string {
  const bindingTarget = target?.trim();
  if (bindingTarget) return bindingTarget;
  const fromSettings = readHookSettings().hookUrl;
  if (fromSettings) return fromSettings;
  return process.env.PASEO_FORGEJO_HOOK_URL?.trim() || DEFAULT_HOOK_URL;
}

/**
 * Resolves the secret file path: configured `hookSecretFile`, then
 * `PASEO_FORGEJO_HOOK_SECRET_FILE`, then the conventional path. The secret value
 * itself is never persisted in settings.
 */
function resolveSecretFile(): string {
  const fromSettings = readHookSettings().hookSecretFile;
  if (fromSettings) return fromSettings;
  const override = process.env.PASEO_FORGEJO_HOOK_SECRET_FILE?.trim();
  if (override) return override;
  return join(process.env.HOME || homedir(), ".paseo", "forgejo-hook.secret");
}

function readSecret(): string {
  const file = resolveSecretFile();
  try {
    const secret = readFileSync(file, "utf8").trim();
    if (secret) return secret;
  } catch {
    // Missing or unreadable file: fall back to the hook's own env convention.
  }
  const fromEnv = process.env.FORGEJO_WEBHOOK_SECRET?.trim();
  if (fromEnv) return fromEnv;
  throw new Error(`forgejo hook secret unavailable at ${file}`);
}

function errorReason(status: number, statusText: string, payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const reason = (payload as { error?: unknown }).error;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  return statusText || `hook refused the handover (${status})`;
}

/**
 * Deterministic orchestrator handover: POSTs the caller's agent id to the
 * forgejo hook control endpoint. Fails closed on missing secret, an
 * unreachable hook, or a non-2xx rejection; the secret is never surfaced.
 * `target` lets a settings-defined operation binding point at another endpoint.
 */
export async function orchestrateHandover(agentId: string, target?: string): Promise<unknown> {
  const id = agentId?.trim();
  if (!id) throw new Error("orchestrate requires a caller agent id");

  const secret = readSecret();
  const url = `${resolveHookUrl(target).replace(/\/+$/, "")}/orchestrate`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ agentId: id }),
      signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`orchestrate failed: forgejo hook unreachable at ${url} (${detail})`);
  }

  const text = await response.text().catch(() => "");
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error(`orchestrate rejected (${response.status}): ${errorReason(response.status, response.statusText, payload)}`);
  }
  return payload ?? { ok: true };
}
