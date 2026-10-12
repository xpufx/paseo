import { AgentEnvelopeSchema, type AgentEnvelope } from "./schemas.js";

export const SHA_PATTERN = /\b[0-9a-f]{7,40}\b/g;
export const PASEO_LINK_PATTERN = /paseo:\/\/[^\s)>\]]+/g;
export const PASEO_SERVER_PATTERN = /paseo:\/\/h\/([^/\s]+)\/agent\//;

export const ENVELOPE_FOOTER_PATTERN =
  /<sub>\s*🤖\s*\*\*(.+?)\*\*\s*\(`([^`)]+)`\)\s*·\s*`([^`]+)`\s*·\s*`([^`]+)`\s*·\s*_([^_]+)_\s*<\/sub>/;

export function stripAgentEnvelopeFooter(body: string | undefined | null): string {
  if (!body || typeof body !== "string") return "";
  return body.replace(ENVELOPE_FOOTER_PATTERN, "").replace(/---\s*$/, "").trim();
}

export function parseAgentEnvelope(
  commentId: number,
  body: string | undefined | null,
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

  const paseoLinks: string[] = [];
  PASEO_LINK_PATTERN.lastIndex = 0;
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = PASEO_LINK_PATTERN.exec(body)) !== null) {
    const link = linkMatch[0];
    if (!paseoLinks.includes(link)) paseoLinks.push(link);
  }

  let serverId: string | null = null;
  for (const link of paseoLinks) {
    const sMatch = PASEO_SERVER_PATTERN.exec(link);
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
    paseoLinks,
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
