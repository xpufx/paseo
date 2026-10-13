import { AgentEnvelopeSchema, type AgentEnvelope } from "./schemas.js";

export const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/g;
/**
 * @deprecated Use {@link AGENT_LINK_PATTERN} instead. Kept as an alias so
 * historical `paseo://` envelopes in comments keep parsing.
 */
export const PASEO_LINK_PATTERN = /paseo:\/\/[^\s)>\]]+/g;
/**
 * @deprecated Server-id extraction now covers every client scheme via
 * {@link AGENT_SERVER_PATTERN}. Kept for backwards compatibility.
 */
export const PASEO_SERVER_PATTERN = /paseo:\/\/h\/([^/\s]+)\/agent\//;

/**
 * Client-agnostic agent deep-link matcher. Covers the historical `paseo://`
 * links plus `happier://` links and `https://` dashboard `/agents/` URLs, so
 * `@xpufx/backend-tickets` stays reusable across agent interfaces (Paseo,
 * Happier, custom web dashboards, headless terminal runners).
 */
export const AGENT_LINK_PATTERN =
  /(?:paseo|happier):\/\/[^\s)>\]]+|https?:\/\/[^\s)>\]]*\/agents\/[^\s)>\]]+/g;
/** Extracts the server id from hosted `paseo://` / `happier://` agent links. */
export const AGENT_SERVER_PATTERN = /(?:paseo|happier):\/\/h\/([^/\s]+)\/agent\//;

export const ENVELOPE_FOOTER_PATTERN =
  /<sub>\s*🤖\s*\*\*(.+?)\*\*\s*\(`([^`)]+)`\)\s*·\s*`([^`]+)`\s*·\s*`([^`]+)`\s*·\s*_([^_]+)_\s*<\/sub>/;

export function stripAgentEnvelopeFooter(body: string | undefined | null): string {
  if (!body || typeof body !== "string") return "";
  return body.replace(ENVELOPE_FOOTER_PATTERN, "").replace(/---\s*$/, "").trim();
}

// ---------------------------------------------------------------------------
// Configurable agent deep-link resolvers
// ---------------------------------------------------------------------------

/** Target coordinates for building one agent session deep-link. */
export interface AgentLinkTarget {
  agentId: string;
  workspaceId?: string | null;
  serverId?: string | null;
  dashboardHost?: string | null;
}

/** Builds an agent session deep-link for the given target coordinates. */
export type AgentLinkResolver = (target: AgentLinkTarget) => string;

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

export interface AgentLinkResolverConfig {
  /** Link scheme to generate. Defaults to `"paseo"` (historical behavior). */
  scheme?: "paseo" | "happier" | "https";
  /** Required when `scheme` is `"https"`. */
  dashboardHost?: string | null;
  /** Default server id baked into generated `paseo://` links. */
  serverId?: string | null;
  /** Default workspace id appended as `?workspace=` to generated links. */
  workspaceId?: string | null;
}

/**
 * Create a configured agent deep-link generator. Lets each host client
 * (Paseo app, Happier, custom dashboards, headless runners) supply its own
 * URI scheme / URL template while envelopes stay client-agnostic.
 */
export function createAgentLinkResolver(config?: AgentLinkResolverConfig): AgentLinkResolver {
  const scheme = config?.scheme ?? "paseo";
  return (target: AgentLinkTarget) => {
    const merged: AgentLinkTarget = {
      agentId: target.agentId,
      workspaceId: target.workspaceId ?? config?.workspaceId ?? null,
      serverId: target.serverId ?? config?.serverId ?? null,
      dashboardHost: target.dashboardHost ?? config?.dashboardHost ?? null,
    };
    if (scheme === "happier") return buildHappierAgentLink(merged);
    if (scheme === "https") return buildDashboardAgentLink(merged);
    return buildPaseoAgentLink(merged);
  };
}

/**
 * Primary deep-link for an envelope: the first `agentLinks` entry, falling
 * back to the historical `paseoLinks` entry. Null when the envelope carries
 * no link (e.g. older comments).
 */
export function primaryAgentLink(
  envelope: { agentLinks?: string[]; paseoLinks?: string[] } | null | undefined,
): string | null {
  if (!envelope) return null;
  return envelope.agentLinks?.[0] ?? envelope.paseoLinks?.[0] ?? null;
}

export interface ParseAgentEnvelopeOptions {
  /**
   * Custom link matcher for clients with their own URL template. Defaults to
   * {@link AGENT_LINK_PATTERN} (which already covers `paseo://`,
   * `happier://`, and dashboard `/agents/` URLs).
   */
  linkPattern?: RegExp;
}

export function parseAgentEnvelope(
  commentId: number,
  body: string | undefined | null,
  options?: ParseAgentEnvelopeOptions,
): AgentEnvelope | null {
  if (!body || typeof body !== "string") return null;
  const match = ENVELOPE_FOOTER_PATTERN.exec(body);
  if (!match) return null;
  const sessionTitle = match[1].trim();
  const agentShortId = match[2].trim();
  if (!sessionTitle || !agentShortId) return null;
  const model = match[3].trim() || null;
  const location = match[4].trim() || null;
  const postedAt = match[5].trim() || null;

  let repo: string | null = null;
  let branch: string | null = null;
  if (location) {
    const colonIdx = location.indexOf(":");
    if (colonIdx > 0 && colonIdx + 1 < location.length) {
      repo = location.slice(0, colonIdx);
      branch = location.slice(colonIdx + 1);
    } else {
      branch = location;
    }
  }

  const commitShas: string[] = [];
  SHA_PATTERN.lastIndex = 0;
  let shaMatch: RegExpExecArray | null;
  while ((shaMatch = SHA_PATTERN.exec(body)) !== null) {
    const sha = shaMatch[0].toLowerCase();
    if (!commitShas.includes(sha)) commitShas.push(sha);
  }

  const agentLinks: string[] = [];
  const configured = options?.linkPattern ?? AGENT_LINK_PATTERN;
  // Normalize to a fresh global matcher so custom (non-global) patterns
  // cannot infinite-loop and shared patterns keep no exec state.
  const flags = configured.flags.includes("g") ? configured.flags : `${configured.flags}g`;
  const matcher = new RegExp(configured.source, flags);
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = matcher.exec(body)) !== null) {
    const link = linkMatch[0];
    if (!agentLinks.includes(link)) agentLinks.push(link);
  }

  let serverId: string | null = null;
  for (const link of agentLinks) {
    const sMatch = AGENT_SERVER_PATTERN.exec(link);
    if (sMatch?.[1]) {
      serverId = sMatch[1];
      break;
    }
  }

  const result = {
    commentId,
    sessionTitle,
    agentShortId,
    model,
    repo,
    branch,
    postedAt,
    commitShas,
    agentLinks,
    // Deprecated alias: historical readers expect `paseoLinks`.
    paseoLinks: agentLinks,
    serverId,
  };
  const parsed = AgentEnvelopeSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export function formatAgentEnvelope(options: {
  sessionTitle: string;
  agentShortId: string;
  model?: string | null;
  location?: string | null;
  postedAt?: string | null;
}): string {
  const model = options.model ?? "unknown";
  const location = options.location ?? "unknown";
  const postedAt = options.postedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, " UTC");
  return `<sub>🤖 **${options.sessionTitle}** (\`${options.agentShortId}\`) · \`${model}\` · \`${location}\` · _${postedAt}_</sub>`;
}
