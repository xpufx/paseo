import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
  appendHookLog,
  getHookLogs,
  clearHookLogs,
  getActiveHookRouter,
  setActiveHookRouter,
  getAvailableNetworkInterfaces,
  getRouterConfigPath,
  loadRouterConfig,
  saveRouterConfig,
  configureHookService,
  getHookServiceStatus,
  getFleetRosterInfo,
  eventKind,
  eventHash,
  sosStateOf,
  formatDigest,
  bufferKey,
  FORGEJO_DIGEST_PREFIX,
  envelopeAgentId,
  type CoalesceEvent,
  type WatchdogAgent,
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
    assert.equal(isFrontDeskEvent({ label: { name: "attention/user" } }), true);
    assert.equal(isFrontDeskEvent({ label: { name: "attention:user" } }), true);
    assert.equal(isFrontDeskEvent({ label: { name: "ATTENTION/2-USER" } }), true);
    assert.equal(isFrontDeskEvent({ comment: { body: "Hey /frontdesk please check this" } }), true);
    assert.equal(isFrontDeskEvent({ comment: { body: "Just a regular comment" } }), false);
    assert.equal(isFrontDeskEvent({ label: { name: "state/1-wip" } }), false);
  });

  it("identifies bypass events correctly", () => {
    assert.equal(isBypassEvent("issues", { label: { name: "priority/0-sos" } }), true);
    assert.equal(isBypassEvent("issues", { label: { name: "flag/stop-work" } }), true);
    assert.equal(isBypassEvent("issues", { label: { name: "attention/1-triager" } }), true);
    assert.equal(isBypassEvent("issues", { label: { name: "attention/user" } }), true);
    assert.equal(isBypassEvent("issues", { label: { name: "attention:user" } }), true);
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
    assert.match(summary, /🔔 Forgejo webhook incoming \[issues:opened\] xpufx-org\/paseo#380 Test issue \(by testuser\)/);

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
  let prevNodeEnv: string | undefined;

  beforeEach(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
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
    if (prevNodeEnv !== undefined) {
      process.env.NODE_ENV = prevNodeEnv;
    } else {
      delete process.env.NODE_ENV;
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
    assert.equal(body.service, "uppidi-fleet-hook-router");
  });

  it("responds to GET /status", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, "uppidi-fleet-hook-router");
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

  it("handles GET and POST /frontdesk", async () => {
    // Initially null or empty
    const getRes1 = await fetch(`http://127.0.0.1:${router.port}/frontdesk`);
    assert.equal(getRes1.status, 200);
    const getBody1 = await getRes1.json();
    assert.equal(getBody1.agentId, null);

    // Register front desk
    const postRes = await fetch(`http://127.0.0.1:${router.port}/frontdesk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "test-fd-agent-1" }),
    });
    assert.equal(postRes.status, 200);
    const postBody = await postRes.json();
    assert.equal(postBody.ok, true);
    assert.equal(postBody.agentId, "test-fd-agent-1");

    // Verify GET reflects registered agent
    const getRes2 = await fetch(`http://127.0.0.1:${router.port}/frontdesk`);
    assert.equal(getRes2.status, 200);
    const getBody2 = await getRes2.json();
    assert.equal(getBody2.agentId, "test-fd-agent-1");
  });

  it("handles GET and POST /orchestrator", async () => {
    const postRes = await fetch(`http://127.0.0.1:${router.port}/orchestrator`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "xpufx-org/test-repo", agentId: "test-orch-agent-1" }),
    });
    assert.equal(postRes.status, 200);
    const postBody = await postRes.json();
    assert.equal(postBody.ok, true);
    assert.equal(postBody.repo, "xpufx-org/test-repo");

    const getRes = await fetch(`http://127.0.0.1:${router.port}/orchestrators?repo=xpufx-org/test-repo`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.ok, true);
    assert.equal(getBody.orchestrator.agentId, "test-orch-agent-1");
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

    // Routine webhook message should now have been dispatched via in-process send with steer: false (#536)
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].text, "Prompt to orchestrator");
    assert.equal(sentMessages[0].options?.steer, false);
    assert.equal(router.getQueue(key).length, 0);
  });

  it("preempts busy agent immediately and delivers with steer: true on SOS emergency (#536)", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const targetAgentId = "agent-orchestrator-sos";

    const sentMessages: Array<{ text: string; options: any }> = [];

    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, targetAgentId);
          return {
            current: () => ({ id, status: "running", activeTurn: { id: "turn-1" } }),
            send: async (text: string, options: any) => {
              sentMessages.push({ text, options });
            },
          };
        },
      },
    } as any;

    const mockServer = {
      paseo: mockPaseo,
      events: { on: () => () => {} },
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    const router = new HookRouter(mockServer, { queueDir, stateDir, port: 0 });

    router.writeOrchestrator(key, targetAgentId);

    // Enqueue an SOS emergency message while agent is busy
    router.enqueue(key, "EMERGENCY STOP", true);

    await new Promise((r) => setTimeout(r, 20));

    // SOS must preempt immediately and pass steer: true
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].text, "EMERGENCY STOP");
    assert.equal(sentMessages[0].options?.steer, true);
    assert.equal(router.getQueue(key).length, 0);
  });

  it("batches multiple queued messages into a single coalesced digest prompt (#536)", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const targetAgentId = "agent-orchestrator-batch";

    let agentStatus: "running" | "idle" = "running";
    const sentMessages: Array<{ text: string; options: any }> = [];
    let turnEndedHandler: any = null;

    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, targetAgentId);
          return {
            current: () => ({ id, status: agentStatus, activeTurn: agentStatus === "running" ? { id: "turn-1" } : null }),
            send: async (text: string, options: any) => {
              sentMessages.push({ text, options });
            },
          };
        },
      },
    } as any;

    const mockServer = {
      paseo: mockPaseo,
      events: { on: () => () => {} },
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

    router.writeOrchestrator(key, targetAgentId);

    // Enqueue 3 messages while agent is busy
    router.enqueue(key, "Event 1: PR closed");
    router.enqueue(key, "Event 2: Action failure");
    router.enqueue(key, "Event 3: Issue labeled");

    await new Promise((r) => setTimeout(r, 20));

    // Agent busy, nothing sent yet
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(key).length, 3);

    // Agent finishes turn
    agentStatus = "idle";
    assert.ok(turnEndedHandler);
    await turnEndedHandler({ agent: { id: targetAgentId } }, { paseo: mockPaseo });

    await new Promise((r) => setTimeout(r, 20));

    // All 3 messages must be coalesced into a SINGLE batch turn with steer: false
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes("Batch notification (3 events)"));
    assert.ok(sentMessages[0].text.includes("Event 1: PR closed"));
    assert.ok(sentMessages[0].text.includes("Event 2: Action failure"));
    assert.ok(sentMessages[0].text.includes("Event 3: Issue labeled"));
    assert.equal(sentMessages[0].options?.steer, false);
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
    assert.ok(getActiveHookRouter() !== null);
    await stop();
    assert.equal(getActiveHookRouter(), null);
  });
});

