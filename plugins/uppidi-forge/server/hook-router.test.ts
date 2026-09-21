import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  normalizeRepoKey,
  keyFromPayload,
  isFrontDeskEvent,
  isBypassEvent,
  formatWebhookMessage,
  forgejoEnvelope,
  summarize,
  stableId,
  HookRouter,
  startHookRouter,
} from "./hook-router.js";

describe("hook-router payload and key utilities", () => {
  it("normalizes repo URLs to canonical key format", () => {
    assert.equal(
      normalizeRepoKey("https://forge.mrs.uppidi.com/xpufx-org/paseo.git"),
      "forge.mrs.uppidi.com/xpufx-org/paseo",
    );
    assert.equal(
      normalizeRepoKey("git@forge.mrs.uppidi.com:xpufx-org/paseo.git"),
      "forge.mrs.uppidi.com/xpufx-org/paseo",
    );
    assert.equal(
      normalizeRepoKey("ssh://git@forge.mrs.uppidi.com:222/xpufx-org/paseo.git"),
      "forge.mrs.uppidi.com/xpufx-org/paseo",
    );
    assert.equal(normalizeRepoKey(""), null);
    assert.equal(normalizeRepoKey(null as any), null);
  });

  it("extracts repository key from various webhook payload structures", () => {
    assert.equal(
      keyFromPayload({
        repository: { html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo" },
      }),
      "forge.mrs.uppidi.com/xpufx-org/paseo",
    );
    assert.equal(
      keyFromPayload({
        repository: { clone_url: "git@forge.mrs.uppidi.com:xpufx-org/aur-automation.git" },
      }),
      "forge.mrs.uppidi.com/xpufx-org/aur-automation",
    );
    assert.equal(
      keyFromPayload({
        run: { repository: { ssh_url: "ssh://git@forge.mrs.uppidi.com:222/xpufx-org/2fado.git" } },
      }),
      "forge.mrs.uppidi.com/xpufx-org/2fado",
    );
    assert.equal(
      keyFromPayload({
        repository: { full_name: "xpufx-org/platform" },
      }),
      "forge.mrs.uppidi.com/xpufx-org/platform",
    );
    assert.equal(keyFromPayload({}), null);
    assert.equal(keyFromPayload(null), null);
  });

  it("identifies frontdesk events correctly", () => {
    assert.equal(isFrontDeskEvent({ label: { name: "attention/frontdesk" } }), true);
    assert.equal(isFrontDeskEvent({ label: { name: "attention/2-user" } }), true);
    assert.equal(isFrontDeskEvent({ comment: { body: "Hey /frontdesk please check this" } }), true);
    assert.equal(isFrontDeskEvent({ comment: { body: "Just a regular comment" } }), false);
    assert.equal(isFrontDeskEvent({ label: { name: "state/1-wip" } }), false);
  });

  it("identifies bypass events correctly", () => {
    assert.equal(isBypassEvent("issues", { label: { name: "priority/0-sos" } }), true);
    assert.equal(isBypassEvent("issues", { label: { name: "flag/stop-work" } }), true);
    assert.equal(isBypassEvent("issues", { label: { name: "attention/1-triager" } }), true);
    assert.equal(isBypassEvent("issue_comment", { comment: { body: "/orchestrator restart" } }), true);
    assert.equal(isBypassEvent("issue_comment", { comment: { body: "/hold this for now" } }), true);
    assert.equal(isBypassEvent("issue_comment", { comment: { body: "/rework required" } }), true);
    assert.equal(isBypassEvent("issue_comment", { comment: { body: "Working on it" } }), false);
  });

  it("formats webhook message and envelope consistently", () => {
    const payload = {
      repository: { full_name: "xpufx-org/paseo", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo" },
      sender: { login: "testuser" },
      issue: { number: 380, title: "Test issue", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/380" },
      action: "opened",
    };

    const env = forgejoEnvelope("issues", payload);
    assert.equal((env as any).forgejo.event, "issues");
    assert.equal((env as any).forgejo.action, "opened");
    assert.equal((env as any).forgejo.repo, "xpufx-org/paseo");
    assert.equal((env as any).forgejo.sender, "testuser");
    assert.equal((env as any).forgejo.subject.number, 380);

    const summary = summarize("issues", payload);
    assert.match(summary, /🔔 Forgejo webhook incoming \[issues:opened\] xpufx-org\/paseo#380 "Test issue"/);

    const fullMessage = formatWebhookMessage("issues", payload);
    assert.ok(fullMessage.startsWith("[forgejo-hook] {"));
    assert.ok(fullMessage.includes("🔔 Forgejo webhook incoming"));
  });

  it("generates deterministic stableId", () => {
    const id1 = stableId("repo/key", "message 1");
    const id2 = stableId("repo/key", "message 1");
    const id3 = stableId("repo/key", "message 2");
    assert.equal(id1, id2);
    assert.notEqual(id1, id3);
    assert.equal(id1.length, 16);
  });
});

describe("hook-router in-memory queue and file persistence", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-test-hook-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createMockServer(): PluginServerContext {
    return {
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;
  }

  it("persists enqueued messages to disk in JSON format and reloads on startup", () => {
    const server = createMockServer();
    const router1 = new HookRouter(server, { queueDir, stateDir, port: 0 });

    const key = "forge.mrs.uppidi.com/xpufx-org/test";
    const entry = router1.enqueue(key, "Test message payload");
    assert.equal(entry.key, key);
    assert.equal(router1.getQueue(key).length, 1);

    // Verify file exists on disk
    const expectedFile = join(queueDir, "forge.mrs.uppidi.com_xpufx-org_test.json");
    assert.ok(existsSync(expectedFile), "Queue JSON file should exist on disk");

    const fileContent = JSON.parse(readFileSync(expectedFile, "utf8"));
    assert.ok(Array.isArray(fileContent));
    assert.equal(fileContent[0].id, entry.id);
    assert.equal(fileContent[0].msg, "Test message payload");

    // Start another router pointing to the same queueDir and verify it reloads
    const router2 = new HookRouter(server, { queueDir, stateDir, port: 0 });
    const loadedQueue = router2.getQueue(key);
    assert.equal(loadedQueue.length, 1);
    assert.equal(loadedQueue[0].id, entry.id);
  });

  it("manages pause and resume states", () => {
    const server = createMockServer();
    const router = new HookRouter(server, { queueDir, stateDir, port: 0 });
    const key = "test/repo";

    assert.equal(router.isPaused(key), false);
    router.pause(key);
    assert.equal(router.isPaused(key), true);
    assert.deepEqual(router.pause(key), [key]);

    router.resume(key);
    assert.equal(router.isPaused(key), false);
  });

  it("prunes queue depth when exceeding capacity", () => {
    const server = createMockServer();
    const router = new HookRouter(server, { queueDir, stateDir, port: 0 });
    const key = "test/prune";

    for (let i = 0; i < 60; i++) {
      router.enqueue(key, `Message ${i}`);
    }

    const queue = router.getQueue(key);
    assert.equal(queue.length, 50);
    const overview = router.getQueuesOverview() as any;
    const queueItem = overview.queues.find((q: any) => q.key === key);
    assert.equal(queueItem.dropped, 10);
  });
});

describe("hook-router HTTP server endpoints", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let router: HookRouter;
  let stopRouter: () => Promise<void>;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-http-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");

    const server = {
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    router = new HookRouter(server, { queueDir, stateDir, port: 0 });
    await router.start();
    stopRouter = () => router.stop();
  });

  afterEach(async () => {
    if (stopRouter) {
      await stopRouter();
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("responds to GET /health", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "healthy");
    assert.equal(body.service, "uppidi-forge-hook-router");
  });

  it("responds to GET /status", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "uppidi-forge-hook-router");
    assert.equal(typeof body.totalQueued, "number");
  });

  it("responds to GET /queues", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/queues`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.queues));
  });

  it("handles ping event on POST /forgejo", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/forgejo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forgejo-Event": "ping",
      },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.ping, true);
  });

  it("receives webhook on POST /forgejo and enqueues payload", async () => {
    const payload = {
      repository: { html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo" },
      sender: { login: "testuser" },
      issue: { number: 380, title: "Test webhook" },
      action: "commented",
    };

    const res = await fetch(`http://127.0.0.1:${router.port}/forgejo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forgejo-Event": "issue_comment",
      },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.queued, true);
    assert.equal(body.key, "forge.mrs.uppidi.com/xpufx-org/paseo");

    const queue = router.getQueue("forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(queue.length, 1);
  });

  it("pauses, resumes, and drains queues via POST endpoints", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const encodedKey = encodeURIComponent(key);

    // Pause
    const pauseRes = await fetch(`http://127.0.0.1:${router.port}/queues/${encodedKey}/pause`, {
      method: "POST",
    });
    assert.equal(pauseRes.status, 200);
    assert.equal(router.isPaused(key), true);

    // Resume
    const resumeRes = await fetch(`http://127.0.0.1:${router.port}/queues/${encodedKey}/resume`, {
      method: "POST",
    });
    assert.equal(resumeRes.status, 200);
    assert.equal(router.isPaused(key), false);

    // Drain
    const drainRes = await fetch(`http://127.0.0.1:${router.port}/queues/${encodedKey}/drain`, {
      method: "POST",
    });
    assert.equal(drainRes.status, 200);
    const drainBody = await drainRes.json();
    assert.equal(drainBody.ok, true);
  });
});

