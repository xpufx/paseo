import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
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
  detectTurnConcurrencyLock,
  detectCancellationTimeout,
  detectIdlePostErrorAmnesia,
  detectZombieHungTurn,
  detectStaleErrorGhosting,
  detectProviderQuotaExhaustion,
  assessAgentHealth,
  planWatchdogRecovery,
  clearAgentDiskFields,
  loadAgentDiskMetadata,
  scanCancellationTimeouts,
  countActiveWorkers,
  assessChildWakeup,
  formatChildWakeupMessage,
  CHILD_WAKEUP_EVENTS,
  type CoalesceEvent,
  type WatchdogAgent,
  type WatchdogAgentDisk,
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

  it("responds to GET /info with host/port/url/frontdesk/uptime (#545)", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/info`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.host, router.configuredHost);
    assert.equal(body.port, router.configuredPort);
    assert.equal(body.url, `http://${router.configuredHost}:${router.configuredPort}`);
    assert.equal(body.frontDeskAgentId, null);
    assert.equal(typeof body.uptime, "number");
    assert.equal(body.isListening, true);
  });

  it("reports the registered front desk on GET /info (#545)", async () => {
    await fetch(`http://127.0.0.1:${router.port}/frontdesk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "info-fd-1" }),
    });

    const res = await fetch(`http://127.0.0.1:${router.port}/info`);
    const body = await res.json();
    assert.equal(body.frontDeskAgentId, "info-fd-1");
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
  let stopped: string[];
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
    stopped = [];
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

  it("recovers a foreground turn lock via the 4-step pipeline and notifies Front Desk", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "error", lastError: "A foreground turn is already active" }],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
      stopAgent: async (id) => {
        stopped.push(id);
        return { ok: true };
      },
    });
    assert.ok(audit.anomalies.some((a) => a.type === "TURN_CONCURRENCY_LOCK"));
    assert.deepEqual(stopped, ["agent-1"]);
    assert.equal(reloaded.length, 0, "turn locks are recovered by the pipeline, not reload");
    assert.ok(delivered.some((d) => d.id === frontDeskId && d.msg.includes("Auto-recovered")));
  });

  it("recovers an ACP attention error with no lastError via the pipeline", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "running", requiresAttention: true, attentionReason: "error", lastError: null }],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
      stopAgent: async (id) => {
        stopped.push(id);
        return { ok: true };
      },
    });
    assert.ok(audit.anomalies.some((a) => a.type === "TURN_CONCURRENCY_LOCK"));
    assert.deepEqual(stopped, ["agent-1"]);
    assert.ok(delivered.some((d) => d.msg.includes("Auto-recovered")));
  });

  it("escalates when auto-reload fails for a generic error", async () => {
    const map = new Map<string, WatchdogAgent>([
      ["agent-1", { id: "agent-1", status: "error", lastError: "fatal boom" }],
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

describe("reactive child-lifecycle wakeups (#537)", () => {
  let tempDir: string;
  let router: HookRouter;
  let delivered: Array<{ id: string; msg: string }>;
  const parentId = "parent-orch-537";
  const childLabels = { "paseo.parent-agent-id": parentId };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-child-wakeup-test-"));
    router = new HookRouter(null, {
      queueDir: join(tempDir, "queues"),
      stateDir: join(tempDir, "state"),
      port: 0,
    });
    delivered = [];
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const deliver = (id: string, msg: string) => {
    delivered.push({ id, msg });
    return Promise.resolve(true);
  };

  const parentAgent: WatchdogAgent = { id: parentId, title: "Project Orchestrator", status: "running" };

  it("classifies blocked children as waiting and derives permission id + scope", () => {
    const assessment = assessChildWakeup("child-blocked", {
      id: "child-blocked",
      title: "Blocked Child",
      status: "running",
      labels: childLabels,
      pendingPermissions: [{ id: "req-537", name: "external_directory", description: "Scope: /tmp/wt" }],
    });
    assert.equal(assessment?.kind, "waiting");
    assert.equal(assessment?.event, CHILD_WAKEUP_EVENTS.waiting);
    assert.equal(assessment?.permissionId, "req-537");
    assert.equal(assessment?.scope, "/tmp/wt");
    assert.equal(assessment?.alertKey, "child_waiting:child-blocked:req-537");
  });

  it("classifies errored and completed children", () => {
    assert.equal(assessChildWakeup("c-err", { id: "c-err", status: "error" })?.kind, "errored");
    assert.equal(assessChildWakeup("c-fin", { id: "c-fin", status: "idle", attentionReason: "finished" })?.kind, "completed");
    assert.equal(assessChildWakeup("c-idle", { id: "c-idle", status: "idle" })?.kind, "completed");
    assert.equal(assessChildWakeup("c-run", { id: "c-run", status: "running" }), null);
  });

  it("formats a waiting wakeup with the adjudication command", () => {
    const message = formatChildWakeupMessage(
      { id: "child-blocked", title: "Blocked Child" },
      { kind: "waiting", event: CHILD_WAKEUP_EVENTS.waiting, alertKey: "k", detail: "access external dir", permissionId: "req-537", scope: "/tmp/wt" },
    );
    assert.ok(message.includes("waiting for input: access external dir"));
    assert.ok(message.includes("scope=/tmp/wt"));
    assert.ok(message.includes("paseo permit allow child-blocked req-537"));
  });

  it("wakes the parent only, once per (child,event), and never the Front Desk", async () => {
    const map = new Map<string, WatchdogAgent>([
      [parentId, parentAgent],
      [
        "child-blocked",
        {
          id: "child-blocked",
          title: "Blocked Child",
          status: "running",
          labels: childLabels,
          pendingPermissions: [{ id: "req-537", description: "Scope: /tmp/wt" }],
        },
      ],
      ["child-done", { id: "child-done", title: "Done Child", status: "idle", labels: childLabels }],
    ]);

    const audit = await router.runWatchdogAudit({ agentMap: map, deliver, reloadAgent: async () => ({ ok: true }) });
    assert.equal(audit.anomalies.filter((a) => a.type === "CHILD_WAKEUP").length, 2);
    const waiting = audit.anomalies.find((a) => a.event === CHILD_WAKEUP_EVENTS.waiting);
    assert.equal(waiting?.parentAgentId, parentId);
    assert.equal(waiting?.permissionId, "req-537");
    assert.equal(waiting?.scope, "/tmp/wt");
    assert.ok(delivered.every((d) => d.id === parentId), "no wakeup is routed to Front Desk");
    assert.ok(delivered.some((d) => d.msg.includes("waiting for input")));
    assert.ok(delivered.some((d) => d.msg.includes("completed and is idle")));

    // Second tick within the cooldown must not re-deliver or re-report.
    const before = delivered.length;
    const second = await router.runWatchdogAudit({ agentMap: map, deliver, reloadAgent: async () => ({ ok: true }) });
    assert.equal(second.anomalies.filter((a) => a.type === "CHILD_WAKEUP").length, 0);
    assert.equal(delivered.length, before);
  });

  it("re-keys a waiting wakeup when the permission request changes", async () => {
    const child = (requestId: string) => ({
      id: "child-rekey",
      title: "Rekey Child",
      status: "running",
      labels: childLabels,
      pendingPermissions: [{ id: requestId }],
    });
    const first = new Map<string, WatchdogAgent>([[parentId, parentAgent], ["child-rekey", child("req-1")]]);
    await router.runWatchdogAudit({ agentMap: first, deliver, reloadAgent: async () => ({ ok: true }) });
    const countAfterFirst = delivered.length;
    assert.ok(countAfterFirst > 0);

    const second = new Map<string, WatchdogAgent>([[parentId, parentAgent], ["child-rekey", child("req-2")]]);
    await router.runWatchdogAudit({ agentMap: second, deliver, reloadAgent: async () => ({ ok: true }) });
    assert.ok(delivered.some((d) => d.msg.includes("permit allow child-rekey req-2")));
  });

  it("skips children with no parent, a missing parent, an archived parent, or archived child", async () => {
    const map = new Map<string, WatchdogAgent>([
      [parentId, { ...parentAgent, archivedAt: "2026-01-01T00:00:00Z" }],
      ["orphan", { id: "orphan", status: "idle", labels: childLabels }],
      ["no-parent", { id: "no-parent", status: "idle" }],
      ["archived-child", { id: "archived-child", status: "idle", labels: childLabels, archivedAt: "2026-01-01T00:00:00Z" }],
    ]);
    const audit = await router.runWatchdogAudit({ agentMap: map, deliver, reloadAgent: async () => ({ ok: true }) });
    assert.equal(audit.anomalies.filter((a) => a.type === "CHILD_WAKEUP").length, 0);
    assert.equal(delivered.length, 0);
  });

  it("can be disabled via childWakeups: false", async () => {
    const map = new Map<string, WatchdogAgent>([
      [parentId, parentAgent],
      ["child-done", { id: "child-done", status: "idle", labels: childLabels }],
    ]);
    const audit = await router.runWatchdogAudit({
      agentMap: map,
      deliver,
      reloadAgent: async () => ({ ok: true }),
      childWakeups: false,
    });
    assert.equal(audit.anomalies.filter((a) => a.type === "CHILD_WAKEUP").length, 0);
    assert.equal(delivered.length, 0);
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

describe("fleet agent health taxonomy classifier (#529)", () => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);

  it("classifies a turn concurrency lock only for errored lifecycles", () => {
    assert.equal(detectTurnConcurrencyLock("error", "A foreground turn is already active"), true);
    assert.equal(detectTurnConcurrencyLock("error", "concurrent turn detected"), true);
    assert.equal(detectTurnConcurrencyLock("idle", "A foreground turn is already active"), false);
    assert.equal(detectTurnConcurrencyLock("error", "spawn ENOENT"), false);
  });

  it("classifies cancellation timeouts with a recency window", () => {
    const cancellations = new Map<string, number | null>([["agent-1", now - 60_000]]);
    assert.equal(detectCancellationTimeout("agent-1", cancellations, "idle", now, 86400), true);
    assert.equal(detectCancellationTimeout("agent-1", cancellations, "running", now, 86400), false);
    assert.equal(detectCancellationTimeout("agent-recovered", cancellations, "idle", now, 86400), false);
    assert.equal(detectCancellationTimeout("agent-1", cancellations, "idle", now, 30), false);
    assert.equal(detectCancellationTimeout("agent-1", new Map([["agent-1", null]]), "error", now, 30), true);
  });

  it("classifies idle post-error amnesia conservatively", () => {
    // Ghost lastError or a stalled attention reason on a workerless idle agent.
    assert.equal(detectIdlePostErrorAmnesia("idle", "boom", false, null, 0), true);
    assert.equal(detectIdlePostErrorAmnesia("idle", "", true, "stalled", 0), true);
    assert.equal(detectIdlePostErrorAmnesia("idle", "", true, "finished", 0), false);
    assert.equal(detectIdlePostErrorAmnesia("idle", "boom", false, null, 2), false);
    assert.equal(detectIdlePostErrorAmnesia("running", "boom", false, null, 0), false);
    // Explicit opt-in treats a plain finished/attention idle agent as stalled.
    assert.equal(detectIdlePostErrorAmnesia("idle", "", true, "finished", 0, true), true);
  });

  it("classifies zombie hung turns past the stale window", () => {
    const stale = new Date(now - 1900 * 1000).toISOString();
    const fresh = new Date(now - 60 * 1000).toISOString();
    assert.equal(detectZombieHungTurn("running", stale, now, 1800), true);
    assert.equal(detectZombieHungTurn("running", fresh, now, 1800), false);
    assert.equal(detectZombieHungTurn("idle", stale, now, 1800), false);
    assert.equal(detectZombieHungTurn("running", null, now, 1800), false);
  });

  it("classifies stale error ghosting for healthy lifecycles only", () => {
    assert.equal(detectStaleErrorGhosting("idle", "boom"), true);
    assert.equal(detectStaleErrorGhosting("running", "boom"), true);
    assert.equal(detectStaleErrorGhosting("idle", "   "), false);
    assert.equal(detectStaleErrorGhosting("error", "boom"), false);
  });

  it("classifies provider quota exhaustion but not recoverable transients", () => {
    assert.equal(detectProviderQuotaExhaustion("You've hit your usage limit"), true);
    assert.equal(detectProviderQuotaExhaustion("Rate limit exceeded (429): Quota exhausted"), true);
    assert.equal(detectProviderQuotaExhaustion("model unavailable"), true);
    assert.equal(detectProviderQuotaExhaustion("fetch failed: ECONNRESET"), false);
    assert.equal(detectProviderQuotaExhaustion("spawn ENOENT"), false);
    assert.equal(detectProviderQuotaExhaustion(""), false);
  });

  it("fuses live and disk signals into an ordered assessment", () => {
    const assessment = assessAgentHealth(
      "agent-1",
      { id: "agent-1", status: "error", lastError: "foreground turn is already active" },
      { lastError: "foreground turn is already active", lastStatus: "error" },
      now,
    );
    assert.deepEqual(assessment.taxonomy, ["TURN_CONCURRENCY_LOCK"]);
    assert.equal(assessment.severities.TURN_CONCURRENCY_LOCK, "high");
    assert.equal(assessment.healthy, false);

    const archived = assessAgentHealth(
      "agent-2",
      { id: "agent-2", status: "error", lastError: "boom", archivedAt: "2026-01-01T00:00:00Z" },
      null,
      now,
    );
    assert.deepEqual(archived.taxonomy, []);
    assert.equal(archived.healthy, true);
  });

  it("counts only live running/parented workers as active children", () => {
    const map = new Map<string, WatchdogAgent>([
      ["parent", { id: "parent", status: "idle" }],
      ["child-a", { id: "child-a", status: "running", labels: { "paseo.parent-agent-id": "parent" } }],
      ["child-b", { id: "child-b", status: "running", labels: { "paseo.parent-agent-id": "other" } }],
    ]);
    assert.equal(countActiveWorkers(map, "parent"), 1);
    assert.equal(countActiveWorkers(map, "other"), 1);
  });

  it("plans conservative recovery and blocks auto-steer on quota exhaustion", () => {
    const zombie = planWatchdogRecovery(["ZOMBIE_HUNG_TURN", "STALE_ERROR_GHOSTING"]);
    assert.equal(zombie.stop, true);
    assert.equal(zombie.clearError, true);
    assert.equal(zombie.steer, true);
    assert.equal(zombie.blockedReason, null);

    const amnesia = planWatchdogRecovery(["IDLE_POST_ERROR_AMNESIA"]);
    assert.equal(amnesia.stop, false);
    assert.equal(amnesia.clearAttention, true);
    assert.equal(amnesia.steer, true);

    const quota = planWatchdogRecovery(["PROVIDER_QUOTA_EXHAUSTION"]);
    assert.equal(quota.stop, false);
    assert.equal(quota.steer, false);
    assert.match(quota.blockedReason ?? "", /circuit-break/);
  });

  it("atomically wipes metadata keys and tolerates missing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-health-disk-"));
    try {
      const file = join(dir, "agent.json");
      writeFileSync(
        file,
        JSON.stringify({ id: "agent-1", lastError: "boom", requiresAttention: true, attentionReason: "error", attentionTimestamp: "x", keep: 1 }),
      );
      assert.equal(clearAgentDiskFields(file, ["lastError"]), true);
      const afterError = JSON.parse(readFileSync(file, "utf8"));
      assert.equal("lastError" in afterError, false);
      assert.equal(afterError.keep, 1);
      assert.equal(
        clearAgentDiskFields(file, ["requiresAttention", "attentionReason", "attentionTimestamp"]),
        true,
      );
      const afterAttention = JSON.parse(readFileSync(file, "utf8"));
      assert.equal("requiresAttention" in afterAttention, false);
      assert.equal("attentionReason" in afterAttention, false);
      assert.equal("attentionTimestamp" in afterAttention, false);
      assert.equal(clearAgentDiskFields(file, ["lastError"]), false);
      assert.equal(clearAgentDiskFields(join(dir, "missing.json"), ["lastError"]), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("loads persisted metadata from the agents directory subfolders", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-health-metadata-"));
    try {
      const sub = join(dir, "agent-1");
      mkdirSync(sub, { recursive: true });
      writeFileSync(
        join(sub, "agent-1.json"),
        JSON.stringify({ id: "agent-1", lastStatus: "idle", lastError: "ghost", updatedAt: "2026-01-01T00:00:00Z" }),
      );
      const map = loadAgentDiskMetadata(dir);
      const disk = map.get("agent-1") as WatchdogAgentDisk;
      assert.equal(disk.lastStatus, "idle");
      assert.equal(disk.lastError, "ghost");
      assert.equal(disk.lastActivityAt, "2026-01-01T00:00:00Z");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scans daemon logs for the newest cancellation-timeout marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-health-logs-"));
    try {
      const log = join(dir, "daemon.log");
      writeFileSync(
        log,
        `${JSON.stringify({ time: 1000, agentId: "agent-aaaaaaaa", msg: "cancelAgentRun: acknowledged turn still active after timeout" })}\n` +
        `${JSON.stringify({ time: 2000, agentId: "agent-aaaaaaaa", msg: "cancelAgentRun: acknowledged turn still active after timeout" })}\n` +
        `plain line cancelAgentRun: acknowledged turn still active after timeout "agentId":"bbbbbbbb-1111-2222-3333-444444444444"\n`,
      );
      const map = scanCancellationTimeouts([log]);
      assert.equal(map.get("agent-aaaaaaaa"), 2000);
      assert.equal(map.has("bbbbbbbb-1111-2222-3333-444444444444"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("hook-router taxonomy recovery pipeline (#529)", () => {
  let tempDir: string;
  let agentsDir: string;
  let delivered: Array<{ id: string; msg: string; steer?: boolean }>;
  let stopped: string[];
  let router: HookRouter;
  const frontDeskId = "fd-health-agent";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-health-watchdog-"));
    agentsDir = join(tempDir, "agents");
    router = new HookRouter(null, { queueDir: join(tempDir, "queues"), stateDir: join(tempDir, "state"), port: 0 });
    router.writeFrontDesk(frontDeskId, "test");
    delivered = [];
    stopped = [];
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const writeMetadata = (id: string, data: Record<string, unknown>) => {
    const sub = join(agentsDir, id);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `${id}.json`), JSON.stringify(data, null, 2));
  };

  it("runs the stop -> clear -> steer pipeline for a zombie hung turn", async () => {
    const stale = new Date(Date.now() - 3600 * 1000).toISOString();
    writeMetadata("agent-zombie", { id: "agent-zombie", lastStatus: "running", lastError: "hung", lastActivityAt: stale });
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };
    const map = new Map<string, WatchdogAgent>([["agent-zombie", { id: "agent-zombie", status: "running" }]]);

    const audit = await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      diskMetadata: undefined,
      cancellations: new Map(),
      deliver: fakeDeliver,
      stopAgent: async (id) => {
        stopped.push(id);
        return { ok: true };
      },
    });

    assert.ok(audit.anomalies.some((a) => a.type === "ZOMBIE_HUNG_TURN" && a.agentId === "agent-zombie"));
    assert.deepEqual(stopped, ["agent-zombie"]);
    // lastError was wiped from disk by step 2.
    const persisted = JSON.parse(readFileSync(join(agentsDir, "agent-zombie", "agent-zombie.json"), "utf8"));
    assert.equal("lastError" in persisted, false);
    // Step 4 steers the wake pulse at the agent itself.
    assert.ok(delivered.some((d) => d.id === "agent-zombie" && d.steer === true && /Health check/.test(d.msg)));
    assert.ok(
      delivered.some((d) => d.id === frontDeskId && /Auto-recovered agent/.test(d.msg) && /ZOMBIE_HUNG_TURN/.test(d.msg)),
    );
  });

  it("never auto-steers on provider quota exhaustion and alerts instead", async () => {
    writeMetadata("agent-quota", { id: "agent-quota", lastStatus: "idle", lastError: "You've hit your usage limit" });
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };
    const map = new Map<string, WatchdogAgent>([
      ["agent-quota", { id: "agent-quota", status: "idle", lastError: "You've hit your usage limit" }],
    ]);

    const audit = await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      cancellations: new Map(),
      deliver: fakeDeliver,
      stopAgent: async (id) => {
        stopped.push(id);
        return { ok: true };
      },
      frontDeskId,
    });

    assert.ok(audit.anomalies.some((a) => a.type === "PROVIDER_QUOTA_EXHAUSTION"));
    assert.deepEqual(stopped, [], "quota exhaustion must not stop the agent");
    assert.equal(delivered.some((d) => d.id === "agent-quota"), false, "quota exhaustion must not steer the agent");
    assert.ok(delivered.some((d) => d.id === frontDeskId && /quota exhaustion/.test(d.msg)));
  });

  it("throttles taxonomy alerts within the watchdog cooldown", async () => {
    writeMetadata("agent-ghost", { id: "agent-ghost", lastStatus: "idle", lastError: "ghost" });
    const fakeDeliver = async (id: string, msg: string) => {
      delivered.push({ id, msg });
      return true;
    };
    const map = new Map<string, WatchdogAgent>([["agent-ghost", { id: "agent-ghost", status: "idle" }]]);

    const runOnce = () =>
      router.runWatchdogAudit({
        agentMap: map,
        agentsDir,
        cancellations: new Map(),
        deliver: fakeDeliver,
        stopAgent: async () => ({ ok: true }),
        frontDeskId,
      });
    await runOnce();
    const first = delivered.length;
    assert.ok(first > 0);
    await runOnce();
    assert.equal(delivered.length, first, "no duplicate taxonomy alerts within cooldown");
  });
});