describe("hook-router bundled service lifecycle and log buffer", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-lifecycle-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    clearHookLogs();
  });

  afterEach(async () => {
    const router = getActiveHookRouter();
    if (router) {
      await router.stop();
      setActiveHookRouter(null);
    }
    clearHookLogs();
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("inspects lifecycle status and responds to restart and reload", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    assert.equal(router.isListening(), false);
    assert.equal(router.getUptime(), 0);

    await router.start();
    assert.equal(router.isListening(), true);
    assert.ok(router.port > 0);
    assert.equal(typeof router.getUptime(), "number");

    const status = router.getLifecycleStatus();
    assert.equal(status.listening, true);
    assert.equal(status.port, router.port);
    assert.equal(typeof status.uptime, "number");
    assert.equal(status.totalQueued, 0);
    assert.equal(status.repoCount, 0);

    // Test reload
    await router.reload();

    // Test restart
    const oldPort = router.port;
    await router.restart();
    assert.equal(router.isListening(), true);
    assert.ok(router.port > 0);

    // Stop
    await router.stop();
    assert.equal(router.isListening(), false);
    assert.equal(router.getUptime(), 0);
  });

  it("maintains in-memory log buffer with max line limits", () => {
    clearHookLogs();
    assert.deepEqual(getHookLogs(), []);

    appendHookLog("test message 1");
    appendHookLog("test message 2");

    const logs = getHookLogs(10);
    assert.equal(logs.length, 2);
    assert.ok(logs[0].includes("test message 1"));
    assert.ok(logs[1].includes("test message 2"));

    // Check custom line limit
    const singleLog = getHookLogs(1);
    assert.equal(singleLog.length, 1);
    assert.ok(singleLog[0].includes("test message 2"));

    clearHookLogs();
    assert.deepEqual(getHookLogs(), []);
  });
});