describe("hook-router in-process dispatch and event-driven draining", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-dispatch-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("holds messages when agent is busy, then drains immediately on agent.turn_ended", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const targetAgentId = "agent-orchestrator-123";

    let agentStatus: "running" | "idle" = "running";
    const sentMessages: Array<{ text: string; options: any }> = [];

    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, targetAgentId);
          return {
            current: () => ({ id, status: agentStatus, activeTurn: agentStatus === "running" ? "turn-1" : null }),
            refresh: async () => ({ agent: { id, status: agentStatus, activeTurn: agentStatus === "running" ? "turn-1" : null } }),
            send: async (text: string, options: any) => {
              sentMessages.push({ text, options });
            },
          };
        },
      },
    } as any;

    let turnEndedHandler: ((event: any, context: any) => Promise<void>) | null = null;
    const mockServer = {
      paseo: mockPaseo,
      on: (name: string, handler: any) => {
        if (name === "agent.turn_ended") {
          turnEndedHandler = handler;
        }
        return () => {};
      },
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    const router = new HookRouter(mockServer, { queueDir, stateDir, port: 0 });
    // Write orchestrator record for the repo key
    router.writeOrchestrator(key, targetAgentId);

    // Enqueue message while agent is busy
    router.enqueue(key, "Prompt to orchestrator");

    // Allow async drain check to execute
    await new Promise((r) => setTimeout(r, 20));

    // Agent was running, so send should NOT have been called yet
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(key).length, 1);

    // Agent finishes turn!
    agentStatus = "idle";
    assert.ok(turnEndedHandler, "turnEndedHandler should have been registered");
    const handlerToCall = turnEndedHandler as any;
    await handlerToCall({ agent: { id: targetAgentId } }, { paseo: mockPaseo });

    // Allow async drain to complete
    await new Promise((r) => setTimeout(r, 20));

    // Message should now have been dispatched via in-process send with steer: true!
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].text, "Prompt to orchestrator");
    assert.equal(sentMessages[0].options?.steer, true);
    assert.equal(router.getQueue(key).length, 0);
  });

  it("routes frontdesk events to frontdesk agent", async () => {
    const frontDeskAgentId = "agent-frontdesk-456";
    const sentMessages: string[] = [];

    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, frontDeskAgentId);
          return {
            current: () => ({ id, status: "idle", activeTurn: null }),
            send: async (text: string) => {
              sentMessages.push(text);
            },
          };
        },
      },
    } as any;

    const mockServer = {
      paseo: mockPaseo,
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    const router = new HookRouter(mockServer, { queueDir, stateDir, port: 0 });
    router.writeFrontDesk(frontDeskAgentId);

    router.enqueue("frontdesk", "Front desk task");

    await new Promise((r) => setTimeout(r, 20));

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0], "Front desk task");
    assert.equal(router.getQueue("frontdesk").length, 0);
  });

  it("startHookRouter provides clean teardown", async () => {
    const mockServer = {
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    const stop = startHookRouter(mockServer, { queueDir, stateDir, port: 0 });
    assert.equal(typeof stop, "function");
    await stop();
  });
});
