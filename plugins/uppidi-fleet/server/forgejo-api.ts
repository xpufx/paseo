import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Forgejo host used when `FORGEJO_HOST` is unset. */
export const DEFAULT_FORGEJO_HOST = "forge.mrs.uppidi.com";

/** Resolved per call so a late-set `FORGEJO_HOST` is still honoured. */
export function resolveForgejoHost(): string {
  return process.env.FORGEJO_HOST || DEFAULT_FORGEJO_HOST;
}

/** Default per-request timeout for Forgejo API reads. */
export const FORGEJO_API_TIMEOUT_MS = 6000;

/**
 * Resolves the Forgejo API token from the two sources the plugin already used
 * for issue reads: `FORGEJO_TOKEN` / `GITEA_TOKEN`, then the matching login
 * block in `~/.config/tea/config.yml`.
 *
 * A null return means "no usable token", which callers must surface as an
 * authorization failure — never as a reason to serve substitute data.
 */
export async function resolveForgejoToken(host: string): Promise<string | null> {
  if (process.env.FORGEJO_TOKEN) return process.env.FORGEJO_TOKEN.trim();
  if (process.env.GITEA_TOKEN) return process.env.GITEA_TOKEN.trim();
  try {
    const teaConfigPath = join(homedir(), ".config", "tea", "config.yml");
    const content = await readFile(teaConfigPath, "utf8");
    const lines = content.split("\n");
    let currentLoginMatches = false;
    for (const line of lines) {
      if (line.includes(host) || line.includes("https://" + host)) {
        currentLoginMatches = true;
      } else if (line.trim().startsWith("- name:")) {
        currentLoginMatches = line.includes(host);
      }
      if (currentLoginMatches && line.trim().startsWith("token:")) {
        const token = line.replace(/.*token:\s*/, "").trim();
        if (token) return token;
      }
    }
  } catch {
    // No readable tea config — the caller reports this as unauthenticated.
  }
  return null;
}

export type FetchLike = (input: string, init?: any) => Promise<any>;

let fetchImpl: FetchLike = (input, init) => fetch(input, init);

export function setFetchForTest(fn: FetchLike | null): void {
  fetchImpl = fn ?? ((input, init) => fetch(input, init));
}

export type TokenResolverFn = (host: string) => Promise<string | null>;

let tokenResolver: TokenResolverFn = resolveForgejoToken;

export function setTokenResolverForTest(fn: TokenResolverFn | null): void {
  tokenResolver = fn ?? resolveForgejoToken;
}

/**
 * The token every Forgejo read goes through. Indirected so a test can pin the
 * token instead of inheriting the operator's: `resolveForgejoToken` reads
 * `~/.config/tea/config.yml`, which is host state that differs between a
 * workstation and a CI runner, and a guard that only passes where that file
 * happens to be absent is not a guard.
 */
export function forgejoToken(host: string): Promise<string | null> {
  return tokenResolver(host);
}

export type ForgejoApiResult<T> =
  | { outcome: "ok"; httpStatus: number; data: T }
  | { outcome: "http-error"; httpStatus: number; error: string }
  | { outcome: "unreachable"; error: string };

/**
 * Single GET against the Forgejo API, classified into the three states a
 * caller has to tell apart: a 2xx body, an HTTP-level rejection (auth,
 * permission, not-found), or a transport failure with no response at all.
 * The distinction is what lets a panel report "unreachable" instead of
 * silently degrading to placeholder data.
 */
export async function forgejoApiGet<T>(
  path: string,
  opts: { host: string; token: string | null; timeoutMs?: number }
): Promise<ForgejoApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.token) headers.Authorization = `token ${opts.token}`;
  const url = `https://${opts.host}${path}`;

  try {
    const res = await fetchImpl(url, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? FORGEJO_API_TIMEOUT_MS),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const body = await res.json();
        if (body && typeof body.message === "string" && body.message.trim()) {
          detail = body.message.trim();
        }
      } catch {
        // Non-JSON error body — the status line alone is still worth reporting.
      }
      const parts = [`HTTP ${res.status}`];
      if (res.statusText) parts.push(res.statusText);
      if (detail) parts.push(detail);
      return { outcome: "http-error", httpStatus: res.status, error: parts.join(" ") };
    }
    return { outcome: "ok", httpStatus: res.status, data: (await res.json()) as T };
  } catch (err) {
    return {
      outcome: "unreachable",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