describe("hook-router network interfaces and listen address configuration (#427)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "hook-router-config-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    setActiveHookRouter(null);
  });

  it("discovers available network interfaces including loopback and wildcard", () => {
    const ifaces = getAvailableNetworkInterfaces();
    assert.ok(Array.isArray(ifaces));
    assert.ok(ifaces.includes("127.0.0.1"), "Must include 127.0.0.1");
    assert.ok(ifaces.includes("0.0.0.0"), "Must include 0.0.0.0");
  });

  it("isolates default config path in test environment unless FORGE_HOOK_CONFIG is set", () => {
    const originalEnv = process.env.NODE_ENV;
    const originalConfig = process.env.FORGE_HOOK_CONFIG;
    try {
      process.env.NODE_ENV = "test";
      delete process.env.FORGE_HOOK_CONFIG;
      assert.equal(getRouterConfigPath(), "");

      process.env.FORGE_HOOK_CONFIG = "/custom/path/router-config.json";
      assert.equal(getRouterConfigPath(), "/custom/path/router-config.json");
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalConfig !== undefined) {
        process.env.FORGE_HOOK_CONFIG = originalConfig;
      } else {
        delete process.env.FORGE_HOOK_CONFIG;
      }
    }
  });

  it("saves and loads router configuration safely", () => {
    const configPath = join(tmpDir, "router-config.json");
    assert.deepEqual(loadRouterConfig(configPath), {});

    saveRouterConfig({ host: "0.0.0.0", port: 9199 }, configPath);
    assert.ok(existsSync(configPath));

    const loaded = loadRouterConfig(configPath);
    assert.equal(loaded.host, "0.0.0.0");
    assert.equal(loaded.port, 9199);
  });

  it("initializes HookRouter with persisted configuration", () => {
    const configPath = join(tmpDir, "router-config.json");
    saveRouterConfig({ host: "0.0.0.0", port: 8200 }, configPath);

    const router = new HookRouter(null, {
      configPath,
      queueDir: join(tmpDir, "queues"),
      stateDir: join(tmpDir, "state"),
    });

    assert.equal(router.configuredHost, "0.0.0.0");
    assert.equal(router.configuredPort, 8200);
    assert.equal(router.host, "0.0.0.0");
    assert.equal(router.port, 8200);
  });

  it("reconfigures host and port, saves config, and restarts listener", async () => {
    const configPath = join(tmpDir, "router-config.json");
    const router = new HookRouter(null, {
      host: "127.0.0.1",
      port: 0, // dynamic port for testing
      configPath,
      queueDir: join(tmpDir, "queues"),
      stateDir: join(tmpDir, "state"),
    });

    await router.start();
    assert.equal(router.isListening(), true);
    assert.equal(router.host, "127.0.0.1");
    const originalPort = router.port;
    assert.ok(originalPort > 0);

    // Reconfigure router with restart
    const configureResult = await router.configure({
      host: "127.0.0.1",
      port: 0,
      restart: true,
    });

    assert.equal(configureResult.configuredHost, "127.0.0.1");
    assert.equal(configureResult.restarted, true);
    assert.equal(router.isListening(), true);

    const savedConfig = loadRouterConfig(configPath);
    assert.equal(savedConfig.host, "127.0.0.1");

    await router.stop();
    assert.equal(router.isListening(), false);
  });

  it("configureHookService and getHookServiceStatus report accurate configuration and interfaces", async () => {
    const configPath = join(tmpDir, "router-config.json");
    const router = new HookRouter(null, {
      host: "127.0.0.1",
      port: 0,
      configPath,
      queueDir: join(tmpDir, "queues"),
      stateDir: join(tmpDir, "state"),
    });
    setActiveHookRouter(router);

    const statusBefore = getHookServiceStatus();
    assert.equal(statusBefore.active, false);
    assert.equal(statusBefore.configuredHost, "127.0.0.1");
    assert.ok(statusBefore.availableInterfaces.includes("127.0.0.1"));

    // Configure service
    const configResult = await configureHookService({
      host: "127.0.0.1",
      port: 8888,
      restart: false,
      configPath,
    });

    assert.equal(configResult.ok, true);
    assert.equal(configResult.configuredHost, "127.0.0.1");
    assert.equal(configResult.configuredPort, 8888);

    const statusAfter = getHookServiceStatus();
    assert.equal(statusAfter.configuredHost, "127.0.0.1");
    assert.equal(statusAfter.configuredPort, 8888);
  });
});

