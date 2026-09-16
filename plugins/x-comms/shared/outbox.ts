import { z } from "zod";

/**
 * Shared contract for the outbox expiry notice. The daemon appends one of
 * these to the sender's local timeline when a held message expires; the client
 * registers a renderer for it. Kept out of the wire envelope on purpose: the
 * notice is local to the sender's daemon (see #12 — no wire change).
 */

export const OUTBOX_NOTICE_KIND = "x-comms-outbox-notice";
export const OUTBOX_NOTICE_VERSION = 1;

export const OutboxNoticeSchema = z.object({
  daemon: z.string(),
  agentId: z.string(),
  reason: z.string(),
  attempts: z.number(),
  heldForMs: z.number(),
});

export type OutboxNotice = z.infer<typeof OutboxNoticeSchema>;
