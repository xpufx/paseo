

/** Forgejo host used when `FORGEJO_HOST` is unset. */
export const DEFAULT_FORGEJO_HOST = "forge.mrs.uppidi.com";

/** Resolved per call so a late-set `FORGEJO_HOST` is still honoured. */
export function resolveForgejoHost(): string {
  return process.env.FORGEJO_HOST || DEFAULT_FORGEJO_HOST;
}

/** Default per-request timeout for Forgejo API reads. */
export const FORGEJO_API_TIMEOUT_MS = 6000;

import { PluginStorage } from "paseo-plugin-helper/server";
import {
  type FleetRole,
  DEFAULT_ROLE_USERNAMES,
  DEFAULT_FLEET_USER,
} from "../shared/contracts.js";

export function resolveTokenValue(val: unknown): string {
  if (typeof val !== "string") return "";
  const trimmed = val.trim();
  if (trimmed.startsWith("env:")) {
    const envVar = trimmed.slice(4).trim();
    return (process.env[envVar] ?? "").trim();
  }
  return trimmed;
}

export interface ResolveForgejoIdentityOptions {
  host?: string | null;
  role?: FleetRole | string | null;
  settings?: any;
  pluginSettingsPath?: string;
  routerConfigPath?: string;
}

export interface ForgejoIdentity {
  role: string | null;
  username: string;
  token: string | null;
  isFallback: boolean;
}

function loadUppidiFleetSettings(opts?: ResolveForgejoIdentityOptions): any {
  if (opts?.settings && typeof opts.settings === "object") return opts.settings;
  try {
    const storage = new PluginStorage<any>("uppidi-fleet", "settings.json");
    return storage.read() ?? {};
  } catch {
    return {};
  }
}

/**
 * Resolve Forgejo identity supporting role-based multi-PAT routing with
 * independent single-user fallback (#1428).
 */