describe("hook-router per-repository muting circuit breaker and fleet roster (#426)", () => {
  let tmpDir: string;
  let queueDir: string;
  let stateDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "uppidi-fleet-mute-test-"));
    queueDir = join(tmpDir, "queues");
    stateDir = join(tmpDir, "state");
    configPath = join(tmpDir, "router-config.json");
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("manages and persists mutedRepos and enrolledRepos in router config", () => {
    const router = new HookRouter(null, {
      configPath,
      queueDir,
      stateDir,
      port: 0,
    });

    assert.equal(router.isRepoMuted("xpufx-org/paseo"), false);
    assert.deepEqual(router.getMutedRepos(), []);

    // Mute repo
    router.muteRepo("xpufx-org/paseo");
    assert.equal(router.isRepoMuted("xpufx-org/paseo"), true);
    assert.deepEqual(router.getMutedRepos(), ["xpufx-org/paseo"]);

    // Verify config persisted
    const saved = loadRouterConfig(configPath);
    assert.deepEqual(saved.mutedRepos, ["xpufx-org/paseo"]);

    // Toggle mute off
    const toggleRes = router.toggleRepoMute("xpufx-org/paseo");
    assert.equal(toggleRes.isMuted, false);
    assert.equal(router.isRepoMuted("xpufx-org/paseo"), false);
    assert.deepEqual(router.getMutedRepos(), []);

    // Enroll repo
    router.enrollRepo("xpufx-org/new-repo");
    assert.ok(router.getEnrolledRepos().includes("xpufx-org/new-repo"));
  });

  it("suppresses queue drain when repository is muted and resumes on unmute", async () => {
    const key = "xpufx-org/paseo";
    const targetAgentId = "agent-orch-mute-1";
    const sentMessages: string[] = [];

    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, targetAgentId);
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

    const router = new HookRouter(mockServer, {
      configPath,
      queueDir,
      stateDir,
      port: 0,
    });

    // Write orchestrator mapping
    router.writeOrchestrator(key, targetAgentId);

    // Mute the repository
    router.muteRepo(key);
    assert.equal(router.isRepoMuted(key), true);

    // Enqueue message while muted
    router.enqueue(key, "Muted webhook task");

    // Allow drain check to run
    await new Promise((r) => setTimeout(r, 20));

    // Message should NOT be sent because repo is muted!
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(key).length, 1);

    // Now unmute the repository
    router.unmuteRepo(key);
    assert.equal(router.isRepoMuted(key), false);

    // Trigger drain
    await router.drain(key);
    await new Promise((r) => setTimeout(r, 20));

    // Message should now be dispatched!
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0], "Muted webhook task");
    assert.equal(router.getQueue(key).length, 0);
  });

  it("getQueuesOverview and getStatusOverview report enrolled repositories even when queue depth is 0 (#448)", () => {
    const router = new HookRouter(null, {
      configPath,
      queueDir,
      stateDir,
      port: 0,
    });

    router.enrollRepo("xpufx-org/enrolled-repo-empty");
    const overview = router.getQueuesOverview() as any;
    assert.ok(Array.isArray(overview.queues));
    const emptyQueue = overview.queues.find((q: any) => q.key === "xpufx-org/enrolled-repo-empty");
    assert.ok(emptyQueue, "Enrolled repository must be returned in getQueuesOverview");
    assert.equal(emptyQueue.depth, 0);
    assert.equal(emptyQueue.isBusy, false);
    assert.deepEqual(emptyQueue.messages, []);

    const status = router.getStatusOverview() as any;
    assert.ok(status.repoCount >= 1, "Status repoCount must include enrolled repositories");
  });

  it("getFleetRosterInfo reports enrolled repos, muted repos, and queue depths", () => {
    const router = new HookRouter(null, {
      configPath,
      queueDir,
      stateDir,
      port: 0,
    });
    setActiveHookRouter(router);

    router.enrollRepo("xpufx-org/paseo");
    router.enrollRepo("xpufx-org/aur-automation");
    router.muteRepo("xpufx-org/aur-automation");
    router.enqueue("xpufx-org/paseo", "Queued 1");
    router.enqueue("xpufx-org/paseo", "Queued 2");

    const info = getFleetRosterInfo();
    assert.ok(info.enrolledRepos.includes("xpufx-org/paseo"));
    assert.ok(info.enrolledRepos.includes("xpufx-org/aur-automation"));
    assert.deepEqual(info.mutedRepos, ["xpufx-org/aur-automation"]);
    assert.equal(info.repoQueuedHooks["xpufx-org/paseo"], 2);
  });
});

