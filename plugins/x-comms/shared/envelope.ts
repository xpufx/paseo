import { z } from "zod";

/**
 * The x-comms wire envelope: a `[x-comms] ` prefixed JSON block stamped on
 * every cross-daemon message. Pure parsing with no UI imports so the
 * conversation derive and its tests run anywhere.
 */

export const ENVELOPE_OPEN = "<x-comms-message>";
export const ENVELOPE_CLOSE = "</x-comms-message>";
export const ENVELOPE_TAG_OPEN = ENVELOPE_OPEN;
export const ENVELOPE_TAG_CLOSE = ENVELOPE_CLOSE;
export const META_PREFIX = "[x-comms] ";

export const EnvelopeSchema = z.object({
  xComms: z.object({
    version: z.number(),
    type: z.string(),
    direction: z.enum(["incoming", "outgoing"]).optional(),
    sender: z.object({
      agentId: z.string().nullable(),
      agentName: z.string().nullable(),
      host: z.string().nullable(),
      daemonServerId: z.string().nullable(),
      cwd: z.string().nullable(),
    }),
    target: z.object({
      daemon: z.string().nullable(),
      agentId: z.string().nullable(),
    }),
    // This is the daemon's delivery key, not a conversation id.  It must be
    // retained when an outbox item is retried so Paseo can discard a duplicate
    // before it reaches the target agent.
    messageId: z.string().min(1).max(128).optional(),
    sentAt: z.string(),
  }),
});

export type CrossDaemonEnvelope = z.infer<typeof EnvelopeSchema>;

export type MessageDirection = "incoming" | "outgoing";

/**
 * Produce the version-6 wire envelope shared by every x-comms delivery route.
 * Keeping this browser-safe lets an interactive client send retain the same
 * attribution contract as the server and MCP routes.
 */
export function buildXCommsEnvelope(args: {
  sender: {
    agentId: string | null;
    agentName: string | null;
    host: string;
    daemonServerId: string | null;
    cwd: string | null;
  };
  target: { daemon: string | null; agentId: string | null };
  messageId?: string;
  sentAt: string;
}): string {
  return `${ENVELOPE_OPEN}${JSON.stringify({
    xComms: {
      version: 6,
      type: "x-comms.message",
      direction: "outgoing",
      sender: args.sender,
      target: args.target,
      ...(args.messageId ? { messageId: args.messageId } : {}),
      sentAt: args.sentAt,
    },
  })}${ENVELOPE_CLOSE}`;
}

/**
 * Viewer-relative direction. The wire envelope stamps direction "outgoing"
 * from the sender's side, so only a message from self counts as user-sent.
 */
export function viewerDirection(env: CrossDaemonEnvelope, viewerAgentId: string): MessageDirection {
  const senderId = env.xComms.sender.agentId;
  return senderId !== null && senderId === viewerAgentId ? "outgoing" : "incoming";
}

export interface CardSignal {
  direction: MessageDirection;
  userSent: boolean;
}

/**
 * Pure card signal: red is reserved for user-sent messages only. Peer and
 * agent arrivals render neutral. Never derive red from envelope defaults.
 */
export function cardSignal(env: CrossDaemonEnvelope, viewerAgentId: string): CardSignal {
  const direction = viewerDirection(env, viewerAgentId);
  return { direction, userSent: direction === "outgoing" };
}

/**
 * Collapsed preview shows this many lines. Measured overflow (via
 * onTextLayout) decides whether a Show more toggle appears at all.
 */
export const COLLAPSED_LINES = 3;

/**
 * Pure overflow rule for collapsible bodies: only bodies rendering more
 * lines than the collapsed preview get a toggle. Short messages never do.
 */
export function isOverflowing(lineCount: number, maxLines: number = COLLAPSED_LINES): boolean {
  return lineCount > maxLines;
}

/**
 * Splits a message body into its x-comms envelope (if present) and the
 * remaining human-visible text. Dual-parses v6 `<x-comms-message>...</x-comms-message>`
 * and legacy v5 `[x-comms] ` envelopes.
 */
export function parseEnvelope(text: string): { envelope: CrossDaemonEnvelope; body: string } | null {
  if (text.startsWith(ENVELOPE_OPEN)) {
    const closeIdx = text.indexOf(ENVELOPE_CLOSE, ENVELOPE_OPEN.length);
    if (closeIdx === -1) return null;
    const json = text.slice(ENVELOPE_OPEN.length, closeIdx).trim();
    const rest = text.slice(closeIdx + ENVELOPE_CLOSE.length);
    const body = rest.startsWith("\n\n") ? rest.slice(2).trim() : rest.trim();
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return null;
    }
    const parsed = EnvelopeSchema.safeParse(raw);
    if (!parsed.success) return null;
    return { envelope: parsed.data, body };
  }

  if (text.startsWith(META_PREFIX)) {
    const rest = text.slice(META_PREFIX.length).trimStart();
    const sep = rest.indexOf("\n\n");
    const json = sep === -1 ? rest : rest.slice(0, sep);
    const body = sep === -1 ? "" : rest.slice(sep + 2).trim();
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return null;
    }
    const parsed = EnvelopeSchema.safeParse(raw);
    if (!parsed.success) return null;
    return { envelope: parsed.data, body };
  }

  return null;
}