export function resolveForgejoIdentity(
  hostOrOpts?: string | null | ResolveForgejoIdentityOptions,
  maybeRole?: FleetRole | string | null,
  maybeOpts?: ResolveForgejoIdentityOptions,
): ForgejoIdentity {
  let host: string | null = null;
  let role: string | null = null;
  let opts: ResolveForgejoIdentityOptions = {};

  if (typeof hostOrOpts === "object" && hostOrOpts !== null && !maybeRole) {
    ({ host = null, role = null, ...opts } = hostOrOpts);
  } else {
    host = typeof hostOrOpts === "string" ? hostOrOpts : null;
    role = typeof maybeRole === "string" ? maybeRole : null;
    opts = maybeOpts ?? {};
  }

  role = role ? role.trim() : null;
  host = host ? host.trim() : null;

  // Normalize role aliases (e.g. coding-agent -> worker)
  const normalizedRole = role ? (role === "coding-agent" ? "worker" : role) : null;

  const settings = loadUppidiFleetSettings(opts);
  const auth = settings?.auth ?? {};
  const roles = auth?.roles ?? {};

  // 1. Role-specific token resolution (if role is provided)
  if (normalizedRole) {
    const envRoleKey = `FORGEJO_TOKEN_${normalizedRole.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    const envRoleToken = (process.env[envRoleKey] ?? "").trim();

    const roleConfig = roles[normalizedRole] ?? (role ? roles[role] : undefined);
    let roleToken = "";
    let roleUsername = "";

    if (typeof roleConfig === "string") {
      roleToken = resolveTokenValue(roleConfig);
      roleUsername = DEFAULT_ROLE_USERNAMES[normalizedRole as FleetRole] ?? normalizedRole;
    } else if (roleConfig && typeof roleConfig === "object") {
      roleToken = resolveTokenValue(roleConfig.token);
      roleUsername = (roleConfig.username ?? DEFAULT_ROLE_USERNAMES[normalizedRole as FleetRole] ?? normalizedRole).trim();
    }

    if (envRoleToken) {
      return {
        role: normalizedRole,
        username: roleUsername || DEFAULT_ROLE_USERNAMES[normalizedRole as FleetRole] || normalizedRole,
        token: envRoleToken,
        isFallback: false,
      };
    }

    if (roleToken) {
      return {
        role: normalizedRole,
        username: roleUsername || DEFAULT_ROLE_USERNAMES[normalizedRole as FleetRole] || normalizedRole,
        token: roleToken,
        isFallback: false,
      };
    }
  }

  // 2. Single-user collapse
  // Independent fallback: collapse cleanly to auth.defaultToken / FORGEJO_TOKEN / GITEA_TOKEN / tokensByHost[host] / forgejoToken
  const defaultUsername = (auth.defaultUser ?? DEFAULT_FLEET_USER).trim();

  let defaultToken = "";
  if (auth.defaultToken) {
    defaultToken = resolveTokenValue(auth.defaultToken);
  }
  if (!defaultToken) {
    defaultToken = (process.env.FORGEJO_TOKEN ?? "").trim();
  }
  if (!defaultToken) {
    defaultToken = (process.env.GITEA_TOKEN ?? "").trim();
  }
  const targetHost = host ?? DEFAULT_FORGEJO_HOST;
  if (!defaultToken && settings?.tokensByHost && typeof settings.tokensByHost === "object") {
    defaultToken = resolveTokenValue(settings.tokensByHost[targetHost]);
  }
  if (!defaultToken && typeof settings?.forgejoToken === "string") {
    defaultToken = resolveTokenValue(settings.forgejoToken);
  }

  return {
    role: null,
    username: defaultUsername,
    token: defaultToken ? defaultToken : null,
    isFallback: true,
  };
}

/**
 * Resolves the Forgejo API token supporting role-based multi-PAT routing with
 * independent single-user fallback (#1428). Never falls back to 'forges'
 * settings or ~/.config/tea/config.yml.
 *
 * A null return means "no usable token", which callers must surface as an
 * authorization failure — never as a reason to serve substitute data.
 */
export async function resolveForgejoToken(
  hostOrOpts?: string | null | ResolveForgejoIdentityOptions,
  maybeRole?: FleetRole | string | null,
  maybeOpts?: ResolveForgejoIdentityOptions,
): Promise<string | null> {
  const identity = resolveForgejoIdentity(hostOrOpts, maybeRole, maybeOpts);
  return identity.token;
}

export function resolveForgejoTokenSync(
  hostOrOpts?: string | null | ResolveForgejoIdentityOptions,
  maybeRole?: FleetRole | string | null,
  maybeOpts?: ResolveForgejoIdentityOptions,
): string | null {
  const identity = resolveForgejoIdentity(hostOrOpts, maybeRole, maybeOpts);
  return identity.token;
}

export type FetchLike = (input: string, init?: any) => Promise<any>;

let fetchImpl: FetchLike = (input, init) => fetch(input, init);

export function setFetchForTest(fn: FetchLike | null): void {
  fetchImpl = fn ?? ((input, init) => fetch(input, init));
}

export type TokenResolverFn = (
  host: string,
  role?: FleetRole | string | null,
) => Promise<string | null>;

let tokenResolver: TokenResolverFn = resolveForgejoToken;

export function setTokenResolverForTest(fn: TokenResolverFn | null): void {
  tokenResolver = fn ?? resolveForgejoToken;
}

/**
 * The token every Forgejo read goes through. Indirected so a test can pin the
 * token instead of inheriting the operator's: `resolveForgejoToken` reads
 * uppidi-fleet settings/env, which is host state that differs between a
 * workstation and a CI runner.
 */
export function forgejoToken(
  host: string,
  role?: FleetRole | string | null,
): Promise<string | null> {
  return tokenResolver(host, role);
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

/**
 * Single mutating call (POST/PATCH/PUT/DELETE) against the Forgejo API, using
 * the same token resolver and injectable transport as `forgejoApiGet`. Shared
 * by the hook router's direct-action handlers (#847), which apply labels,
 * reopen issues, and post comments in-process.
 */
export async function forgejoApiRequest<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body: unknown,
  opts: { host: string; token: string | null; timeoutMs?: number }
): Promise<ForgejoApiResult<T>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (opts.token) headers.Authorization = `token ${opts.token}`;
  const url = `https://${opts.host}${path}`;

  try {
    const res = await fetchImpl(url, {
      method,
      headers,
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(opts.timeoutMs ?? FORGEJO_API_TIMEOUT_MS),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.json();
        if (errBody && typeof errBody.message === "string" && errBody.message.trim()) {
          detail = errBody.message.trim();
        }
      } catch {
        // Non-JSON error body — the status line alone is still worth reporting.
      }
      const parts = [`HTTP ${res.status}`];
      if (res.statusText) parts.push(res.statusText);
      if (detail) parts.push(detail);
      return { outcome: "http-error", httpStatus: res.status, error: parts.join(" ") };
    }
    let data: T;
    try {
      data = (await res.json()) as T;
    } catch {
      // Some writes (e.g. 204 No Content) carry no body.
      data = undefined as unknown as T;
    }
    return { outcome: "ok", httpStatus: res.status, data };
  } catch (err) {
    return {
      outcome: "unreachable",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
