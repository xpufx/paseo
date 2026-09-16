import { z } from "zod";

/**
 * The Forgejo webhook wire envelope: a `[forgejo-hook] ` prefixed JSON block
 * (xpufx/platform#2) followed by a blank line and the human `summarize()` line.
 * Pure parsing with no UI imports so the timeline transformer and its tests run
 * anywhere. Until the hook emits the envelope we also recognize today's
 * plain summary line and normalize both sources to one card shape.
 */

export const FORGEJO_HOOK_PREFIX = "[forgejo-hook] ";

export const ForgejoSubjectSchema = z.object({
  kind: z.string(),
  number: z.number().optional(),
  title: z.string().optional(),
  url: z.string().optional(),
  commentId: z.number().optional(),
  ref: z.string().optional(),
  commits: z.number().optional(),
});

export const ForgejoEnvelopeSchema = z.object({
  forgejo: z.object({
    version: z.number(),
    event: z.string(),
    action: z.string().default(""),
    repo: z.string(),
    repoUrl: z.string().optional(),
    sender: z.string(),
    subject: ForgejoSubjectSchema.optional(),
  }),
});

export type ForgejoEnvelope = z.infer<typeof ForgejoEnvelopeSchema>;
export type ForgejoSubject = z.infer<typeof ForgejoSubjectSchema>;

/**
 * Normalized card data shared by the envelope and summary-line paths. This is a
 * display-only shape: every field the wire envelope carries is mapped here, and
 * the raw message text is deliberately absent. The transformer never rewrites
 * the source `AgentTimelineItem`, so the human line stays in the agent's
 * context (see `PluginTimelineTransformerContribution`).
 */
export const forgejoWebhookCardSchema = z.object({
  event: z.string(),
  action: z.string(),
  repo: z.string(),
  repoUrl: z.string().optional(),
  sender: z.string(),
  subject: ForgejoSubjectSchema.nullable(),
  version: z.number().optional(),
});

export type ForgejoWebhookCardData = z.infer<typeof forgejoWebhookCardSchema>;

/**
 * The exact target a subject title should link to. Issue/PR comments arrive
 * with the anchor in the URL from the summary line but as a separate
 * `commentId` in the envelope, so append the anchor when it is missing.
 */
export function subjectLinkUrl(subject: ForgejoSubject): string | undefined {
  if (!subject.url) return undefined;
  if (subject.commentId != null && !subject.url.includes(`#issuecomment-${subject.commentId}`)) {
    return `${subject.url}#issuecomment-${subject.commentId}`;
  }
  return subject.url;
}

/**
 * Splits an envelope-stamped message into its structured envelope and the
 * remaining human text. The prefix is the signal we render on; malformed JSON
 * or a payload that fails the schema returns null so callers fall back to the
 * summary parser.
 */
export function parseForgejoWebhookEnvelope(
  text: string,
): { envelope: ForgejoEnvelope; body: string } | null {
  if (typeof text !== "string" || !text.startsWith(FORGEJO_HOOK_PREFIX)) return null;
  const rest = text.slice(FORGEJO_HOOK_PREFIX.length).trimStart();
  const sep = rest.indexOf("\n\n");
  const json = sep === -1 ? rest : rest.slice(0, sep);
  const body = sep === -1 ? "" : rest.slice(sep + 2).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = ForgejoEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { envelope: parsed.data, body };
}

const HOOK_HEAD = "🔔 Forgejo webhook incoming";

function subjectKindForEvent(event: string): string {
  if (event === "issues") return "issue";
  if (event === "issue_comment" || event === "pull_request" || event === "push") return event;
  return "unknown";
}

function commentIdFromUrl(url: string | undefined): number | undefined {
  if (!url) return undefined;
  const match = /#issuecomment-(\d+)/.exec(url);
  return match ? Number(match[1]) : undefined;
}

/**
 * Parse today's plain summary line
 * (`🔔 Forgejo webhook incoming [event] repo (by sender) url`) into the same
 * card shape as the envelope. Returns null for anything that is not a hook
 * message, leaving non-hook chat untouched.
 */