describe("hook-router event coalescing and digest (#458)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-coalesce-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("derives deterministic event kind and hash", () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const labeled = { action: "labeled", label: { name: "state/1-wip" }, issue: { number: 42 } };
    const commented = { action: "created", comment: { body: "hello" }, issue: { number: 42 } };

    assert.equal(eventKind("issues", labeled), "state-transition");
    assert.equal(eventKind("issues", commented), "issues:created");
    assert.equal(eventKind("issue_comment", commented), "issue_comment:created");

    const h1 = eventHash(key, 42, "state-transition", "operator", "body");
    const h2 = eventHash(key, 42, "state-transition", "operator", "body");
    const h3 = eventHash(key, 42, "state-transition", "operator", "other");
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
    assert.equal(bufferKey(key, 42), `${key}#42`);
    assert.equal(bufferKey(key, null), `${key}#?`);
  });

  it("identifies SOS state transitions, including cleared and retained states", () => {
    const sosEvent = (action: string, labels: string[]) => ({
      action,
      label: { name: "priority/0-SOS" },
      issue: { labels: labels.map((name) => ({ name })) },
    });
    assert.equal(sosStateOf("issues", sosEvent("labeled", ["priority/0-SOS"])), "priority/0-sos");
    assert.equal(sosStateOf("issues", sosEvent("unlabeled", [])), "");
    assert.equal(
      sosStateOf("issues", {
        action: "labeled",
        label: { name: "flag/stop-work" },
        issue: { labels: [{ name: "flag/stop-work" }] },
      }),
      "flag/stop-work",
    );
    assert.equal(sosStateOf("issue_comment", { comment: { body: "hi" } }), null);
  });

  it("formats a digest card with event counts, latest comment, and trailing URL", () => {
    const buffered: CoalesceEvent[] = [
      {
        hash: "a",
        kind: "issue_comment:created",
        msg: "first",
        commentBody: "first comment",
        title: "Digest test",
        stateLabels: ["state/1-wip"],
        url: "https://forge.test/xpufx-org/paseo/issues/42",
      },
      {
        hash: "b",
        kind: "state-transition",
        msg: "second",
        commentBody: "latest comment body",
        title: "Digest test",
        stateLabels: ["state/2-review"],
        url: "https://forge.test/xpufx-org/paseo/issues/42",
      },
    ];
    const digest = formatDigest("forge.mrs.uppidi.com/xpufx-org/paseo", 42, buffered);
    assert.ok(digest.startsWith(`${FORGEJO_DIGEST_PREFIX} `));
    assert.match(digest, /#42 Digest test \[state\/2-review\]/);
    assert.match(digest, /\(2 events: issue_comment:created, state-transition\)/);
    assert.ok(digest.includes("Latest comment: latest comment body"));
    assert.ok(digest.endsWith("https://forge.test/xpufx-org/paseo/issues/42"));
  });

  it("buffers burst events, dedupes identical deliveries, and flushes one digest", async () => {
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      coalesceDisable: false,
      debounceMs: 25,
    });
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const base = { repoKey: key, issue: 42, actor: "operator", title: "Burst", stateLabels: [], url: "", bypass: false };

    assert.equal(router.coalesceOrSend({ ...base, kind: "issues:opened", commentBody: "opened", msg: "msg-1" }), "buffered");
    assert.equal(router.coalesceOrSend({ ...base, kind: "issues:edited", commentBody: "edited", msg: "msg-2" }), "buffered");
    assert.equal(router.coalesceOrSend({ ...base, kind: "issues:edited", commentBody: "edited", msg: "msg-2" }), "deduped");
    assert.equal(router.getQueue(key).length, 0, "digest withheld until debounce");

    await new Promise((r) => setTimeout(r, 60));

    const queue = router.getQueue(key);
    assert.equal(queue.length, 1);
    assert.ok(queue[0].msg.startsWith(FORGEJO_DIGEST_PREFIX));
    assert.match(queue[0].msg, /2 events/);
  });

  it("bypass events skip the buffer while flushing any pending digest first", () => {
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      coalesceDisable: false,
      debounceMs: 10000,
    });
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const base = { repoKey: key, issue: 42, actor: "operator", title: "Burst", stateLabels: [], url: "", bypass: false };

    assert.equal(router.coalesceOrSend({ ...base, kind: "issues:opened", commentBody: "opened", msg: "buffered-1" }), "buffered");
    const result = router.coalesceOrSend({
      ...base,
      kind: "state-transition",
      commentBody: "SOS",
      msg: "SOS interrupt",
      bypass: true,
      sosState: "priority/0-sos",
    });
    assert.equal(result, "bypass");

    const msgs = router.getQueue(key).map((e) => e.msg);
    assert.ok(msgs.includes("SOS interrupt"));
    assert.ok(msgs.some((m) => m.startsWith(FORGEJO_DIGEST_PREFIX) || m === "buffered-1"));
  });

  it("dedupes repeated SOS transitions but re-interrupts on a distinct state change", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0, coalesceDisable: false, debounceMs: 10000 });
    const key = "forge.mrs.uppidi.com/xpufx-org/sos-dedup";
    const base = { repoKey: key, issue: 79, actor: "operator", title: "SOS", stateLabels: [], url: "" };
    const sendSos = (sosState: string) =>
      router.coalesceOrSend({ ...base, kind: "state-transition", commentBody: "state-transition", msg: `SOS ${sosState}`, bypass: true, sosState });

    assert.equal(sendSos("priority/0-sos"), "bypass");
    assert.equal(sendSos("priority/0-sos"), "sos-deduped");
    assert.equal(sendSos(""), "bypass");
    assert.equal(sendSos("priority/0-sos"), "bypass");
    assert.equal(router.getQueue(key).length, 3, "one message per distinct transition");
  });

  it("extracts the agent envelope id from a stamped comment footer", () => {
    const body = {
      comment: {
        body: "Pre-flight complete.\n\n---\n<sub>🤖 **Orchestrator** (`agent-1`) · `model` · `platform:main` · _now_</sub>",
      },
    };
    assert.equal(envelopeAgentId(body), "agent-1");
    assert.equal(envelopeAgentId({ comment: { body: "plain comment" } }), null);
  });
});

