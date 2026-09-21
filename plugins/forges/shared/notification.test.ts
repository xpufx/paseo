import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  FORGEJO_DIGEST_PREFIX,
  forgejoNotificationCardSchema,
  forgejoNotificationItem,
} from "./notification.ts";

const digest = `${FORGEJO_DIGEST_PREFIX} forge.example.com/owner/repo#294 Publish demo (3 events)`;

describe("Forgejo digest notification timeline item", () => {
  it("converts a host notification into the typed Forgejo card", () => {
    const transformed = forgejoNotificationItem({ level: "info", message: digest });
    assert.ok(transformed);
    assert.equal(transformed.items[0].type, "plugin");
    assert.equal(transformed.items[0].kind, "forgejo-notification");
    assert.deepEqual(forgejoNotificationCardSchema.parse(transformed.items[0].data), {
      level: "info",
      message: digest,
    });
  });

  it("preserves the notification level for warning and error presentation", () => {
    for (const level of ["warning", "error"] as const) {
      const transformed = forgejoNotificationItem({ level, message: digest });
      assert.equal(transformed?.items[0].data.level, level);
    }
  });

  it("leaves unrelated host notifications to their existing renderer", () => {
    assert.equal(
      forgejoNotificationItem({ level: "warning", message: "The agent is waiting for permission." }),
      undefined,
    );
  });

  it("reproduces the host rejection for notification transformer queries", () => {
    const registerTimelineTransformer = (contribution: { id: string; query: { itemType: string } }) => {
      if (contribution.query.itemType === "notification") {
        throw new Error(`Timeline transformer ${contribution.id} has invalid item type: ${contribution.query.itemType}`);
      }
    };

    assert.throws(
      () => registerTimelineTransformer({ id: "forgejo-notification", query: { itemType: "notification" } }),
      /Timeline transformer forgejo-notification has invalid item type: notification/,
    );
  });

  it("registers the digest renderer without querying host notifications", () => {
    const candidates = [
      join(process.cwd(), "index.client.tsx"),
      join(process.cwd(), "plugins/forges/index.client.tsx"),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    assert.ok(path, "index.client.tsx not found");
    const source = readFileSync(path as string, "utf8");
    assert.match(source, /addTimelineRenderer\(forgejoNotificationRenderer\)/);
    assert.doesNotMatch(source, /addTimelineTransformer\(forgejoNotificationTransformer\)/);
    assert.doesNotMatch(source, /forgejoNotificationTransformer/);

    const cardSource = readFileSync(join(dirname(path as string), "client", "notification-card.tsx"), "utf8");
    assert.doesNotMatch(cardSource, /itemType:\s*["']notification["']/);
  });
});
