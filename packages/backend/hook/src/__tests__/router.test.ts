import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { HookEventQueue } from "../server/queue.js";
import { handleHookIngress, handleQueueAdmin } from "../server/router.js";

describe("handleHookIngress", () => {
  const secret = "test-secret-12345";

  function forgejoSig(payload: string, sec: string): string {
    return createHmac("sha256", sec).update(payload).digest("hex");
  }

  it("normalizes a valid Forgejo webhook without secret", () => {
    const raw = JSON.stringify({
      action: "opened",
      issue: { number: 42 },
      repository: { full_name: "xpufx-org/paseo" },
      sender: { login: "okcode" },
    });
    const body = JSON.parse(raw);
    const res = handleHookIngress({ "x-forgejo-event": "issues" }, raw, body);

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.forge).toBe("forgejo");
    expect(res.event).toBe("issues");
    expect(res.normalized?.repository).toBe("xpufx-org/paseo");
    expect(res.normalized?.issueNumber).toBe(42);
    expect(res.normalized?.sender).toBe("okcode");
  });

  it("verifies HMAC signature when secret is provided", () => {
    const raw = JSON.stringify({
      action: "opened",
      issue: { number: 99 },
      repository: { full_name: "xpufx-org/paseo" },
    });
    const body = JSON.parse(raw);
    const validSig = `sha256=${forgejoSig(raw, secret)}`;

    const res = handleHookIngress(
      {
        "x-forgejo-event": "issues",
        "x-hub-signature-256": validSig,
      },
      raw,
      body,
      { secret },
    );

    expect(res.ok).toBe(true);
    expect(res.normalized?.issueNumber).toBe(99);
  });

  it("rejects invalid HMAC signature with 401", () => {
    const raw = JSON.stringify({ action: "opened" });
    const body = JSON.parse(raw);

    const res = handleHookIngress(
      {
        "x-forgejo-event": "issues",
        "x-hub-signature-256": "sha256=invalidhexsignature000000000000000000000000000000000000000000000000",
      },
      raw,
      body,
      { secret },
    );

    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error).toMatch(/Invalid webhook signature/);
  });

  it("handles GitHub and GitLab events appropriately", () => {
    const ghRaw = JSON.stringify({
      action: "closed",
      pull_request: { number: 10, head: { ref: "fix/branch" } },
      repository: { full_name: "octocat/hello-world" },
      sender: { login: "octocat" },
    });
    const ghBody = JSON.parse(ghRaw);
    const ghRes = handleHookIngress({ "x-github-event": "pull_request" }, ghRaw, ghBody);
    expect(ghRes.ok).toBe(true);
    expect(ghRes.forge).toBe("github");
    expect(ghRes.normalized?.pullRequestNumber).toBe(10);

    const glRaw = JSON.stringify({
      object_kind: "issue",
      project: { path_with_namespace: "group/project" },
      user: { username: "gitlab-user" },
    });
    const glBody = JSON.parse(glRaw);
    const glRes = handleHookIngress({ "x-gitlab-event": "Issue Hook" }, glRaw, glBody);
    expect(glRes.ok).toBe(true);
    expect(glRes.forge).toBe("gitlab");
    expect(glRes.normalized?.repository).toBe("group/project");
  });
});

describe("handleQueueAdmin", () => {
  it("handles GET /queues", () => {
    const queue = new HookEventQueue();
    const res = handleQueueAdmin("/queues", "GET", queue);
    expect(res.handled).toBe(true);
    expect(res.status).toBe(200);
    expect((res.data as any).state).toBe("idle");
    expect((res.data as any).pending).toBe(0);
  });

  it("handles POST /queues/pause and /queues/resume", () => {
    const queue = new HookEventQueue();
    const pauseRes = handleQueueAdmin("/queues/pause", "POST", queue);
    expect(pauseRes.handled).toBe(true);
    expect((pauseRes.data as any).ok).toBe(true);
    expect((pauseRes.data as any).state).toBe("paused");

    const resumeRes = handleQueueAdmin("/queues/resume", "POST", queue);
    expect(resumeRes.handled).toBe(true);
    expect((resumeRes.data as any).ok).toBe(true);
    expect((resumeRes.data as any).state).toBe("idle");
  });

  it("handles POST /queues/purge", async () => {
    const queue = new HookEventQueue();
    await queue.pause();
    queue.enqueue({
      id: "e-1",
      forge: "forgejo",
      action: "push",
      repository: "repo/a",
      sender: "user",
      timestamp: new Date().toISOString(),
      raw: {},
    });
    expect(queue.inspect().pending).toBe(1);

    const purgeRes = handleQueueAdmin("/queues/purge", "POST", queue);
    expect(purgeRes.handled).toBe(true);
    expect((purgeRes.data as any).purged).toBe(1);
    expect(queue.inspect().pending).toBe(0);
  });
});