describe("hook-router fleet watchdog audit (#458)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let router: HookRouter;
  let delivered: Array<{ id: string; msg: string }>;
  let reloaded: string[];
  let fakeDeliver: (id: string, msg: string) => Promise<boolean>;
  let fakeReload: (id: string) => Promise<{ ok: boolean; error?: string }>;
  const frontDeskId = "fd-watchdog-agent";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-watchdog-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeFrontDesk(frontDeskId, "test");
    delivered = [];
    reloaded = [];
    fakeDeliver = async (id, msg) => {
      delivered.push({ id, msg });
      return true;
    };
    fakeReload = async (id) => {
      reloaded.push(id);
      return { ok: true };
    };
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("reports a clean audit when no anomalies are present", async () => {
    const cleanMap = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "idle", lastError: null }],
      ["agent-2", { id: "agent-2", status: "running", lastError: null }],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: cleanMap,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.equal(audit.ok, true);
    assert.equal(audit.anomalies.length, 0);
    assert.equal(audit.audited.agents, 2);
    assert.equal(audit.audited.orchestrators, 1);
  });

  it("detects missing orchestrators and alerts Front Desk", async () => {
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: new Map(),
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.ok(audit.anomalies.some((a) => a.type === "ORCHESTRATOR_MISSING"));
    assert.ok(delivered.some((d) => d.id === frontDeskId && d.msg.includes("was not found on daemon")));
  });

  it("auto-recovers a foreground turn lock and notifies Front Desk", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "error", lastError: "A foreground turn is already active" }],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.ok(audit.anomalies.some((a) => a.type === "AGENT_ERROR"));
    assert.ok(reloaded.includes("agent-1"));
    assert.ok(delivered.some((d) => d.id === frontDeskId && d.msg.includes("Auto-recovered")));
  });

  it("auto-recovers an ACP attention error with no lastError", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "running", requiresAttention: true, attentionReason: "error", lastError: null }],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.ok(audit.anomalies.some((a) => a.type === "AGENT_ERROR"));
    assert.ok(reloaded.includes("agent-1"));
    assert.ok(delivered.some((d) => d.msg.includes("Auto-recovered")));
  });

  it("escalates when auto-reload fails", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "error", lastError: "A foreground turn is already active" }],
    ]);
    await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: async () => ({ ok: false, error: "daemon died" }),
    });
    assert.ok(delivered.some((d) => d.msg.includes("Operator attention may be required")));
  });

  it("does not reload on quota exhaustion and escalates instead", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "error", lastError: "You've hit your usage limit" }],
    ]);
    await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.equal(reloaded.length, 0);
    assert.ok(delivered.some((d) => d.msg.includes("usage limit")));
  });

  it("throttles repeat alerts within the cooldown window", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "error", lastError: "fatal boom" }],
    ]);
    await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: async () => ({ ok: false, error: "nope" }),
    });
    const first = delivered.length;
    assert.ok(first > 0);
    await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: async () => ({ ok: false, error: "nope" }),
    });
    assert.equal(delivered.length, first, "no duplicate alerts within cooldown");
  });

  it("intercepts pending permission requests with the permit command hint", async () => {
    const map = new Map<string, WatchdogAgent>([
      [
        "agent-perm-1",
        {
          id: "agent-perm-1",
          title: "Worker Perm",
          status: "running",
          pendingPermissions: [{ id: "perm-req-42", tool: "run_command", title: "run bash command" }],
        },
      ],
      ["agent-orch-1", { id: "agent-orch-1", status: "idle", lastError: null }],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-orch-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.ok(
      audit.anomalies.some(
        (a) =>
          a.type === "AGENT_PERMISSION_REQUIRED" &&
          a.agentId === "agent-perm-1" &&
          a.title === "Worker Perm" &&
          Array.isArray(a.permissions) &&
          a.permissions.length === 1,
      ),
    );
    assert.ok(
      delivered.some(
        (d) =>
          d.msg.includes("[Fleet Watchdog] Agent Worker Perm (agent-p)") &&
          d.msg.includes("requires permission: run bash command") &&
          d.msg.includes("paseo permit allow agent-perm-1 perm-req-42"),
      ),
    );
  });

  it("detects non-error attention stalls and alerts Front Desk", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-att-1", { id: "agent-att-1", title: "Worker Input", status: "idle", requiresAttention: true, attentionReason: "input", pendingPermissions: [] }],
      ["agent-orch-1", { id: "agent-orch-1", status: "idle", lastError: null }],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-orch-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.ok(
      audit.anomalies.some(
        (a) => a.type === "AGENT_ATTENTION_REQUIRED" && a.agentId === "agent-att-1" && a.reason === "input",
      ),
    );
    assert.ok(delivered.some((d) => d.msg.includes("requires attention (input). Operator or Front Desk triage required.")));
  });

  it("ignores benign finished attention reason without alerting Front Desk (#488)", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-done-1", { id: "agent-done-1", title: "Worker Done", status: "idle", requiresAttention: true, attentionReason: "finished", pendingPermissions: [] }],
      ["agent-orch-1", { id: "agent-orch-1", status: "idle", lastError: null }],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-orch-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.equal(
      audit.anomalies.some((a) => a.type === "AGENT_ATTENTION_REQUIRED" && a.agentId === "agent-done-1"),
      false,
    );
    assert.equal(delivered.some((d) => d.msg.includes("requires attention (finished)")), false);
  });

  it("flags wedged queues and auto-recovers the registered orchestrator", async () => {
    (router as any).busyAttempts.set("wedged-with-orch", 12);
    (router as any).queues.set("wedged-with-orch", [{ id: "m1", key: "wedged-with-orch", msg: "pending", ts: Date.now() }]);

    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "wedged-with-orch", agentId: "agent-wedged" }],
      agentMap: new Map([["agent-wedged", { id: "agent-wedged", status: "idle" }]]),
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.ok(audit.anomalies.some((a) => a.type === "QUEUE_WEDGED" && a.key === "wedged-with-orch"));
    assert.ok(reloaded.includes("agent-wedged"));
    assert.equal((router as any).busyAttempts.has("wedged-with-orch"), false);
    assert.ok(delivered.some((d) => d.msg.includes("Auto-recovered wedged queue for wedged-with-orch")));
  });
});

