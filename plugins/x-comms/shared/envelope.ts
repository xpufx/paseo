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

/**
 * Envelope authentication. `xComms.auth` is an ed25519 signature over
 * `canonicalAuthPayload` (see below), made with the sending daemon's private
 * x-comms key. It exists because the wire envelope is otherwise plain text: any
 * agent can hand-write the tag and claim someone else's `sender.agentId`
 * (xpufx-org/paseo#594).
 *
 * The schema is deliberately permissive and the *trust decision* is strict. A
 * reader must never lose a message because the sender's auth block is corrupt or
 * written by a newer version with an algorithm it does not know — that would
 * turn a version skew into silent message loss. So anything shaped like an auth
 * block parses, and `verifyEnvelopeAuth` refuses to trust anything it does not
 * recognize.
 */
export const AUTH_VERSION = 1;
export const AUTH_ALG = "ed25519";

export const EnvelopeAuthSchema = z.object({
  v: z.number().int(),
  alg: z.string().max(64),
  keyId: z.string().max(256),
  sig: z.string().max(4096),
});

export type EnvelopeAuth = z.infer<typeof EnvelopeAuthSchema>;

/** The only `auth` shape this build knows how to check. */
export interface KnownEnvelopeAuth extends EnvelopeAuth {
  v: typeof AUTH_VERSION;
  alg: typeof AUTH_ALG;
}

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
    auth: EnvelopeAuthSchema.optional(),
  }),
});

export type CrossDaemonEnvelope = z.infer<typeof EnvelopeSchema>;

export type MessageDirection = "incoming" | "outgoing";

/**
 * Domain separator for the signed payload. Bumping it (or the field list) is a
 * breaking change to the wire contract and must roll the producer and consumer
 * together: a mixed pair then fails verification rather than silently passing.
 */
export const AUTH_PAYLOAD_CONTEXT = "x-comms/envelope-auth/v1";

/**
 * Signed field list, in order. Every attribution field a recipient acts on is
 * here; `direction` is excluded because it is stamped "outgoing" by every
 * sender and readers derive direction themselves. The prose body is excluded
 * too: this signature authenticates *who sent this*, not what they said, and
 * binding the body would make the signature depend on whitespace the
 * intermediate delivery path is free to normalize.
 */
const AUTH_FIELDS = [
  "version",
  "type",
  "sender.agentId",
  "sender.agentName",
  "sender.host",
  "sender.daemonServerId",
  "sender.cwd",
  "target.daemon",
  "target.agentId",
  "messageId",
  "sentAt",
] as const;

function authFieldValue(env: CrossDaemonEnvelope, field: (typeof AUTH_FIELDS)[number]): string {
  const x = env.xComms;
  switch (field) {
    case "version":
      return String(x.version);
    case "type":
      return x.type;
    case "sender.agentId":
      return x.sender.agentId ?? "";
    case "sender.agentName":
      return x.sender.agentName ?? "";
    case "sender.host":
      return x.sender.host ?? "";
    case "sender.daemonServerId":
      return x.sender.daemonServerId ?? "";
    case "sender.cwd":
      return x.sender.cwd ?? "";
    case "target.daemon":
      return x.target.daemon ?? "";
    case "target.agentId":
      return x.target.agentId ?? "";
    case "messageId":
      return x.messageId ?? "";
    case "sentAt":
      return x.sentAt;
  }
}

/**
 * The exact bytes an envelope's signature covers: a context line, then one
 * line per signed field in `AUTH_FIELDS` order. Deliberately not JSON — a JSON
 * canonicalization would depend on key order and escaping, so a re-serialized
 * but otherwise identical envelope would stop verifying. Newlines inside a
 * field value are rejected by the producers rather than escaped here.
 *
 * Pure string work with no crypto, so the client bundle and the shared tests can
 * both use it; `server/mesh-identity.ts` supplies the actual signer.
 */
export function canonicalAuthPayload(env: CrossDaemonEnvelope): string {
  return [AUTH_PAYLOAD_CONTEXT, ...AUTH_FIELDS.map((f) => authFieldValue(env, f))].join("\n");
}

/** Field values that must not contain a newline: a newline would forge a field boundary. */
export function authPayloadSafe(env: CrossDaemonEnvelope): boolean {
  return AUTH_FIELDS.every((f) => !authFieldValue(env, f).includes("\n"));
}

export type EnvelopeAuthStatus =
  /** Signature present and verified against the pinned key named by `keyId`. */
  | "verified"
  /** No `auth` field: the sender could not be authenticated. Never trust it. */
  | "missing"
  /** `auth` present but the signature did not verify, or the key is unknown. */
  | "invalid";

/**
 * Raw signature checker supplied by the caller: `(payload, sig) => boolean`.
 * Injected rather than imported so this module stays browser-safe; the daemon
 * passes a node:crypto-backed implementation (see server/mesh-identity.ts).
 *
 * `null` means "no key material available for this keyId" — a peer whose verify
 * key has not been fetched yet, or a direct host:port link with no
 * authenticated identity. That is an `invalid` verdict, not a pass.
 */
export type EnvelopeAuthVerifier = (
  payload: string,
  auth: KnownEnvelopeAuth,
) => boolean | null;

/**
 * Decide whether an envelope's claimed sender is authenticated.
 *
 * Only `verified` may be used for attribution. A missing or invalid auth means
 * the `sender` block is an unauthenticated assertion by whoever typed the text,
 * and treating it as a peer identity is exactly the #594 forgery.
 */
export function verifyEnvelopeAuth(
  env: CrossDaemonEnvelope,
  verify: EnvelopeAuthVerifier,
): EnvelopeAuthStatus {
  const auth = env.xComms.auth;
  if (!auth) return "missing";
  if (auth.v !== AUTH_VERSION || auth.alg !== AUTH_ALG) return "invalid";
  if (!auth.keyId || !auth.sig) return "invalid";
  if (!authPayloadSafe(env)) return "invalid";
  return verify(canonicalAuthPayload(env), auth as KnownEnvelopeAuth) === true ? "verified" : "invalid";
}

/** Signs the canonical payload and returns the wire `auth` object. */
export type EnvelopeAuthSigner = (payload: string) => KnownEnvelopeAuth;

/**
 * Produce the version-6 wire envelope shared by every x-comms delivery route.
 * Keeping this browser-safe lets an interactive client send retain the same
 * attribution contract as the server and MCP routes.
 *
 * `signer` is supplied by the trusted send path (the plugin server or the MCP
 * server), never by the agent: it is what makes the `sender` block an assertion
 * the receiver can check. Omitting it produces an unsigned envelope, which is
 * legal on the wire but never attributable (#594).
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
  signer?: EnvelopeAuthSigner;
}): string {
  const xComms = {
    version: 6,
    type: "x-comms.message",
    direction: "outgoing" as const,
    sender: args.sender,
    target: args.target,
    ...(args.messageId ? { messageId: args.messageId } : {}),
    sentAt: args.sentAt,
  };
  // Sign over the pre-auth object: `auth` is optional in the schema, so this
  // shape is a valid envelope, and `auth` is never part of its own signature.
  const auth = args.signer ? args.signer(canonicalAuthPayload({ xComms })) : undefined;
  return `${ENVELOPE_OPEN}${JSON.stringify({
    xComms: { ...xComms, ...(auth ? { auth } : {}) },
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
