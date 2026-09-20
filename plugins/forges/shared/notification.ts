import { z } from "zod";

/** The notification emitted by the Forgejo digest worker. */
export const FORGEJO_DIGEST_PREFIX = "🔔 Forgejo digest";

export const forgejoNotificationCardSchema = z.object({
  level: z.enum(["info", "warning", "error"]),
  message: z.string(),
});

export type ForgejoNotificationCardData = z.infer<typeof forgejoNotificationCardSchema>;

/**
 * Creates a presentation-only card for Forgejo digest notifications. Other
 * host notifications deliberately pass through to the host renderer: this
 * plugin owns the digest format, not the notification timeline type itself.
 */
export function forgejoNotificationItem(item: {
  level: ForgejoNotificationCardData["level"];
  message: string;
}) {
  if (!item.message.trimStart().startsWith(FORGEJO_DIGEST_PREFIX)) return undefined;
  return {
    items: [
      {
        type: "plugin" as const,
        kind: "forgejo-notification",
        version: 1,
        data: { level: item.level, message: item.message },
      },
    ],
  };
}