describe("hook-router orchestrator pruning (#458)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-prune-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("deletes orchestrator records for agents that no longer exist on the daemon", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-keep", "agent-keep");
    router.writeOrchestrator("repo-prune", "agent-dead");

    const result = await router.pruneOrchestrators({
      orchestratorRecords: [
        { key: "repo-keep", agentId: "agent-keep" },
        { key: "repo-prune", agentId: "agent-dead" },
      ],
      agentMap: new Map([["agent-keep", { id: "agent-keep", status: "idle" }]]),
    });

    assert.equal(result.ok, true);
    assert.equal(result.prunedCount, 1);
    assert.equal(result.pruned[0].key, "repo-prune");
    assert.equal(router.readOrchestrator("repo-keep")?.agentId, "agent-keep");
    assert.equal(router.readOrchestrator("repo-prune"), null);
  });

  it("deleteOrchestrator reports not found on a repeat delete", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-del", "agent-del");
    assert.equal(router.deleteOrchestrator("repo-del").ok, true);
    const second = router.deleteOrchestrator("repo-del");
    assert.equal(second.ok, false);
    assert.equal(second.error, "not found");
  });
});

describe("hook-router Front Desk handoff (#458)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let router: HookRouter;
  let sent: Array<{ id: string; text: string }>;
  let updated: Array<{ id: string; name: string; labels: Record<string, string> }>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-handoff-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    sent = [];
    updated = [];

    const mockPaseo = {
      agents: {
        ref: (id: string) => ({
          id,
          current: () => ({ id, status: "idle", activeTurn: null }),
          refresh: async () => ({ agent: { id, status: "idle" } }),
          send: async (text: string) => {
            sent.push({ id, text });
          },
          update: async (update: { name: string; labels: Record<string, string> }) => {
            updated.push({ id, name: update.name, labels: update.labels });
          },
        }),
      },
    } as any;

    const server = {
      paseo: mockPaseo,
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    router = new HookRouter(server, { queueDir, stateDir, port: 0 });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("seeds the handoff snapshot without registering an agent", async () => {
    const out = await router.doFrontDeskHandoff({ handoffText: "# staged\n\nOperator context." });
    assert.equal(out.agentId, null);
    assert.equal(router.readHandoff(), "# staged\n\nOperator context.");
  });

  it("rotates Front Desk, updates metadata, persists state, and notifies orchestrators", async () => {
    router.writeOrchestrator("forge.test/xpufx-org/paseo", "orch-agent-1");
    router.writeFrontDesk("fd-old", "test");

    const out = await router.doFrontDeskHandoff({ agentId: "fd-new", handoffText: "# New Front Desk\n\nUse this context." });

    assert.equal(out.agentId, "fd-new");
    assert.equal(router.readFrontDesk()?.agentId, "fd-new");
    assert.equal(router.readHandoff(), "# New Front Desk\n\nUse this context.");
    assert.ok(updated.some((u) => u.id === "fd-new" && u.name === "Front Desk" && u.labels.role === "front-desk"));
    assert.ok(
      updated.some((u) => u.id === "fd-old" && u.name === "Front Desk (retired)" && u.labels.role === "retired-front-desk"),
    );
    assert.ok(sent.some((s) => s.id === "fd-new" && s.text.includes("handoff snapshot")));
    assert.ok(sent.some((s) => s.id === "orch-agent-1" && s.text.includes("Front Desk handover")));
    assert.equal(out.orchestratorsNotified, 1);
  });

  it("reads the handoff snapshot from a file", async () => {
    const file = join(tempDir, "incoming.md");
    writeFileSync(file, "# From file\n\nfile snapshot");
    await router.doFrontDeskHandoff({ agentId: "fd-file", handoffFile: file });
    assert.equal(router.readHandoff(), "# From file\n\nfile snapshot");
    assert.equal(router.readFrontDesk()?.agentId, "fd-file");
  });

  it("rejects a handoff with neither text nor agentId", async () => {
    await assert.rejects(() => router.doFrontDeskHandoff({}), /handoffText or agentId is required/);
  });

  it("exposes handoff status for the registered agent", async () => {
    await router.doFrontDeskHandoff({ agentId: "fd-status", handoffText: "status snapshot" });
    const status = router.frontDeskHandoffStatus();
    assert.equal(status.agentId, "fd-status");
    assert.equal(status.handoffPath, router.handoffPath());
    assert.ok(status.summary.includes("status snapshot"));
  });
});

