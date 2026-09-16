import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORGEJO_HOOK_PREFIX,
  forgejoWebhookCardSchema,
  forgejoWebhookItem,
  parseForgejoWebhookCard,
  parseForgejoWebhookEnvelope,
  parseForgejoWebhookSummary,
  subjectLinkUrl,
} from "./webhook.ts";
import { extractBareForgeIssueUrls } from "./issues.ts";

const HOOK_HEAD = "🔔 Forgejo webhook incoming";

function envelopeMessage(payload: unknown, body: string): string {
  return `${FORGEJO_HOOK_PREFIX}${JSON.stringify(payload)}\n\n${body}`;
}

const VALID_ENVELOPE = {
  forgejo: {
    version: 1,
    event: "issues",
    action: "opened",
    repo: "xpufx/paseo",
    repoUrl: "https://forge.mrs.aager.de/xpufx/paseo",
    sender: "octocat",
    subject: {
      kind: "issue",
      number: 178,
      title: "Render the incoming hook",
      url: "https://forge.mrs.aager.de/xpufx/paseo/issues/178",
    },
  },
};

const VALID_BODY = `${HOOK_HEAD} [issues:opened] xpufx/paseo#178 Render the incoming hook (by octocat) https://forge.mrs.aager.de/xpufx/paseo/issues/178`;

describe("parseForgejoWebhookEnvelope", () => {
  it("parses a valid v1 envelope and keeps the human body", () => {
    const parsed = parseForgejoWebhookEnvelope(envelopeMessage(VALID_ENVELOPE, VALID_BODY));
    assert.ok(parsed);
    assert.equal(parsed.envelope.forgejo.event, "issues");
    assert.equal(parsed.envelope.forgejo.subject?.number, 178);
    assert.equal(parsed.body, VALID_BODY);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseForgejoWebhookEnvelope(`${FORGEJO_HOOK_PREFIX}{not json}\n\nbody`), null);
  });

  it("returns null when the prefix is missing", () => {
    assert.equal(parseForgejoWebhookEnvelope(JSON.stringify(VALID_ENVELOPE)), null);
    assert.equal(parseForgejoWebhookEnvelope(VALID_BODY), null);
  });

  it("returns null when the JSON fails the schema", () => {
    assert.equal(parseForgejoWebhookEnvelope(`${FORGEJO_HOOK_PREFIX}{"other":1}\n\nbody`), null);
  });

  it("tolerates an envelope with no trailing body line", () => {
    const parsed = parseForgejoWebhookEnvelope(`${FORGEJO_HOOK_PREFIX}${JSON.stringify(VALID_ENVELOPE)}`);
    assert.ok(parsed);
    assert.equal(parsed.body, "");
  });
});

describe("parseForgejoWebhookSummary (today's plain line)", () => {
  it("parses an issue event with title and url", () => {
    const card = parseForgejoWebhookSummary(VALID_BODY);
    assert.ok(card);
    assert.equal(card.event, "issues");
    assert.equal(card.action, "opened");
    assert.equal(card.repo, "xpufx/paseo");
    assert.equal(card.sender, "octocat");
    assert.equal(card.subject?.kind, "issue");
    assert.equal(card.subject?.number, 178);
    assert.equal(card.subject?.title, "Render the incoming hook");
    assert.equal(card.subject?.url, "https://forge.mrs.aager.de/xpufx/paseo/issues/178");
  });

  it("parses an issue_comment comment anchor", () => {
    const card = parseForgejoWebhookSummary(
      `${HOOK_HEAD} [issue_comment:created] owner/repo#5 Nice (by alice) https://host/owner/repo/issues/5#issuecomment-99`,
    );
    assert.ok(card);
    assert.equal(card.subject?.kind, "issue_comment");
    assert.equal(card.subject?.commentId, 99);
  });

  it("parses a push ref and commit count", () => {
    const card = parseForgejoWebhookSummary(
      `${HOOK_HEAD} [push] owner/repo refs/heads/main 3 commit(s) by alice https://host/owner/repo`,
    );
    assert.ok(card);
    assert.equal(card.subject?.kind, "push");
    assert.equal(card.subject?.ref, "refs/heads/main");
    assert.equal(card.subject?.commits, 3);
    assert.equal(card.subject?.url, "https://host/owner/repo");
  });

  it("parses a ping test", () => {
    const card = parseForgejoWebhookSummary(`${HOOK_HEAD} (ping test) owner/repo (by alice)`);
    assert.ok(card);
    assert.equal(card.event, "ping");
    assert.equal(card.repo, "owner/repo");
    assert.equal(card.sender, "alice");
    assert.equal(card.subject, null);
  });

  it("parses an unknown event with the unknown-repo placeholder", () => {
    const card = parseForgejoWebhookSummary(
      `${HOOK_HEAD} [action_run_success] unknown repo (by unknown) https://host/owner/repo`,
    );
    assert.ok(card);
    assert.equal(card.event, "action_run_success");
    assert.equal(card.repo, "unknown repo");
    assert.equal(card.sender, "unknown");
  });

  it("returns null for non-hook chat", () => {
    assert.equal(parseForgejoWebhookSummary("hello world"), null);
    assert.equal(parseForgejoWebhookSummary(`prefix ${HOOK_HEAD} [issues:opened] a/b#1 x (by y)`), null);
  });
});