export function parseForgejoWebhookSummary(text: string): ForgejoWebhookCardData | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith(HOOK_HEAD)) return null;
  const rest = trimmed.slice(HOOK_HEAD.length).trim();

  const ping = /^\(ping test\)\s+(.+?)\s+\(by\s+(.+?)\)\s*$/.exec(rest);
  if (ping) {
    return {
      event: "ping",
      action: "",
      repo: ping[1].trim(),
      sender: ping[2].trim(),
      subject: null,
    };
  }

  const bracket = /^\[([^\]\s:]+)(?::([^\]]*))?\]\s+([\s\S]+)$/.exec(rest);
  if (!bracket) return null;
  const event = bracket[1].trim();
  const action = (bracket[2] ?? "").trim();
  const tail = bracket[3].trim();

  const base = { event, action, sender: "", subject: null as ForgejoSubject | null };

  if (event === "push") {
    const push = /^(.*?)\s+(\d+)\s+commit\(s\)\s+by\s+(.+?)(?:\s+(\S+))?$/.exec(tail);
    if (!push) return null;
    const [repo, ...refParts] = push[1].trim().split(/\s+/);
    const commits = Number(push[2]);
    const sender = push[3].trim();
    const url = push[4];
    return {
      ...base,
      repo,
      sender,
      ...(url ? { repoUrl: url } : {}),
      subject: {
        kind: "push",
        commits,
        ...(refParts.length ? { ref: refParts.join(" ") } : {}),
        ...(url ? { url } : {}),
      },
    };
  }

  const issue = /^(.+?)#(\d+|\?)(?:\s+(.*?))?\s*\(by\s+(.+?)\)(?:\s+(\S+))?$/.exec(tail);
  if (issue) {
    const number = issue[2] === "?" ? undefined : Number(issue[2]);
    const title = (issue[3] ?? "").trim();
    const url = issue[5];
    return {
      ...base,
      repo: issue[1].trim(),
      sender: issue[4].trim(),
      ...(url ? { repoUrl: url } : {}),
      subject: {
        kind: subjectKindForEvent(event),
        ...(number != null ? { number } : {}),
        ...(title ? { title } : {}),
        ...(url ? { url } : {}),
        ...(commentIdFromUrl(url) != null ? { commentId: commentIdFromUrl(url) } : {}),
      },
    };
  }

  const generic = /^(.+?)\s+\(by\s+(.+?)\)(?:\s+(\S+))?$/.exec(tail);
  if (!generic) return null;
  const url = generic[3];
  return {
    ...base,
    repo: generic[1].trim(),
    sender: generic[2].trim(),
    ...(url ? { repoUrl: url } : {}),
    subject: null,
  };
}

function envelopeToCard(envelope: ForgejoEnvelope): ForgejoWebhookCardData {
  const { forgejo } = envelope;
  return {
    event: forgejo.event,
    action: forgejo.action,
    repo: forgejo.repo,
    ...(forgejo.repoUrl ? { repoUrl: forgejo.repoUrl } : {}),
    sender: forgejo.sender,
    subject: forgejo.subject ?? null,
    version: forgejo.version,
  };
}

/** Normalize either the v1 envelope or today's summary line to card data. */
export function parseForgejoWebhookCard(text: string): ForgejoWebhookCardData | null {
  const stamped = parseForgejoWebhookEnvelope(text);
  if (stamped) return envelopeToCard(stamped.envelope);
  return parseForgejoWebhookSummary(text);
}

/**
 * Build the single plugin timeline item for a hook message, or undefined so
 * earlier transformers leave non-hook messages to the next claimer.
 */
export function forgejoWebhookItem(text: string) {
  const data = parseForgejoWebhookCard(text);
  if (!data) return undefined;
  return {
    items: [{ type: "plugin" as const, kind: "forgejo-webhook", version: 1, data }],
  };
}