describe("hook-router HTTP handoff, prune, and board sweep routes (#458)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let router: HookRouter;
  let prevNodeEnv: string | undefined;

  beforeEach(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    tempDir = mkdtempSync(join(tmpdir(), "paseo-http-extra-test-"));
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
  });

  afterEach(async () => {
    await router.stop();
    if (prevNodeEnv !== undefined) process.env.NODE_ENV = prevNodeEnv;
    else delete process.env.NODE_ENV;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("seeds and reports handoff via GET/POST /handoff", async () => {
    const getInitial = await fetch(`http://127.0.0.1:${router.port}/handoff`);
    assert.equal(getInitial.status, 200);
    const initialBody = await getInitial.json();
    assert.equal(initialBody.agentId, null);

    const post = await fetch(`http://127.0.0.1:${router.port}/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoffText: "# HTTP staged\n\nsnapshot" }),
    });
    assert.equal(post.status, 200);
    const postBody = await post.json();
    assert.equal(postBody.agentId, null);
    assert.ok(postBody.summary.includes("HTTP staged"));

    const getAfter = await fetch(`http://127.0.0.1:${router.port}/handoff`);
    const afterBody = await getAfter.json();
    assert.equal(afterBody.handoffPath, router.handoffPath());
  });

  it("prunes stale orchestrators via POST /orchestrators/prune", async () => {
    router.writeOrchestrator("repo-stale", "agent-does-not-exist");
    const res = await fetch(`http://127.0.0.1:${router.port}/orchestrators/prune`, { method: "POST" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.prunedCount, "number");
  });

  it("runs a board sweep via POST /board-sweep over explicit repos", async () => {
    const fakeScript = join(tempDir, "fake-check.sh");
    writeFileSync(
      fakeScript,
      `#!/bin/sh\ncat <<'JSON'\n{"ranked_candidates":[{"number":1,"title":"t","labels":[],"category":"dispatchable","is_dispatchable":true,"reason":"r"}]}\nJSON\n`,
      { mode: 0o755 },
    );
    const prevScript = process.env.FORGEJO_ISSUES_CHECK;
    process.env.FORGEJO_ISSUES_CHECK = fakeScript;
    try {
      const res = await fetch(`http://127.0.0.1:${router.port}/board-sweep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos: ["forge.test/xpufx-org/paseo"] }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.swept, 1);
      assert.equal(body.actionable.length, 1);
      assert.equal(body.actionable[0].dispatchable, 1);
    } finally {
      if (prevScript !== undefined) process.env.FORGEJO_ISSUES_CHECK = prevScript;
      else delete process.env.FORGEJO_ISSUES_CHECK;
    }
  });

  it("parses board check JSON even when the checker exits non-zero", async () => {
    const fakeScript = join(tempDir, "fake-check-fail.sh");
    writeFileSync(
      fakeScript,
      `#!/bin/sh\ncat <<'JSON'\n{"ranked_candidates":[{"number":7,"title":"x","labels":["state/1-wip"],"category":"verification","is_dispatchable":false,"reason":"r"}]}\nJSON\nexit 1\n`,
      { mode: 0o755 },
    );
    const prevScript = process.env.FORGEJO_ISSUES_CHECK;
    process.env.FORGEJO_ISSUES_CHECK = fakeScript;
    try {
      const result = await router.runBoardCheck("forge.test/xpufx-org/paseo");
      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].number, 7);
    } finally {
      if (prevScript !== undefined) process.env.FORGEJO_ISSUES_CHECK = prevScript;
      else delete process.env.FORGEJO_ISSUES_CHECK;
    }
  });
});