describe("parseForgejoWebhookCard source selection", () => {
  it("prefers the envelope when present", () => {
    const card = parseForgejoWebhookCard(envelopeMessage(VALID_ENVELOPE, VALID_BODY));
    assert.ok(card);
    assert.equal(card.subject?.title, "Render the incoming hook");
    assert.equal(card.version, 1);
  });

  it("falls back to the summary line", () => {
    const card = parseForgejoWebhookCard(VALID_BODY);
    assert.ok(card);
    assert.equal(card.event, "issues");
  });

  it("leaves non-hook messages unclaimed", () => {
    assert.equal(parseForgejoWebhookCard("just a normal message"), null);
    assert.equal(forgejoWebhookItem("just a normal message"), undefined);
  });
});

describe("subjectLinkUrl", () => {
  it("appends the comment anchor when only commentId is carried", () => {
    assert.equal(
      subjectLinkUrl({ kind: "issue_comment", url: "https://host/o/r/issues/5", commentId: 99 }),
      "https://host/o/r/issues/5#issuecomment-99",
    );
  });

  it("does not duplicate an anchor already present in the url", () => {
    assert.equal(
      subjectLinkUrl({
        kind: "issue_comment",
        url: "https://host/o/r/issues/5#issuecomment-99",
        commentId: 99,
      }),
      "https://host/o/r/issues/5#issuecomment-99",
    );
  });

  it("returns undefined without a url", () => {
    assert.equal(subjectLinkUrl({ kind: "issue", number: 1 }), undefined);
  });
});

describe("forgejo-webhook transformer is presentation-only", () => {
  it("never carries the raw message text into the card payload", () => {
    // Display schema has no raw-text field at all.
    assert.equal("body" in forgejoWebhookCardSchema.shape, false);

    const text = envelopeMessage(VALID_ENVELOPE, VALID_BODY);
    const card = parseForgejoWebhookCard(text);
    assert.ok(card);
    const serialized = JSON.stringify(card);
    assert.ok(!serialized.includes(VALID_BODY), "card must not echo the human line");
    assert.ok(!serialized.includes(FORGEJO_HOOK_PREFIX), "card must not echo the envelope");
  });

  it("produces the same card with or without the human line", () => {
    // The transformer output is derived from the envelope alone, so it does not
    // depend on stripping (or keeping) the source text. The host keeps the
    // original AgentTimelineItem for the agent; the transformer only supplies a
    // client-side PluginTimelineItem render target (PluginTimelineTransformerContribution
    // returns PluginTimelineItem[], it cannot rewrite the agent-visible message).
    const withBody = parseForgejoWebhookCard(envelopeMessage(VALID_ENVELOPE, VALID_BODY));
    const withoutBody = parseForgejoWebhookCard(
      `${FORGEJO_HOOK_PREFIX}${JSON.stringify(VALID_ENVELOPE)}`,
    );
    assert.ok(withBody && withoutBody);
    assert.deepEqual(withoutBody, withBody);
  });

  it("keeps the human line in the parsed envelope for the agent path", () => {
    const parsed = parseForgejoWebhookEnvelope(envelopeMessage(VALID_ENVELOPE, VALID_BODY));
    assert.ok(parsed);
    assert.equal(parsed.body, VALID_BODY);
  });

  it("does not render the raw body in the card component", () => {
    const candidates = [
      join(process.cwd(), "client/webhook-card.tsx"),
      join(process.cwd(), "plugins/forges/client/webhook-card.tsx"),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    assert.ok(path, `webhook-card.tsx not found from cwd ${process.cwd()}`);
    const source = readFileSync(path as string, "utf8");
    assert.ok(!source.includes("data.body"), "card component must not render the raw body");
  });
});

describe("forgejo-webhook transformer precedence over the linkifier", () => {
  it("claims a hook message even though it carries a bare forge URL", () => {
    const item = forgejoWebhookItem(VALID_BODY);
    assert.ok(item);
    assert.equal(item.items[0].kind, "forgejo-webhook");
    // The same text also contains a bare forge URL, so the linkifier matches too.
    assert.ok(extractBareForgeIssueUrls(VALID_BODY).length > 0);
  });

  it("wins first-match over the linkifier and leaves other messages to it", () => {
    const firstMatch = (text: string): { kind: string } | undefined => {
      const item = forgejoWebhookItem(text);
      if (item) return { kind: item.items[0].kind };
      return extractBareForgeIssueUrls(text).length > 0 ? { kind: "forge-issue-link" } : undefined;
    };

    const hook = firstMatch(VALID_BODY);
    assert.equal(hook?.kind, "forgejo-webhook");

    const nonHook = "linked issue https://forge.mrs.aager.de/xpufx/paseo/issues/178";
    assert.equal(forgejoWebhookItem(nonHook), undefined);
    assert.equal(firstMatch(nonHook)?.kind, "forge-issue-link");
  });

  it("registers the webhook transformer before the linkifier", () => {
    const candidates = [
      join(process.cwd(), "index.client.tsx"),
      join(process.cwd(), "plugins/forges/index.client.tsx"),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    assert.ok(path, `index.client.tsx not found from cwd ${process.cwd()}`);
    const source = readFileSync(path as string, "utf8");
    const webhookAt = source.indexOf("addTimelineTransformer(forgejoWebhookUserTransformer");
    const linkAt = source.indexOf("addTimelineTransformer(forgeLinkUserTransformer");
    assert.ok(webhookAt >= 0, "webhook transformer is registered");
    assert.ok(linkAt >= 0, "linkifier transformer is registered");
    assert.ok(webhookAt < linkAt, "webhook must register before the linkifier (first-match-wins)");
  });
});
