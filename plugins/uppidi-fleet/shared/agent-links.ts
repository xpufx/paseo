/**
 * Client-agnostic agent session deep-links (Refs #1297).
 *
 * Historically every agent URL was hardcoded to the Paseo protocol
 * (`paseo://agent/{id}`). Host clients (Paseo app, Happier, custom web
 * dashboards, headless terminal runners) now supply their own URI scheme /
 * URL template through {@link AgentLinkConfig} while envelope parsing stays
 * backwards-compatible with historical `paseo://` links.
 */

export type AgentLinkScheme = "paseo" | "happier" | "https";

export interface AgentLinkTarget {
  agentId: string;
  workspaceId?: string | null;
  serverId?: string | null;
  dashboardHost?: string | null;
}

export interface AgentLinkConfig {
  /** Link scheme to generate. Defaults to `"paseo"` (historical behavior). */
  scheme?: AgentLinkScheme | null;
  /** Required when `scheme` is `"https"`. */
  dashboardHost?: string | null;
  /** Default server id baked into generated `paseo://` links. */
  serverId?: string | null;
  /** Default workspace id appended as `?workspace=` to generated links. */
  workspaceId?: string | null;
}

/** `paseo://agent/{agentId}?workspace={workspaceId}` */
export function buildPaseoAgentLink(target: AgentLinkTarget): string {
  const base = target.serverId
    ? `paseo://h/${target.serverId}/agent/${target.agentId}`
    : `paseo://agent/${target.agentId}`;
  return target.workspaceId
    ? `${base}?workspace=${encodeURIComponent(target.workspaceId)}`
    : base;
}

/** `happier://agent/{agentId}` */
export function buildHappierAgentLink(target: AgentLinkTarget): string {
  return `happier://agent/${target.agentId}`;
}

/** `https://{dashboardHost}/agents/{agentId}` */
export function buildDashboardAgentLink(target: AgentLinkTarget): string {
  const host = (target.dashboardHost ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!host) return buildPaseoAgentLink(target);
  return `https://${host}/agents/${target.agentId}`;
}

/**
 * Build one agent deep-link with an explicit host configuration. Pure and
 * safe to call from server or client bundles.
 */
export function buildAgentLink(target: AgentLinkTarget, config?: AgentLinkConfig | null): string {
  const scheme = config?.scheme ?? "paseo";
  const merged: AgentLinkTarget = {
    agentId: target.agentId,
    workspaceId: target.workspaceId ?? config?.workspaceId ?? null,
    serverId: target.serverId ?? config?.serverId ?? null,
    dashboardHost: target.dashboardHost ?? config?.dashboardHost ?? null,
  };
  if (scheme === "happier") return buildHappierAgentLink(merged);
  if (scheme === "https") return buildDashboardAgentLink(merged);
  return buildPaseoAgentLink(merged);
}

function readGlobalOverride(key: string): string | null {
  try {
    const value = (globalThis as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function readEnv(key: string): string | null {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    const value = env?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the host-configured link generator inputs. Precedence: explicit
 * argument, then `PASEO_AGENT_LINK_SCHEME` / `PASEO_AGENT_DASHBOARD_HOST` /
 * `PASEO_AGENT_SERVER_ID` env (or `globalThis` overrides of the same names
 * for client bundles), then the historical `paseo://` default.
 */
export function resolveAgentLinkConfig(explicit?: AgentLinkConfig | null): AgentLinkConfig {
  const schemeRaw = explicit?.scheme ?? readEnv("PASEO_AGENT_LINK_SCHEME") ?? readGlobalOverride("PASEO_AGENT_LINK_SCHEME");
  const scheme: AgentLinkScheme =
    schemeRaw === "happier" || schemeRaw === "https" || schemeRaw === "paseo" ? schemeRaw : "paseo";
  return {
    scheme,
    dashboardHost:
      explicit?.dashboardHost ??
      readEnv("PASEO_AGENT_DASHBOARD_HOST") ??
      readGlobalOverride("PASEO_AGENT_DASHBOARD_HOST") ??
      null,
    serverId:
      explicit?.serverId ??
      readEnv("PASEO_AGENT_SERVER_ID") ??
      readGlobalOverride("PASEO_AGENT_SERVER_ID") ??
      null,
    workspaceId: explicit?.workspaceId ?? null,
  };
}

/** Create a configured agent deep-link generator for a host client. */
export function createAgentLinkResolver(config?: AgentLinkConfig | null): (target: AgentLinkTarget) => string {
  const resolved = resolveAgentLinkConfig(config);
  return (target: AgentLinkTarget) => buildAgentLink(target, resolved);
}

/**
 * Primary deep-link for an envelope: the first `agentLinks` entry, falling
 * back to the historical `paseoLinks` entry. Null when the envelope carries
 * no link (e.g. older comments).
 */
export function resolveEnvelopeAgentLink(
  envelope: { agentLinks?: string[]; paseoLinks?: string[] } | null | undefined,
): string | null {
  if (!envelope) return null;
  return envelope.agentLinks?.[0] ?? envelope.paseoLinks?.[0] ?? null;
}

/**
 * Default deep-link for an agent id when no envelope link exists. Honors the
 * host-configured scheme and falls back to the historical `paseo://` link.
 */
export function defaultAgentLink(
  agentId: string,
  options?: { workspaceId?: string | null; config?: AgentLinkConfig | null },
): string {
  return buildAgentLink(
    { agentId, workspaceId: options?.workspaceId ?? null },
    resolveAgentLinkConfig(options?.config),
  );
}
