import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  normalizeRepoKey,
  candidateRepoKeys,
  canonicalRepoKey,
  keyFromPayload,
  isFrontDeskEvent,
  isBypassEvent,
  formatWebhookMessage,
  forgejoEnvelope,
  summarize,
  fleetEnvelope,
  formatFleetEnvelope,
  withFleetEnvelope,
  fleetEnvelopeAttachment,
  extractFleetEnvelopeAttachments,
  FLEET_ENVELOPE_CONTEXT_KIND,
  FLEET_ENVELOPE_TITLE,
  routerEnvelope,
  watchdogEnvelope,
  agentRepoKey,
  FLEET_ENVELOPE_VERSION,
  ROUTER_SENDER,
  WATCHDOG_SENDER,
  FRONT_DESK_REPO,
  FLEET_REPO,
  stableId,
  HookRouter,
  startHookRouter,
  appendHookLog,
  getHookLogs,
  clearHookLogs,
  getActiveDiskLogger,
  setActiveDiskLogger,
  getActiveHookRouter,
  setActiveHookRouter,
  setActivePaseo,
  getAvailableNetworkInterfaces,
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
  findProviderRetryQuotaError,
  scanTimelineRetryErrors,
  recordModelQuotaFailure,
  getCachedModelHealth,
  resolveOrchestratorModel,
  readModelAlerts,
  recordModelAlert,
  clearModelAlert,
  defaultModelAlertsPath,
  handleUppidiFleetAlerts,
  QUOTA_MARKERS,
  assessAgentHealth,
  planWatchdogRecovery,
  clearAgentDiskFields,
  setAgentDiskFields,
  loadAgentDiskMetadata,
  scanCancellationTimeouts,
  coerceEpochMs,
  countActiveWorkers,
  assessChildWakeup,
  formatChildWakeupMessage,
  isOrchestratorAgent,
  isFrontDeskAgent,
  isOrchestratorMatchingRepo,
  findLiveOrchestratorAgents,
  findLiveFrontDeskAgents,
  isProbeAgent,
  isChildWakeupCandidate,
  CHILD_WAKEUP_EVENTS,
  labelTriageDecision,
  closeGuardDecision,
  parseTargetActors,
  labelNamesFromIssue,
  isPullRequestSubject,
  normalizeLabelName,
  SHARED_AGENT_ACTOR,
  ORCHESTRATOR_ATTENTION_LABEL,
  LABEL_TRIAGE_STOP_WORK_LABEL,
  SOS_LABEL,
  LABEL_TRIAGE_TERMINAL_LABELS,
  CLOSE_GUARD_ACCEPTED_LABELS,
  DEFAULT_CLOSE_GUARD_TARGET_ACTORS,
  CLOSE_GUARD_POLICY_COMMENT,
  CI_FAILURE_LABELS,
  ciFailureIssueTitle,
  ciFailureDetailsFromPayload,
  formatCiFailureBody,
  REPO_ONBOARDING_CATALOGUE_PATH,
  REPO_ONBOARDING_ISSUE_TITLE,
  REPO_ONBOARDING_ISSUE_LABELS,
  REPO_ONBOARDING_ISSUE_BODY,
  resolveProviderSpawnMode,
  resolveMergeEventHook,
  formatMergeEventNotice,
  readMergeEventRecords,
  setExecFileAsyncForTest,
  WAKEUP_RULES,
  isActionableWakeupEvent,
  SLASH_SWEEP_RE,
  type CoalesceEvent,
  type WatchdogAgent,
  type WatchdogAgentDisk,
  type HookRouterOptions,
  type ProviderModeInfo,
} from "./hook-router.js";
import { readAdjudicationDecisions } from "./permission-adjudication.js";
import { setFetchForTest, setTokenResolverForTest } from "./forgejo-api.js";
import { setMetricsFilePathForTest } from "./metrics.js";
import { STALE_WIP_REMINDER_MARKER, type IssuesCheckIo } from "./issues-check.js";
import { getUppidiFleetSettingsStorage, resetUppidiFleetSettingsStorageInstance } from "./settings.js";

/** Extract the hidden `<!-- {"fleet": ...} -->` JSON comment from a delivered prompt. */
function parseFleetComment(text: string | undefined): Record<string, any> | null {
  if (typeof text !== "string") return null;
  const start = text.indexOf("<!-- {");
  if (start < 0) return null;
  const end = text.indexOf(" -->", start);
  if (end < 0) return null;
  try {
    return JSON.parse(text.slice(start + 5, end)).fleet ?? null;
  } catch {
    return null;
  }
}

/** Extract the `fleet_envelope` JSON from a delivered prompt's send options (#1003). */
function parseFleetAttachment(options: any): Record<string, any> | null {
  const attachment = (options?.attachments ?? []).find(
    (a: any) => a?.type === "text" && a?.contextKind === "fleet_envelope",
  );
  if (!attachment) return null;
  try {
    return JSON.parse(attachment.text).fleet ?? null;
  } catch {
    return null;
  }
}

/** Drop the persisted plugin settings so each test starts from schema defaults. */
function clearSettingsStorage(): void {
  try {
    rmSync(getUppidiFleetSettingsStorage().filePath, { force: true });
  } catch {
    // ignore missing file
  }
  resetUppidiFleetSettingsStorageInstance();
}

beforeEach(() => {
  clearSettingsStorage();
});

function failingBoardIo(error: string): IssuesCheckIo {
  return {
    getOpenIssues: async () => ({ ok: false, error }),
    getLatestComments: async () => [],
    getIssueComments: async () => [],
    runStaleWipCommand: async () => true,
    loadCache: async () => ({}),
    saveCache: async () => {},
  };
}

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

  it("derives candidate keys and canonical repo keys (#752)", () => {
    assert.deepEqual(candidateRepoKeys("xpufx-org/paseo"), [
      "xpufx-org/paseo",
      "forge.mrs.uppidi.com/xpufx-org/paseo",
    ]);
    assert.deepEqual(candidateRepoKeys("forge.mrs.uppidi.com/xpufx-org/paseo"), [
      "forge.mrs.uppidi.com/xpufx-org/paseo",
      "xpufx-org/paseo",
    ]);
    assert.deepEqual(candidateRepoKeys("https://forge.mrs.uppidi.com/xpufx-org/paseo.git"), [
      "https://forge.mrs.uppidi.com/xpufx-org/paseo.git",
      "forge.mrs.uppidi.com/xpufx-org/paseo",
      "xpufx-org/paseo",
    ]);
    assert.equal(canonicalRepoKey("xpufx-org/paseo"), "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(canonicalRepoKey("forge.mrs.uppidi.com/xpufx-org/paseo"), "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(canonicalRepoKey("https://forge.mrs.uppidi.com/xpufx-org/paseo.git"), "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(canonicalRepoKey(""), null);
    assert.equal(canonicalRepoKey(null), null);
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

describe("fleet JSON envelope (#283/#985)", () => {
  it("nests the envelope under `fleet` with v1 and defaults ref to null", () => {
    const direct = fleetEnvelope({
      origin: "orchestrator",
      sender: "525721aa",
      repo: "forge/o/r",
      kind: "escalation",
      ref: 38,
    });
    assert.deepEqual(Object.keys(direct), ["fleet"]);
    assert.equal(direct.fleet.v, FLEET_ENVELOPE_VERSION);
    assert.equal(direct.fleet.origin, "orchestrator");
    assert.equal(direct.fleet.sender, "525721aa");
    assert.equal(direct.fleet.repo, "forge/o/r");
    assert.equal(direct.fleet.kind, "escalation");
    assert.equal(direct.fleet.ref, 38);
    assert.equal(
      fleetEnvelope({ origin: "worker", sender: "w", repo: "forge/o/r", kind: "escalation" }).fleet.ref,
      null,
    );
  });

  it("formats a hidden HTML comment that round-trips", () => {
    const formatted = formatFleetEnvelope({
      origin: "frontdesk",
      sender: "fd-1",
      repo: "forge/o/r",
      kind: "steer",
    });
    assert.ok(formatted.startsWith("<!-- {"));
    assert.ok(formatted.endsWith("} -->"));
    assert.equal(parseFleetComment(formatted)?.sender, "fd-1");
  });

  it("prepends the signature line and leaves an already-signed body untouched", () => {
    const wrapped = withFleetEnvelope(routerEnvelope({ repo: "forge/o/r", kind: "steer" }), "body");
    assert.ok(wrapped.startsWith("<!-- {"));
    assert.ok(wrapped.split("\n")[0].endsWith("} -->"));
    assert.ok(wrapped.endsWith("\nbody"));

    const formatted = formatFleetEnvelope(routerEnvelope({ repo: "forge/o/r", kind: "steer" }));
    assert.equal(withFleetEnvelope(routerEnvelope({ repo: "forge/o/r", kind: "steer" }), formatted), formatted);
  });

  it("builds a `fleet_envelope` text attachment with the JSON envelope as its body (#1003)", () => {
    const attachment = fleetEnvelopeAttachment({
      origin: "router",
      sender: ROUTER_SENDER,
      repo: "forge/o/r",
      kind: "webhook",
      ref: 7,
    });
    assert.equal(attachment.type, "text");
    assert.equal(attachment.mimeType, "text/plain");
    assert.equal(attachment.contextKind, FLEET_ENVELOPE_CONTEXT_KIND);
    assert.equal(attachment.contextKind, "fleet_envelope");
    assert.equal(attachment.title, FLEET_ENVELOPE_TITLE);
    assert.equal(attachment.title, "Fleet context");
    assert.deepEqual(JSON.parse(attachment.text), fleetEnvelope({
      origin: "router",
      sender: ROUTER_SENDER,
      repo: "forge/o/r",
      kind: "webhook",
      ref: 7,
    }));
  });

  it("extracts legacy in-band comments into attachments and strips them from the body (#1003)", () => {
    const wrapped = withFleetEnvelope(
      routerEnvelope({ repo: "forge/o/r", kind: "steer" }),
      "human body",
    );
    const { text, attachments } = extractFleetEnvelopeAttachments(wrapped);
    assert.equal(text, "human body");
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].contextKind, "fleet_envelope");
    assert.match(attachments[0].text, /^\{"fleet":/);
  });

  it("keeps the `[forgejo-hook]` machine line and moves the fleet comment to an attachment (#1003)", () => {
    const payload = {
      repository: { full_name: "xpufx-org/paseo", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo" },
      sender: { login: "testuser" },
      issue: { number: 380, title: "Test issue", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/380" },
      action: "opened",
    };
    const { text, attachments } = extractFleetEnvelopeAttachments(formatWebhookMessage("issues", payload));
    assert.ok(text.startsWith("[forgejo-hook] {"));
    assert.equal(text.includes("<!-- {"), false);
    assert.equal(attachments.length, 1);
    assert.match(text, /🔔 Forgejo webhook incoming/);
  });

  it("leaves a malformed fleet comment in the body rather than dropping text (#1003)", () => {
    const message = "<!-- {\"fleet\": not-json} -->\nbody";
    const { text, attachments } = extractFleetEnvelopeAttachments(message);
    assert.equal(attachments.length, 0);
    assert.equal(text, message);
  });

  it("stamps router and watchdog senders with the canonical origins", () => {
    const routerFields = routerEnvelope({ repo: "forge/o/r", kind: "webhook", ref: 7 });
    assert.equal(routerFields.origin, "router");
    assert.equal(routerFields.sender, ROUTER_SENDER);
    assert.equal(routerFields.ref, 7);

    const watchdogFields = watchdogEnvelope({ repo: "forge/o/r" });
    assert.equal(watchdogFields.origin, "watchdog");
    assert.equal(watchdogFields.sender, WATCHDOG_SENDER);
    assert.equal(watchdogFields.kind, "alert");
    assert.equal(watchdogFields.ref, null);
    assert.equal(watchdogEnvelope().repo, FLEET_REPO);
    assert.equal(FRONT_DESK_REPO, "frontdesk");
  });

  it("resolves alert repo context from the registry, labels, then the fleet fallback", () => {
    const records = [{ key: "forge/o/registered", agentId: "agent-1" }];
    assert.equal(agentRepoKey({ id: "agent-1", labels: { repo: "forge/o/labelled" } }, records), "forge/o/registered");
    assert.equal(agentRepoKey({ id: "agent-2", labels: { repo: "forge/o/labelled" } }, records), "forge/o/labelled");
    assert.equal(agentRepoKey({ id: "agent-3", labels: {} }, records), FLEET_REPO);
  });

  it("keeps the webhook machine line first and puts the envelope before the human summary", () => {
    const payload = {
      repository: { full_name: "xpufx-org/paseo", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo" },
      sender: { login: "testuser" },
      issue: { number: 380, title: "Test issue", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/380" },
      action: "opened",
    };
    const message = formatWebhookMessage("issues", payload);
    const lines = message.split("\n");
    assert.ok(lines[0].startsWith("[forgejo-hook] {"));
    assert.equal(
      JSON.stringify(JSON.parse(lines[0].slice("[forgejo-hook] ".length))),
      JSON.stringify(forgejoEnvelope("issues", payload)),
    );
    assert.equal(lines[1], "");
    const fleet = parseFleetComment(lines[2]);
    assert.equal(fleet?.v, FLEET_ENVELOPE_VERSION);
    assert.equal(fleet?.origin, "router");
    assert.equal(fleet?.sender, ROUTER_SENDER);
    assert.equal(fleet?.repo, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(fleet?.kind, "webhook");
    assert.equal(fleet?.ref, 380);
    assert.equal(lines.slice(3).join("\n"), summarize("issues", payload));
  });

  it("allows a null webhook ref for payloads without an issue number", () => {
    const push = formatWebhookMessage("push", {
      repository: { full_name: "xpufx-org/paseo", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo" },
      sender: { login: "testuser" },
      ref: "refs/heads/main",
      commits: [],
    });
    const fleet = parseFleetComment(push.split("\n")[2]);
    assert.equal(fleet?.kind, "webhook");
    assert.equal(fleet?.ref, null);
    assert.ok(push.includes("🔔 Forgejo webhook incoming [push]"));
  });

  it("leaves legacy senders unchanged (router/watchdog explicit origins)", () => {
    assert.equal(routerEnvelope({ repo: "x", kind: "webhook" }).sender, "forgejo-hook");
    assert.equal(watchdogEnvelope({ repo: "x" }).sender, "fleet-watchdog");
    assert.notEqual(routerEnvelope({ repo: "x", kind: "webhook" }).sender, watchdogEnvelope({ repo: "x" }).sender);
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

describe("hook-router queue pause-all and turn_ended drain guard (#877)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-pause-all-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    clearHookLogs();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function createIdleRouter() {
    const sentMessages: Array<{ id: string; text: string }> = [];
    const mockPaseo = {
      agents: {
        ref: (id: string) => ({
          current: () => ({ id, status: "idle", activeTurn: null }),
          send: async (text: string) => {
            sentMessages.push({ id, text });
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
    const router = new HookRouter(server, { queueDir, stateDir, port: 0 });
    return { router, sentMessages };
  }

  it("pause('all') pauses every enrolled and active queue without a literal 'all' entry", () => {
    const { router } = createIdleRouter();
    const keyA = "xpufx-org/pause-a";
    const keyB = "xpufx-org/pause-b";
    router.writeOrchestrator(keyA, "agent-pause-a");
    router.writeOrchestrator(keyB, "agent-pause-b");
    router.enqueue(keyA, "msg a");
    router.enqueue(keyB, "msg b");

    const paused = router.pause("all");
    assert.equal(paused.includes("all"), false);
    assert.equal(router.isPaused(keyA), true);
    assert.equal(router.isPaused(keyB), true);
    assert.equal(router.isAllPaused(), true);
  });

  it("pause() without args behaves identically to pause('all')", () => {
    const { router } = createIdleRouter();
    const key = "xpufx-org/pause-noarg";
    router.writeOrchestrator(key, "agent-pause-noarg");
    router.enqueue(key, "msg");

    router.pause();
    assert.equal(router.isPaused(key), true);
    assert.equal(router.isAllPaused(), true);
  });

  it("a queue created after pause-all stays paused via the global flag", () => {
    const { router } = createIdleRouter();
    router.pause("all");

    const lateKey = "xpufx-org/pause-late";
    router.writeOrchestrator(lateKey, "agent-pause-late");
    router.enqueue(lateKey, "late msg");

    assert.equal(router.isPaused(lateKey), true);
    assert.equal(router.getQueue(lateKey).length, 1);
  });

  it("resume('all') clears every pause and single resume keeps other queues paused", () => {
    const { router } = createIdleRouter();
    const keyA = "xpufx-org/resume-a";
    const keyB = "xpufx-org/resume-b";
    router.writeOrchestrator(keyA, "agent-resume-a");
    router.writeOrchestrator(keyB, "agent-resume-b");
    router.enqueue(keyA, "msg a");
    router.enqueue(keyB, "msg b");
    router.pause("all");

    router.resume(keyA);
    assert.equal(router.isPaused(keyA), false);
    assert.equal(router.isPaused(keyB), true);
    assert.equal(router.isAllPaused(), false);

    router.pause("all");
    assert.equal(router.isPaused(keyA), true);
    assert.equal(router.isPaused(keyB), true);

    router.resume("all");
    assert.equal(router.isPaused(keyA), false);
    assert.equal(router.isPaused(keyB), false);
    assert.equal(router.isAllPaused(), false);
  });

  it("drain is suppressed while paused and fires after resume-all", async () => {
    const { router, sentMessages } = createIdleRouter();
    const key = "xpufx-org/drain-paused";
    router.writeOrchestrator(key, "agent-drain-paused");
    router.pause("all");

    router.enqueue(key, "paused task");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(key).length, 1);

    await router.drain(key);
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(key).length, 1);

    router.resume("all");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sentMessages.length, 1);
    assert.equal(router.getQueue(key).length, 0);
  });

  it("agent.turn_ended suppresses the drain log and drain while paused, drains after resume", async () => {
    const { router, sentMessages } = createIdleRouter();
    const key = "xpufx-org/turn-ended-paused";
    const agentId = "agent-turn-ended-paused";
    router.writeOrchestrator(key, agentId);
    router.pause("all");
    router.enqueue(key, "queued while paused");
    router.busyAttempts.set(key, 3);

    clearHookLogs();
    router.handleLifecycleEvent("agent.turn_ended", { agent: { id: agentId } });
    const suppressedLogs = getHookLogs(20).join("\n");
    assert.match(suppressedLogs, /queue drain suppressed \(paused\)/);
    assert.doesNotMatch(suppressedLogs, /triggering queue drain/);

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(key).length, 1);
    // Busy state is still released even though the drain was suppressed.
    assert.equal(router.busyAttempts.has(key), false);

    clearHookLogs();
    router.resume("all");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sentMessages.length, 1);
    assert.equal(router.getQueue(key).length, 0);
  });

  it("agent.turn_ended suppresses drain log while halted or pause-all for registered, front desk, and unregistered agents (#1116, #1119)", async () => {
    const { router, sentMessages } = createIdleRouter();
    const repoKey = "xpufx-org/halted-repo";
    const orchAgentId = "orch-halted-agent";
    const frontDeskAgentId = "front-desk-halted-agent";
    const unregisteredAgentId = "unregistered-worker-agent";

    router.writeOrchestrator(repoKey, orchAgentId);
    router.writeFrontDesk(frontDeskAgentId);

    // Engage canonical halt before queueing messages
    router.halt();

    router.enqueue(repoKey, "task for orch");
    router.enqueue("frontdesk", "task for frontdesk");

    // 1. Front Desk turn ended while halted
    clearHookLogs();
    router.handleLifecycleEvent("agent.turn_ended", { agent: { id: frontDeskAgentId } });
    let logs = getHookLogs(20).join("\n");
    assert.match(logs, /queue drain suppressed \(paused\)/);
    assert.doesNotMatch(logs, /triggering queue drain/);

    // 2. Orchestrator turn ended while halted
    clearHookLogs();
    router.handleLifecycleEvent("agent.turn_ended", { agent: { id: orchAgentId } });
    logs = getHookLogs(20).join("\n");
    assert.match(logs, /queue drain suppressed \(paused\)/);
    assert.doesNotMatch(logs, /triggering queue drain/);

    // 3. Unregistered / worker / lost-registration agent turn ended while halted (#1119)
    clearHookLogs();
    router.handleLifecycleEvent("agent.turn_ended", { agent: { id: unregisteredAgentId } });
    logs = getHookLogs(20).join("\n");
    assert.match(logs, /queue drain suppressed \(paused\)/);
    assert.doesNotMatch(logs, /triggering queue drain/);

    // Ensure no messages were dispatched during halt
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(repoKey).length, 1);
    assert.equal(router.getQueue("frontdesk").length, 1);
  });

  it("agent.turn_ended still triggers the drain log and drain when unpaused", async () => {
    let busy = true;
    const heldSent: Array<{ id: string; text: string }> = [];
    const heldPaseo = {
      agents: {
        ref: (id: string) => ({
          current: () =>
            busy
              ? { id, status: "running", activeTurn: { id: "turn-live" } }
              : { id, status: "idle", activeTurn: null },
          send: async (text: string) => {
            heldSent.push({ id, text });
          },
        }),
      },
    } as any;
    const heldServer = {
      paseo: heldPaseo,
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;
    const heldRouter = new HookRouter(heldServer, { queueDir, stateDir, port: 0 });

    const key = "xpufx-org/turn-ended-open";
    const agentId = "agent-turn-ended-open";
    heldRouter.writeOrchestrator(key, agentId);

    // Busy agent holds the message in the queue.
    heldRouter.enqueue(key, "held task");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(heldSent.length, 0);
    assert.equal(heldRouter.getQueue(key).length, 1);

    // Agent finishes: turn_ended must log the drain trigger and deliver.
    busy = false;
    clearHookLogs();
    heldRouter.handleLifecycleEvent("agent.turn_ended", { agent: { id: agentId } });
    const openLogs = getHookLogs(20).join("\n");
    assert.match(openLogs, /triggering queue drain/);
    assert.doesNotMatch(openLogs, /suppressed \(paused\)/);

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(heldSent.length, 1);
    assert.equal(heldRouter.getQueue(key).length, 0);
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
    assert.ok(Array.isArray(body.enrolledRepos), "Status must include enrolledRepos (#911)");
  });

  it("responds to GET /queues", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/queues`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.queues));
  });

  it("records, checks and summarizes audits over the HTTP gateway (#1172)", async () => {
    const payload = {
      repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
      pr: 1172,
      headCommit: "gate1111",
      iteration: 1,
      taxonomy: [],
      actors: {
        auditor: { agentId: "aud-gate", role: "orchestrator", model: "gemini-3.8-pro" },
        author: { agentId: "wrk-gate", role: "worker", model: "gemini-3.8-flash" },
      },
      verdict: "approved",
      verification: {
        workerClaimed: "passed",
        auditorVerified: "passed",
        checksRun: ["typecheck"],
        isolatedEnv: true,
      },
      summary: "gateway clean",
    };

    const rec = await fetch(`http://127.0.0.1:${router.port}/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal(rec.status, 201);
    const recBody = await rec.json();
    assert.equal(recBody.ok, true);
    assert.match(recBody.auditId, /^aud_/);

    const check = await fetch(
      `http://127.0.0.1:${router.port}/audits/check?repo=xpufx-org/paseo&pr=1172&commit=gate1111`,
    );
    assert.equal(check.status, 200);
    const checkBody = await check.json();
    assert.equal(checkBody.audited, true);
    assert.equal(checkBody.audit.auditId, recBody.auditId);

    const miss = await fetch(
      `http://127.0.0.1:${router.port}/audits/check?repo=xpufx-org/paseo&pr=9999&commit=nope`,
    );
    const missBody = await miss.json();
    assert.equal(missBody.audited, false);

    const sum = await fetch(`http://127.0.0.1:${router.port}/audits/summary?repo=xpufx-org/paseo`);
    assert.equal(sum.status, 200);
    const sumBody = await sum.json();
    assert.equal(sumBody.totalAudits, 1);
    assert.equal(sumBody.firstPassSuccessRate, 100);
    assert.deepEqual(sumBody.defectTaxonomyCounts, {});
    assert.equal(sumBody.modelScorecard[0].model, "gemini-3.8-flash");
  });

  it("rejects malformed audit gateway posts with 400 and a zod issue summary", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "xpufx-org/paseo", pr: 1 }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /verdict|actors|summary/);
  });

  it("validates audit check query parameters", async () => {
    const res = await fetch(`http://127.0.0.1:${router.port}/audits/check?repo=&pr=1&commit=x`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  it("reconciles a merged PR against the audit store and logs a durable record (#1172)", async () => {
    const rec = await fetch(`http://127.0.0.1:${router.port}/audits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
        pr: 77,
        headCommit: "rec7777",
        iteration: 1,
        taxonomy: [],
        actors: {
          auditor: { agentId: "a", role: "orchestrator", model: "m1" },
          author: { agentId: "w", role: "worker", model: "m2" },
        },
        verdict: "approved",
        verification: {
          workerClaimed: "passed",
          auditorVerified: "passed",
          checksRun: [],
          isolatedEnv: false,
        },
        summary: "reconciled",
      }),
    });
    assert.equal(rec.status, 201);
    const recBody = await rec.json();

    const audited = router.reconcileMergeAudit({
      repository: { full_name: "xpufx-org/paseo" },
      pull_request: {
        number: 77,
        merged: true,
        merge_commit_sha: "rec7777",
      },
    });
    assert.equal(audited.status, "audited");
    assert.equal(audited.auditId, recBody.auditId);
    assert.equal(audited.verdict, "approved");

    const unrecorded = router.reconcileMergeAudit({
      repository: { full_name: "xpufx-org/paseo" },
      pull_request: {
        number: 88,
        merged: true,
        merge_commit_sha: "not-audited",
      },
    });
    assert.equal(unrecorded.status, "direct_or_adhoc");
    assert.equal(unrecorded.auditId, undefined);

    // One audited, one direct_or_adhoc merge → 50% compliance.
    const sum = await fetch(`http://127.0.0.1:${router.port}/audits/summary?repo=xpufx-org/paseo`);
    const sumBody = await sum.json();
    assert.equal(sumBody.auditedMerges, 1);
    assert.equal(sumBody.unauditedMerges, 1);
    assert.equal(sumBody.complianceRate, 50);
  });

  it("responds to GET /enrolled with canonical enrolled repository keys (#911)", async () => {
    router.enrollRepo("xpufx-org/enrolled-http-repo");

    const res = await fetch(`http://127.0.0.1:${router.port}/enrolled`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, body.enrolledRepos.length);
    assert.ok(
      body.enrolledRepos.includes("forge.mrs.uppidi.com/xpufx-org/enrolled-http-repo"),
      `Expected canonical key, got ${JSON.stringify(body.enrolledRepos)}`,
    );
    assert.ok(!body.enrolledRepos.includes("xpufx-org/enrolled-http-repo"), "Non-canonical keys must not leak");
  });

  it("aliases GET /repos/enrolled to the enrolled repository list (#911)", async () => {
    router.enrollRepo("xpufx-org/enrolled-alias-repo");

    const res = await fetch(`http://127.0.0.1:${router.port}/repos/enrolled`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.enrolledRepos.includes("forge.mrs.uppidi.com/xpufx-org/enrolled-alias-repo"));
  });

  it("includes canonical enrolledRepos in GET /status (#911)", async () => {
    router.enrollRepo("xpufx-org/status-enrolled-repo");

    const res = await fetch(`http://127.0.0.1:${router.port}/status`);
    const body = await res.json();
    assert.ok(body.enrolledRepos.includes("forge.mrs.uppidi.com/xpufx-org/status-enrolled-repo"));
    assert.ok(body.repoCount >= body.enrolledRepos.length);
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

    // Routine webhook message should now have been dispatched via in-process send with activeTurnBehavior: interrupt (#1027)
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].text, "Prompt to orchestrator");
    assert.equal(sentMessages[0].options?.activeTurnBehavior, "interrupt");
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

    // SOS must preempt immediately and pass activeTurnBehavior: steer
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].text, "EMERGENCY STOP");
    assert.equal(sentMessages[0].options?.activeTurnBehavior, "steer");
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

    // All 3 messages must be coalesced into a SINGLE batch turn with activeTurnBehavior: interrupt
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].text.includes("Batch notification (3 events)"));
    assert.ok(sentMessages[0].text.includes("Event 1: PR closed"));
    assert.ok(sentMessages[0].text.includes("Event 2: Action failure"));
    assert.ok(sentMessages[0].text.includes("Event 3: Issue labeled"));
    assert.equal(sentMessages[0].options?.activeTurnBehavior, "interrupt");
    assert.equal(router.getQueue(key).length, 0);
  });

  it("deliverMessage sends activeTurnBehavior and never the dead SDK steer key (#1027)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    const payloads: Array<{ text: string; options: Record<string, unknown> }> = [];
    (router as any).activePaseo = {
      agents: {
        ref: () => ({
          send: async (text: string, options: Record<string, unknown>) => {
            payloads.push({ text, options });
          },
        }),
      },
    };

    assert.equal(await router.deliverMessage("agent-steer", "steer this", { steer: true }), true);
    assert.equal(await router.deliverMessage("agent-interrupt", "interrupt this", { steer: false }), true);
    assert.equal(await router.deliverMessage("agent-default", "default to interrupt"), true);

    assert.deepEqual(payloads[0], { text: "steer this", options: { activeTurnBehavior: "steer" } });
    assert.deepEqual(payloads[1], { text: "interrupt this", options: { activeTurnBehavior: "interrupt" } });
    assert.deepEqual(payloads[2], { text: "default to interrupt", options: { activeTurnBehavior: "interrupt" } });
    for (const { options } of payloads) {
      assert.equal("steer" in options, false, "the SDK payload must not carry the dead steer key");
    }
  });

  it("deliverMessage CLI fallback keeps --steer when the SDK ref is unavailable (#1027)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    (router as any).activePaseo = null;
    const calls: string[][] = [];
    setExecFileAsyncForTest(async (_cmd: string, args: readonly string[]) => {
      calls.push([...args]);
      return { stdout: "" };
    });
    try {
      assert.equal(await router.deliverMessage("agent-cli-steer", "go", { steer: true, noWait: true }), true);
      assert.equal(await router.deliverMessage("agent-cli-plain", "go", { noWait: true }), true);
    } finally {
      setExecFileAsyncForTest(null);
    }
    assert.deepEqual(calls[0], ["send", "--no-wait", "--steer", "agent-cli-steer", "go"]);
    assert.deepEqual(calls[1], ["send", "--no-wait", "agent-cli-plain", "go"]);
  });

  it("deliverMessage sends fleet provenance as a `fleet_envelope` attachment, not in the body (#1003)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    const payloads: Array<{ text: string; options: any }> = [];
    (router as any).activePaseo = {
      agents: {
        ref: () => ({
          send: async (text: string, options: any) => {
            payloads.push({ text, options });
          },
        }),
      },
    };

    const wrapped = withFleetEnvelope(
      routerEnvelope({ repo: "forge.mrs.uppidi.com/xpufx-org/paseo", kind: "webhook", ref: 1003 }),
      "🔔 Forgejo webhook incoming [issues:opened] xpufx-org/paseo#1003 Fleet pill",
    );
    assert.equal(await router.deliverMessage("agent-envelope", wrapped, { steer: true }), true);

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].text.includes("<!-- {"), false);
    assert.ok(payloads[0].text.startsWith("🔔 Forgejo webhook incoming"));
    const attachments = payloads[0].options.attachments;
    assert.equal(Array.isArray(attachments), true);
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].type, "text");
    assert.equal(attachments[0].contextKind, "fleet_envelope");
    assert.equal(attachments[0].title, "Fleet context");
    assert.deepEqual(JSON.parse(attachments[0].text), fleetEnvelope({
      origin: "router",
      sender: ROUTER_SENDER,
      repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
      kind: "webhook",
      ref: 1003,
    }));
    assert.equal(payloads[0].options.activeTurnBehavior, "steer");
  });

  it("deliverMessage forwards explicit attachments alongside an extracted envelope (#1003)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    const payloads: Array<{ text: string; options: any }> = [];
    (router as any).activePaseo = {
      agents: {
        ref: () => ({
          send: async (text: string, options: any) => {
            payloads.push({ text, options });
          },
        }),
      },
    };

    await router.deliverMessage(
      "agent-attach",
      withFleetEnvelope(watchdogEnvelope({ repo: "forge/o/r" }), "alert body"),
      { noWait: true, attachments: [fleetEnvelopeAttachment(routerEnvelope({ repo: "other", kind: "handoff" }))] },
    );
    assert.equal(payloads[0].text, "alert body");
    assert.deepEqual(
      payloads[0].options.attachments.map((a: any) => a.contextKind),
      ["fleet_envelope", "fleet_envelope"],
    );
  });

  it("deliverMessage CLI fallback re-inlines the envelope for the model (#1003)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    (router as any).activePaseo = null;
    const calls: string[][] = [];
    setExecFileAsyncForTest(async (_cmd: string, args: readonly string[]) => {
      calls.push([...args]);
      return { stdout: "" };
    });
    try {
      await router.deliverMessage(
        "agent-cli-envelope",
        withFleetEnvelope(routerEnvelope({ repo: "forge/o/r", kind: "steer" }), "body"),
        { noWait: true },
      );
    } finally {
      setExecFileAsyncForTest(null);
    }
    const sent = calls[0][calls[0].length - 1];
    assert.ok(sent.startsWith('<!-- {"fleet"'));
    assert.ok(sent.endsWith("\nbody"));
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

  it("recovers the newest live Front Desk after a restart with missing disk state", async () => {
    const liveAgents = {
      agents: {
        list: async () => ({
          entries: [
            {
              id: "fd-older",
              title: "Front Desk",
              status: "idle",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "fd-newer",
              labels: { role: "front-desk" },
              status: "running",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        }),
      },
    } as any;
    const first = new HookRouter(null, { queueDir, stateDir, port: 0 });
    first.writeFrontDesk("fd-retired");
    rmSync(join(tempDir, "frontdesk.json"), { force: true });

    const recovered = new HookRouter(null, { queueDir, stateDir, port: 0, paseo: liveAgents });
    (recovered as any).updateAgentMetadata = async () => {};
    await recovered.start();

    assert.equal(recovered.readFrontDesk()?.agentId, "fd-newer");
    const ordered = findLiveFrontDeskAgents(
      new Map([
        ["fd-older", { id: "fd-older", title: "Front Desk", status: "idle", updatedAt: "2026-01-01T00:00:00.000Z" }],
        ["fd-newer", { id: "fd-newer", labels: { role: "front-desk" }, status: "running", updatedAt: "2026-01-02T00:00:00.000Z" }],
      ] as any),
    );
    assert.deepEqual(ordered.map((agent) => agent.id), ["fd-newer", "fd-older"]);
    await recovered.stop();
  });

  it("persists hook logs to scoped disk storage and rotates when bounded (#1115)", () => {
    clearHookLogs();
    const logDir = join(tempDir, "logs");
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      logDir,
      logMaxBytes: 150,
      logMaxFiles: 2,
      port: 0,
    });
    setActiveHookRouter(router);

    // Initial log file path verification
    assert.equal(router.logDir, logDir);
    assert.equal(router.logFilePath, join(logDir, "hook.log"));
    assert.ok(existsSync(logDir), "scoped logs/ directory must exist");
    assert.ok(!router.logDir.includes(".paseo/logs"), "must never write to ~/.paseo/logs");

    // Write log lines via appendHookLog
    appendHookLog("[info] first message to disk");
    appendHookLog("[warn] second message to disk");

    const hookLogFile = join(logDir, "hook.log");
    assert.ok(existsSync(hookLogFile), "hook.log should be created on write");
    const content = readFileSync(hookLogFile, "utf8");
    assert.match(content, /first message to disk/);
    assert.match(content, /second message to disk/);

    // Verify bounded rotation: trigger rotation by appending lines past 150 bytes
    for (let i = 1; i <= 10; i++) {
      appendHookLog(`[info] rotation test line ${i} with long descriptive text to exceed threshold`);
    }

    assert.ok(existsSync(join(logDir, "hook.log")));
    assert.ok(existsSync(join(logDir, "hook.log.1")));
    assert.ok(existsSync(join(logDir, "hook.log.2")));
    assert.ok(!existsSync(join(logDir, "hook.log.3")), "hook.log.3 must not exist when maxFiles is 2");

    setActiveHookRouter(null);
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

  it("saves and loads router configuration through plugin settings", () => {
    saveRouterConfig({ host: "0.0.0.0", port: 9199 });

    const loaded = loadRouterConfig();
    assert.equal(loaded.host, "0.0.0.0");
    assert.equal(loaded.port, 9199);
  });

  it("never consults the legacy ~/.config/uppidi-fleet/router-config.json mirror (#1164)", () => {
    const legacyHome = mkdtempSync(join(tmpdir(), "uppidi-legacy-config-"));
    const legacyDir = join(legacyHome, ".config", "uppidi-fleet");
    mkdirSync(legacyDir, { recursive: true });
    const legacyFile = join(legacyDir, "router-config.json");
    writeFileSync(legacyFile, JSON.stringify({ host: "10.99.99.99", port: 19999 }));

    const realHome = process.env.HOME;
    const realConfig = process.env.FORGE_HOOK_CONFIG;
    process.env.HOME = legacyHome;
    process.env.FORGE_HOOK_CONFIG = legacyFile;
    try {
      // Canonical plugin settings drive resolution; the legacy mirror is ignored.
      saveRouterConfig({ host: "192.0.2.10", port: 8321 });
      const loaded = loadRouterConfig();
      assert.equal(loaded.host, "192.0.2.10");
      assert.equal(loaded.port, 8321);

      // With canonical settings cleared, schema defaults apply -- not the mirror.
      clearSettingsStorage();
      const fallback = loadRouterConfig();
      assert.equal(fallback.host, "127.0.0.1");
      assert.equal(fallback.port, 8099);
    } finally {
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
      if (realConfig === undefined) delete process.env.FORGE_HOOK_CONFIG;
      else process.env.FORGE_HOOK_CONFIG = realConfig;
      rmSync(legacyHome, { recursive: true, force: true });
    }
  });

  it("initializes HookRouter with persisted configuration", () => {
    saveRouterConfig({ host: "0.0.0.0", port: 8200 });

    const router = new HookRouter(null, {
      isTestMode: false,
      queueDir: join(tmpDir, "queues"),
      stateDir: join(tmpDir, "state"),
    });

    assert.equal(router.configuredHost, "0.0.0.0");
    assert.equal(router.configuredPort, 8200);
    assert.equal(router.host, "0.0.0.0");
    assert.equal(router.port, 8200);
  });

  it("reconfigures host and port, saves config, and restarts listener", async () => {
    const router = new HookRouter(null, {
      host: "127.0.0.1",
      port: 0, // dynamic port for testing
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

    const savedConfig = loadRouterConfig();
    assert.equal(savedConfig.host, "127.0.0.1");

    await router.stop();
    assert.equal(router.isListening(), false);
  });

  it("configureHookService and getHookServiceStatus report accurate configuration and interfaces", async () => {
    const router = new HookRouter(null, {
      host: "127.0.0.1",
      port: 0,
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

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "uppidi-fleet-pause-test-"));
    queueDir = join(tmpDir, "queues");
    stateDir = join(tmpDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("manages and persists pausedRepos and enrolledRepos in plugin settings", () => {
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
    });

    assert.equal(router.isRepoPaused("xpufx-org/paseo"), false);
    assert.deepEqual(router.getPausedRepos(), []);

    // Pause repo
    router.pauseRepo("xpufx-org/paseo");
    assert.equal(router.isRepoPaused("xpufx-org/paseo"), true);
    assert.deepEqual(router.getPausedRepos(), ["xpufx-org/paseo"]);

    // Verify config persisted
    const saved = loadRouterConfig();
    assert.deepEqual(saved.pausedRepos, ["xpufx-org/paseo"]);

    // Toggle pause off
    const toggleRes = router.toggleRepoPause("xpufx-org/paseo");
    assert.equal(toggleRes.isPaused, false);
    assert.equal(router.isRepoPaused("xpufx-org/paseo"), false);
    assert.deepEqual(router.getPausedRepos(), []);

    // Enroll repo
    router.enrollRepo("xpufx-org/new-repo");
    assert.ok(router.getEnrolledRepos().includes("xpufx-org/new-repo"));

    // Unenroll repo (#867)
    router.unenrollRepo("xpufx-org/new-repo");
    assert.ok(!router.getEnrolledRepos().includes("xpufx-org/new-repo"));
  });

  it("reads the pre-#984 mutedRepos key and migrates it into pausedRepos", () => {
    const storage = getUppidiFleetSettingsStorage();
    storage.update((prev) => ({ ...prev, pausedRepos: [], mutedRepos: ["xpufx-org/legacy"] }));

    const loaded = loadRouterConfig();
    assert.deepEqual(loaded.pausedRepos, ["xpufx-org/legacy"]);

    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    assert.equal(router.isRepoPaused("xpufx-org/legacy"), true);

    // A write through the new key drops the legacy entry so an unpaused repo
    // cannot be resurrected by a stale alias on the next read.
    router.unpauseRepo("xpufx-org/legacy");
    assert.equal(router.isRepoPaused("xpufx-org/legacy"), false);
    assert.deepEqual(loadRouterConfig().pausedRepos, []);
    const raw = JSON.parse(readFileSync(storage.filePath, "utf8"));
    assert.equal(raw.mutedRepos, undefined);
  });

  it("suppresses queue drain when repository is paused and resumes on unpause", async () => {
    const key = "xpufx-org/paseo";
    const targetAgentId = "agent-orch-pause-1";
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
      queueDir,
      stateDir,
      port: 0,
    });

    // Write orchestrator mapping
    router.writeOrchestrator(key, targetAgentId);

    // Pause the repository
    router.pauseRepo(key);
    assert.equal(router.isRepoPaused(key), true);

    // Enqueue message while paused
    router.enqueue(key, "Paused webhook task");

    // Allow drain check to run
    await new Promise((r) => setTimeout(r, 20));

    // Message should NOT be sent because repo is paused!
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(key).length, 1);

    // Now unpause the repository
    router.unpauseRepo(key);
    assert.equal(router.isRepoPaused(key), false);

    // Trigger drain
    await router.drain(key);
    await new Promise((r) => setTimeout(r, 20));

    // Message should now be dispatched!
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0], "Paused webhook task");
    assert.equal(router.getQueue(key).length, 0);
  });

  it("getQueuesOverview and getStatusOverview report enrolled repositories even when queue depth is 0 (#448)", () => {
    const router = new HookRouter(null, {
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

  it("getFleetRosterInfo reports enrolled repos, paused repos, and queue depths", () => {
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
    });
    setActiveHookRouter(router);

    router.enrollRepo("xpufx-org/paseo");
    router.enrollRepo("xpufx-org/aur-automation");
    router.pauseRepo("xpufx-org/aur-automation");
    router.enqueue("xpufx-org/paseo", "Queued 1");
    router.enqueue("xpufx-org/paseo", "Queued 2");

    const info = getFleetRosterInfo();
    assert.ok(info.enrolledRepos.includes("xpufx-org/paseo"));
    assert.ok(info.enrolledRepos.includes("xpufx-org/aur-automation"));
    assert.deepEqual(info.pausedRepos, ["xpufx-org/aur-automation"]);
    assert.equal(info.repoQueuedHooks["xpufx-org/paseo"], 2);
  });

  it("reports only declared enrollment, not runtime queues or orchestrators (#1165)", () => {
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
    });
    setActiveHookRouter(router);

    router.enqueue("xpufx-org/ghost-repo", "Queued work");
    router.writeOrchestrator("xpufx-org/ghost-repo", "agent-ghost");

    assert.equal(router.isEnrolledRepo("xpufx-org/ghost-repo"), false);
    assert.ok(!router.getEnrolledRepos().includes("xpufx-org/ghost-repo"));

    const ghostInfo = getFleetRosterInfo();
    assert.ok(!ghostInfo.enrolledRepos.includes("xpufx-org/ghost-repo"));
    assert.equal(ghostInfo.repoQueuedHooks["xpufx-org/ghost-repo"], 1);

    router.enrollRepo("xpufx-org/declared-repo");
    assert.ok(router.getEnrolledRepos().includes("xpufx-org/declared-repo"));
    assert.ok(getFleetRosterInfo().enrolledRepos.includes("xpufx-org/declared-repo"));
  });

  it("stays unenrolled after unenroll even with an active queue and orchestrator (#1154, #1165)", () => {
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
    });
    setActiveHookRouter(router);

    router.enrollRepo("xpufx-org/durable-repo");
    router.enqueue("xpufx-org/durable-repo", "Queued work");
    router.writeOrchestrator("xpufx-org/durable-repo", "agent-durable");
    router.unenrollRepo("xpufx-org/durable-repo");

    assert.ok(!router.getEnrolledRepos().includes("xpufx-org/durable-repo"));
    assert.ok(!getFleetRosterInfo().enrolledRepos.includes("xpufx-org/durable-repo"));
    assert.ok(!(loadRouterConfig().enrolledRepos ?? []).includes("xpufx-org/durable-repo"));
    // Runtime state is still surfaced as queue depth, just not as enrollment.
    assert.equal(getFleetRosterInfo().repoQueuedHooks["xpufx-org/durable-repo"], 1);
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
    const digestFleet = parseFleetComment(digest.split("\n")[0]);
    assert.equal(digestFleet?.v, FLEET_ENVELOPE_VERSION);
    assert.equal(digestFleet?.origin, "router");
    assert.equal(digestFleet?.sender, ROUTER_SENDER);
    assert.equal(digestFleet?.repo, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(digestFleet?.kind, "webhook");
    assert.equal(digestFleet?.ref, 42);
    const digestBody = digest.split("\n").slice(1).join("\n");
    assert.ok(digestBody.startsWith(`${FORGEJO_DIGEST_PREFIX} `));
    assert.match(digestBody, /#42 Digest test \[state\/2-review\]/);
    assert.match(digestBody, /\(2 events: issue_comment:created, state-transition\)/);
    assert.ok(digestBody.includes("Latest comment: latest comment body"));
    assert.ok(digestBody.endsWith("https://forge.test/xpufx-org/paseo/issues/42"));
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
    assert.ok(queue[0].msg.startsWith('<!-- {"fleet"'));
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

  it("stamps watchdog alerts with the fleet envelope (#985)", async () => {
    await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "agent-1" }],
      agentMap: new Map(),
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    const miss = delivered.find((d) => d.msg.includes("was not found on daemon"));
    const fleet = parseFleetComment(miss?.msg);
    assert.equal(fleet?.v, FLEET_ENVELOPE_VERSION);
    assert.equal(fleet?.origin, "watchdog");
    assert.equal(fleet?.sender, WATCHDOG_SENDER);
    assert.equal(fleet?.kind, "alert");
    assert.equal(fleet?.repo, "test-repo");
    assert.equal(fleet?.ref, null);
    assert.ok(miss?.msg.startsWith('<!-- {"fleet"'));
    assert.ok(miss?.msg.endsWith("was not found on daemon."));
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

  it("auto-allows a safe fleet heredoc permission instead of wedging (#1084)", async () => {
    const logPath = join(tempDir, "permission-decisions.jsonl");
    const allowed: Array<[string, string]> = [];
    const heredoc =
      "teax issue comment 1084 --hostname forge.example.com -R owner/repo --envelope " +
      "-b \"$(cat <<'EOF'\nbody\nEOF\n)\"";
    const map = new Map<string, WatchdogAgent>([
      [
        "orch-1",
        {
          id: "orch-1",
          title: "Orchestrator · test-repo",
          status: "running",
          labels: { role: "orchestrator" },
          pendingPermissions: [{ id: "perm-hd", tool: "run_command", input: { command: heredoc } }],
        },
      ],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "orch-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
      allowFleetPermission: async (agentId, permissionId) => {
        allowed.push([agentId, permissionId]);
        return true;
      },
      adjudicationLogPath: logPath,
    });
    assert.ok(
      audit.anomalies.some((a) => a.type === "AGENT_PERMISSION_AUTO_ALLOWED" && a.agentId === "orch-1"),
    );
    assert.equal(
      audit.anomalies.some((a) => a.type === "AGENT_PERMISSION_REQUIRED"),
      false,
      "an auto-allowed permission must not also escalate",
    );
    assert.deepEqual(allowed, [["orch-1", "perm-hd"]]);
    assert.equal(delivered.length, 0, "auto-allowed permission does not page Front Desk");
    const records = readAdjudicationDecisions({ logPath });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.action, "auto-allow");
    assert.equal(records[0]!.ruleId, "teax-board");
  });

  it("escalates a destructive fleet command to Front Desk with the full command (#1084)", async () => {
    const logPath = join(tempDir, "permission-decisions.jsonl");
    const destructive = "rm -rf " + "/";
    const allowed: Array<[string, string]> = [];
    const map = new Map<string, WatchdogAgent>([
      [
        "worker-1",
        {
          id: "worker-1",
          title: "Worker One",
          status: "running",
          labels: { category: "worker" },
          pendingPermissions: [{ id: "perm-destr", tool: "run_command", input: { command: destructive } }],
        },
      ],
    ]);
    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "test-repo", agentId: "worker-1" }],
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
      allowFleetPermission: async (agentId, permissionId) => {
        allowed.push([agentId, permissionId]);
        return true;
      },
      adjudicationLogPath: logPath,
    });
    assert.ok(audit.anomalies.some((a) => a.type === "AGENT_PERMISSION_REQUIRED" && a.agentId === "worker-1"));
    assert.equal(allowed.length, 0, "destructive command must not reach the allow seam");
    assert.ok(
      delivered.some(
        (d) =>
          d.msg.includes("paseo permit allow worker-1 perm-destr") &&
          d.msg.includes(JSON.stringify(destructive)),
      ),
      "escalation carries the full command",
    );
    const records = readAdjudicationDecisions({ logPath });
    assert.equal(records.length, 1);
    assert.equal(records[0]!.action, "escalate");
  });

  it("never auto-allows a non-fleet agent's pending permission (#1084)", async () => {
    const allowed: Array<[string, string]> = [];
    const map = new Map<string, WatchdogAgent>([
      [
        "adhoc-1",
        {
          id: "adhoc-1",
          name: "my scratch session",
          status: "running",
          pendingPermissions: [{ id: "perm-adhoc", input: { command: "git status" } }],
        },
      ],
    ]);
    const audit = await router.runWatchdogAudit({
      agentMap: map,
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
      allowFleetPermission: async (agentId, permissionId) => {
        allowed.push([agentId, permissionId]);
        return true;
      },
    });
    assert.equal(allowed.length, 0);
    assert.ok(audit.anomalies.some((a) => a.type === "AGENT_PERMISSION_REQUIRED" && a.agentId === "adhoc-1"));
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

  it("never reloads a wedged orchestrator when the queue is empty even past the busy threshold (#1072)", async () => {
    (router as any).busyAttempts.set("drained-with-orch", 12);
    (router as any).queues.set("drained-with-orch", []);

    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "drained-with-orch", agentId: "agent-drained" }],
      agentMap: new Map([["agent-drained", { id: "agent-drained", status: "idle" }]]),
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.equal(
      audit.anomalies.some((a) => a.type === "QUEUE_WEDGED" && a.key === "drained-with-orch"),
      false,
    );
    assert.equal(reloaded.includes("agent-drained"), false);
    assert.equal(delivered.some((d) => d.msg.includes("Auto-recovered wedged queue for drained-with-orch")), false);
  });

  it("clears stale busy attempts once a queue has drained (#1072)", async () => {
    (router as any).busyAttempts.set("drained-with-orch", 5);
    (router as any).busyQueues.add("drained-with-orch");
    (router as any).queues.set("drained-with-orch", []);

    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [{ key: "drained-with-orch", agentId: "agent-drained" }],
      agentMap: new Map([["agent-drained", { id: "agent-drained", status: "idle" }]]),
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });
    assert.equal((router as any).busyAttempts.has("drained-with-orch"), false);
    assert.equal((router as any).busyQueues.has("drained-with-orch"), false);
    assert.equal(audit.audited.queues, 0);
  });

  it("flags un-orchestrated queues with pending messages and alerts Front Desk (#752)", async () => {
    (router as any).queues.set("forge.mrs.uppidi.com/xpufx-org/pending-repo", [
      { id: "m1", key: "forge.mrs.uppidi.com/xpufx-org/pending-repo", msg: "pending 1", ts: Date.now() },
      { id: "m2", key: "forge.mrs.uppidi.com/xpufx-org/pending-repo", msg: "pending 2", ts: Date.now() },
    ]);

    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [],
      agentMap: new Map(),
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });

    const unorch = audit.anomalies.find((a) => a.type === "QUEUE_UNORCHESTRATED");
    assert.ok(unorch, "expected QUEUE_UNORCHESTRATED anomaly");
    assert.equal(unorch?.key, "forge.mrs.uppidi.com/xpufx-org/pending-repo");
    assert.equal(unorch?.queueDepth, 2);
    assert.ok(
      delivered.some((d) =>
        d.msg.includes("pending-repo has 2 pending message(s) but no orchestrator is registered"),
      ),
    );
  });

  it("does not flag un-orchestrated queues when queue is empty or paused (#752)", async () => {
    (router as any).queues.set("empty-repo", []);
    (router as any).queues.set("paused-repo", [{ id: "m1", key: "paused-repo", msg: "p", ts: Date.now() }]);
    (router as any).pausedRepos.add("paused-repo");
    (router as any).queues.set("paused-repo", [{ id: "m2", key: "paused-repo", msg: "p", ts: Date.now() }]);
    (router as any).pausedQueues.add("paused-repo");

    const audit = await router.runWatchdogAudit({
      orchestratorRecords: [],
      agentMap: new Map(),
      deliver: fakeDeliver,
      reloadAgent: fakeReload,
    });

    assert.equal(
      audit.anomalies.some((a) => a.type === "QUEUE_UNORCHESTRATED"),
      false,
    );
  });
});

describe("watchdog metrics rollup tick (#560)", () => {
  let tempDir: string;
  let metricsFile: string;
  let router: HookRouter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-rollup-test-"));
    metricsFile = join(tempDir, "uppidi-fleet-metrics.json");
    setMetricsFilePathForTest(metricsFile);
    router = new HookRouter(null, {
      queueDir: join(tempDir, "queues"),
      stateDir: join(tempDir, "state"),
      port: 0,
    });
  });

  afterEach(() => {
    setMetricsFilePathForTest(null);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const metricsAgent = (id: string): WatchdogAgent => ({
    id,
    status: "idle",
    provider: "opencode",
    model: "deepseek-v4.1-flash",
    deterministicState: "idle:waiting",
    metrics: { contextUsedTokens: 40, contextMaxTokens: 100, costUsd: 1 },
  });

  it("writes a receipt from live metrics-bearing agents on the audit tick", async () => {
    await router.runWatchdogAudit({
      agentMap: new Map([["agent-1", metricsAgent("agent-1")]]),
      orchestratorRecords: [],
      deliver: async () => true,
      reloadAgent: async () => ({ ok: true }),
      metricsRollup: true,
    });

    // appendRollupReceipt is fire-and-forget; flush the microtask/IO queue.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(existsSync(metricsFile), true);
    const persisted = JSON.parse(readFileSync(metricsFile, "utf8"));
    assert.equal(persisted.receipts.length, 1);
    assert.equal(persisted.receipts[0].model, "deepseek-v4.1-flash");
    assert.equal(persisted.receipts[0].turnsCompleted, 1);
  });

  it("does not write when no agent has metrics, and can be disabled", async () => {
    await router.runWatchdogAudit({
      agentMap: new Map([["agent-plain", { id: "agent-plain", status: "idle" }]]),
      orchestratorRecords: [],
      deliver: async () => true,
      reloadAgent: async () => ({ ok: true }),
      metricsRollup: true,
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(existsSync(metricsFile), false);

    await router.runWatchdogAudit({
      agentMap: new Map([["agent-1", metricsAgent("agent-1")]]),
      orchestratorRecords: [],
      deliver: async () => true,
      reloadAgent: async () => ({ ok: true }),
      metricsRollup: false,
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(existsSync(metricsFile), false);
  });

  it("gates repeated ticks behind the metrics_rollup cooldown", async () => {
    const map = new Map([["agent-1", metricsAgent("agent-1")]]);
    const audit = { agentMap: map, orchestratorRecords: [], deliver: async () => true, reloadAgent: async () => ({ ok: true }), metricsRollup: true };
    await router.runWatchdogAudit({ ...audit, now: 1_000_000 });
    await new Promise((r) => setTimeout(r, 50));
    await router.runWatchdogAudit({ ...audit, now: 1_000_001 });
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(router.canWatchdogAlert("metrics_rollup", 1_000_001), false);
    const persisted = JSON.parse(readFileSync(metricsFile, "utf8"));
    assert.equal(persisted.receipts.length, 1);
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

  it("classifies only worker children as wakeup candidates (#895)", () => {
    const worker: WatchdogAgent = { id: "c", status: "idle", labels: childLabels };
    assert.equal(isChildWakeupCandidate(worker), true);
    assert.equal(isChildWakeupCandidate({ ...worker, role: "orchestrator" }), false);
    assert.equal(isChildWakeupCandidate({ ...worker, labels: { ...childLabels, role: "orchestrator" } }), false);
    assert.equal(isChildWakeupCandidate({ ...worker, title: "ping" }), false);
    assert.equal(isChildWakeupCandidate({ ...worker, title: "canary", labels: { ...childLabels, "paseo.probe": "true" } }), false);
    assert.equal(isChildWakeupCandidate(worker, { frontDeskId: parentId }), false);
    assert.equal(isChildWakeupCandidate({ ...worker, labels: {} }), false);
    assert.equal(isOrchestratorAgent({ labels: { category: "orchestrator" } }), true);
    assert.equal(isProbeAgent({ title: "ping" }), true);
  });

  it("excludes orchestrator peers from child wakeups (#895)", async () => {
    const map = new Map<string, WatchdogAgent>([
      [parentId, parentAgent],
      [
        "orch-peer",
        {
          id: "orch-peer",
          title: "Orchestrator · xpufx-org/paseo",
          status: "idle",
          role: "orchestrator",
          labels: childLabels,
        },
      ],
    ]);
    const audit = await router.runWatchdogAudit({ agentMap: map, deliver, reloadAgent: async () => ({ ok: true }) });
    assert.equal(audit.anomalies.filter((a) => a.type === "CHILD_WAKEUP").length, 0);
    assert.equal(delivered.filter((d) => d.msg.includes("Subagent")).length, 0);
    assert.equal(assessChildWakeup("orch-peer", { id: "orch-peer", role: "orchestrator", status: "idle" }), null);
  });

  it("excludes children whose parent is the registered Front Desk (#895)", async () => {
    const frontDeskId = "front-desk-895";
    const fdChildLabels = { "paseo.parent-agent-id": frontDeskId };
    const map = new Map<string, WatchdogAgent>([
      [frontDeskId, { id: frontDeskId, title: "Front Desk", status: "idle" }],
      ["fd-child", { id: "fd-child", title: "Worker", status: "idle", labels: fdChildLabels }],
    ]);
    const audit = await router.runWatchdogAudit({
      agentMap: map,
      frontDeskId,
      deliver,
      reloadAgent: async () => ({ ok: true }),
    });
    assert.equal(audit.anomalies.filter((a) => a.type === "CHILD_WAKEUP").length, 0);
    assert.equal(delivered.filter((d) => d.msg.includes("Subagent")).length, 0);
    assert.equal(
      assessChildWakeup("fd-child", { id: "fd-child", status: "idle", labels: fdChildLabels }, { frontDeskId }),
      null,
    );
  });

  it("excludes ping health canaries from child wakeups (#891/#895)", async () => {
    const map = new Map<string, WatchdogAgent>([
      [parentId, parentAgent],
      ["probe-ping", { id: "probe-ping", title: "ping", status: "idle", labels: childLabels }],
      [
        "probe-labelled",
        { id: "probe-labelled", title: "canary", status: "idle", labels: { ...childLabels, "paseo.probe": "true" } },
      ],
    ]);
    const audit = await router.runWatchdogAudit({ agentMap: map, deliver, reloadAgent: async () => ({ ok: true }) });
    assert.equal(audit.anomalies.filter((a) => a.type === "CHILD_WAKEUP").length, 0);
    assert.equal(delivered.filter((d) => d.msg.includes("Subagent")).length, 0);
    assert.equal(
      assessChildWakeup("probe-ping", { id: "probe-ping", title: "ping", status: "idle", labels: childLabels }),
      null,
    );
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

  it("keeps a registration and marks it stale on first absence (#889)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-keep", "agent-keep");
    router.writeOrchestrator("repo-stale", "agent-dead");

    const result = await router.pruneOrchestrators({
      orchestratorRecords: [
        { key: "repo-keep", agentId: "agent-keep" },
        { key: "repo-stale", agentId: "agent-dead" },
      ],
      agentMap: new Map([["agent-keep", { id: "agent-keep", status: "idle" }]]),
    });

    assert.equal(result.ok, true);
    assert.equal(result.prunedCount, 0, "first absence must never hard-delete");
    assert.equal(result.markedStale?.length, 1);
    assert.equal(result.markedStale?.[0]?.key, "repo-stale");
    assert.equal(result.markedStale?.[0]?.missCount, 1);
    assert.equal(router.readOrchestrator("repo-keep")?.agentId, "agent-keep");

    const stale = router.readOrchestrator("repo-stale");
    assert.equal(stale?.agentId, "agent-dead", "registration must survive a transient absence");
    assert.equal(stale?.stale, true);
    assert.equal(stale?.missCount, 1);
  });

  it("clears stale markers when an absent agent reappears (#889)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-transient", "agent-flaky");

    const first = await router.pruneOrchestrators({
      orchestratorRecords: router.listOrchestratorRecords(),
      agentMap: new Map(),
    });
    assert.equal(first.prunedCount, 0);
    assert.equal(router.readOrchestrator("repo-transient")?.stale, true);

    const second = await router.pruneOrchestrators({
      orchestratorRecords: router.listOrchestratorRecords(),
      agentMap: new Map([["agent-flaky", { id: "agent-flaky", status: "idle" }]]),
    });
    assert.equal(second.prunedCount, 0);
    assert.deepEqual(second.recovered, ["repo-transient"]);
    const recovered = router.readOrchestrator("repo-transient");
    assert.equal(recovered?.agentId, "agent-flaky");
    assert.equal(recovered?.stale, false);
    assert.equal(recovered?.missCount, 0);
  });

  it("hard-deletes only after the grace window and positive verification (#889)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-gone", "agent-gone");
    const verified: string[] = [];
    const opts = {
      agentMap: new Map<string, WatchdogAgent>(),
      verifyAgentAbsent: async (id: string) => {
        verified.push(id);
        return true;
      },
    };

    const first = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    assert.equal(first.prunedCount, 0);
    const second = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    assert.equal(second.prunedCount, 0);
    assert.equal(verified.length, 0, "verification must not run during the grace window");

    const third = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    assert.equal(third.prunedCount, 1);
    assert.equal(third.pruned[0].key, "repo-gone");
    assert.deepEqual(verified, ["agent-gone"]);
    assert.equal(router.readOrchestrator("repo-gone"), null);
  });

  it("keeps the registration stale when verification cannot confirm absence (#889)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-unconfirmed", "agent-unconfirmed");
    const opts = {
      agentMap: new Map<string, WatchdogAgent>(),
      verifyAgentAbsent: async () => false,
    };

    for (let i = 0; i < 4; i++) {
      await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    }

    const record = router.readOrchestrator("repo-unconfirmed");
    assert.equal(record?.agentId, "agent-unconfirmed");
    assert.equal(record?.stale, true);
    assert.equal(record?.missCount, 3);
  });

  it("never unlinks a registration from a partial (SDK-only) roster (#1068)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-other-workspace", "agent-other-ws");
    // The SDK list is workspace-scoped: it returns this workspace's agents but
    // omits a live orchestrator registered in another workspace. The global CLI
    // roster is unavailable, so the merged map is only partial (#1068).
    (router as any).activePaseo = {
      agents: {
        list: async () => ({ entries: [{ id: "agent-in-this-workspace", status: "idle" }] }),
      },
    };
    const calls: string[][] = [];
    setExecFileAsyncForTest(async (_cmd: string, args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "ls") throw new Error("global roster unavailable");
      if (args[0] === "agent" && args[1] === "inspect") {
        // A scoped inspect cannot see the agent in the other workspace.
        return { stdout: JSON.stringify({ error: { code: "AGENT_NOT_FOUND" } }) };
      }
      return { stdout: "" };
    });
    try {
      for (let i = 0; i < 5; i++) {
        await router.pruneOrchestrators({ orchestratorRecords: router.listOrchestratorRecords() });
      }
    } finally {
      setExecFileAsyncForTest(null);
    }

    const record = router.readOrchestrator("repo-other-workspace");
    assert.equal(record?.agentId, "agent-other-ws", "a partial roster must never unlink a live orchestrator");
    assert.equal(record?.stale, true);
    assert.equal(
      calls.some((c) => c[0] === "agent" && c[1] === "inspect"),
      false,
      "a partial roster must not trigger destructive verification",
    );
  });

  it("unions the SDK list with the global CLI roster (#1068)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    (router as any).activePaseo = {
      agents: {
        list: async () => ({ entries: [{ id: "sdk-only", status: "idle" }] }),
      },
    };
    setExecFileAsyncForTest(async (_cmd: string, args: readonly string[]) => {
      if (args[0] === "ls") return { stdout: JSON.stringify([{ id: "cli-global", status: "idle" }]) };
      return { stdout: "" };
    });
    try {
      const map = await router.fetchAgentMap();
      assert.ok(map);
      assert.equal(map!.has("sdk-only"), true, "SDK entries must survive the CLI merge");
      assert.equal(map!.has("cli-global"), true, "the global CLI roster must always be consulted");
    } finally {
      setExecFileAsyncForTest(null);
    }
  });

  it("deleteOrchestrator reports not found on a repeat delete", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-del", "agent-del");
    assert.equal(router.deleteOrchestrator("repo-del").ok, true);
    const second = router.deleteOrchestrator("repo-del");
    assert.equal(second.ok, false);
    assert.equal(second.error, "not found");
  });

  it("archives a closed orchestrator session and unlinks it only after the grace window (#973/#1077)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-closed", "agent-closed");
    const archivedIds: string[] = [];
    const opts = {
      agentMap: new Map([["agent-closed", { id: "agent-closed", status: "closed" }]]),
      archiveAgent: async (id: string) => {
        archivedIds.push(id);
        return true;
      },
    };

    const first = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    const second = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    assert.equal(first.prunedCount, 0, "a single closed observation must not unlink");
    assert.equal(second.prunedCount, 0);
    assert.deepEqual(archivedIds, []);
    assert.equal(router.readOrchestrator("repo-closed")?.agentId, "agent-closed");

    const third = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    assert.equal(third.ok, true);
    assert.deepEqual(archivedIds, ["agent-closed"]);
    assert.equal(third.prunedCount, 1);
    assert.equal(third.pruned[0].key, "repo-closed");
    assert.deepEqual(third.archived, [
      { key: "repo-closed", agentId: "agent-closed", reason: "closed session archived and unlinked" },
    ]);
    assert.equal(router.readOrchestrator("repo-closed"), null);
  });

  it("keeps a closed registration when archival fails so a later sweep retries (#973)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-closed", "agent-closed");

    const result = await router.pruneOrchestrators({
      orchestratorRecords: router.listOrchestratorRecords(),
      agentMap: new Map([["agent-closed", { id: "agent-closed", status: "closed" }]]),
      archiveAgent: async () => false,
      graceSweeps: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.prunedCount, 0);
    assert.equal(router.readOrchestrator("repo-closed")?.agentId, "agent-closed");
  });

  it("unlinks an already-archived session without re-archiving (#973)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-archived", "agent-archived");
    const archivedIds: string[] = [];

    const result = await router.pruneOrchestrators({
      orchestratorRecords: router.listOrchestratorRecords(),
      agentMap: new Map([
        ["agent-archived", { id: "agent-archived", status: "closed", archivedAt: "2026-01-01T00:00:00Z" }],
      ]),
      archiveAgent: async (id) => {
        archivedIds.push(id);
        return true;
      },
    });

    assert.deepEqual(archivedIds, []);
    assert.equal(result.archived?.[0]?.reason, "archived session unlinked");
    assert.equal(router.readOrchestrator("repo-archived"), null);
  });

  it("archiveAgent uses the daemon SDK ref when available (#973)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    const archived: string[] = [];
    (router as any).activePaseo = {
      agents: {
        ref: (id: string) => ({
          archive: async () => {
            archived.push(id);
          },
        }),
      },
    };

    assert.equal(await router.archiveAgent("agent-sdk"), true);
    assert.deepEqual(archived, ["agent-sdk"]);
  });

  it("dry-run reports closed sessions without archiving or unlinking (#973)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-closed", "agent-closed");
    const archivedIds: string[] = [];

    const result = await router.pruneOrchestrators({
      orchestratorRecords: router.listOrchestratorRecords(),
      agentMap: new Map([["agent-closed", { id: "agent-closed", status: "closed" }]]),
      archiveAgent: async (id) => {
        archivedIds.push(id);
        return true;
      },
      dryRun: true,
    });

    assert.deepEqual(archivedIds, []);
    assert.equal(result.dryRun, true);
    assert.equal(router.readOrchestrator("repo-closed")?.agentId, "agent-closed");
  });

  it("keeps a live registration when a partial roster reports it closed (#1077)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-other-workspace", "agent-other-ws");
    // The workspace-scoped SDK list sees a stale closed session, while the
    // global CLI roster (the completeness guarantee) is unavailable.
    (router as any).activePaseo = {
      agents: {
        list: async () => ({ entries: [{ id: "agent-other-ws", status: "closed" }] }),
        ref: () => ({ archive: async () => {} }),
      },
    };
    setExecFileAsyncForTest(async (_cmd: string, args: readonly string[]) => {
      if (args[0] === "ls") throw new Error("global roster unavailable");
      return { stdout: "" };
    });
    try {
      for (let i = 0; i < 5; i++) {
        await router.pruneOrchestrators({ orchestratorRecords: router.listOrchestratorRecords() });
      }
    } finally {
      setExecFileAsyncForTest(null);
    }

    const record = router.readOrchestrator("repo-other-workspace");
    assert.equal(record?.agentId, "agent-other-ws", "a partial roster must never unlink a registration");
    assert.equal(record?.stale, true);
  });

  it("requires consecutive closed sweeps before archiving a live orchestrator (#1077)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-flap", "agent-flap");
    const archivedIds: string[] = [];
    const opts = {
      agentMap: new Map([["agent-flap", { id: "agent-flap", status: "closed" }]]),
      archiveAgent: async (id: string) => {
        archivedIds.push(id);
        return true;
      },
    };

    const first = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    assert.equal(first.prunedCount, 0, "a momentary close must not unlink");
    assert.equal(router.readOrchestrator("repo-flap")?.closedSweeps, 1);
    const second = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    assert.equal(second.prunedCount, 0);
    assert.equal(router.readOrchestrator("repo-flap")?.agentId, "agent-flap");

    const third = await router.pruneOrchestrators({ ...opts, orchestratorRecords: router.listOrchestratorRecords() });
    assert.equal(third.prunedCount, 1);
    assert.deepEqual(archivedIds, ["agent-flap"]);
    assert.equal(router.readOrchestrator("repo-flap"), null);
  });

  it("appends durable actor records for every deleteOrchestrator and front-desk clear (#1077)", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("repo-audit", "agent-audit");
    const del = router.deleteOrchestrator("repo-audit", {
      source: "unit:delete",
      reason: "test delete",
      actor: "agent-actor",
    });
    assert.equal(del.ok, true);

    router.writeFrontDesk("fd-audit", "operator");
    const cleared = router.clearFrontDesk({ source: "unit:clear-frontdesk", reason: "test clear" });
    assert.ok(cleared >= 1);

    assert.equal(existsSync(router.stateMutationLogPath()), true);
    const log = router.readStateMutations(10);
    const delEntry = log.find((e) => e.action === "deleteOrchestrator");
    assert.equal(delEntry?.source, "unit:delete");
    assert.equal(delEntry?.actor, "agent-actor");
    assert.equal(delEntry?.reason, "test delete");
    assert.equal(delEntry?.key, "repo-audit");
    assert.match(String(delEntry?.stack), /deleteOrchestrator/);
    const removed = (delEntry?.priorValue as Array<{ record: { agentId: string } | null }>)[0];
    assert.equal(removed?.record?.agentId, "agent-audit");

    const fdEntry = log.find((e) => e.action === "clearFrontDesk");
    assert.equal(fdEntry?.source, "unit:clear-frontdesk");
    assert.equal((fdEntry?.priorValue as any)?.record?.agentId, "fd-audit");
  });

  it("keeps the desk and registry across partial/closed prune sweeps and teardown reconciliation (#1077)", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    for (let i = 0; i < 4; i++) {
      router.writeOrchestrator(`repo-${i}`, `agent-${i}`);
    }
    router.writeFrontDesk("fd-survivor", "operator");
    assert.equal(router.listOrchestratorRecords().length, 4);

    (router as any).activePaseo = {
      agents: {
        list: async () => ({ entries: [{ id: "agent-0", status: "closed" }] }),
        ref: () => ({ archive: async () => {} }),
      },
    };
    setExecFileAsyncForTest(async (_cmd: string, args: readonly string[]) => {
      if (args[0] === "ls") throw new Error("global roster unavailable");
      return { stdout: "" };
    });
    try {
      for (let i = 0; i < 4; i++) {
        await router.pruneOrchestrators();
      }
      assert.equal(router.listOrchestratorRecords().length, 4, "partial/closed sweeps must not drop the registry");

      // Tombstone/teardown reconciliation for workers must not touch either scope.
      (router as any).markFleetTeardown(["workers"], []);
      assert.equal(router.listOrchestratorRecords().length, 4);
      assert.equal(router.readFrontDesk()?.agentId, "fd-survivor");
    } finally {
      setExecFileAsyncForTest(null);
    }
  });

  it("reads frontdesk.json from the persisted orchestrators dir (#1077)", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    const persistedRoot = join(tempDir, "persisted");
    const persistedOrch = join(persistedRoot, "orchestrators");
    const prev = process.env.HOOK_STATE_DIR;
    mkdirSync(persistedOrch, { recursive: true });
    process.env.HOOK_STATE_DIR = persistedRoot;
    try {
      writeFileSync(
        join(persistedOrch, "frontdesk.json"),
        JSON.stringify({ version: 1, agentId: "fd-nested", updatedAt: null, by: "frontdesk" }),
      );
      assert.equal(router.readFrontDesk()?.agentId, "fd-nested", "a present frontdesk.json must never read as null");
    } finally {
      if (prev === undefined) delete process.env.HOOK_STATE_DIR;
      else process.env.HOOK_STATE_DIR = prev;
    }
  });
});

describe("hook-router bidirectional repo key reconciliation (#752)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-reconcile-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("resolves orchestrator bidirectionally between short and canonical keys", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    // Registered with short key
    router.writeOrchestrator("xpufx-org/paseo", "agent-short");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-short");
    assert.equal(router.readOrchestrator("forge.mrs.uppidi.com/xpufx-org/paseo")?.agentId, "agent-short");
    assert.equal(router.readOrchestrator("https://forge.mrs.uppidi.com/xpufx-org/paseo.git")?.agentId, "agent-short");

    // Registered with long key
    router.writeOrchestrator("forge.mrs.uppidi.com/xpufx-org/platform", "agent-long");
    assert.equal(router.readOrchestrator("xpufx-org/platform")?.agentId, "agent-long");
    assert.equal(router.readOrchestrator("forge.mrs.uppidi.com/xpufx-org/platform")?.agentId, "agent-long");
  });

  it("deduplicates listOrchestratorRecords to canonical key", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("xpufx-org/paseo", "agent-paseo");
    router.writeOrchestrator("forge.mrs.uppidi.com/xpufx-org/platform", "agent-platform");

    const records = router.listOrchestratorRecords();
    assert.equal(records.length, 2);
    assert.equal(records[0].key, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.equal(records[0].agentId, "agent-paseo");
    assert.equal(records[1].key, "forge.mrs.uppidi.com/xpufx-org/platform");
    assert.equal(records[1].agentId, "agent-platform");
  });

  it("deletes all candidate files on deleteOrchestrator", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator("xpufx-org/paseo", "agent-paseo");
    assert.ok(router.readOrchestrator("xpufx-org/paseo"));
    assert.ok(router.readOrchestrator("forge.mrs.uppidi.com/xpufx-org/paseo"));

    const delRes = router.deleteOrchestrator("xpufx-org/paseo");
    assert.equal(delRes.ok, true);
    assert.equal(router.readOrchestrator("xpufx-org/paseo"), null);
    assert.equal(router.readOrchestrator("forge.mrs.uppidi.com/xpufx-org/paseo"), null);
  });
});

describe("hook-router Front Desk handoff (#458)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let router: HookRouter;
  let sent: Array<{ id: string; text: string; options?: any }>;
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
          send: async (text: string, options?: any) => {
            sent.push({ id, text, options });
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

  it("wraps onboarding, handover, and stand-down notices in `fleet_envelope` attachments (#985/#1003)", async () => {
    router.writeOrchestrator("forge.test/xpufx-org/paseo", "orch-agent-1");
    router.writeFrontDesk("fd-old", "test");

    await router.doFrontDeskHandoff({ agentId: "fd-new", handoffText: "# New Front Desk" });

    const onboarding = sent.find((s) => s.id === "fd-new");
    const onboardingFleet = parseFleetAttachment(onboarding?.options);
    assert.equal(onboardingFleet?.origin, "router");
    assert.equal(onboardingFleet?.sender, ROUTER_SENDER);
    assert.equal(onboardingFleet?.repo, FRONT_DESK_REPO);
    assert.equal(onboardingFleet?.kind, "handoff");
    assert.equal(onboarding?.text.includes("<!-- {"), false);
    assert.ok(onboarding?.text.includes("You are now the Front Desk agent"));

    const handover = sent.find((s) => s.id === "orch-agent-1");
    const handoverFleet = parseFleetAttachment(handover?.options);
    assert.equal(handoverFleet?.origin, "router");
    assert.equal(handoverFleet?.repo, "forge.test/xpufx-org/paseo");
    assert.equal(handoverFleet?.kind, "handoff");
    assert.ok(handover?.text.includes("Front Desk handover"));

    const standDown = sent.find((s) => s.id === "fd-old");
    const standDownFleet = parseFleetAttachment(standDown?.options);
    assert.equal(standDownFleet?.origin, "router");
    assert.equal(standDownFleet?.sender, ROUTER_SENDER);
    assert.equal(standDownFleet?.repo, FRONT_DESK_REPO);
    assert.equal(standDownFleet?.kind, "handoff");
    assert.ok(standDown?.text.includes("You are no longer Front Desk"));
    assert.ok(standDown?.text.includes("registry authority is now fd-new"));
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

    router = new HookRouter(server, {
      queueDir,
      stateDir,
      port: 0,
      spawnAgent: async () => ({ id: "mock-http-extra-agent" }),
    });
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

  /**
   * `POST /orchestrators/prune` calls `pruneOrchestrators()` with no arguments,
   * so the route resolves its agent roster from a live daemon (`fetchAgentMap` ->
   * `paseo ls --json`) and has no `agentMap` injection seam the way the
   * in-process test at "deletes orchestrator records for agents that no longer
   * exist on the daemon" does. A stand-in `paseo` on PATH pins the roster so the
   * route is asserted against a known agent list rather than against whatever
   * daemon the developer happens to be running — the assertion passed locally for
   * years only because a live daemon answered.
   *
   * Scoped to the one test that needs it on purpose: the Front Desk routes read
   * the same CLI through `getActiveAgentIds()`, and their tests rely on the
   * daemon-unreachable path, where an empty active set means "notify every
   * orchestrator". A file-wide stub would quietly change what those assert.
   */
  async function withStubbedPaseoAgents<T>(agents: { id: string; status: string }[], fn: () => Promise<T>): Promise<T> {
    const binDir = mkdtempSync(join(tmpdir(), "paseo-stub-cli-"));
    const prevPath = process.env.PATH;
    try {
      writeFileSync(
        join(binDir, "paseo"),
        `#!/bin/sh\nif [ "$1" = "ls" ] && [ "$2" = "--json" ]; then\n  printf '%s' '${JSON.stringify(agents)}'\n  exit 0\nfi\nif [ "$1" = "agent" ] && [ "$2" = "inspect" ]; then\n  printf '%s' '{"error":{"code":"AGENT_NOT_FOUND","message":"Agent not found"}}'\n  exit 0\nfi\nexit 127\n`,
        { mode: 0o755 },
      );
      process.env.PATH = `${binDir}:${prevPath ?? ""}`;
      return await fn();
    } finally {
      if (prevPath === undefined) delete process.env.PATH;
      else process.env.PATH = prevPath;
      try {
        rmSync(binDir, { recursive: true, force: true });
      } catch {}
    }
  }

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

  it("prunes stale orchestrators via POST /orchestrators/prune after the grace window (#889)", async () => {
    router.writeOrchestrator("repo-stale", "agent-does-not-exist");
    router.writeOrchestrator("repo-live", "agent-live");
    let body: any = null;
    await withStubbedPaseoAgents([{ id: "agent-live", status: "running" }], async () => {
      for (let i = 0; i < 3; i++) {
        const res = await fetch(`http://127.0.0.1:${router.port}/orchestrators/prune`, { method: "POST" });
        assert.equal(res.status, 200);
        body = await res.json();
        assert.equal(body.ok, true);
      }
    });
    assert.equal(body.prunedCount, 1);
    assert.equal(body.pruned[0].key, "repo-stale");
    assert.equal(router.readOrchestrator("repo-live")?.agentId, "agent-live");
    assert.equal(router.readOrchestrator("repo-stale"), null);
  });

  it("runs a board sweep via POST /board-sweep over explicit repos (debug override)", async () => {
    // The external checker is retired (#733); this exercises the documented
    // FORGEJO_ISSUES_CHECK debug-only override, not the primary path.
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

  it("parses debug-override checker JSON even when the checker exits non-zero", async () => {
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

  it("runs the in-process board check with an injected io (#733)", async () => {
    const saved: string[] = [];
    const io: IssuesCheckIo = {
      getOpenIssues: async () => ({
        ok: true,
        issues: [
          {
            number: 5,
            title: "t",
            state: "open",
            updated_at: "2026-01-01T00:00:00Z",
            created_at: "2026-01-01T00:00:00Z",
            comments: 0,
            labels: [{ name: "spec/2-approved" }, { name: "attention/1-agent" }, { name: "target/uppidi-fleet" }],
          },
        ],
      }),
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async () => true,
      // Stale cache entry so issue 5 counts as changed-but-seen: the
      // dispatchable classification path, not the first-seen one.
      loadCache: async () => ({
        5: { updated_at: "2025-12-01T00:00:00Z", labels: ["stale-marker"], comments_count: 0 },
      }),
      saveCache: async (state, repo) => {
        saved.push(`${repo}:${Object.keys(state).join(",")}`);
      },
    };
    const result = await router.runBoardCheck("forge.test/xpufx-org/paseo", "forge.test", io);
    assert.equal(result.ok, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].number, 5);
    assert.equal(result.candidates[0].is_dispatchable, true);
    assert.ok(result.candidates[0].reason.includes("[target/uppidi-fleet]"));
    assert.deepEqual(saved, ["xpufx-org/paseo:5"]);
  });

  it("board sweep reports a failed repo check loudly instead of a silent ok:false (#733)", async () => {
    const result = await router.runBoardSweep(
      ["forge.test/xpufx-org/paseo"],
      failingBoardIo("teax issues query failed (rc=7): boom"),
    );
    assert.equal(result.ok, true);
    assert.equal(result.swept, 1);
    assert.equal(result.actionable.length, 0);
    assert.equal(result.errors?.length, 1);
    assert.equal(result.errors?.[0].repo, "forge.test/xpufx-org/paseo");
    assert.match(result.errors?.[0].error ?? "", /teax issues query failed/);
    assert.ok(
      getHookLogs().some((line) => line.includes("[error] board check failed for forge.test/xpufx-org/paseo")),
    );
  });

  it("notifies Front Desk when a repo board check fails (#733)", async () => {
    router.writeFrontDesk("agent-front");
    const sendLog = join(tempDir, "paseo-send.log");
    const binDir = mkdtempSync(join(tmpdir(), "paseo-stub-send-"));
    const prevPath = process.env.PATH;
    try {
      writeFileSync(
        join(binDir, "paseo"),
        `#!/bin/sh\nif [ "$1" = "send" ]; then\n  printf '%s\\n' "$*" >> ${JSON.stringify(sendLog)}\n  exit 0\nfi\nexit 127\n`,
        { mode: 0o755 },
      );
      process.env.PATH = `${binDir}:${prevPath ?? ""}`;
      const result = await router.runBoardSweep(
        ["forge.test/xpufx-org/paseo"],
        failingBoardIo("teax issues query failed (rc=127): not found"),
      );
      assert.equal(result.notified, 1);
      const sent = readFileSync(sendLog, "utf8");
      assert.ok(sent.includes("FAILED board check"), `front desk message missing failure section: ${sent}`);
      assert.ok(sent.includes("forge.test/xpufx-org/paseo"));
      assert.ok(sent.includes("agent-front"));
    } finally {
      if (prevPath === undefined) delete process.env.PATH;
      else process.env.PATH = prevPath;
      try {
        rmSync(binDir, { recursive: true, force: true });
      } catch {}
    }
  });
});

describe("in-router stale-WIP sweep (#920)", () => {
  let tempDir: string;
  let router: HookRouter;

  beforeEach(() => {
    clearSettingsStorage();
    tempDir = mkdtempSync(join(tmpdir(), "stale-wip-sweep-test-"));
    router = new HookRouter(null, { queueDir: tempDir });
  });

  afterEach(() => {
    router.stopBackgroundLoops();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("staleWipSweepEnabled defaults to false in test mode and reflects options", () => {
    assert.equal(router.staleWipSweepEnabled, false);
    const enabledRouter = new HookRouter(null, {
      queueDir: tempDir,
      staleWipSweepEnabled: true,
      staleWipHours: 3,
    });
    assert.equal(enabledRouter.staleWipSweepEnabled, true);
    assert.equal(enabledRouter.staleWipHours, 3);
  });

  it("skips stale WIP sweep when staleWipSweepEnabled is false", async () => {
    const staleDate = new Date(Date.now() - 5 * 3600 * 1000).toISOString();
    const staleCommands: string[][] = [];
    const io: IssuesCheckIo = {
      getOpenIssues: async () => ({
        ok: true,
        issues: [
          {
            number: 42,
            title: "Stuck task",
            state: "open",
            updated_at: staleDate,
            created_at: staleDate,
            comments: 0,
            labels: [{ name: "state/1-wip" }],
          },
        ],
      }),
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async (cmd) => {
        staleCommands.push(cmd);
        return true;
      },
      loadCache: async () => ({}),
      saveCache: async () => {},
    };

    const res = await router.runBoardCheck("xpufx-org/paseo", "forge.test", io);
    assert.equal(res.ok, true);
    assert.deepEqual(res.staleWipRecovery, []);
    assert.equal(staleCommands.length, 0);
  });

  it("runs stale WIP sweep, posts reminder and updates labels when staleWipSweepEnabled is true", async () => {
    const activeRouter = new HookRouter(null, {
      queueDir: tempDir,
      staleWipSweepEnabled: true,
      staleWipHours: 2,
    });
    const staleDate = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
    const commandCalls: Array<{ command: string[]; inputText?: string }> = [];
    const io: IssuesCheckIo = {
      getOpenIssues: async () => ({
        ok: true,
        issues: [
          {
            number: 42,
            title: "Stuck task",
            state: "open",
            updated_at: staleDate,
            created_at: staleDate,
            comments: 0,
            labels: [{ name: "state/1-wip" }],
          },
        ],
      }),
      getLatestComments: async () => [],
      getIssueComments: async () => [],
      runStaleWipCommand: async (command, inputText) => {
        commandCalls.push({ command, inputText });
        return true;
      },
      loadCache: async () => ({}),
      saveCache: async () => {},
    };

    const sweepResult = await activeRouter.runBoardSweep(["xpufx-org/paseo"], io);
    assert.equal(sweepResult.ok, true);
    assert.ok(sweepResult.staleWipRecovered);
    assert.equal(sweepResult.staleWipRecovered.length, 1);
    assert.deepEqual(sweepResult.staleWipRecovered[0], {
      number: 42,
      reminded: true,
      recovered: true,
      dry_run: false,
    });

    // 2 commands: comment creation (teax api -X POST) and label edit (teax issue edit)
    assert.equal(commandCalls.length, 2);
    const commentCall = commandCalls[0];
    assert.ok(commentCall.command.join(" ").includes("repos/xpufx-org/paseo/issues/42/comments"));
    assert.ok(commentCall.inputText?.includes(STALE_WIP_REMINDER_MARKER));
    assert.ok(commentCall.inputText?.includes("WIP has had no update past the configured timeout"));

    const labelCall = commandCalls[1];
    const labelCmd = labelCall.command.join(" ");
    assert.ok(labelCmd.includes("issue edit 42"));
    assert.ok(labelCmd.includes("--add-label attention/orchestrator"));
    assert.ok(labelCmd.includes("--remove-label state/wip"));
  });

  it("is idempotent and avoids duplicate comment when reminder marker already exists", async () => {
    const activeRouter = new HookRouter(null, {
      queueDir: tempDir,
      staleWipSweepEnabled: true,
      staleWipHours: 2,
    });
    const staleDate = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
    const commandCalls: Array<{ command: string[]; inputText?: string }> = [];
    const io: IssuesCheckIo = {
      getOpenIssues: async () => ({
        ok: true,
        issues: [
          {
            number: 42,
            title: "Stuck task",
            state: "open",
            updated_at: staleDate,
            created_at: staleDate,
            comments: 1,
            labels: [{ name: "state/1-wip" }],
          },
        ],
      }),
      getLatestComments: async () => [],
      getIssueComments: async () => [
        {
          id: 101,
          body: `Notice\n\n${STALE_WIP_REMINDER_MARKER}`,
          created_at: staleDate,
          updated_at: staleDate,
        },
      ],
      runStaleWipCommand: async (command, inputText) => {
        commandCalls.push({ command, inputText });
        return true;
      },
      loadCache: async () => ({}),
      saveCache: async () => {},
    };

    const sweepResult = await activeRouter.runBoardSweep(["xpufx-org/paseo"], io);
    assert.equal(sweepResult.ok, true);
    assert.ok(sweepResult.staleWipRecovered);
    assert.equal(sweepResult.staleWipRecovered.length, 1);
    assert.deepEqual(sweepResult.staleWipRecovered[0], {
      number: 42,
      reminded: false,
      recovered: true,
      dry_run: false,
    });

    // Only 1 command: the label edit; comment is skipped because reminder already exists
    assert.equal(commandCalls.length, 1);
    const labelCmd = commandCalls[0].command.join(" ");
    assert.ok(labelCmd.includes("issue edit 42"));
    assert.ok(labelCmd.includes("--add-label attention/orchestrator"));
    assert.ok(labelCmd.includes("--remove-label state/wip"));
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

  it("classifies cancellation timeouts with a recency window and timestamp shapes", () => {
    const cancellations = new Map<string, number | null>([["agent-1", now - 60_000]]);
    assert.equal(detectCancellationTimeout("agent-1", cancellations, "idle", now, 86400), true);
    assert.equal(detectCancellationTimeout("agent-1", cancellations, "running", now, 86400), false);
    assert.equal(detectCancellationTimeout("agent-recovered", cancellations, "idle", now, 86400), false);
    assert.equal(detectCancellationTimeout("agent-1", cancellations, "idle", now, 30), false);
    assert.equal(detectCancellationTimeout("agent-1", new Map([["agent-1", null]]), "error", now, 30), true);

    // Healthy idle with activity since cancellation does not flag.
    assert.equal(
      detectCancellationTimeout("agent-1", cancellations, "idle", now, 86400, "", now - 30_000),
      false,
    );
    // Idle with unhandled wedged error still flags.
    assert.equal(
      detectCancellationTimeout("agent-1", cancellations, "idle", now, 86400, "crash", now - 30_000),
      true,
    );
    // Idle without activity since cancellation still flags (idle never resumed).
    assert.equal(
      detectCancellationTimeout("agent-1", cancellations, "idle", now, 86400, "", now - 120_000),
      true,
    );
    // Handled marker matching or exceeding cancellation timestamp suppresses flag.
    assert.equal(
      detectCancellationTimeout("agent-1", cancellations, "idle", now, 86400, "", null, now - 60_000),
      false,
    );
    assert.equal(
      detectCancellationTimeout("agent-1", cancellations, "error", now, 86400, "err", null, now - 60_000),
      false,
    );
    // Newer cancellation after a handled one is still flagged.
    assert.equal(
      detectCancellationTimeout("agent-1", new Map([["agent-1", now - 10_000]]), "error", now, 86400, "err", null, now - 60_000),
      true,
    );

    // Tolerates various timestamp shapes: ISO-8601 string, epoch-s, epoch-ms
    const isoMap = new Map([["agent-iso", new Date(now - 60_000).toISOString()]]);
    assert.equal(detectCancellationTimeout("agent-iso", isoMap, "idle", now, 86400, "", new Date(now - 30_000).toISOString()), false);
    assert.equal(detectCancellationTimeout("agent-iso", isoMap, "idle", now, 86400, "", null, new Date(now - 60_000).toISOString()), false);

    const epochSecMap = new Map([["agent-sec", Math.floor((now - 60_000) / 1000)]]);
    assert.equal(detectCancellationTimeout("agent-sec", epochSecMap, "idle", now, 86400, "", Math.floor((now - 30_000) / 1000)), false);
  });

  it("coerces epoch timestamps from ms, seconds, ISO strings, and dates", () => {
    assert.equal(coerceEpochMs(1700000000000), 1700000000000);
    assert.equal(coerceEpochMs(1700000000), 1700000000000);
    assert.equal(coerceEpochMs("1700000000"), 1700000000000);
    assert.equal(coerceEpochMs("1700000000000"), 1700000000000);
    assert.equal(coerceEpochMs("2026-01-01T00:00:00.000Z"), Date.parse("2026-01-01T00:00:00.000Z"));
    assert.equal(coerceEpochMs(new Date("2026-01-01T00:00:00.000Z")), Date.parse("2026-01-01T00:00:00.000Z"));
    assert.equal(coerceEpochMs(null), null);
    assert.equal(coerceEpochMs(undefined), null);
    assert.equal(coerceEpochMs("invalid"), null);
    assert.equal(coerceEpochMs(""), null);
    assert.equal(coerceEpochMs(NaN), null);
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

  it("classifies provider quota exhaustion with new markers and timeline retry lines (#890)", () => {
    // 1. New quota markers in lastError
    assert.equal(detectProviderQuotaExhaustion("Free usage exceeded, subscribe to Go"), true);
    assert.equal(detectProviderQuotaExhaustion("Provider retry (attempt 1): Free usage exceeded, subscribe to Go"), true);
    assert.equal(detectProviderQuotaExhaustion("usage exceeded"), true);
    assert.equal(detectProviderQuotaExhaustion("please subscribe to pro"), true);

    // Verify QUOTA_MARKERS export
    assert.ok(QUOTA_MARKERS.includes("usage exceeded"));
    assert.ok(QUOTA_MARKERS.includes("free usage"));
    assert.ok(QUOTA_MARKERS.includes("subscribe to"));

    // 2. Timeline error detection when lastError is empty
    const timelineString =
      "[Thought] analyzing ticket\n" +
      "[Error] provider-retry: Provider retry (attempt 1): Free usage exceeded, subscribe to Go\n" +
      "[Thought] still waiting";
    assert.equal(detectProviderQuotaExhaustion("", timelineString), true);
    assert.equal(detectProviderQuotaExhaustion(null, timelineString), true);
    assert.equal(findProviderRetryQuotaError(timelineString), "[Error] provider-retry: Provider retry (attempt 1): Free usage exceeded, subscribe to Go");

    // Timeline array of objects or strings
    const timelineArray = [
      { type: "thought", text: "thinking" },
      { type: "error", message: "provider-retry: Provider retry (attempt 1): Free usage exceeded, subscribe to Go" },
    ];
    assert.equal(detectProviderQuotaExhaustion("", timelineArray), true);

    // Clean timeline without quota error
    const cleanTimeline = [
      { type: "thought", text: "thinking" },
      { type: "tool", text: "[run] git status" },
    ];
    assert.equal(detectProviderQuotaExhaustion("", cleanTimeline), false);
  });

  it("fuses timeline retry lines into assessAgentHealth and classifies quota exhaustion (#890)", () => {
    const retryLine = "[Error] provider-retry: Provider retry (attempt 1): Free usage exceeded, subscribe to Go";
    const assessment = assessAgentHealth(
      "agent-quota-1",
      {
        id: "agent-quota-1",
        status: "running",
        lastError: "",
        recentTimeline: retryLine,
      },
      null,
      now,
    );

    assert.deepEqual(assessment.taxonomy, ["PROVIDER_QUOTA_EXHAUSTION"]);
    assert.equal(assessment.healthy, false);
    assert.equal(assessment.severities.PROVIDER_QUOTA_EXHAUSTION, "high");
    assert.equal(assessment.lastError, retryLine);
    assert.equal(assessment.details.PROVIDER_QUOTA_EXHAUSTION, retryLine);

    // Plan recovery blocks auto-steer
    const plan = planWatchdogRecovery(assessment.taxonomy);
    assert.equal(plan.steer, false);
    assert.equal(plan.blockedReason, "provider/quota exhaustion requires operator circuit-break");
  });

  it("scans daemon logs for provider-retry quota exhaustion lines (#890)", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-quota-test-"));
    try {
      const log = join(dir, "daemon.log");
      writeFileSync(
        log,
        `${JSON.stringify({ agentId: "agent-quota-a", msg: "[Error] provider-retry: Free usage exceeded, subscribe to Go" })}\n` +
        `plain line [Error] provider-retry: Provider retry (attempt 1): Free usage exceeded, subscribe to Go "agentId":"agent-quota-b"\n` +
        `${JSON.stringify({ agentId: "agent-transient", msg: "[Error] provider-retry: fetch failed: ECONNRESET" })}\n`,
      );
      const errors = scanTimelineRetryErrors([log]);
      assert.ok(errors.has("agent-quota-a"));
      assert.ok(errors.has("agent-quota-b"));
      assert.equal(errors.has("agent-transient"), false);
      assert.match(errors.get("agent-quota-a")![0], /Free usage exceeded/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records quota failure into circuit breaker and getCachedModelHealth reads it (#890)", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-cb-test-"));
    try {
      const cbPath = join(dir, "model-health.json");
      const entry = recordModelQuotaFailure(
        "opencode",
        "muse-spark-1.3-contributor-free",
        "Free usage exceeded, subscribe to Go",
        cbPath,
        3600,
        1000,
      );
      assert.equal(entry.status, "quota_exhausted");
      assert.equal(entry.key, "opencode/muse-spark-1.3-contributor-free");

      const cached = getCachedModelHealth("opencode/muse-spark-1.3-contributor-free", cbPath, 1500);
      assert.ok(cached);
      assert.equal(cached?.status, "quota_exhausted");
      assert.equal(cached?.remaining_cooldown_sec, 3100);

      // Past cooldown returns null
      const expired = getCachedModelHealth("opencode/muse-spark-1.3-contributor-free", cbPath, 5000);
      assert.equal(expired, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveOrchestratorModel skips cooling down models in fallback chain (#890)", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-fallback-test-"));
    try {
      const cbPath = join(dir, "model-health.json");
      // Record primary model as exhausted
      recordModelQuotaFailure(
        "antigravity-acp",
        "gemini-3.8-flash-low",
        "quota exceeded",
        cbPath,
        3600,
        1000,
      );

      const resolved = resolveOrchestratorModel({
        fallbackList: [
          "antigravity-acp/gemini-3.8-flash-low",
          "codex/gpt-5.6-luna",
          "uppidi/opencode-go/deepseek-v4.1-flash",
        ],
        circuitBreakerPath: cbPath,
        nowSec: 1500,
      });

      // Should skip antigravity-acp/gemini-3.8-flash-low and pick codex/gpt-5.6-luna
      assert.equal(resolved.key, "codex/gpt-5.6-luna");
      assert.equal(resolved.provider, "codex");
      assert.equal(resolved.model, "gpt-5.6-luna");

      // Now record codex as exhausted too
      recordModelQuotaFailure(
        "codex",
        "gpt-5.6-luna",
        "rate limit 429",
        cbPath,
        3600,
        1000,
      );

      const resolvedTier3 = resolveOrchestratorModel({
        fallbackList: [
          "antigravity-acp/gemini-3.8-flash-low",
          "codex/gpt-5.6-luna",
          "uppidi/opencode-go/deepseek-v4.1-flash",
        ],
        circuitBreakerPath: cbPath,
        nowSec: 1500,
      });

      assert.equal(resolvedTier3.key, "uppidi/opencode-go/deepseek-v4.1-flash");
      assert.equal(resolvedTier3.provider, "uppidi");
      assert.equal(resolvedTier3.model, "opencode-go/deepseek-v4.1-flash");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveOrchestratorModel skips providers that are disabled on the host (#973)", () => {
    const resolved = resolveOrchestratorModel({
      fallbackList: [
        "antigravity-acp/gemini-3.8-flash-low",
        "codex/gpt-5.6-luna",
        "antigravity/gemini-3.8-flash-low",
      ],
      availableProviders: new Set(["antigravity"]),
    });
    assert.equal(resolved.key, "antigravity/gemini-3.8-flash-low");
    assert.equal(resolved.provider, "antigravity");
    assert.deepEqual(
      (resolved.dropped ?? []).map((d) => [d.key, d.reason]),
      [
        ["antigravity-acp/gemini-3.8-flash-low", "provider_disabled"],
        ["codex/gpt-5.6-luna", "provider_disabled"],
      ],
    );
  });

  it("resolveOrchestratorModel drops dead entries visibly and names the live provider set (#1011)", () => {
    const resolved = resolveOrchestratorModel({
      fallbackList: [
        "antigravity-acp/gemini-3.8-flash-low",
        "codex/gpt-5.6-luna",
        "pi/commandcode/deepseek/deepseek-v4-flash",
      ],
      availableProviders: new Set(["pi"]),
    });
    assert.equal(resolved.key, "pi/commandcode/deepseek/deepseek-v4-flash");
    assert.deepEqual(resolved.availableProviders, ["pi"]);
    assert.deepEqual(
      (resolved.dropped ?? []).map((d) => [d.key, d.reason]),
      [
        ["antigravity-acp/gemini-3.8-flash-low", "provider_disabled"],
        ["codex/gpt-5.6-luna", "provider_disabled"],
      ],
    );
  });

  it("resolveOrchestratorModel fails loud instead of appending DEFAULT_ROLE_MODELS when every configured candidate is disabled (#1011)", () => {
    const resolved = resolveOrchestratorModel({
      fallbackList: ["antigravity-acp/gemini-3.8-flash-low", "codex/gpt-5.6-luna"],
      availableProviders: new Set(["pi"]),
    });
    assert.equal(resolved.exhausted, true);
    assert.equal(resolved.provider, "");
    assert.equal(resolved.key, "");
    assert.match(resolved.error ?? "", /No orchestrator model is satisfiable/);
    assert.match(resolved.error ?? "", /Live enabled providers: pi/);
    assert.doesNotMatch(resolved.error ?? "", /commandcode/, "a hidden default must never be substituted");
    assert.deepEqual(resolved.configuredChain, [
      "antigravity-acp/gemini-3.8-flash-low",
      "codex/gpt-5.6-luna",
    ]);
    assert.equal(resolved.dropped?.length, 2);
  });

  it("resolveOrchestratorModel fails loud when no provider is enabled at all (#1011)", () => {
    const resolved = resolveOrchestratorModel({
      fallbackList: ["antigravity-acp/gemini-3.8-flash-low", "codex/gpt-5.6-luna"],
      availableProviders: new Set<string>(),
    });
    assert.equal(resolved.exhausted, true);
    assert.equal(resolved.provider, "");
    assert.match(resolved.error ?? "", /Live enabled providers: none/);
  });

  it("resolveOrchestratorModel re-checks the configured primary and recovers after a transient outage (#1011)", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-primary-recovery-"));
    try {
      const cbPath = join(dir, "model-health.json");
      recordModelQuotaFailure(
        "pi",
        "commandcode/deepseek/deepseek-v4-flash",
        "429 quota",
        cbPath,
        3600,
        1000,
      );
      const chain = [
        "pi/commandcode/deepseek/deepseek-v4-flash",
        "antigravity/gemini-3.8-flash-low",
      ];
      const cooling = resolveOrchestratorModel({
        fallbackList: chain,
        circuitBreakerPath: cbPath,
        availableProviders: new Set(["pi", "antigravity"]),
        nowSec: 1500,
      });
      assert.equal(cooling.key, "antigravity/gemini-3.8-flash-low");
      assert.deepEqual(
        (cooling.dropped ?? []).map((d) => [d.key, d.reason]),
        [["pi/commandcode/deepseek/deepseek-v4-flash", "quota_exhausted"]],
      );

      // Cooldown expires: the next spawn re-checks the primary and wins again.
      const recovered = resolveOrchestratorModel({
        fallbackList: chain,
        circuitBreakerPath: cbPath,
        availableProviders: new Set(["pi", "antigravity"]),
        nowSec: 5000,
      });
      assert.equal(recovered.key, "pi/commandcode/deepseek/deepseek-v4-flash");
      assert.deepEqual(recovered.dropped, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handleUppidiFleetAlerts returns persisted banners and honors the scoped override (#1011)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-fleet-alerts-"));
    const alertsPath = join(dir, "model-alerts.json");
    const previous = process.env.UPPIDI_FLEET_ALERTS_PATH;
    process.env.UPPIDI_FLEET_ALERTS_PATH = alertsPath;
    try {
      assert.equal(defaultModelAlertsPath(), alertsPath);
      recordModelAlert(
        {
          repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
          role: "orchestrator",
          message: "boom",
          configuredChain: ["a/b"],
          dropped: [{ key: "a/b", provider: "a", model: "b", reason: "provider_disabled" }],
          availableProviders: ["pi"],
          createdAt: new Date().toISOString(),
        },
        alertsPath,
      );
      const out = await handleUppidiFleetAlerts();
      assert.equal(out.ok, true);
      assert.equal(out.alerts.length, 1);
      assert.equal(out.alerts[0].message, "boom");
      assert.equal(out.alerts[0].dropped[0].reason, "provider_disabled");
    } finally {
      if (previous === undefined) delete process.env.UPPIDI_FLEET_ALERTS_PATH;
      else process.env.UPPIDI_FLEET_ALERTS_PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveOrchestratorModel fails loud for a stale saved config of disabled providers (#987/#1011)", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-role-models-stale-"));
    const configPath = join(dir, "uppidi-fleet-role-models.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        orchestrator: {
          role: "orchestrator",
          primaryModel: "antigravity-acp/gemini-3.8-flash-low",
          fallbackGroup: ["antigravity-acp/gemini-3.8-flash-low", "codex/gpt-5.6-luna"],
        },
      }),
    );
    const previous = process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG;
    process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG = configPath;
    try {
      const resolved = resolveOrchestratorModel({ availableProviders: new Set(["pi"]) });
      assert.equal(resolved.exhausted, true);
      assert.equal(resolved.provider, "");
      assert.match(resolved.error ?? "", /Live enabled providers: pi/);
    } finally {
      if (previous === undefined) delete process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG;
      else process.env.UPPIDI_FLEET_ROLE_MODELS_CONFIG = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runWatchdogAudit records quota failure into circuit breaker and suppresses steer (#890)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-watchdog-cb-"));
    try {
      const cbPath = join(dir, "model-health.json");
      const agentMap = new Map<string, WatchdogAgent>([
        [
          "agent-quota-exhausted",
          {
            id: "agent-quota-exhausted",
            title: "Orchestrator · xpufx-org/paseo",
            status: "running",
            lastError: "",
            provider: "opencode",
            model: "muse-spark-1.3-contributor-free",
            recentTimeline: "[Error] provider-retry: Provider retry (attempt 1): Free usage exceeded, subscribe to Go",
          },
        ],
      ]);

      let steerAttempted = false;
      let alertDelivered: string | null = null;
      const testRouter = new HookRouter(null, {
        isTestMode: true,
        circuitBreakerPath: cbPath,
      });

      const result = await testRouter.runWatchdogAudit({
        now,
        agentMap,
        frontDeskId: "front-desk-1",
        deliver: async (_target, msg, opts) => {
          if (opts?.steer) steerAttempted = true;
          alertDelivered = msg;
          return true;
        },
        circuitBreakerPath: cbPath,
      });

      // 1. Anomaly was classified as PROVIDER_QUOTA_EXHAUSTION
      const quotaAnomaly = result.anomalies.find((a) => a.type === "PROVIDER_QUOTA_EXHAUSTION");
      assert.ok(quotaAnomaly);
      assert.equal(quotaAnomaly?.agentId, "agent-quota-exhausted");

      // 2. Steer was NOT attempted (suppressed)
      assert.equal(steerAttempted, false);

      // 3. Front Desk received circuit-break alert
      assert.ok(alertDelivered);
      assert.match(alertDelivered!, /Circuit-break: no auto-steer; operator required/);

      // 4. Circuit breaker record was written to cbPath
      const cached = getCachedModelHealth("opencode/muse-spark-1.3-contributor-free", cbPath, Math.floor(now / 1000));
      assert.ok(cached);
      assert.equal(cached?.status, "quota_exhausted");
      assert.match(cached?.error ?? "", /Free usage exceeded/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ensureOrchestrator falls back to healthy model when configured primary is cooling down (#890)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-ensure-cb-"));
    try {
      const cbPath = join(dir, "model-health.json");
      // Mark primary model as cooling down in circuit breaker
      recordModelQuotaFailure(
        "antigravity-acp",
        "gemini-3.8-flash-low",
        "quota exceeded",
        cbPath,
        3600,
        Math.floor(Date.now() / 1000),
      );

      const spawned: any[] = [];
      const testRouter = new HookRouter(null, {
        isTestMode: true,
        circuitBreakerPath: cbPath,
        orchestratorModelFallback: [
          "antigravity-acp/gemini-3.8-flash-low",
          "codex/gpt-5.6-luna",
          "uppidi/opencode-go/deepseek-v4.1-flash",
        ],
        workspacesData: [
          {
            workspaceId: "ws-test",
            cwd: dir,
            displayName: "Paseo",
            isolation: "local",
            projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
          },
        ],
        spawnAgent: async (opts) => {
          spawned.push(opts);
          return { id: "agent-fallback-orch" };
        },
      });

      const res = await testRouter.ensureOrchestrator({ repo: "xpufx-org/paseo" });
      assert.equal(res.ok, true);
      assert.equal(res.agentId, "agent-fallback-orch");

      // Verified it bypassed cooling-down antigravity-acp and chose codex/gpt-5.6-luna
      assert.equal(spawned.length, 1);
      assert.equal(spawned[0].provider, "codex");
      assert.equal(spawned[0].model, "gpt-5.6-luna");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("atomically merges metadata keys and tolerates missing or corrupt files", () => {
    const dir = mkdtempSync(join(tmpdir(), "paseo-health-disk-set-"));
    try {
      const file = join(dir, "agent.json");
      writeFileSync(file, JSON.stringify({ id: "agent-1", status: "idle", keep: 42 }));
      assert.equal(
        setAgentDiskFields(file, { lastHandledCancellationAt: 1790000000000, extra: "yes" }),
        true,
      );
      const after = JSON.parse(readFileSync(file, "utf8"));
      assert.equal(after.id, "agent-1");
      assert.equal(after.keep, 42);
      assert.equal(after.lastHandledCancellationAt, 1790000000000);
      assert.equal(after.extra, "yes");

      // No-op update returns true without error
      assert.equal(setAgentDiskFields(file, { extra: "yes" }), true);

      // Missing file returns false
      assert.equal(setAgentDiskFields(join(dir, "nonexistent.json"), { foo: "bar" }), false);

      // Corrupted file returns false
      const corrupt = join(dir, "corrupt.json");
      writeFileSync(corrupt, "{ invalid-json");
      assert.equal(setAgentDiskFields(corrupt, { foo: "bar" }), false);
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
        JSON.stringify({
          id: "agent-1",
          lastStatus: "idle",
          lastError: "ghost",
          updatedAt: "2026-01-01T00:00:00Z",
          lastHandledCancellationAt: 1790000000000,
        }),
      );
      const map = loadAgentDiskMetadata(dir);
      const disk = map.get("agent-1") as WatchdogAgentDisk;
      assert.equal(disk.lastStatus, "idle");
      assert.equal(disk.lastError, "ghost");
      assert.equal(disk.lastActivityAt, "2026-01-01T00:00:00Z");
      assert.equal(disk.lastHandledCancellationAt, 1790000000000);
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

  it("healthy idle agent with recent cancellation is not steered", async () => {
    const cancelTime = Date.now() - 30 * 60 * 1000;
    const activityTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeMetadata("orch-healthy", {
      id: "orch-healthy",
      lastStatus: "idle",
      lastError: "",
      lastActivityAt: activityTime,
    });
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };
    const map = new Map<string, WatchdogAgent>([
      ["orch-healthy", { id: "orch-healthy", status: "idle" }],
    ]);

    const audit = await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      cancellations: new Map([["orch-healthy", cancelTime]]),
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellationRecencySeconds: 86400,
    });

    assert.equal(audit.anomalies.some((a) => a.type === "TURN_CANCELLATION_TIMEOUT"), false);
    assert.equal(delivered.some((d) => d.id === "orch-healthy"), false, "healthy agent must not be steered");
  });

  it("recovers a genuinely wedged agent and persists lastHandledCancellationAt", async () => {
    const cancelTime = Date.now() - 30 * 60 * 1000;
    const staleActivity = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    writeMetadata("wedged-1", {
      id: "wedged-1",
      lastStatus: "idle",
      lastError: "",
      lastActivityAt: staleActivity,
    });
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };
    const map = new Map<string, WatchdogAgent>([
      ["wedged-1", { id: "wedged-1", status: "idle" }],
    ]);

    const audit = await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      cancellations: new Map([["wedged-1", cancelTime]]),
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellationRecencySeconds: 86400,
    });

    assert.ok(audit.anomalies.some((a) => a.type === "TURN_CANCELLATION_TIMEOUT" && a.agentId === "wedged-1"));
    assert.ok(delivered.some((d) => d.id === "wedged-1" && d.steer === true));
    const persisted = JSON.parse(readFileSync(join(agentsDir, "wedged-1", "wedged-1.json"), "utf8"));
    assert.equal(persisted.lastHandledCancellationAt, cancelTime);
  });

  it("second watchdog pass after successful recovery produces NO re-steer (idempotency)", async () => {
    const cancelTime = Date.now() - 30 * 60 * 1000;
    const staleActivity = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    writeMetadata("orch-loop", {
      id: "orch-loop",
      lastStatus: "idle",
      lastError: "",
      lastActivityAt: staleActivity,
    });
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };
    const map = new Map<string, WatchdogAgent>([
      ["orch-loop", { id: "orch-loop", status: "idle" }],
    ]);
    const cancellations = new Map([["orch-loop", cancelTime]]);

    // Pass 1: wedged agent is identified and recovered
    const audit1 = await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      cancellations,
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellationRecencySeconds: 86400,
    });
    assert.ok(audit1.anomalies.some((a) => a.type === "TURN_CANCELLATION_TIMEOUT"));
    assert.ok(delivered.some((d) => d.id === "orch-loop"));

    // Verify handled marker was saved to disk
    const persisted1 = JSON.parse(readFileSync(join(agentsDir, "orch-loop", "orch-loop.json"), "utf8"));
    assert.equal(persisted1.lastHandledCancellationAt, cancelTime);

    // Pass 2: simulate subsequent watchdog pass (use fresh router / empty cooldowns)
    const router2 = new HookRouter(null, { queueDir: join(tempDir, "queues2"), stateDir: join(tempDir, "state2"), port: 0 });
    const delivered2: Array<{ id: string; msg: string; steer?: boolean }> = [];
    const audit2 = await router2.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      cancellations,
      deliver: async (id, msg, o) => {
        delivered2.push({ id, msg, steer: o?.steer });
        return true;
      },
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellationRecencySeconds: 86400,
    });

    assert.equal(audit2.anomalies.some((a) => a.type === "TURN_CANCELLATION_TIMEOUT"), false);
    assert.equal(delivered2.some((d) => d.id === "orch-loop"), false, "second watchdog pass must not steer");
  });

  it("marker persists across separate invocations", async () => {
    const cancelTime = Date.now() - 45 * 60 * 1000;
    // Pre-populate disk file with handled marker from prior invocation
    writeMetadata("persisted-agent", {
      id: "persisted-agent",
      lastStatus: "idle",
      lastError: "",
      lastHandledCancellationAt: cancelTime,
    });
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };
    const map = new Map<string, WatchdogAgent>([
      ["persisted-agent", { id: "persisted-agent", status: "idle" }],
    ]);

    const audit = await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      cancellations: new Map([["persisted-agent", cancelTime]]),
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellationRecencySeconds: 86400,
    });

    assert.equal(audit.anomalies.some((a) => a.type === "TURN_CANCELLATION_TIMEOUT"), false);
    assert.equal(delivered.some((d) => d.id === "persisted-agent"), false, "persisted marker suppresses steer");
  });
});

describe("hook-router teardown cleanup methods (#774)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let router: HookRouter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-teardown-router-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    router = new HookRouter(null, { queueDir, stateDir, port: 0 });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("clearFrontDesk unlinks frontdesk state files and clears frontdesk queue", () => {
    router.writeFrontDesk("fd-test-agent", "operator");
    router.enqueue("frontdesk", "queued fd msg");
    assert.equal(router.readFrontDesk()?.agentId, "fd-test-agent");
    assert.equal(router.getQueue("frontdesk").length, 1);

    const cleared = router.clearFrontDesk();
    assert.ok(cleared >= 1);
    assert.equal(router.readFrontDesk(), null);
    assert.equal(router.getQueue("frontdesk").length, 0);
  });

  it("reads a frontdesk.json written to the persisted hook state dir by another process (#1068)", () => {
    const persistedDir = join(tempDir, "persisted", "orchestrators");
    const prevHookStateDir = process.env.HOOK_STATE_DIR;
    mkdirSync(persistedDir, { recursive: true });
    process.env.HOOK_STATE_DIR = persistedDir;
    try {
      writeFileSync(
        join(persistedDir, "frontdesk.json"),
        JSON.stringify({ version: 1, agentId: "fd-persisted", updatedAt: null, by: "frontdesk" }),
      );
      assert.equal(router.readFrontDesk()?.agentId, "fd-persisted");
    } finally {
      if (prevHookStateDir === undefined) delete process.env.HOOK_STATE_DIR;
      else process.env.HOOK_STATE_DIR = prevHookStateDir;
    }
  });

  it("clearAllOrchestrators unlinks all orchestrator files but preserves frontdesk", () => {
    router.writeOrchestrator("repo-a", "agent-a");
    router.writeOrchestrator("repo-b", "agent-b");
    router.writeFrontDesk("fd-keep", "operator");

    assert.equal(router.listOrchestratorRecords().length, 2);

    const cleared = router.clearAllOrchestrators();
    assert.equal(cleared, 2);
    assert.equal(router.listOrchestratorRecords().length, 0);
    assert.equal(router.readOrchestrator("repo-a"), null);
    assert.equal(router.readOrchestrator("repo-b"), null);
    assert.equal(router.readFrontDesk()?.agentId, "fd-keep");
  });

  it("clearQueue removes in-memory queue, timers, and persisted queue file", () => {
    router.enqueue("test-repo", "item 1");
    router.enqueue("test-repo", "item 2");
    assert.equal(router.getQueue("test-repo").length, 2);

    const cleared = router.clearQueue("test-repo");
    assert.ok(cleared >= 1);
    assert.equal(router.getQueue("test-repo").length, 0);
  });

  it("broadcastTeardownNotice delivers notice exactly once across simulated pause+resume drain cycle (#1118)", async () => {
    const deliveries: Array<{ agentId: string; msg: string; steer: boolean }> = [];
    (router as any).deliverMessage = async (agentId: string, msg: string, options?: any) => {
      deliveries.push({ agentId, msg, steer: Boolean(options?.steer) });
      return true;
    };

    router.writeFrontDesk("fd-survivor");
    router.writeOrchestrator("repo-survivor", "orch-survivor");

    // Pause all queues as happens during fleet teardown / halt
    router.pause("all");

    // Broadcast teardown notice for worker teardown (Front Desk and Orchestrator survive)
    const notice = "[Fleet Teardown] Workers culled";
    const res = await router.broadcastTeardownNotice(notice, { targets: ["workers"] });

    assert.equal(res.delivered, 2, "immediate delivery should succeed for both survivors");
    assert.equal(deliveries.length, 2, "both surviving agents received immediate steer delivery");
    assert.equal(deliveries[0].agentId, "fd-survivor");
    assert.equal(deliveries[0].steer, true);
    assert.equal(deliveries[1].agentId, "orch-survivor");
    assert.equal(deliveries[1].steer, true);

    // Queues must be clean: immediate delivery succeeded so no queued entry should remain
    assert.equal(router.getQueue("frontdesk").length, 0, "frontdesk queue should not retain entry");
    assert.equal(router.getQueue("repo-survivor").length, 0, "orchestrator queue should not retain entry");

    // Clear recorded deliveries and simulate fleet resume / drain
    deliveries.length = 0;
    router.resume("all");

    // Allow any pending async drain to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(
      deliveries.length,
      0,
      "resume drain must not deliver duplicate teardown notice when immediate steer delivery succeeded",
    );
  });

  it("broadcastTeardownNotice leaves notice queued for retry when immediate delivery fails (#1118)", async () => {
    const deliveries: Array<{ agentId: string; msg: string }> = [];
    let deliverShouldFail = true;
    (router as any).deliverMessage = async (agentId: string, msg: string) => {
      deliveries.push({ agentId, msg });
      return !deliverShouldFail;
    };

    router.writeFrontDesk("fd-agent");
    router.pause("all");

    const notice = "[Fleet Teardown] Notice for retry";
    const res = await router.broadcastTeardownNotice(notice, { targets: ["workers"] });

    assert.equal(res.delivered, 0, "immediate delivery failed");
    assert.equal(router.getQueue("frontdesk").length, 1, "notice must remain queued for retry");

    // Now allow delivery to succeed and unpause
    deliverShouldFail = false;
    router.resume("all");

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(deliveries.length, 2, "1 failed initial delivery + 1 successful drain delivery");
    assert.equal(router.getQueue("frontdesk").length, 0, "queue drained after resume");
  });
});

describe("hook-router Front Desk non-interrupting delivery and watchdog alerts (#780)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let agentsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-frontdesk-780-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    agentsDir = join(tempDir, "agents");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("non-SOS webhook for Front Desk queues when busy and delivers without steer: true on turn_ended", async () => {
    const frontDeskId = "fd-agent-780";
    let agentStatus = "running";
    let turnEndedHandler: any = null;
    const sentMessages: Array<{ text: string; activeTurnBehavior?: "interrupt" | "steer" }> = [];

    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, frontDeskId);
          return {
            current: () => ({ id, status: agentStatus, activeTurn: agentStatus === "running" ? { id: "turn-1" } : null }),
            send: async (text: string, options?: any) => {
              sentMessages.push({ text, activeTurnBehavior: options?.activeTurnBehavior });
            },
          };
        },
      },
    } as any;

    const mockServer = {
      paseo: mockPaseo,
      events: { on: () => () => {} },
      on: (name: string, handler: any) => {
        if (name === "agent.turn_ended") turnEndedHandler = handler;
        return () => {};
      },
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    const router = new HookRouter(mockServer, { queueDir, stateDir, port: 0 });
    router.writeFrontDesk(frontDeskId, "operator");

    // Ingest non-SOS webhook targeted to Front Desk (e.g. meta repo issue with attention/frontdesk label)
    const ingestRes = await router.ingestWebhook("issues", {
      repository: { full_name: "xpufx-org/meta", html_url: "https://forge.mrs.uppidi.com/xpufx-org/meta" },
      issue: { number: 42, title: "Routine front desk task" },
      label: { name: "attention/frontdesk" },
      action: "labeled",
      sender: { login: "alice" },
    });

    assert.equal(ingestRes.frontDesk, true);
    assert.equal(ingestRes.bypass, true);

    await new Promise((r) => setTimeout(r, 20));

    // Agent is running, so message should be held in queue, NOT sent immediately
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue("frontdesk").length, 1);

    // Now turn ends
    agentStatus = "idle";
    assert.ok(turnEndedHandler);
    await turnEndedHandler({ agent: { id: frontDeskId } }, { paseo: mockPaseo });

    await new Promise((r) => setTimeout(r, 20));

    // Message delivered without steering
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].activeTurnBehavior, "interrupt");
    assert.equal(router.getQueue("frontdesk").length, 0);
  });

  it("SOS webhook for Front Desk bypasses busy check and delivers with steer: true", async () => {
    const frontDeskId = "fd-agent-780-sos";
    let agentStatus = "running";
    const sentMessages: Array<{ text: string; activeTurnBehavior?: "interrupt" | "steer" }> = [];

    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, frontDeskId);
          return {
            current: () => ({ id, status: agentStatus, activeTurn: { id: "turn-sos" } }),
            send: async (text: string, options?: any) => {
              sentMessages.push({ text, activeTurnBehavior: options?.activeTurnBehavior });
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
    router.writeFrontDesk(frontDeskId, "operator");

    // Ingest SOS comment webhook targeted to Front Desk
    const ingestRes = await router.ingestWebhook("issue_comment", {
      repository: { full_name: "xpufx-org/meta", html_url: "https://forge.mrs.uppidi.com/xpufx-org/meta" },
      issue: { number: 42, title: "Emergency" },
      comment: { body: "/frontdesk /sos Stop everything!" },
      action: "created",
      sender: { login: "admin" },
    });

    assert.equal(ingestRes.frontDesk, true);

    await new Promise((r) => setTimeout(r, 20));

    // Delivered immediately with activeTurnBehavior: steer despite agentStatus === "running"
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].activeTurnBehavior, "steer");
    assert.ok(sentMessages[0].text.includes("Emergency"));
  });

  it("watchdog audit delivers alerts with steer: false when Front Desk is idle", async () => {
    const frontDeskId = "fd-idle-audit";
    const delivered: Array<{ id: string; msg: string; steer?: boolean }> = [];
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };

    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeFrontDesk(frontDeskId, "operator");

    // Anomaly: pending permission on a worker agent
    const map = new Map<string, WatchdogAgent>([
      [frontDeskId, { id: frontDeskId, status: "idle" }],
      [
        "worker-needs-perm",
        {
          id: "worker-needs-perm",
          status: "waiting",
          pendingPermissions: [{ id: "perm-123" }],
        },
      ],
    ]);

    await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellations: new Map(),
    });

    // Alert should have been delivered to Front Desk
    const fdAlert = delivered.find((d) => d.id === frontDeskId);
    assert.ok(fdAlert, "frontdesk alert delivered");
    assert.equal(fdAlert.steer, false, "watchdog alert must not steer Front Desk");
    assert.ok(fdAlert.msg.includes("perm-123"));
  });

  it("watchdog audit queues alert in frontdesk queue when Front Desk is busy", async () => {
    const frontDeskId = "fd-busy-audit";
    const delivered: Array<{ id: string; msg: string; steer?: boolean }> = [];
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };

    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeFrontDesk(frontDeskId, "operator");

    // Front Desk is running an active turn
    const map = new Map<string, WatchdogAgent>([
      [frontDeskId, { id: frontDeskId, status: "running", activeTurn: { id: "turn-fd" } as any }],
      [
        "worker-stalled",
        {
          id: "worker-stalled",
          status: "running",
          requiresAttention: true,
          attentionReason: "input_required",
        },
      ],
    ]);

    await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellations: new Map(),
    });

    // Front Desk was busy: must NOT be delivered directly via deliver function
    const fdDeliveries = delivered.filter((d) => d.id === frontDeskId);
    assert.equal(fdDeliveries.length, 0, "busy Front Desk was not interrupted");

    // Alert was enqueued into frontdesk queue instead
    const queue = router.getQueue("frontdesk");
    assert.ok(queue.length >= 1, "alert queued in frontdesk queue");
    assert.ok(queue[0].msg.includes("attention-required") || queue[0].msg.includes("input_required"));
  });

  it("runBoardSweep queues alert when Front Desk is busy and does not pass steer: true", async () => {
    const frontDeskId = "fd-sweep-busy";
    const delivered: Array<{ id: string; msg: string; steer?: boolean }> = [];
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };

    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.writeFrontDesk(frontDeskId, "operator");

    // Cache latest agent map with busy Front Desk
    await router.runWatchdogAudit({
      agentMap: new Map([[frontDeskId, { id: frontDeskId, status: "running" }]]),
      agentsDir,
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellations: new Map(),
    });

    await router.runBoardSweep(["xpufx-org/paseo"], failingBoardIo("check failed"));

    // Since Front Desk was busy, board sweep alert is queued, not directly delivered
    const sweepDeliveries = delivered.filter((d) => d.id === frontDeskId);
    assert.equal(sweepDeliveries.length, 0);

    const queue = router.getQueue("frontdesk");
    assert.ok(queue.length >= 1, "board sweep failure queued for frontdesk");
    assert.ok(queue[0].msg.includes("check failed") || queue[0].msg.includes("FAILED board check"));
  });

  it("cooldown throttle gates rapid deliveries to Front Desk", async () => {
    const frontDeskId = "fd-throttle-test";
    const delivered: Array<{ id: string; msg: string; steer?: boolean }> = [];
    const fakeDeliver = async (id: string, msg: string, o?: { steer?: boolean }) => {
      delivered.push({ id, msg, steer: o?.steer });
      return true;
    };

    // Configure 500ms throttle
    const router = new HookRouter(null, { queueDir, stateDir, port: 0, frontDeskThrottleMs: 500 });
    router.writeFrontDesk(frontDeskId, "operator");

    const map = new Map<string, WatchdogAgent>([
      [frontDeskId, { id: frontDeskId, status: "idle" }],
      ["worker-1", { id: "worker-1", status: "waiting", pendingPermissions: [{ id: "p-1" }] }],
    ]);

    // First audit: Front Desk idle, delivers alert
    await router.runWatchdogAudit({
      agentMap: map,
      agentsDir,
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellations: new Map(),
    });

    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].steer, false);

    // Second audit immediately following (within 500ms window):
    // Another anomaly: worker pending permission
    const map2 = new Map<string, WatchdogAgent>([
      [frontDeskId, { id: frontDeskId, status: "idle" }],
      ["worker-2", { id: "worker-2", status: "waiting", pendingPermissions: [{ id: "p-2" }] }],
    ]);

    await router.runWatchdogAudit({
      agentMap: map2,
      agentsDir,
      deliver: fakeDeliver,
      stopAgent: async () => ({ ok: true }),
      frontDeskId,
      cancellations: new Map(),
    });

    // Delivered count should STILL be 1 because Front Desk is in throttle window
    assert.equal(delivered.length, 1);

    // Second alert queued in frontdesk queue
    const queue = router.getQueue("frontdesk");
    assert.ok(queue.length >= 1, "throttled alert queued for frontdesk");
    assert.ok(queue[0].msg.includes("p-2"));
  });
});

describe("hook-router stale latestAgentMap cache invalidation and live verification (#795)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "hook-router-795-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("idle agent whose cached state was running is refreshed via agentRef.refresh() during drain() rather than marked busy", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const targetAgentId = "agent-orchestrator-795-1";
    const sentMessages: Array<{ text: string; options: any }> = [];

    // Live agent is idle, but periodic latestAgentMap cache still says running
    let liveStatus: "running" | "idle" = "idle";
    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, targetAgentId);
          return {
            current: () => ({ id, status: liveStatus, activeTurn: null }),
            refresh: async () => ({ agent: { id, status: liveStatus, activeTurn: null } }),
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

    // Seed stale cache with status: running and activeTurn
    router.setLatestAgentMap(
      new Map([
        [
          targetAgentId,
          {
            id: targetAgentId,
            status: "running",
            activeTurn: { id: "stale-turn-123", startedAt: Date.now() - 30000 } as any,
          },
        ],
      ])
    );
    // Simulate accumulated busy attempts from earlier polling against stale cache
    router.busyAttempts.set(key, 8);

    // Enqueue message
    router.enqueue(key, "Prompt to idle agent with stale cache");

    await new Promise((r) => setTimeout(r, 30));

    // Message must have been delivered immediately rather than marked busy
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].text, "Prompt to idle agent with stale cache");
    assert.equal(router.getQueue(key).length, 0);

    // busyAttempts must be reset
    assert.equal(router.busyAttempts.has(key), false);

    // latestAgentMap entry should have been refreshed to idle
    const cached = router.getLatestAgentMap()?.get(targetAgentId);
    assert.equal(cached?.status, "idle");
    assert.equal(cached?.activeTurn, null);
  });

  it("idle agent whose cached state was running is refreshed via fetchAgentMap() when agentRef is unavailable", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/repo-cli";
    const targetAgentId = "agent-cli-795";
    const sentMessages: Array<{ id: string; msg: string; options: any }> = [];

    const mockServer = {
      events: { on: () => () => {} },
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    const router = new HookRouter(mockServer, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator(key, targetAgentId);

    // Intercept deliverMessage to track deliveries without spawning paseo CLI
    (router as any).deliverMessage = async (id: string, msg: string, options: any) => {
      sentMessages.push({ id, msg, options });
      return true;
    };

    // Seed stale cache indicating running
    router.setLatestAgentMap(
      new Map([
        [
          targetAgentId,
          {
            id: targetAgentId,
            status: "running",
            activeTurn: { id: "stale-turn-456" } as any,
          },
        ],
      ])
    );
    router.busyAttempts.set(key, 6);

    // Stub fetchAgentMap to simulate live query returning idle agent
    let fetchCalled = false;
    router.fetchAgentMap = async () => {
      fetchCalled = true;
      return new Map([
        [
          targetAgentId,
          {
            id: targetAgentId,
            status: "idle",
            activeTurn: null,
          },
        ],
      ]);
    };

    // Enqueue message
    router.enqueue(key, "Prompt to CLI agent");

    await new Promise((r) => setTimeout(r, 30));

    assert.equal(fetchCalled, true, "fetchAgentMap must be called for live lookup");
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].id, targetAgentId);
    assert.equal(sentMessages[0].msg, "Prompt to CLI agent");
    assert.equal(router.getQueue(key).length, 0);

    // busyAttempts cleared
    assert.equal(router.busyAttempts.has(key), false);

    // Cache updated to idle
    const cached = router.getLatestAgentMap()?.get(targetAgentId);
    assert.equal(cached?.status, "idle");
  });

  it("agent.turn_ended lifecycle event immediately updates latestAgentMap to idle and resets busyAttempts", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/lifecycle-test";
    const targetAgentId = "agent-lifecycle-ended";

    const mockServer = {
      events: { on: () => () => {} },
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    const router = new HookRouter(mockServer, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator(key, targetAgentId);

    // Seed stale running cache and high busy attempts (which would trigger wedged-queue alert)
    router.setLatestAgentMap(
      new Map([
        [
          targetAgentId,
          {
            id: targetAgentId,
            status: "running",
            activeTurn: { id: "turn-running", startedAt: Date.now() - 50000 } as any,
          },
        ],
      ])
    );
    router.busyAttempts.set(key, 11);

    // Agent finishes turn: dispatch lifecycle event
    router.handleLifecycleEvent("agent.turn_ended", { agent: { id: targetAgentId } });

    // Cache immediately reflects idle state and cleared activeTurn
    const cached = router.getLatestAgentMap()?.get(targetAgentId);
    assert.equal(cached?.status, "idle");
    assert.equal(cached?.activeTurn, null);

    // busyAttempts is reset to prevent wedged-queue alert
    assert.equal(router.busyAttempts.has(key), false);
  });

  it("agent.updated lifecycle event with idle status immediately updates cache and resets busyAttempts", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/update-test";
    const targetAgentId = "agent-lifecycle-updated";

    const mockServer = {
      events: { on: () => () => {} },
      on: () => () => {},
      before: () => () => {},
      handle: () => {},
      registerSettings: () => ({} as any),
      registerProvider: () => {},
    } as unknown as PluginServerContext;

    const router = new HookRouter(mockServer, { queueDir, stateDir, port: 0 });
    router.writeOrchestrator(key, targetAgentId);

    router.setLatestAgentMap(
      new Map([
        [
          targetAgentId,
          {
            id: targetAgentId,
            status: "running",
            activeTurn: { id: "turn-before" } as any,
          },
        ],
      ])
    );
    router.busyAttempts.set(key, 9);

    // Agent status update arrives with idle status
    router.handleLifecycleEvent("agent.updated", {
      agent: { id: targetAgentId, status: "idle", activeTurn: null },
    });

    const cached = router.getLatestAgentMap()?.get(targetAgentId);
    assert.equal(cached?.status, "idle");
    assert.equal(cached?.activeTurn, null);
    assert.equal(router.busyAttempts.has(key), false);
  });

  it("genuinely busy agent is verified by live check and remains held with incremented busyAttempts", async () => {
    const key = "forge.mrs.uppidi.com/xpufx-org/genuinely-busy";
    const targetAgentId = "agent-genuinely-busy";
    const sentMessages: Array<any> = [];

    const mockPaseo = {
      agents: {
        ref: (id: string) => {
          assert.equal(id, targetAgentId);
          return {
            current: () => ({ id, status: "running", activeTurn: { id: "turn-live" } }),
            refresh: async () => ({ agent: { id, status: "running", activeTurn: { id: "turn-live" } } }),
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

    router.setLatestAgentMap(
      new Map([
        [
          targetAgentId,
          {
            id: targetAgentId,
            status: "running",
            activeTurn: { id: "turn-cached" } as any,
          },
        ],
      ])
    );
    router.busyAttempts.set(key, 2);

    router.enqueue(key, "Prompt to genuinely busy agent");

    await new Promise((r) => setTimeout(r, 30));

    // Message must remain queued
    assert.equal(sentMessages.length, 0);
    assert.equal(router.getQueue(key).length, 1);

    // busyAttempts incremented from 2 to 3
    assert.equal(router.busyAttempts.get(key), 3);
  });
});

describe("hook-router ensure-orchestrator deterministic resolution and idempotency (#793)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let tempRepoDir: string;
  let router: HookRouter;
  let spawnedCalls: any[];
  let providerModes: Record<string, ProviderModeInfo | null>;
  let stopRouter: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-ensure-orch-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    tempRepoDir = join(tempDir, "repo-worktree");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(tempRepoDir, { recursive: true });
    spawnedCalls = [];
    providerModes = {
      "antigravity-acp": { modes: [{ id: "yolo", label: "YOLO" }], defaultModeId: "yolo" },
    };

    const workspacesWithRealDir = [
      {
        workspaceId: "ws-paseo-main",
        cwd: tempRepoDir,
        displayName: "Paseo",
        isolation: "local",
        projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
      },
    ];

    router = new HookRouter(null, {
      host: "127.0.0.1",
      queueDir,
      stateDir,
      port: 0,
      workspacesData: workspacesWithRealDir,
      // Pin model resolution so the suite never reads the operator's live
      // role-model config or circuit breaker (#955).
      orchestratorModelFallback: ["antigravity-acp/gemini-3.8-flash-low"],
      circuitBreakerPath: join(tempDir, "model-health.json"),
      providerModeResolver: async (provider) => providerModes[provider] ?? null,
      spawnAgent: async (opts) => {
        spawnedCalls.push(opts);
        return { id: `agent-${spawnedCalls.length}` };
      },
    });
    (router as any).deliverMessage = async () => true;
    await router.start();
    stopRouter = () => router.stop();
  });

  afterEach(async () => {
    if (stopRouter) {
      await stopRouter();
      stopRouter = null;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("validates repo parameter", async () => {
    const res = await router.ensureOrchestrator({ repo: "" });
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /repo is required/);
  });

  it("returns an actionable error when no workspace found for unknown repository", async () => {
    const res = await router.ensureOrchestrator({ repo: "unknown/repo" });
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "workspace_not_found");
    assert.match(res.error ?? "", /No workspace found/);
    assert.match(res.error ?? "", /Remediation:/);
    assert.equal(res.repo, "unknown/repo");
  });

  it("skips detach when the orchestrator spawned as a top-level peer (#889)", async () => {
    const detachCalls: string[] = [];
    (router as any).hasParentAgentLabel = async () => false;
    (router as any).detachAgent = async (id: string) => {
      detachCalls.push(id);
      return true;
    };

    const res = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(detachCalls.length, 0, "a top-level peer must not be detached");
  });

  it("detaches an orchestrator that still inherited a parent (#889)", async () => {
    const detachCalls: string[] = [];
    (router as any).hasParentAgentLabel = async () => true;
    (router as any).detachAgent = async (id: string) => {
      detachCalls.push(id);
      return true;
    };

    const res = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.deepEqual(detachCalls, ["agent-1"]);
  });

  it("reads the parent label from the daemon ref (#889)", async () => {
    const mockPaseo = {
      agents: {
        ref: () => ({ current: () => ({ id: "agent-parent", labels: { "paseo.parent-agent-id": "frontdesk-1" } }) }),
      },
    } as any;
    (router as any).activePaseo = mockPaseo;
    assert.equal(await router.hasParentAgentLabel("agent-parent"), true);

    const peerPaseo = {
      agents: { ref: () => ({ current: () => ({ id: "agent-peer", labels: {} }) }) },
    } as any;
    (router as any).activePaseo = peerPaseo;
    assert.equal(await router.hasParentAgentLabel("agent-peer"), false);
    (router as any).activePaseo = null;
  });

  it("deterministically resolves workspace and provisions orchestrator defaulting to yolo mode", async () => {
    const res = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(res.status, "provisioned");
    assert.equal(res.agentId, "agent-1");
    assert.equal(res.workspaceId, "ws-paseo-main");
    assert.equal(res.cwd, tempRepoDir);

    // Verify spawn options
    assert.equal(spawnedCalls.length, 1);
    assert.equal(spawnedCalls[0].mode, "yolo");
    assert.equal(spawnedCalls[0].provider, "antigravity-acp");
    assert.equal(spawnedCalls[0].labels.role, "orchestrator");
    assert.equal(spawnedCalls[0].labels.repo, "xpufx-org/paseo");

    // Verify authoritative registry is updated
    const record = router.readOrchestrator("xpufx-org/paseo");
    assert.equal(record?.agentId, "agent-1");
  });

  it("falls back to an enabled host provider when the configured default is disabled (#973)", async () => {
    const fallbackSpawns: any[] = [];
    const fallbackRouter = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      workspacesData: [
        {
          workspaceId: "ws-paseo-main",
          cwd: tempRepoDir,
          displayName: "Paseo",
          isolation: "local",
          projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
        },
      ],
      orchestratorModelFallback: [
        "antigravity-acp/gemini-3.8-flash-low",
        "antigravity/gemini-3.8-flash-low",
      ],
      circuitBreakerPath: join(tempDir, "model-health-fallback.json"),
      availableProvidersData: ["antigravity"],
      providerModeResolver: async () => ({ modes: [] }),
      spawnAgent: async (opts) => {
        fallbackSpawns.push(opts);
        return { id: "agent-fallback" };
      },
    });
    (fallbackRouter as any).hasParentAgentLabel = async () => false;

    const res = await fallbackRouter.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(fallbackSpawns.length, 1);
    assert.equal(fallbackSpawns[0].provider, "antigravity");
    assert.equal(fallbackSpawns[0].model, "gemini-3.8-flash-low");
    assert.equal(res.resolvedModelKey, "antigravity/gemini-3.8-flash-low");
    assert.deepEqual(
      (res.droppedModels ?? []).map((d) => [d.key, d.reason]),
      [["antigravity-acp/gemini-3.8-flash-low", "provider_disabled"]],
    );
    await fallbackRouter.stop();
  });

  it("fails loud, persists a banner, and posts the board alert when the chain is exhausted (#1011)", async () => {
    const alertsPath = join(tempDir, "model-alerts.json");
    const posted: Array<{ repo: string; alert: any }> = [];
    const exhaustedRouter = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      workspacesData: [
        {
          workspaceId: "ws-paseo-main",
          cwd: tempRepoDir,
          displayName: "Paseo",
          isolation: "local",
          projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
        },
      ],
      orchestratorModelFallback: [
        "antigravity-acp/gemini-3.8-flash-low",
        "codex/gpt-5.6-luna",
      ],
      circuitBreakerPath: join(tempDir, "model-health-exhausted.json"),
      modelAlertsPath: alertsPath,
      availableProvidersData: ["pi"],
      providerModeResolver: async () => ({ modes: [] }),
      postModelExhaustionAlert: async (repo, alert) => {
        posted.push({ repo, alert });
      },
      spawnAgent: async () => {
        throw new Error("must not spawn on total exhaustion");
      },
    });

    const res = await exhaustedRouter.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "model_exhausted");
    assert.match(res.error ?? "", /No orchestrator model is satisfiable/);
    assert.deepEqual(
      (res.droppedModels ?? []).map((d) => [d.key, d.reason]),
      [
        ["antigravity-acp/gemini-3.8-flash-low", "provider_disabled"],
        ["codex/gpt-5.6-luna", "provider_disabled"],
      ],
    );
    assert.equal(posted.length, 1);
    assert.equal(posted[0].repo, "forge.mrs.uppidi.com/xpufx-org/paseo");
    assert.match(posted[0].alert.message, /Live enabled providers: pi/);

    // Persistent banner survives for the dashboard to read.
    const persisted = readModelAlerts(alertsPath);
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    assert.ok(persisted[key], "the exhaustion banner must be persisted");
    assert.deepEqual(persisted[key].configuredChain, [
      "antigravity-acp/gemini-3.8-flash-low",
      "codex/gpt-5.6-luna",
    ]);
    assert.equal(persisted[key].dropped.length, 2);
    await exhaustedRouter.stop();
  });

  it("clears a stale exhaustion banner once a spawn resolves again (#1011)", async () => {
    const alertsPath = join(tempDir, "model-alerts-clear.json");
    const key = "forge.mrs.uppidi.com/xpufx-org/paseo";
    recordModelAlert(
      {
        repo: key,
        role: "orchestrator",
        message: "stale",
        configuredChain: ["antigravity-acp/gemini-3.8-flash-low"],
        dropped: [],
        availableProviders: ["pi"],
        createdAt: new Date().toISOString(),
      },
      alertsPath,
    );
    assert.ok(readModelAlerts(alertsPath)[key]);

    const recoveryRouter = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      workspacesData: [
        {
          workspaceId: "ws-paseo-main",
          cwd: tempRepoDir,
          displayName: "Paseo",
          isolation: "local",
          projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
        },
      ],
      orchestratorModelFallback: ["antigravity/gemini-3.8-flash-low"],
      circuitBreakerPath: join(tempDir, "model-health-recovery.json"),
      modelAlertsPath: alertsPath,
      availableProvidersData: ["antigravity"],
      providerModeResolver: async () => ({ modes: [] }),
      spawnAgent: async () => ({ id: "agent-recovered" }),
    });
    (recoveryRouter as any).hasParentAgentLabel = async () => false;
    const res = await recoveryRouter.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(readModelAlerts(alertsPath)[key], undefined, "recovery must clear the banner");
    await recoveryRouter.stop();
  });

  it("is idempotent: returns existing active orchestrator without duplicate spawns", async () => {
    // Mock active agent in agentMap
    const agentMap = new Map<string, any>([
      ["agent-1", { id: "agent-1", status: "idle" }],
    ]);
    (router as any).fetchAgentMap = async () => agentMap;

    // First ensure
    const first = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(first.ok, true);
    assert.equal(first.status, "provisioned");
    assert.equal(first.agentId, "agent-1");
    assert.equal(spawnedCalls.length, 1);

    // Second ensure for the same repo
    const second = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(second.ok, true);
    assert.equal(second.status, "existing");
    assert.equal(second.agentId, "agent-1");
    assert.equal(spawnedCalls.length, 1, "must not spawn duplicate agent");
  });

  it("re-provisions when registered agent is closed or terminated", async () => {
    // First ensure
    const first = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(first.ok, true);
    assert.equal(first.agentId, "agent-1");

    // Mark agent-1 as closed
    const agentMap = new Map<string, any>([
      ["agent-1", { id: "agent-1", status: "closed" }],
      ["agent-2", { id: "agent-2", status: "idle" }],
    ]);
    (router as any).fetchAgentMap = async () => agentMap;

    // Second ensure detects closed agent and provisions new agent
    const second = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(second.ok, true);
    assert.equal(second.status, "provisioned");
    assert.equal(second.agentId, "agent-2");
    assert.equal(spawnedCalls.length, 2);

    // Authoritative registry is updated with new agentId
    const record = router.readOrchestrator("xpufx-org/paseo");
    assert.equal(record?.agentId, "agent-2");
  });

  it("automatically drains buffered queues upon registration", async () => {
    // Buffer a message before orchestrator exists
    router.enqueue("xpufx-org/paseo", "buffered task 1");
    router.enqueue("forge.mrs.uppidi.com/xpufx-org/paseo", "buffered task 2");
    assert.equal(router.getQueue("xpufx-org/paseo").length, 1);
    assert.equal(router.getQueue("forge.mrs.uppidi.com/xpufx-org/paseo").length, 1);

    // Ensure orchestrator
    const res = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(res.status, "provisioned");

    // Queues for candidate keys are drained
    assert.equal(router.getQueue("xpufx-org/paseo").length, 0);
    assert.equal(router.getQueue("forge.mrs.uppidi.com/xpufx-org/paseo").length, 0);
  });

  it("handles HTTP POST /orchestrators/spawn", async () => {
    // 1. Missing repo -> 400
    const badRes = await fetch(`http://127.0.0.1:${router.port}/orchestrators/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(badRes.status, 400);
    const badBody = await badRes.json();
    assert.equal(badBody.ok, false);

    // 2. Unknown repo -> 422 with an actionable diagnostic naming the registry
    const notFoundRes = await fetch(`http://127.0.0.1:${router.port}/orchestrators/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "unknown/repo" }),
    });
    assert.equal(notFoundRes.status, 422);
    const notFoundBody = await notFoundRes.json();
    assert.equal(notFoundBody.ok, false);
    assert.equal(notFoundBody.errorCode, "workspace_not_found");
    assert.match(notFoundBody.error, /No workspace found for repository "unknown\/repo"/);
    assert.match(notFoundBody.error, /Remediation:/);
    assert.match(notFoundBody.error, /workspace open --cwd/);
    assert.equal(
      router.readOrchestrator("unknown/repo"),
      null,
      "failed provision must not register an orchestrator row",
    );

    // 3. Provisioning path -> 200 provisioned
    const provRes = await fetch(`http://127.0.0.1:${router.port}/orchestrators/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "xpufx-org/paseo", mode: "yolo" }),
    });
    assert.equal(provRes.status, 200);
    const provBody = await provRes.json();
    assert.equal(provBody.ok, true);
    assert.equal(provBody.status, "provisioned");
    assert.equal(provBody.agentId, "agent-1");

    // Mock active agent
    const agentMap = new Map<string, any>([
      ["agent-1", { id: "agent-1", status: "running" }],
    ]);
    (router as any).fetchAgentMap = async () => agentMap;

    // 4. Idempotency path on /orchestrators/spawn -> 200 existing
    const existRes = await fetch(`http://127.0.0.1:${router.port}/orchestrators/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "xpufx-org/paseo" }),
    });
    assert.equal(existRes.status, 200);
    const existBody = await existRes.json();
    assert.equal(existBody.ok, true);
    assert.equal(existBody.status, "existing");
    assert.equal(existBody.agentId, "agent-1");
  });

  it("does not register a failed spawn in the authoritative registry", async () => {
    (router as any).options.spawnAgent = async () => {
      throw new Error("spawn exploded");
    };

    const res = await fetch(`http://127.0.0.1:${router.port}/orchestrators/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: "xpufx-org/paseo" }),
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(router.readOrchestrator("xpufx-org/paseo"), null);
  });
});

describe("orchestrator provider mode resolution (#894)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let tempRepoDir: string;
  let capturedRuns: string[][] = [];

  const workspacesWithRealDir = (repoDir: string) => [
    {
      workspaceId: "ws-paseo-main",
      cwd: repoDir,
      displayName: "Paseo",
      isolation: "local",
      projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
    },
  ];

  const makeRouter = (options: Partial<HookRouterOptions> = {}): HookRouter =>
    new HookRouter(null, {
      port: 0,
      queueDir,
      stateDir,
      workspacesData: workspacesWithRealDir(tempRepoDir),
      // Pin model resolution so the suite never reads the operator's live
      // role-model config or circuit breaker (#955).
      orchestratorModelFallback: ["antigravity-acp/gemini-3.8-flash-low"],
      circuitBreakerPath: join(tempDir, "model-health.json"),
      ...options,
    });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-orch-mode-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    tempRepoDir = join(tempDir, "repo-worktree");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(tempRepoDir, { recursive: true });
    capturedRuns = [];
    setExecFileAsyncForTest(async (_cmd: string, args: readonly string[]) => {
      if (args[0] === "run") capturedRuns.push([...args]);
      return { stdout: JSON.stringify({ id: "agent-cli" }) };
    });
  });

  afterEach(() => {
    setExecFileAsyncForTest(null);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolveProviderSpawnMode omits the mode when the provider declares none", () => {
    assert.equal(resolveProviderSpawnMode({ modes: [] }, "yolo"), undefined);
    assert.equal(resolveProviderSpawnMode(null, "yolo"), undefined);
    assert.equal(resolveProviderSpawnMode(undefined, "yolo"), undefined);
  });

  it("resolveProviderSpawnMode matches requested modes by id or label", () => {
    const info: ProviderModeInfo = {
      modes: [
        { id: "build", label: "Build" },
        { id: "plan", label: "Plan" },
      ],
    };
    assert.equal(resolveProviderSpawnMode(info, "build"), "build");
    assert.equal(resolveProviderSpawnMode(info, "BUILD"), "build");
    assert.equal(resolveProviderSpawnMode(info, "Plan"), "plan");
  });

  it("resolveProviderSpawnMode falls back to an addressable default mode", () => {
    const info: ProviderModeInfo = {
      modes: [{ id: "full-access", label: "Full access" }],
      defaultModeId: "full-access",
    };
    assert.equal(resolveProviderSpawnMode(info, "yolo"), "full-access");
  });

  it("resolveProviderSpawnMode omits an unaddressable default mode", () => {
    const info: ProviderModeInfo = {
      modes: [
        { id: "build", label: "Build" },
        { id: "plan", label: "Plan" },
      ],
      defaultModeId: "default",
    };
    assert.equal(resolveProviderSpawnMode(info, "yolo"), undefined);
  });

  it("omits the spawn mode for a mode-less provider", async () => {
    const spawned: any[] = [];
    const router = makeRouter({
      providerModeResolver: async () => ({ modes: [] }),
      spawnAgent: async (opts) => {
        spawned.push(opts);
        return { id: "agent-pi" };
      },
    });

    const res = await router.ensureOrchestrator({
      repo: "xpufx-org/paseo",
      provider: "pi",
      model: "pi-model",
    });
    assert.equal(res.ok, true);
    assert.equal(spawned[0].provider, "pi");
    assert.equal(spawned[0].mode, undefined);
  });

  it("passes the resolved mode for a mode-capable provider", async () => {
    const spawned: any[] = [];
    const router = makeRouter({
      providerModeResolver: async () => ({
        modes: [{ id: "yolo", label: "YOLO" }],
        defaultModeId: "yolo",
      }),
      spawnAgent: async (opts) => {
        spawned.push(opts);
        return { id: "agent-antigravity" };
      },
    });

    const res = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(spawned[0].provider, "antigravity-acp");
    assert.equal(spawned[0].mode, "yolo");
  });

  it("omits --mode on the CLI fallback for a mode-less provider", async () => {
    const router = makeRouter({
      allowCliSpawn: true,
      providerModeResolver: async () => ({ modes: [] }),
    });

    const res = await router.ensureOrchestrator({
      repo: "xpufx-org/paseo",
      provider: "pi",
      model: "pi-model",
    });
    assert.equal(res.ok, true);
    assert.equal(capturedRuns.length, 1);
    assert.equal(capturedRuns[0].includes("--mode"), false);
  });

  it("passes --mode on the CLI fallback for a mode-capable provider", async () => {
    const router = makeRouter({
      allowCliSpawn: true,
      providerModeResolver: async () => ({
        modes: [{ id: "full-access", label: "Full access" }],
        defaultModeId: "full-access",
      }),
    });

    const res = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(capturedRuns.length, 1);
    const modeIdx = capturedRuns[0].indexOf("--mode");
    assert.ok(modeIdx >= 0, "expected --mode in CLI args");
    assert.equal(capturedRuns[0][modeIdx + 1], "full-access");
  });

  it("forwards auto_accept in the SDK create payload and scopes cwd to the workspace root (#974)", async () => {
    const payloads: any[] = [];
    const router = makeRouter({
      providerModeResolver: async () => ({ modes: [{ id: "yolo", label: "YOLO" }], defaultModeId: "yolo" }),
    });
    (router as any).activePaseo = {
      agents: {
        create: async (payload: any) => {
          payloads.push(payload);
          return { id: "agent-sdk-974" };
        },
        ref: (id: string) => ({
          current: () => ({ id, labels: {} }),
          setMode: async () => {},
          update: async () => {},
        }),
      },
    };

    const res = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(res.agentId, "agent-sdk-974");
    assert.equal(res.autoAcceptApplied, true);
    assert.equal(res.autoAllow, undefined, "the SDK path pre-grants; no CLI auto-allow runs");
    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0].config.featureValues, { auto_accept: true });
    assert.equal(payloads[0].config.cwd, tempRepoDir);
    assert.equal(payloads[0].cwd, tempRepoDir);
    assert.equal(payloads[0].workspaceId, "ws-paseo-main");
    assert.equal(payloads[0].workspace, "ws-paseo-main");
  });

  it("pre-grants a workspace-scoped permission on the CLI fallback and passes no auto-accept flag (#974)", async () => {
    const grantScopes: Array<{ agentId: string; scopes: readonly string[] }> = [];
    const router = makeRouter({
      allowCliSpawn: true,
      providerModeResolver: async () => ({ modes: [] }),
      spawnAutoAllow: async (agentId, scopePrefixes) => {
        grantScopes.push({ agentId, scopes: scopePrefixes });
        return { allowed: true, permissionId: "perm-974", scope: tempRepoDir };
      },
    });

    const res = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(res.ok, true);
    assert.equal(res.agentId, "agent-cli");
    assert.equal(res.autoAcceptApplied, false);
    assert.deepEqual(res.autoAllow, { allowed: true, permissionId: "perm-974", scope: tempRepoDir });
    assert.deepEqual(grantScopes, [{ agentId: "agent-cli", scopes: [tempRepoDir] }]);

    assert.equal(capturedRuns.length, 1);
    const args = capturedRuns[0];
    assert.equal(args[args.indexOf("--cwd") + 1], tempRepoDir, "CLI spawn scopes execution to the workspace root");
    assert.equal(
      args.some(
        (a) => a === "--auto-accept" || a.startsWith("--auto-accept") || a === "--feature" || a.startsWith("auto_accept"),
      ),
      false,
      "paseo run exposes no auto-accept flag; it must not be passed",
    );
  });
});

describe("board sweep auto-reconciliation (#794)", () => {
  let router: HookRouter;
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let tempRepoDir: string;
  let spawnedCalls: any[] = [];
  let deliveredMessages: Array<{ dest: string; msg: string }> = [];
  let stopRouter: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-sweep-reconcile-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    tempRepoDir = join(tempDir, "repo-worktree");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(tempRepoDir, { recursive: true });
    spawnedCalls = [];
    deliveredMessages = [];

    const workspacesWithRealDir = [
      {
        workspaceId: "ws-paseo-main",
        cwd: tempRepoDir,
        displayName: "Paseo",
        isolation: "local",
        projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
      },
    ];

    router = new HookRouter(null, {
      host: "127.0.0.1",
      queueDir,
      stateDir,
      port: 0,
      workspacesData: workspacesWithRealDir,
      spawnAgent: async (opts) => {
        spawnedCalls.push(opts);
        return { id: `agent-${spawnedCalls.length}` };
      },
    });
    router.writeFrontDesk("front-desk-1");
    (router as any).deliverMessage = async (dest: string, msg: string) => {
      deliveredMessages.push({ dest, msg });
      return true;
    };
    (router as any).runBoardCheck = async (repo: string) => {
      return {
        repo,
        ok: true,
        candidates: [
          {
            number: 1,
            title: "Task 1",
            labels: ["attention/1-agent"],
            category: "dispatchable",
            is_dispatchable: true,
            reason: "ready",
          },
        ],
      };
    };
    await router.start();
    stopRouter = () => router.stop();
  });

  afterEach(async () => {
    if (stopRouter) {
      await stopRouter();
      stopRouter = null;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("does not auto-provision an unenrolled repo with actionable work (#889)", async () => {
    (router as any).fetchAgentMap = async () => new Map();
    const sweep = await router.runBoardSweep(["xpufx-org/paseo"]);
    assert.equal(sweep.ok, true);
    assert.equal(sweep.swept, 1);
    assert.equal(sweep.actionable.length, 1);
    assert.equal(sweep.prunedCount, 0);
    assert.equal(sweep.autoEnsured, undefined);
    assert.equal(spawnedCalls.length, 0, "only enrolled repos are auto-staffed");

    assert.equal(deliveredMessages.length, 1);
    assert.equal(deliveredMessages[0].dest, "front-desk-1");
    assert.ok(
      deliveredMessages[0].msg.includes("1 actionable (1 dispatchable)"),
      `Expected notify-only message, got: ${deliveredMessages[0].msg}`,
    );
  });

  it("auto-staffs an enrolled repo with pending work and no active orchestrator (#889)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    (router as any).fetchAgentMap = async () => new Map();

    const sweep = await router.runBoardSweep(["xpufx-org/paseo"]);

    assert.equal(sweep.actionable.length, 1);
    assert.equal(sweep.autoEnsured?.length, 1);
    assert.match(sweep.autoEnsured?.[0]?.repo ?? "", /xpufx-org\/paseo$/);
    assert.equal(sweep.autoEnsured?.[0]?.status, "provisioned");
    assert.equal(spawnedCalls.length, 1, "expected one auto-provisioned orchestrator");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-1");
  });

  it("does not auto-staff an enrolled repo that already has an active orchestrator (#889)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    router.writeOrchestrator("xpufx-org/paseo", "agent-live");
    (router as any).fetchAgentMap = async () =>
      new Map([["agent-live", { id: "agent-live", status: "idle" }]]);

    const sweep = await router.runBoardSweep(["xpufx-org/paseo"]);

    assert.equal(sweep.actionable.length, 1);
    assert.equal(sweep.autoEnsured, undefined);
    assert.equal(spawnedCalls.length, 0, "staffed repo must not spawn a duplicate");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-live");
  });

  it("auto-staffs an unorchestrated enrolled repo on webhook queue ingress (#889)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    (router as any).fetchAgentMap = async () => new Map();

    const res = await router.ingestWebhook("issues", {
      repository: { full_name: "xpufx-org/paseo", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo" },
      issue: { number: 7, title: "Task" },
      action: "opened",
      sender: { login: "alice" },
    });
    assert.equal(res.frontDesk, false);

    await new Promise((r) => setTimeout(r, 25));
    assert.equal(spawnedCalls.length, 1, "webhook ingress should auto-staff the unstaffed repo");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-1");
  });

  it("does not auto-staff on webhook ingress when an orchestrator is registered (#889)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    router.writeOrchestrator("xpufx-org/paseo", "agent-live");
    (router as any).fetchAgentMap = async () =>
      new Map([["agent-live", { id: "agent-live", status: "idle" }]]);

    await router.ingestWebhook("issues", {
      repository: { full_name: "xpufx-org/paseo", html_url: "https://forge.mrs.uppidi.com/xpufx-org/paseo" },
      issue: { number: 8, title: "Task" },
      action: "opened",
      sender: { login: "alice" },
    });

    await new Promise((r) => setTimeout(r, 25));
    assert.equal(spawnedCalls.length, 0);
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-live");
  });

  it("marks an absent orchestrator stale on the first sweep and auto-heals it (#889)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    router.writeOrchestrator("xpufx-org/paseo", "dead-agent");
    (router as any).fetchAgentMap = async () => new Map();

    const sweep = await router.runBoardSweep(["xpufx-org/paseo"]);

    assert.equal(sweep.prunedCount, 0, "first absence must never prune");
    assert.equal(spawnedCalls.length, 1, "unstaffed enrolled repo is auto-healed");
    const record = router.readOrchestrator("xpufx-org/paseo");
    assert.equal(record?.agentId, "agent-1");
    assert.equal(record?.stale, false);
  });

  it("does not treat error-status orchestrators as active", async () => {
    router.writeOrchestrator("xpufx-org/paseo", "errored-agent");
    (router as any).fetchAgentMap = async () =>
      new Map([["errored-agent", { id: "errored-agent", status: "error" }]]);

    assert.equal(await router.getActiveOrchestrator("xpufx-org/paseo"), null);
  });

  it("recovers a lost orchestrator registration from a live labelled agent (#987)", async () => {
    const liveMap = new Map<string, WatchdogAgent>([
      [
        "agent-recovered",
        {
          id: "agent-recovered",
          status: "idle",
          labels: { role: "orchestrator", category: "orchestrator", repo: "xpufx-org/paseo" },
        },
      ],
    ]);

    const active = await router.getActiveOrchestrator("xpufx-org/paseo", liveMap);
    assert.ok(active, "a live labelled orchestrator is adopted into the registry");
    assert.equal(active?.agentId, "agent-recovered");

    const record = router.readOrchestrator("xpufx-org/paseo");
    assert.equal(record?.agentId, "agent-recovered");
    assert.equal(record?.by, "recovered");
    assert.equal(record?.stale, false);
  });

  it("does not provision a duplicate when a live orchestrator exists without a registration (#987)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    const liveMap = new Map<string, WatchdogAgent>([
      [
        "agent-lost-reg",
        { id: "agent-lost-reg", status: "running", labels: { role: "orchestrator", repo: "xpufx-org/paseo" } },
      ],
    ]);

    const ensured = await router.ensureUnstaffedEnrolledRepo("xpufx-org/paseo", { agentMap: liveMap });

    assert.equal(ensured, null, "a live orchestrator must short-circuit provisioning");
    assert.equal(spawnedCalls.length, 0, "no duplicate orchestrator may be spawned");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-lost-reg");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.by, "recovered");
  });

  it("watchdog auto-provisions an unstaffed enrolled repo with pending work (#987)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    (router as any).fetchAgentMap = async () => new Map();
    (router as any).queues.set("xpufx-org/paseo", [
      { id: "m1", key: "xpufx-org/paseo", msg: "pending", ts: Date.now() },
    ]);

    const audit = await router.runWatchdogAudit({
      agentMap: new Map(),
      orchestratorRecords: [],
      reloadAgent: async () => ({ ok: true }),
    });

    assert.ok(
      audit.anomalies.some((a) => a.type === "ORCHESTRATOR_PROVISIONED" && a.key === "xpufx-org/paseo"),
      "expected the watchdog to provision an orchestrator for the unstaffed queue",
    );
    assert.equal(spawnedCalls.length, 1, "one orchestrator is provisioned, not a duplicate");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-1");
    assert.ok(
      deliveredMessages.some((d) => d.msg.includes("auto-provisioned orchestrator agent-1")),
      "Front Desk is told the queue was auto-staffed",
    );
  });

  it("recovers a registered orchestrator omitted by a stale cached agent map (#987)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    router.writeOrchestrator("xpufx-org/paseo", "agent-live-registered");

    const staleMap = new Map<string, WatchdogAgent>(); // stale: omits the live registration
    const freshMap = new Map<string, WatchdogAgent>([
      ["agent-live-registered", { id: "agent-live-registered", status: "idle" }],
    ]);
    let fetches = 0;
    (router as any).fetchAgentMap = async () => {
      fetches += 1;
      return freshMap;
    };

    const ensured = await router.ensureUnstaffedEnrolledRepo("xpufx-org/paseo", { agentMap: staleMap });

    assert.equal(ensured, null, "the live registered orchestrator must be found after refresh");
    assert.equal(spawnedCalls.length, 0, "no duplicate orchestrator may be spawned");
    assert.equal(fetches, 1, "exactly one fresh roster fetch is attempted");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-live-registered");
  });

  it("coalesces concurrent auto-ensure calls into a single orchestrator spawn (#987)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    (router as any).fetchAgentMap = async () => new Map();

    let ensureCalls = 0;
    const realEnsure = router.ensureOrchestrator.bind(router);
    router.ensureOrchestrator = (async (input: any) => {
      ensureCalls += 1;
      return await realEnsure(input);
    }) as typeof router.ensureOrchestrator;

    const [a, b, c] = await Promise.all([
      router.ensureUnstaffedEnrolledRepo("xpufx-org/paseo", { reason: "concurrent a" }),
      router.ensureUnstaffedEnrolledRepo("xpufx-org/paseo", { reason: "concurrent b" }),
      router.ensureUnstaffedEnrolledRepo("xpufx-org/paseo", { reason: "concurrent c" }),
    ]);

    assert.equal(spawnedCalls.length, 1, "concurrent ensures must coalesce to one spawn");
    assert.equal(ensureCalls, 1, "the per-repo guard coalesces before provisioning");
    assert.ok(a && b === a && c === a, "all callers share the coalesced result");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-1");
  });

  it("detects live orchestrators by title/name matching 'Orchestrator · <repo>' without labels (#993)", async () => {
    const liveMap = new Map<string, WatchdogAgent>([
      [
        "agent-title-orch",
        {
          id: "agent-title-orch",
          status: "running",
          name: "Orchestrator · forge.mrs.uppidi.com/xpufx-org/paseo",
        },
      ],
    ]);

    const active = await router.getActiveOrchestrator("xpufx-org/paseo", liveMap);
    assert.ok(active, "a live agent with matching Orchestrator title is adopted");
    assert.equal(active?.agentId, "agent-title-orch");

    const record = router.readOrchestrator("xpufx-org/paseo");
    assert.equal(record?.agentId, "agent-title-orch");
  });

  it("performs a pre-spawn check against the latest live agent roster to guarantee no duplicate orchestrator is spawned (#993)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    const liveMap = new Map<string, WatchdogAgent>([
      [
        "agent-live-prespawn",
        {
          id: "agent-live-prespawn",
          status: "idle",
          title: "Orchestrator · xpufx-org/paseo",
        },
      ],
    ]);
    (router as any).fetchAgentMap = async () => liveMap;

    const result = await router.ensureOrchestrator({ repo: "xpufx-org/paseo" });
    assert.equal(result.ok, true);
    assert.equal(result.status, "existing");
    assert.equal(result.agentId, "agent-live-prespawn");
    assert.equal(spawnedCalls.length, 0, "pre-spawn check prevented duplicate agent spawn");
  });

  it("enforces singleton invariant by archiving duplicate extras and keeping the newest authoritative agent (#993)", async () => {
    const archivedIds: string[] = [];
    (router as any).archiveAgent = async (id: string) => {
      archivedIds.push(id);
      return true;
    };

    const duplicateMap = new Map<string, WatchdogAgent>([
      [
        "agent-older",
        {
          id: "agent-older",
          status: "idle",
          title: "Orchestrator · xpufx-org/paseo",
          updatedAt: "2026-10-06T10:00:00Z",
        },
      ],
      [
        "agent-newer",
        {
          id: "agent-newer",
          status: "running",
          name: "Orchestrator · forge.mrs.uppidi.com/xpufx-org/paseo",
          updatedAt: "2026-10-06T11:00:00Z",
        },
      ],
    ]);

    const active = await router.getActiveOrchestrator("xpufx-org/paseo", duplicateMap);
    assert.ok(active);
    assert.equal(active?.agentId, "agent-newer", "the newest agent must be kept as authoritative");
    assert.deepEqual(archivedIds, ["agent-older"], "the older duplicate extra must be archived");

    const record = router.readOrchestrator("xpufx-org/paseo");
    assert.equal(record?.agentId, "agent-newer");
  });

  it("guards runBoardSweep so concurrent auto-ensures do not spawn duplicate orchestrators (#993)", async () => {
    router.enrollRepo("xpufx-org/paseo");
    (router as any).fetchAgentMap = async () => new Map();

    let sweepCheckCount = 0;
    const realBoardCheck = (router as any).runBoardCheck.bind(router);
    (router as any).runBoardCheck = async (repo: string) => {
      sweepCheckCount++;
      await new Promise((r) => setTimeout(r, 20));
      return await realBoardCheck(repo);
    };

    const [sweep1, sweep2] = await Promise.all([
      router.runBoardSweep(["xpufx-org/paseo"]),
      router.runBoardSweep(["xpufx-org/paseo"]),
    ]);

    assert.equal(sweep1.ok, true);
    assert.equal(sweep2.ok, true);
    assert.equal(sweepCheckCount, 1, "concurrent sweeps must coalesce and not duplicate board checks");
    assert.equal(spawnedCalls.length, 1, "exactly one orchestrator is spawned across concurrent sweeps");
  });

  it("standardizes agent identity on title/name and cwd without reliance on labels (#999)", async () => {
    // 1. isOrchestratorAgent identification by title/name variants without labels
    assert.equal(isOrchestratorAgent({ title: "Orchestrator · xpufx-org/paseo" }), true);
    assert.equal(isOrchestratorAgent({ name: "Orchestrator · forge.mrs.uppidi.com/xpufx-org/paseo" }), true);
    assert.equal(isOrchestratorAgent({ title: "Orchestrator - xpufx-org/paseo" }), true);
    assert.equal(isOrchestratorAgent({ title: "Orchestrator: xpufx-org/paseo" }), true);
    assert.equal(isOrchestratorAgent({ title: "orchestrator" }), true);
    assert.equal(isOrchestratorAgent({ title: "Worker: task-1" }), false);
    assert.equal(isOrchestratorAgent({ title: "Front Desk" }), false);

    // 2. isFrontDeskAgent identification by title/name
    assert.equal(isFrontDeskAgent({ title: "Front Desk" }), true);
    assert.equal(isFrontDeskAgent({ name: "Front Desk (primary)" }), true);
    assert.equal(isFrontDeskAgent({ title: "frontdesk" }), true);
    assert.equal(isFrontDeskAgent({ title: "Orchestrator · xpufx-org/paseo" }), false);
    assert.equal(isFrontDeskAgent({ title: "Worker: coding" }), false);

    // 3. isOrchestratorMatchingRepo matches forge-qualified and slug titles without labels
    const orchAgent: WatchdogAgent = {
      id: "orch-unlabelled",
      title: "Orchestrator · forge.mrs.uppidi.com/xpufx-org/paseo",
      status: "idle",
    };
    assert.equal(isOrchestratorMatchingRepo(orchAgent, "xpufx-org/paseo"), true);
    assert.equal(isOrchestratorMatchingRepo(orchAgent, "forge.mrs.uppidi.com/xpufx-org/paseo"), true);
    assert.equal(isOrchestratorMatchingRepo(orchAgent, "other-org/other-repo"), false);

    // 4. isOrchestratorMatchingRepo matches agent cwd against workspace checkout without labels
    const workspaceCheckout = "/home/dev-user/.paseo/worktrees/repo-checkout";
    const cwdOrchAgent: WatchdogAgent = {
      id: "orch-cwd",
      title: "Orchestrator · unlabelled",
      cwd: workspaceCheckout,
      status: "running",
    };
    assert.equal(
      isOrchestratorMatchingRepo(cwdOrchAgent, "xpufx-org/paseo", workspaceCheckout),
      true,
      "matches when agent cwd matches repo workspace checkout",
    );
    assert.equal(
      isOrchestratorMatchingRepo(cwdOrchAgent, "xpufx-org/paseo", "/other/workspace"),
      false,
      "does not match when agent cwd differs from repo workspace checkout",
    );

    // 5. findLiveOrchestratorAgents finds agent by cwd when title is generic
    const liveMapWithCwd = new Map<string, WatchdogAgent>([
      [
        "orch-cwd-match",
        {
          id: "orch-cwd-match",
          title: "Orchestrator",
          cwd: "/home/dev-user/code/platform",
          status: "running",
        },
      ],
    ]);
    const matches = findLiveOrchestratorAgents(
      "xpufx-org/platform",
      liveMapWithCwd,
      null,
      "/home/dev-user/code/platform",
    );
    assert.equal(matches.length, 1);
    assert.equal(matches[0].id, "orch-cwd-match");

    // 6. getActiveOrchestrator adopts live orchestrator discovered via cwd matching without labels
    router.enrollRepo("xpufx-org/platform");
    (router as any).resolveWorkspace = (repo: string) => ({ cwd: "/home/dev-user/code/platform" });
    const active = await router.getActiveOrchestrator("xpufx-org/platform", liveMapWithCwd);
    assert.ok(active);
    assert.equal(active?.agentId, "orch-cwd-match");
  });
});

describe("test isolation & CLI agent execution safety (#814)", () => {
  it("disallows host-level CLI agent spawn in test mode when spawnAgent is not provided", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "paseo-test-814-"));
    try {
      const router = new HookRouter(null, {
        queueDir: join(tempDir, "queues"),
        stateDir: join(tempDir, "state"),
        port: 0,
        workspacesData: [
          {
            workspaceId: "ws-mock",
            cwd: tempDir,
            displayName: "repo",
            projectKey: "mock-org/repo",
          },
        ],
      });
      assert.equal(router.isTestMode, true);

      // Attempt ensureOrchestrator without spawnAgent mock
      const result = await router.ensureOrchestrator({ repo: "mock-org/repo" });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes("CLI agent spawning is disabled in test mode"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("isolates default queueDir and stateDir when omitted in test mode", () => {
    const router = new HookRouter(null, { port: 0 });
    assert.equal(router.isTestMode, true);
    assert.ok(
      !router.queueDir.includes(".paseo/plugin-data"),
      `queueDir should not point to host paseo dir: ${router.queueDir}`,
    );
    assert.ok(
      !router.stateDir.includes(".paseo/plugin-data"),
      `stateDir should not point to host paseo dir: ${router.stateDir}`,
    );
    assert.ok(router.queueDir.includes("paseo-test-hook-router"));
    assert.ok(router.stateDir.includes("paseo-test-hook-router"));
  });

  it("disallows CLI mutation operations (setAgentMode, detachAgent, updateAgentMetadata, reloadAgent, stopAgent) in test mode", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "paseo-test-814-ops-"));
    try {
      const router = new HookRouter(null, {
        queueDir: join(tempDir, "queues"),
        stateDir: join(tempDir, "state"),
        port: 0,
      });

      const modeRes = await router.setAgentMode("agent-123", "yolo");
      assert.equal(modeRes, false);

      const detachRes = await router.detachAgent("agent-123");
      assert.equal(detachRes, false);

      const updateRes = await router.updateAgentMetadata("agent-123", "Name", { role: "test" });
      assert.equal(updateRes, false);

      const reloadRes = await router.reloadAgent("agent-123");
      assert.equal(reloadRes.ok, false);
      assert.ok(reloadRes.error?.includes("disabled in test mode"));

      const stopRes = await router.stopAgent("agent-123");
      assert.equal(stopRes.ok, false);
      assert.ok(stopRes.error?.includes("disabled in test mode"));

      const clearAttentionRes = await router.clearDaemonAttention("agent-123");
      assert.equal(clearAttentionRes, false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("isolates workspace resolution from host ~/.paseo in test mode", () => {
    const router = new HookRouter(null, { port: 0 });
    // Without workspacesData, resolving an arbitrary repo must not find a host workspace
    const resolved = router.resolveWorkspace("nonexistent-test-owner/test-repo-xyz");
    assert.equal(resolved, null);
  });
});

describe("hook-router direct-action guards (#847)", () => {
  const REPO = "xpufx-org/paseo";
  const REPO_URL = "https://forge.mrs.uppidi.com/xpufx-org/paseo";
  const REPO_KEY = "forge.mrs.uppidi.com/xpufx-org/paseo";

  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let requests: Array<{ url: string; method: string; body: any }>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-direct-actions-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    requests = [];
    setTokenResolverForTest(async () => "test-token");
  });

  afterEach(() => {
    setFetchForTest(null);
    setTokenResolverForTest(null);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  type FetchReply = { status?: number; data?: any };
  function installFetch(handler: (req: { url: string; method: string; body: any }) => FetchReply | undefined) {
    setFetchForTest(async (input: string, init?: any) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const req = { url: input, method, body };
      requests.push(req);
      const reply = handler(req) ?? {};
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "",
        json: async () => reply.data ?? {},
      };
    });
  }

  function makeRouter(overrides: Partial<HookRouterOptions> = {}): HookRouter {
    return new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      labelTriageEnabled: true,
      closeGuardEnabled: true,
      ...overrides,
    });
  }

  function baseRepository() {
    return { full_name: REPO, html_url: REPO_URL, clone_url: `${REPO_URL}.git` };
  }

  function issueBody(action: string, opts: {
    actor: string;
    number?: number;
    labels?: any[];
    pullRequest?: any;
    state?: string;
  }) {
    const number = opts.number ?? 42;
    return {
      action,
      repository: baseRepository(),
      sender: { login: opts.actor },
      issue: {
        number,
        title: "Test issue",
        state: opts.state ?? "open",
        html_url: `${REPO_URL}/issues/${number}`,
        labels: opts.labels ?? [],
        ...(opts.pullRequest !== undefined ? { pull_request: opts.pullRequest } : {}),
      },
    };
  }

  describe("labelTriageDecision", () => {
    const human = { actor: "alice", labels: [] as string[], isPullRequest: false };

    it("skips the shared agent actor", () => {
      const d = labelTriageDecision({ ...human, actor: SHARED_AGENT_ACTOR });
      assert.equal(d.act, false);
      assert.match(d.reason, /shared actor/);
    });

    it("skips pull requests", () => {
      const d = labelTriageDecision({ ...human, isPullRequest: true });
      assert.equal(d.act, false);
      assert.match(d.reason, /pull request/);
    });

    it("skips flag/stop-work even when SOS is present", () => {
      const d = labelTriageDecision({
        ...human,
        labels: [LABEL_TRIAGE_STOP_WORK_LABEL, SOS_LABEL],
      });
      assert.equal(d.act, false);
      assert.match(d.reason, /stop-work/);
    });

    it("skips terminal labels", () => {
      for (const terminal of LABEL_TRIAGE_TERMINAL_LABELS) {
        const d = labelTriageDecision({ ...human, labels: [terminal] });
        assert.equal(d.act, false, `expected ${terminal} to suppress triage`);
        assert.match(d.reason, /terminal label/);
      }
    });

    it("lets priority/0-SOS break through terminal labels", () => {
      const d = labelTriageDecision({ ...human, labels: ["state/4-done", SOS_LABEL] });
      assert.equal(d.act, true);
    });

    it("skips when orchestrator attention is already set", () => {
      const d = labelTriageDecision({ ...human, labels: [ORCHESTRATOR_ATTENTION_LABEL] });
      assert.equal(d.act, false);
      assert.match(d.reason, /already assigned/);
    });

    it("acts for a human on an ordinary issue", () => {
      const d = labelTriageDecision({ ...human, labels: ["kind/bug", "state/1-wip"] });
      assert.equal(d.act, true);
    });

    it("matches labels case-insensitively", () => {
      const d = labelTriageDecision({ ...human, labels: ["STATE/4-DONE"] });
      assert.equal(d.act, false);
    });

    it("honours a custom shared actor", () => {
      const d = labelTriageDecision({ ...human, actor: "robot", sharedActor: "robot" });
      assert.equal(d.act, false);
    });
  });

  describe("closeGuardDecision", () => {
    const target = { actor: "xpufx", labels: [] as string[], isPullRequest: false };

    it("skips non-target actors", () => {
      const d = closeGuardDecision({ ...target, actor: "alice" });
      assert.equal(d.act, false);
      assert.match(d.reason, /not a target actor/);
    });

    it("skips pull requests", () => {
      const d = closeGuardDecision({ ...target, isPullRequest: true });
      assert.equal(d.act, false);
      assert.match(d.reason, /pull request/);
    });

    it("does not bypass for terminal acceptance labels (#996)", () => {
      for (const label of CLOSE_GUARD_ACCEPTED_LABELS) {
        const d = closeGuardDecision({ ...target, labels: [label] });
        assert.equal(d.act, true, `expected ${label} to be intercepted`);
        assert.match(d.reason, /targeted actor closed an issue/);
      }
    });

    it("acts when a target actor closes an issue regardless of labels", () => {
      const d = closeGuardDecision({ ...target, labels: ["kind/bug", "state/4-done", "confirmed-done"] });
      assert.equal(d.act, true);
    });

    it("supports a custom target actor list", () => {
      const d = closeGuardDecision({ ...target, actor: "bob", targetActors: ["bob", "carol"] });
      assert.equal(d.act, true);
      const skipped = closeGuardDecision({ ...target, actor: "dave", targetActors: ["bob", "carol"] });
      assert.equal(skipped.act, false);
    });
  });

  describe("helpers", () => {
    it("parses comma-separated target actors and trims whitespace", () => {
      assert.deepEqual(parseTargetActors(" xpufx, bot ,  "), ["xpufx", "bot"]);
      assert.deepEqual(parseTargetActors(""), [...DEFAULT_CLOSE_GUARD_TARGET_ACTORS]);
      assert.deepEqual(parseTargetActors(undefined), [...DEFAULT_CLOSE_GUARD_TARGET_ACTORS]);
      assert.deepEqual(parseTargetActors(["a", " b "]), ["a", "b"]);
    });

    it("extracts label names from string and object labels", () => {
      assert.deepEqual(
        labelNamesFromIssue({ labels: ["kind/bug", { name: "state/1-wip" }, { noName: true }] }),
        ["kind/bug", "state/1-wip"],
      );
      assert.deepEqual(labelNamesFromIssue({}), []);
    });

    it("detects pull request subjects authoritatively", () => {
      assert.equal(isPullRequestSubject({ pull_request: {} }), true);
      assert.equal(isPullRequestSubject({ pull_request: null }), false);
      assert.equal(isPullRequestSubject({ pull_request: false }), false);
      assert.equal(isPullRequestSubject({}), false);
    });

    it("normalizes label names", () => {
      assert.equal(normalizeLabelName("  STATE/4-DONE "), "state/4-done");
    });
  });

  describe("runLabelTriage", () => {
    it("applies attention/0-orchestrator for a human on issues:opened", async () => {
      const router = makeRouter();
      installFetch((req) => {
        if (req.method === "GET" && req.url.endsWith("/issues/42")) {
          return { data: { number: 42, title: "T", state: "open", labels: [{ name: "kind/bug" }] } };
        }
        if (req.method === "POST" && req.url.endsWith("/issues/42/labels")) {
          return { data: [{ name: ORCHESTRATOR_ATTENTION_LABEL }] };
        }
        return { status: 404 };
      });

      const res = await router.runLabelTriage(issueBody("opened", { actor: "alice" }));
      assert.equal(res.acted, true);
      assert.equal(res.appliedLabel, ORCHESTRATOR_ATTENTION_LABEL);

      const post = requests.find((r) => r.method === "POST");
      assert.ok(post, "expected a label POST");
      assert.equal(post!.url, `https://forge.mrs.uppidi.com/api/v1/repos/${REPO}/issues/42/labels`);
      assert.deepEqual(post!.body, { labels: [ORCHESTRATOR_ATTENTION_LABEL] });
    });

    it("skips the shared actor without touching the API", async () => {
      const router = makeRouter();
      installFetch(() => ({ data: {} }));
      const res = await router.runLabelTriage(issueBody("opened", { actor: SHARED_AGENT_ACTOR }));
      assert.equal(res.acted, false);
      assert.equal(requests.length, 0);
    });

    it("skips pull request activity", async () => {
      const router = makeRouter();
      installFetch(() => ({ data: { number: 42, labels: [], pull_request: { url: "x" } } }));
      const res = await router.runLabelTriage(issueBody("opened", { actor: "alice", pullRequest: { url: "x" } }));
      assert.equal(res.acted, false);
      assert.equal(requests.filter((r) => r.method === "POST").length, 0);
    });

    it("skips terminal and stop-work states", async () => {
      const router = makeRouter();
      installFetch(() => ({ data: { number: 42, labels: [{ name: "flag/stop-work" }] } }));
      const res = await router.runLabelTriage(issueBody("opened", { actor: "alice" }));
      assert.equal(res.acted, false);
      assert.equal(requests.filter((r) => r.method === "POST").length, 0);
    });

    it("reports an API failure without throwing", async () => {
      const router = makeRouter();
      installFetch((req) => (req.method === "GET" ? { status: 500 } : { status: 500 }));
      const res = await router.runLabelTriage(issueBody("opened", { actor: "alice" }));
      assert.equal(res.acted, false);
      assert.match(res.reason, /issue fetch failed/);
    });

    it("is disabled by default in test mode", async () => {
      const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
      installFetch(() => ({ data: {} }));
      const res = await router.runLabelTriage(issueBody("opened", { actor: "alice" }));
      assert.equal(res.acted, false);
      assert.equal(res.reason, "label triage disabled");
      assert.equal(requests.length, 0);
    });
  });

  describe("runCloseGuard", () => {
    it("reopens, comments, and notifies when a target actor closes a non-terminal issue", async () => {
      const router = makeRouter();
      installFetch((req) => {
        if (req.method === "GET") {
          return {
            data: {
              number: 7,
              title: "Bug",
              state: "closed",
              labels: [{ name: "kind/bug" }],
              html_url: `${REPO_URL}/issues/7`,
            },
          };
        }
        if (req.method === "PATCH") return { data: { number: 7, state: "open" } };
        if (req.method === "POST" && req.url.endsWith("/comments")) return { data: { id: 1 } };
        return { status: 404 };
      });

      const res = await router.runCloseGuard(issueBody("closed", { actor: "xpufx", number: 7, state: "closed" }));
      assert.equal(res.acted, true);
      assert.equal(res.reopened, true);
      assert.equal(res.commented, true);
      assert.equal(res.notified, true);

      const patch = requests.find((r) => r.method === "PATCH");
      assert.ok(patch);
      assert.equal(patch!.url, `https://forge.mrs.uppidi.com/api/v1/repos/${REPO}/issues/7`);
      assert.deepEqual(patch!.body, { state: "open" });

      const comment = requests.find((r) => r.method === "POST" && r.url.endsWith("/comments"));
      assert.ok(comment);
      assert.equal(comment!.body.body, CLOSE_GUARD_POLICY_COMMENT);
      assert.ok(comment!.body.body.includes("> [!WARNING]"));

      // Notification is routed through the normal queue for the repo.
      assert.equal(router.getQueue(REPO_KEY).length, 1);
    });

    it("skips non-target actors without touching the API", async () => {
      const router = makeRouter();
      installFetch(() => ({ data: {} }));
      const res = await router.runCloseGuard(issueBody("closed", { actor: "alice" }));
      assert.equal(res.acted, false);
      assert.equal(requests.length, 0);
    });

    it("reopens even when a terminal acceptance label is present (#996)", async () => {
      const router = makeRouter();
      installFetch((req) => {
        if (req.method === "GET") {
          return {
            data: {
              number: 7,
              title: "Bug",
              state: "closed",
              labels: [{ name: "state/4-done" }],
              html_url: `${REPO_URL}/issues/7`,
            },
          };
        }
        if (req.method === "PATCH") return { data: { number: 7, state: "open" } };
        if (req.method === "POST" && req.url.endsWith("/comments")) return { data: { id: 1 } };
        return { status: 404 };
      });
      const res = await router.runCloseGuard(issueBody("closed", { actor: "xpufx", number: 7, state: "closed" }));
      assert.equal(res.acted, true);
      assert.equal(res.reopened, true);
      assert.equal(requests.filter((r) => r.method === "PATCH").length, 1);
    });

    it("still reopens when the policy comment fails", async () => {
      const router = makeRouter();
      installFetch((req) => {
        if (req.method === "GET") return { data: { number: 7, title: "Bug", labels: [] } };
        if (req.method === "PATCH") return { data: { number: 7, state: "open" } };
        return { status: 500 };
      });
      const res = await router.runCloseGuard(issueBody("closed", { actor: "xpufx", number: 7 }));
      assert.equal(res.acted, true);
      assert.equal(res.reopened, true);
      assert.equal(res.commented, false);
    });

    it("does not comment or notify when the reopen fails", async () => {
      const router = makeRouter();
      installFetch((req) => {
        if (req.method === "GET") return { data: { number: 7, labels: [] } };
        return { status: 500 };
      });
      const res = await router.runCloseGuard(issueBody("closed", { actor: "xpufx", number: 7 }));
      assert.equal(res.acted, false);
      assert.match(res.reason, /reopen failed/);
      assert.equal(requests.filter((r) => r.method === "POST").length, 0);
      assert.equal(router.getQueue(REPO_KEY).length, 0);
    });

    it("never fails the guard when notification throws", async () => {
      const router = makeRouter();
      installFetch((req) => {
        if (req.method === "GET") return { data: { number: 7, title: "Bug", labels: [] } };
        if (req.method === "PATCH") return { data: { number: 7, state: "open" } };
        return { data: { id: 1 } };
      });
      (router as any).notifyReopened = async () => {
        throw new Error("notify boom");
      };
      const res = await router.runCloseGuard(issueBody("closed", { actor: "xpufx", number: 7 }));
      assert.equal(res.acted, true);
      assert.equal(res.notified, false);
    });

    it("supports custom target actors", async () => {
      const router = makeRouter({ closeGuardTargetActors: ["bot-actor"] });
      installFetch((req) => {
        if (req.method === "GET") return { data: { number: 7, title: "Bug", labels: [] } };
        if (req.method === "PATCH") return { data: { number: 7, state: "open" } };
        return { data: { id: 1 } };
      });
      const res = await router.runCloseGuard(issueBody("closed", { actor: "bot-actor", number: 7 }));
      assert.equal(res.acted, true);
    });

    it("is disabled by default in test mode", async () => {
      const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
      installFetch(() => ({ data: {} }));
      const res = await router.runCloseGuard(issueBody("closed", { actor: "xpufx" }));
      assert.equal(res.acted, false);
      assert.equal(res.reason, "close guard disabled");
      assert.equal(requests.length, 0);
    });
  });

  describe("ciFailureIssueTitle", () => {
    it("formats the title with workflow name and repo", () => {
      assert.equal(ciFailureIssueTitle("CI", "xpufx-org/paseo"), "ci: CI failed (xpufx-org/paseo)");
    });
  });

  describe("ciFailureDetailsFromPayload", () => {
    function actionRunFailureBody(overrides: Record<string, any> = {}) {
      return {
        action: "failure",
        run: {
          id: 123,
          title: "CI",
          status: "failure",
          html_url: `${REPO_URL}/actions/runs/123`,
          repository: baseRepository(),
          ...overrides,
        },
        prior_status: "in_progress",
      };
    }

    it("extracts workflow name, repo, run URL, and conclusion", () => {
      const details = ciFailureDetailsFromPayload(actionRunFailureBody());
      assert.ok(details);
      assert.equal(details!.workflowName, "CI");
      assert.equal(details!.repo, REPO);
      assert.equal(details!.runUrl, `${REPO_URL}/actions/runs/123`);
      assert.equal(details!.conclusion, "failure");
      assert.equal(details!.title, `ci: CI failed (${REPO})`);
      assert.equal(details!.failedStep, null);
    });

    it("falls back to workflow_id when title is missing", () => {
      const details = ciFailureDetailsFromPayload(actionRunFailureBody({ title: "", workflow_id: 456 }));
      assert.equal(details!.workflowName, "456");
    });

    it("falls back to 'unknown workflow' when neither title nor workflow_id is present", () => {
      const details = ciFailureDetailsFromPayload(actionRunFailureBody({ title: null, workflow_id: null }));
      assert.equal(details!.workflowName, "unknown workflow");
    });

    it("surfaces a failed step when the payload carries one", () => {
      const details = ciFailureDetailsFromPayload(actionRunFailureBody({ failed_step: "build" }));
      assert.equal(details!.failedStep, "build");
    });

    it("returns null when the payload has no run", () => {
      assert.equal(ciFailureDetailsFromPayload({ action: "failure" }), null);
      assert.equal(ciFailureDetailsFromPayload({}), null);
      assert.equal(ciFailureDetailsFromPayload(null), null);
    });

    it("returns null when the run has no repository full_name", () => {
      const body: any = actionRunFailureBody();
      body.run.repository = { name: "paseo" };
      assert.equal(ciFailureDetailsFromPayload(body), null);
    });
  });

  describe("formatCiFailureBody", () => {
    it("includes workflow, repo, conclusion, and run URL", () => {
      const body = formatCiFailureBody({
        workflowName: "CI",
        repo: REPO,
        runUrl: `${REPO_URL}/actions/runs/123`,
        conclusion: "failure",
        failedStep: null,
        title: `ci: CI failed (${REPO})`,
      });
      assert.ok(body.includes("CI workflow **CI** failed on `xpufx-org/paseo`"));
      assert.ok(body.includes("- Workflow: CI"));
      assert.ok(body.includes("- Repo: xpufx-org/paseo"));
      assert.ok(body.includes("- Conclusion: failure"));
      assert.ok(body.includes(`- Run: ${REPO_URL}/actions/runs/123`));
      assert.ok(body.includes("(#865)"));
    });

    it("includes the failed step when present", () => {
      const body = formatCiFailureBody({
        workflowName: "CI",
        repo: REPO,
        runUrl: "",
        conclusion: "failure",
        failedStep: "build",
        title: `ci: CI failed (${REPO})`,
      });
      assert.ok(body.includes("- Failed step: build"));
    });
  });

  describe("runCiFailure", () => {
    function ciFailureBody(overrides: Record<string, any> = {}) {
      return {
        action: "failure",
        run: {
          id: 123,
          title: "CI",
          status: "failure",
          html_url: `${REPO_URL}/actions/runs/123`,
          repository: baseRepository(),
          ...overrides,
        },
        prior_status: "in_progress",
      };
    }

    it("creates an issue with failure details and CI labels", async () => {
      const router = makeRouter({ ciFailureEnabled: true });
      installFetch((req) => {
        if (req.method === "GET" && req.url.endsWith("/issues?state=open&limit=50")) {
          return { data: [] };
        }
        if (req.method === "POST" && req.url.endsWith("/issues")) {
          return { data: { number: 99, title: `ci: CI failed (${REPO})` } };
        }
        return { status: 404 };
      });

      const res = await router.runCiFailure(ciFailureBody());
      assert.equal(res.acted, true);
      assert.equal(res.createdIssue, 99);

      const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/issues"));
      assert.ok(post, "expected an issue POST");
      assert.equal(post!.url, `https://forge.mrs.uppidi.com/api/v1/repos/${REPO}/issues`);
      assert.equal(post!.body.title, `ci: CI failed (${REPO})`);
      assert.ok(post!.body.body.includes("CI workflow **CI** failed"));
      assert.ok(post!.body.body.includes(`- Run: ${REPO_URL}/actions/runs/123`));
      assert.deepEqual(post!.body.labels, [...CI_FAILURE_LABELS]);
    });

    it("deduplicates when an open issue with the same title exists", async () => {
      const router = makeRouter({ ciFailureEnabled: true });
      installFetch((req) => {
        if (req.method === "GET" && req.url.endsWith("/issues?state=open&limit=50")) {
          return { data: [{ number: 55, title: `ci: CI failed (${REPO})` }] };
        }
        return { status: 404 };
      });

      const res = await router.runCiFailure(ciFailureBody());
      assert.equal(res.acted, false);
      assert.match(res.reason, /open issue already exists/);
      assert.equal(res.createdIssue, null);
      assert.equal(requests.filter((r) => r.method === "POST").length, 0);
    });

    it("creates a new issue when the existing match is for a different workflow", async () => {
      const router = makeRouter({ ciFailureEnabled: true });
      installFetch((req) => {
        if (req.method === "GET" && req.url.endsWith("/issues?state=open&limit=50")) {
          return { data: [{ number: 55, title: `ci: Lint failed (${REPO})` }] };
        }
        if (req.method === "POST" && req.url.endsWith("/issues")) {
          return { data: { number: 99 } };
        }
        return { status: 404 };
      });

      const res = await router.runCiFailure(ciFailureBody());
      assert.equal(res.acted, true);
      assert.equal(res.createdIssue, 99);
    });

    it("skips creation when the issue list cannot be read", async () => {
      const router = makeRouter({ ciFailureEnabled: true });
      installFetch((req) => {
        if (req.method === "GET") return { status: 500 };
        if (req.method === "POST" && req.url.endsWith("/issues")) {
          return { data: { number: 99 } };
        }
        return { status: 404 };
      });

      const res = await router.runCiFailure(ciFailureBody());
      assert.equal(res.acted, true);
    });

    it("reports an API failure without throwing", async () => {
      const router = makeRouter({ ciFailureEnabled: true });
      installFetch((req) => {
        if (req.method === "GET") return { data: [] };
        return { status: 500 };
      });

      const res = await router.runCiFailure(ciFailureBody());
      assert.equal(res.acted, false);
      assert.match(res.reason, /issue create failed/);
    });

    it("returns a skip reason when the payload has no run", async () => {
      const router = makeRouter({ ciFailureEnabled: true });
      installFetch(() => ({ data: {} }));
      const res = await router.runCiFailure({ action: "failure" });
      assert.equal(res.acted, false);
      assert.match(res.reason, /missing run or repository/);
      assert.equal(requests.length, 0);
    });

    it("is disabled by default in test mode", async () => {
      const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
      installFetch(() => ({ data: {} }));
      const res = await router.runCiFailure(ciFailureBody());
      assert.equal(res.acted, false);
      assert.equal(res.reason, "ci failure handler disabled");
      assert.equal(requests.length, 0);
    });
  });

  describe("runDirectActions routing", () => {
    it("dispatches opened and created events to triage, closed events to the guard, and action_run_failure to the CI handler", async () => {
      const router = makeRouter();
      const calls: string[] = [];
      (router as any).runLabelTriage = async () => {
        calls.push("triage");
        return { acted: false, reason: "" };
      };
      (router as any).runCloseGuard = async () => {
        calls.push("guard");
        return { acted: false, reason: "" };
      };
      (router as any).runCiFailure = async () => {
        calls.push("ci-failure");
        return { acted: false, reason: "" };
      };

      await router.runDirectActions("issues", { action: "opened" });
      await router.runDirectActions("issue_comment", { action: "created" });
      await router.runDirectActions("issues", { action: "closed" });
      await router.runDirectActions("issues", { action: "labeled" });
      await router.runDirectActions("pull_request", { action: "closed" });
      await router.runDirectActions("action_run_failure", { action: "failure" });
      await router.runDirectActions("action_run_success", { action: "success" });

      assert.deepEqual(calls, ["triage", "triage", "guard", "ci-failure"]);
    });

    it("never rejects when a guard throws", async () => {
      const router = makeRouter();
      (router as any).runLabelTriage = async () => {
        throw new Error("boom");
      };
      await assert.doesNotReject(router.runDirectActions("issues", { action: "opened" }));
    });

    it("runs direct actions during webhook ingestion", async () => {
      const router = makeRouter();
      const seen: Array<{ event: string; action: string }> = [];
      (router as any).runDirectActions = async (event: string, body: any) => {
        seen.push({ event, action: body.action });
      };

      await router.ingestWebhook("issues", issueBody("closed", { actor: "xpufx" }));
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(seen, [{ event: "issues", action: "closed" }]);
    });

    it("dispatches action_run_failure webhooks to the CI failure handler", async () => {
      const router = makeRouter();
      const seen: Array<{ event: string; action: string }> = [];
      (router as any).runDirectActions = async (event: string, body: any) => {
        seen.push({ event, action: body.action });
      };

      await router.ingestWebhook("action_run_failure", {
        action: "failure",
        run: {
          id: 123,
          title: "CI",
          status: "failure",
          html_url: `${REPO_URL}/actions/runs/123`,
          repository: { full_name: REPO, html_url: REPO_URL },
        },
        prior_status: "in_progress",
      });
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(seen, [{ event: "action_run_failure", action: "failure" }]);
    });
  });
});


describe("hook-router repository onboarding (#847)", () => {
  const REPO = "xpufx-org/new-repo";
  const REPO_URL = "https://forge.mrs.uppidi.com/xpufx-org/new-repo";
  const REPO_KEY = "forge.mrs.uppidi.com/xpufx-org/new-repo";
  const HOST = "forge.mrs.uppidi.com";
  const CATALOGUE_URL = `https://${HOST}${REPO_ONBOARDING_CATALOGUE_PATH}`;

  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let requests: Array<{ url: string; method: string; body: any }>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-repo-onboarding-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    requests = [];
    setTokenResolverForTest(async () => "test-token");
  });

  afterEach(() => {
    setFetchForTest(null);
    setTokenResolverForTest(null);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  type FetchReply = { status?: number; data?: any };

  const CATALOGUE = {
    manifest_version: 1,
    labels: [
      { name: "priority/sos", color: "#b60205", exclusive: true, description: "SOS" },
      { name: "priority/high", color: "#d93f0b", exclusive: true, description: "High" },
      { name: "attention/orchestrator", color: "#fbca04", exclusive: false, description: "Orchestrator" },
    ],
  };

  function installFetch(handler: (req: { url: string; method: string; body: any }) => FetchReply | undefined) {
    setFetchForTest(async (input: string, init?: any) => {
      const method = String(init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const req = { url: input, method, body };
      requests.push(req);
      const reply = handler(req) ?? {};
      const status = reply.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "",
        json: async () => reply.data ?? {},
      };
    });
  }

  function makeRouter(overrides: Partial<HookRouterOptions> = {}): HookRouter {
    return new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      repoOnboardingEnabled: true,
      ...overrides,
    });
  }

  function repoCreatedBody() {
    return {
      action: "created",
      repository: {
        full_name: REPO,
        name: "new-repo",
        html_url: REPO_URL,
        clone_url: `${REPO_URL}.git`,
      },
      sender: { login: "alice" },
    };
  }

  /** Fetch handler for the happy path: empty label list, no Issue #1 yet. */
  function seedFetch(overrides: {
    existingLabels?: any[];
    issue1?: any;
    catalogue?: any;
  } = {}) {
    const createdLabels: any[] = [];
    let nextId = 100;
    installFetch((req) => {
      if (req.url === CATALOGUE_URL) {
        return { data: overrides.catalogue ?? CATALOGUE };
      }
      if (req.url.endsWith("/labels?limit=50&page=1")) {
        return { data: [...(overrides.existingLabels ?? []), ...createdLabels] };
      }
      if (req.method === "POST" && req.url.endsWith("/labels")) {
        const label = { id: nextId++, ...req.body };
        createdLabels.push(label);
        return { data: label };
      }
      if (req.method === "PATCH" && /\/labels\/\d+$/.test(req.url)) {
        return { data: { id: 1, ...req.body } };
      }
      if (req.url.endsWith("/issues/1")) {
        if (overrides.issue1 !== undefined) return { data: overrides.issue1 };
        return { status: 404 };
      }
      if (req.method === "POST" && req.url.endsWith("/issues")) {
        return { data: { number: 1, title: req.body.title, html_url: `${REPO_URL}/issues/1` } };
      }
      return { status: 404 };
    });
  }

  describe("runRepoOnboarding", () => {
    it("creates missing labels and the onboarding issue", async () => {
      const router = makeRouter();
      seedFetch();

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, true);
      assert.equal(res.issueCreated, true);
      assert.equal(res.issueNumber, 1);
      assert.equal(res.labelsCreated, 3);
      assert.equal(res.labelsUpdated, 0);

      const catalogueGet = requests.find((r) => r.url === CATALOGUE_URL);
      assert.ok(catalogueGet, "expected the catalogue to be fetched");

      const labelPosts = requests.filter((r) => r.method === "POST" && r.url.endsWith("/labels"));
      assert.equal(labelPosts.length, 3);
      assert.deepEqual(
        labelPosts.map((r) => r.body.name),
        ["priority/sos", "priority/high", "attention/orchestrator"],
      );
      assert.equal(labelPosts[0].url, `https://${HOST}/api/v1/repos/${REPO}/labels`);
      assert.deepEqual(labelPosts[0].body, {
        name: "priority/sos",
        color: "#b60205",
        description: "SOS",
        exclusive: true,
      });

      const issuePost = requests.find((r) => r.method === "POST" && r.url.endsWith("/issues"));
      assert.ok(issuePost, "expected an issue POST");
      assert.equal(issuePost!.url, `https://${HOST}/api/v1/repos/${REPO}/issues`);
      assert.equal(issuePost!.body.title, "chore: repository fleet onboarding & standard workflow seeding");
      assert.equal(issuePost!.body.body, REPO_ONBOARDING_ISSUE_BODY);
      assert.deepEqual(issuePost!.body.labels, [102, 101]);
    });

    it("resolves onboarding label ids from the reconciled label list", async () => {
      const router = makeRouter();
      seedFetch({
        existingLabels: [
          { id: 5, name: "priority/high", color: "#d93f0b" },
          { id: 6, name: "attention/orchestrator", color: "#fbca04" },
        ],
      });

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, true);
      assert.equal(res.labelsCreated, 1);
      const issuePost = requests.find((r) => r.method === "POST" && r.url.endsWith("/issues"));
      assert.deepEqual(issuePost!.body.labels, [6, 5]);
    });

    it("updates changed managed fields on existing labels", async () => {
      const router = makeRouter();
      seedFetch({
        existingLabels: [
          { id: 5, name: "priority/high", color: "#000000", exclusive: true, description: "Old" },
          { id: 6, name: "attention/orchestrator", color: "#fbca04", exclusive: false, description: "Orchestrator" },
          { id: 7, name: "priority/sos", color: "#b60205", exclusive: true, description: "SOS" },
        ],
      });

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, true);
      assert.equal(res.labelsCreated, 0);
      assert.equal(res.labelsUpdated, 1);

      const patch = requests.find((r) => r.method === "PATCH");
      assert.ok(patch, "expected a label PATCH");
      assert.equal(patch!.url, `https://${HOST}/api/v1/repos/${REPO}/labels/5`);
      assert.deepEqual(patch!.body, {
        name: "priority/high",
        color: "#d93f0b",
        description: "High",
      });
    });

    it("skips issue creation when Issue #1 already exists", async () => {
      const router = makeRouter();
      seedFetch({
        issue1: { number: 1, title: "Existing", html_url: `${REPO_URL}/issues/1` },
      });

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, true);
      assert.equal(res.issueCreated, false);
      assert.equal(res.issueNumber, 1);
      assert.equal(res.issueUrl, `${REPO_URL}/issues/1`);
      assert.equal(requests.filter((r) => r.method === "POST" && r.url.endsWith("/issues")).length, 0);
    });

    it("paginates the existing label list", async () => {
      const router = makeRouter();
      const page1 = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `l/${i}` }));
      const page2 = [{ id: 51, name: "attention/orchestrator", color: "#fbca04" }];
      installFetch((req) => {
        if (req.url === CATALOGUE_URL) return { data: CATALOGUE };
        if (req.url.endsWith("/labels?limit=50&page=1")) return { data: page1 };
        if (req.url.endsWith("/labels?limit=50&page=2")) return { data: page2 };
        if (req.method === "POST" && req.url.endsWith("/labels")) return { data: { id: 99, ...req.body } };
        if (req.url.endsWith("/issues/1")) return { status: 404 };
        if (req.method === "POST" && req.url.endsWith("/issues")) return { data: { number: 1 } };
        return { status: 404 };
      });

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, true);
      assert.equal(res.labelsCreated, 2);
      const pages = requests
        .filter((r) => r.url.includes("/labels?limit=50"))
        .map((r) => r.url);
      assert.deepEqual(
        pages.slice(0, 2),
        [
          `https://${HOST}/api/v1/repos/${REPO}/labels?limit=50&page=1`,
          `https://${HOST}/api/v1/repos/${REPO}/labels?limit=50&page=2`,
        ],
      );
    });

    it("reports a catalogue fetch failure without throwing", async () => {
      const router = makeRouter();
      installFetch((req) => {
        if (req.url === CATALOGUE_URL) return { status: 500 };
        return { status: 404 };
      });

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, false);
      assert.match(res.reason, /label catalogue fetch failed/);
      assert.equal(requests.filter((r) => r.method === "POST").length, 0);
    });

    it("reports an empty catalogue without touching the repo", async () => {
      const router = makeRouter();
      seedFetch({ catalogue: { manifest_version: 1, labels: [] } });

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, false);
      assert.match(res.reason, /empty/);
      assert.equal(requests.filter((r) => r.method === "POST").length, 0);
    });

    it("reports an issue create failure without throwing", async () => {
      const router = makeRouter();
      const createdLabels: any[] = [];
      installFetch((req) => {
        if (req.url === CATALOGUE_URL) return { data: CATALOGUE };
        if (req.url.endsWith("/labels?limit=50&page=1")) return { data: [...createdLabels] };
        if (req.method === "POST" && req.url.endsWith("/labels")) {
          const label = { id: 99, ...req.body };
          createdLabels.push(label);
          return { data: label };
        }
        if (req.url.endsWith("/issues/1")) return { status: 404 };
        if (req.method === "POST" && req.url.endsWith("/issues")) return { status: 500 };
        return { status: 404 };
      });

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, false);
      assert.match(res.reason, /issue create failed/);
      assert.equal(res.labelsCreated, 3);
    });

    it("skips a payload without a repository", async () => {
      const router = makeRouter();
      installFetch(() => ({ data: {} }));

      const res = await router.runRepoOnboarding({ action: "created", sender: { login: "alice" } });

      assert.equal(res.acted, false);
      assert.match(res.reason, /missing repository/);
      assert.equal(requests.length, 0);
    });

    it("is disabled by default in test mode", async () => {
      const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
      installFetch(() => ({ data: {} }));

      const res = await router.runRepoOnboarding(repoCreatedBody());

      assert.equal(res.acted, false);
      assert.equal(res.reason, "repository onboarding disabled");
      assert.equal(requests.length, 0);
    });
  });

  describe("runDirectActions routing", () => {
    it("dispatches repository:created to the onboarding handler", async () => {
      const router = makeRouter();
      const calls: string[] = [];
      (router as any).runRepoOnboarding = async () => {
        calls.push("onboarding");
        return { acted: true, reason: "" };
      };

      await router.runDirectActions("repository", { action: "created" });
      await router.runDirectActions("repository", { action: "deleted" });
      await router.runDirectActions("repository", {});

      assert.deepEqual(calls, ["onboarding"]);
    });

    it("never rejects when the onboarding handler throws", async () => {
      const router = makeRouter();
      (router as any).runRepoOnboarding = async () => {
        throw new Error("boom");
      };
      await assert.doesNotReject(router.runDirectActions("repository", { action: "created" }));
    });

    it("runs onboarding during webhook ingestion", async () => {
      const router = makeRouter();
      const seen: Array<{ event: string; action: string }> = [];
      (router as any).runDirectActions = async (event: string, body: any) => {
        seen.push({ event, action: body.action });
      };

      await router.ingestWebhook("repository", repoCreatedBody());
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepEqual(seen, [{ event: "repository", action: "created" }]);
    });
  });
});

describe("HookRouter canonical ALL HALT mode (#994)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-halt-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("router.halt() sets isHalted() and engages pause('all')", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    assert.equal(router.isHalted(), false);
    assert.equal(router.isPaused("any/repo"), false);

    router.halt();

    assert.equal(router.isHalted(), true);
    assert.equal(router.isPaused("any/repo"), true);
    assert.equal(router.isAllPaused(), true);
  });

  it("immediately rejects or skips auto-provisioning when halted", async () => {
    let spawnAttempts = 0;
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      spawnAgent: async () => {
        spawnAttempts++;
        return { id: "test-agent" };
      },
    });

    router.halt();

    // 1. ensureOrchestrator
    const orchRes = await router.ensureOrchestrator({ repo: "xpufx-org/test-repo" });
    assert.equal(orchRes.ok, false);
    assert.match(orchRes.error || "", /halted/i);
    assert.equal(spawnAttempts, 0);

    // 2. ensureUnstaffedEnrolledRepo
    const unstaffedRes = await router.ensureUnstaffedEnrolledRepo("xpufx-org/test-repo", { reason: "test" });
    assert.equal(unstaffedRes, null);
    assert.equal(spawnAttempts, 0);
  });

  it("pauses webhook queue ingress when halted", async () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.halt();

    const payload = {
      repository: { full_name: "xpufx-org/test-repo" },
      issue: { number: 42, title: "Test issue" },
      sender: { login: "someone" },
    };

    const res = await router.ingestWebhook("issues", payload);
    assert.equal(res.result, "suppressed");
    assert.equal(router.getQueue("xpufx-org/test-repo").length, 0);
  });

  it("pauses background loops (watchdog and board sweep) when halted", async () => {
    let auditRan = false;
    let sweepRan = false;

    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      watchdogIntervalMs: 50,
      boardSweepIntervalMs: 50,
    });

    // Replace methods before starting loops
    (router as any).runWatchdogAudit = async () => {
      auditRan = true;
      return { ok: true, now: Date.now(), anomalies: [], actions: [] };
    };
    (router as any).runBoardSweep = async () => {
      sweepRan = true;
      return { ok: true, actionable: [], staleWipRecovered: [], errors: [], prunedCount: 0, autoEnsured: [], notified: 0 };
    };

    router.startBackgroundLoops();
    router.halt();

    // Wait 120ms to verify timers were cancelled and loops do not execute
    await new Promise((resolve) => setTimeout(resolve, 120));

    assert.equal(auditRan, false, "watchdog loop should not run after halt");
    assert.equal(sweepRan, false, "board sweep loop should not run after halt");
  });

  it("resumes halt state on router.resume('all')", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.halt();
    assert.equal(router.isHalted(), true);

    router.resume("all");
    assert.equal(router.isHalted(), false);
    assert.equal(router.isAllPaused(), false);
  });

  it("exposes halted and teardownInProgress on the status overview (#1013)", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });

    const before = router.getStatusOverview();
    assert.equal(before.halted, false);
    assert.equal(before.teardownInProgress, false);

    router.halt();
    assert.equal(router.getStatusOverview().halted, true);

    router.markTeardownStart();
    assert.equal(router.getStatusOverview().teardownInProgress, true);

    router.markTeardownEnd();
    assert.equal(router.getStatusOverview().teardownInProgress, false);
  });

  it("ignores resume while a teardown is in progress and allows it afterwards (#1013)", () => {
    const router = new HookRouter(null, { queueDir, stateDir, port: 0 });
    router.halt();
    router.markTeardownStart();

    router.resume("all");
    assert.equal(router.isHalted(), true, "resume must not clear the halt during teardown");

    const refused = router.resumeAll();
    assert.equal(refused.ok, false);
    assert.equal(refused.resumed, false);
    assert.match(refused.error || "", /teardown/i);

    router.markTeardownEnd();
    const allowed = router.resumeAll();
    assert.equal(allowed.ok, true);
    assert.equal(allowed.resumed, true);
    assert.equal(router.isHalted(), false);
  });
});


describe("HookRouter role rotation (#1019)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-rotation-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    mkdirSync(queueDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  function makeRouter(overrides: Partial<HookRouterOptions> = {}) {
    const spawned: any[] = [];
    const archived: string[] = [];
    const delivered: Array<{ id: string; text: string; options?: any }> = [];
    const router = new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      rotationAutoEnabled: true,
      workspacesData: [
        {
          workspaceId: "ws-paseo-main",
          cwd: tempDir,
          displayName: "Paseo",
          isolation: "local",
          projectKey: "remote:forge.mrs.uppidi.com:222/xpufx-org/paseo",
        },
      ],
      orchestratorModelFallback: ["antigravity-acp/gemini-3.8-flash-low"],
      circuitBreakerPath: join(tempDir, "model-health.json"),
      spawnAgent: async (opts) => {
        spawned.push(opts);
        return { id: `agent-new-${spawned.length}` };
      },
      archiveAgent: async (id) => {
        archived.push(id);
        return true;
      },
      ...overrides,
    });
    (router as any).deliverMessage = async (id: string, text: string, options?: any) => {
      delivered.push({ id, text, options });
      return true;
    };
    return { router, spawned, archived, delivered };
  }

  it("rotates an orchestrator: spawn -> verify -> deliver brief -> archive incumbent", async () => {
    const { router, spawned, archived, delivered } = makeRouter();
    router.writeOrchestrator("xpufx-org/paseo", "agent-old", "test");
    (router as any).fetchAgentMap = async () =>
      new Map<string, WatchdogAgent>([
        ["agent-new-1", { id: "agent-new-1", role: "orchestrator", title: "Orchestrator · xpufx-org/paseo", status: "idle" }],
      ]);

    const res = await router.rotateRole({ role: "orchestrator", repo: "xpufx-org/paseo", reason: "operator test", force: true });

    assert.equal(res.ok, true);
    assert.equal(res.oldAgentId, "agent-old");
    assert.equal(res.agentId, "agent-new-1");
    assert.equal(spawned.length, 1, "exactly one replacement is spawned");
    assert.equal(archived.length, 1, "exactly one agent is archived");
    assert.equal(archived[0], "agent-old", "the incumbent is archived, never the replacement");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-new-1");
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].id, "agent-new-1");
    assert.match(delivered[0].text, /Rotation Brief/);
    assert.match(delivered[0].text, /operator test/);
    assert.ok(delivered[0].options?.steer, "the brief is steered to the replacement");
  });

  it("aborts cleanly on spawn failure and leaves the incumbent registered", async () => {
    const { router, archived } = makeRouter({ spawnAgent: async () => null });
    router.writeOrchestrator("xpufx-org/paseo", "agent-old", "test");
    (router as any).fetchAgentMap = async () => new Map();

    const res = await router.rotateRole({ role: "orchestrator", repo: "xpufx-org/paseo", force: true });

    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "spawn_failed");
    assert.equal(archived.length, 0, "the incumbent is not archived when the spawn fails");
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-old");
  });

  it("archives the replacement and restores the incumbent when verification fails", async () => {
    const { router, archived } = makeRouter();
    router.writeOrchestrator("xpufx-org/paseo", "agent-old", "test");
    // The live roster never shows the spawned replacement.
    (router as any).fetchAgentMap = async () => new Map<string, WatchdogAgent>([["agent-old", { id: "agent-old" }]]);

    const res = await router.rotateRole({ role: "orchestrator", repo: "xpufx-org/paseo", force: true });

    assert.equal(res.ok, false);
    assert.equal(res.errorCode, "verify_failed");
    assert.deepEqual(archived, ["agent-new-1"]);
    assert.equal(router.readOrchestrator("xpufx-org/paseo")?.agentId, "agent-old", "incumbent registry is restored");
  });

  it("allows only one rotation per role at a time", async () => {
    const { router } = makeRouter();
    router.writeOrchestrator("xpufx-org/paseo", "agent-old", "test");
    (router as any).fetchAgentMap = async () =>
      new Map<string, WatchdogAgent>([
        ["agent-new-1", { id: "agent-new-1", role: "orchestrator", title: "Orchestrator · xpufx-org/paseo" }],
      ]);

    const first = router.rotateRole({ role: "orchestrator", repo: "xpufx-org/paseo", reason: "first", force: true });
    const second = await router.rotateRole({ role: "orchestrator", repo: "xpufx-org/paseo", reason: "second", force: true });
    const firstRes = await first;

    assert.equal(second.ok, false);
    assert.equal(second.errorCode, "in_flight");
    assert.equal(firstRes.ok, true);
  });

  it("rotates the Front Desk singleton with the injected spawn seam", async () => {
    const spawnedFd: string[] = [];
    const { router, archived, delivered } = makeRouter({
      spawnFrontDesk: async (input) => {
        spawnedFd.push(input.title);
        return { id: "fd-new" };
      },
    });
    router.writeFrontDesk("fd-old", "test");
    (router as any).fetchAgentMap = async () =>
      new Map<string, WatchdogAgent>([["fd-new", { id: "fd-new", role: "front-desk", title: "Front Desk" }]]);

    const res = await router.rotateRole({ role: "front-desk", reason: "manual", force: true });

    assert.equal(res.ok, true);
    assert.equal(res.oldAgentId, "fd-old");
    assert.equal(res.agentId, "fd-new");
    assert.deepEqual(spawnedFd, ["Front Desk"]);
    assert.deepEqual(archived, ["fd-old"]);
    assert.equal(router.readFrontDesk()?.agentId, "fd-new");
    assert.equal(delivered[0].id, "fd-new");
  });

  it("round-trips the policy and applies a per-repo override", () => {
    const { router } = makeRouter();
    router.setRotationPolicyRole("orchestrator", undefined, { maxTurns: 9 });
    assert.equal(router.getRotationPolicyFor("orchestrator", "xpufx-org/paseo").maxTurns, 9);

    router.setRotationPolicyRole("orchestrator", "xpufx-org/paseo", { maxTurns: 3 });
    assert.equal(router.getRotationPolicyFor("orchestrator", "xpufx-org/paseo").maxTurns, 3);
    assert.equal(router.getRotationPolicyFor("orchestrator", "xpufx-org/other").maxTurns, 9);
  });

  it("reports status and remaining cooldown after a rotation", async () => {
    const { router } = makeRouter();
    router.writeOrchestrator("xpufx-org/paseo", "agent-old", "test");
    (router as any).fetchAgentMap = async () =>
      new Map<string, WatchdogAgent>([
        ["agent-new-1", { id: "agent-new-1", role: "orchestrator", title: "Orchestrator · xpufx-org/paseo" }],
      ]);

    await router.rotateRole({ role: "orchestrator", repo: "xpufx-org/paseo", reason: "test", force: true });
    const status = router.rotationStatus({ role: "orchestrator", repo: "xpufx-org/paseo" });
    assert.equal(status.ok, true);
    assert.equal(status.statuses.length, 1);
    assert.equal(status.statuses[0].agentId, "agent-new-1");
    assert.ok(status.statuses[0].lastRotationAt);
    assert.ok(status.statuses[0].cooldownRemainingMs > 0);
    assert.equal(status.statuses[0].policy.maxTurns, 50);
  });

  it("automatically rotates when age crosses the threshold and respects cooldown", async () => {
    const { router } = makeRouter();
    router.writeOrchestrator("xpufx-org/paseo", "agent-old", "test");
    const oldTs = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    (router as any).fetchAgentMap = async () =>
      new Map<string, WatchdogAgent>([
        [
          "agent-old",
          { id: "agent-old", role: "orchestrator", title: "Orchestrator · xpufx-org/paseo", updatedAt: oldTs },
        ],
        ["agent-new-1", { id: "agent-new-1", role: "orchestrator", title: "Orchestrator · xpufx-org/paseo" }],
      ]);

    const first = await router.evaluateAutomaticRotations();
    assert.ok(first.some((r) => r.ok && r.role === "orchestrator"), "age trigger rotates the stale orchestrator");

    // A second evaluation within the cooldown window must not rotate again.
    const second = await router.evaluateAutomaticRotations();
    assert.equal(second.some((r) => r.ok), false, "cooldown suppresses a second automatic rotation");
  });
});

describe("merge-event hook (#1076)", () => {
  const REPO = "xpufx-org/paseo";
  const REPO_URL = "https://forge.mrs.uppidi.com/xpufx-org/paseo";
  const REPO_KEY = "forge.mrs.uppidi.com/xpufx-org/paseo";
  const realExecFile = promisify(execFile);

  let tempDir: string;
  let queueDir: string;
  let stateDir: string;
  let mergeEventLogPath: string;
  let remoteDir: string;
  let checkoutDir: string;
  let workDir: string;
  let paseoCalls: string[][];

  function git(cwd: string, ...args: string[]): string {
    return execFileSync(
      "git",
      ["-c", "user.email=test@example.com", "-c", "user.name=Fleet Test", ...args],
      { cwd, encoding: "utf8" },
    ).trim();
  }

  function initRepo(): void {
    remoteDir = join(tempDir, "remote.git");
    checkoutDir = join(tempDir, "checkout");
    workDir = join(tempDir, "work");
    execFileSync("git", ["init", "--bare", "--initial-branch=main", remoteDir]);
    execFileSync("git", ["clone", remoteDir, checkoutDir]);
    execFileSync("git", ["clone", remoteDir, workDir]);
    writeFileSync(join(workDir, "README.md"), "one\n");
    git(workDir, "add", "README.md");
    git(workDir, "commit", "-m", "init: seed repo");
    git(workDir, "push", "origin", "main");
    git(checkoutDir, "fetch", "origin");
    git(checkoutDir, "merge", "--ff-only", "origin/main");
  }

  function pushCommit(file: string, body: string, message: string): void {
    writeFileSync(join(workDir, file), body);
    git(workDir, "add", file);
    git(workDir, "commit", "-m", message);
    git(workDir, "push", "origin", "main");
  }

  function headOf(dir: string): string {
    return git(dir, "rev-parse", "HEAD");
  }

  function makeRouter(overrides: Partial<HookRouterOptions> = {}): HookRouter {
    return new HookRouter(null, {
      queueDir,
      stateDir,
      port: 0,
      mergeEventLogPath,
      ...overrides,
    });
  }

  function mergedPrBody(): any {
    return {
      action: "closed",
      repository: { full_name: REPO, html_url: REPO_URL, clone_url: `${REPO_URL}.git` },
      pull_request: { number: 7, title: "fix: merged", merged: true, html_url: `${REPO_URL}/pulls/7` },
      sender: { login: "xpufx" },
    };
  }

  function reloadCalls(): string[][] {
    return paseoCalls.filter((args) => args[0] === "plugin" && args[1] === "reload");
  }

  function sentMessages(agentId: string): string[] {
    return paseoCalls
      .filter((args) => args[0] === "send" && args.includes(agentId))
      .map((args) => String(args[args.length - 1]));
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-merge-event-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    mergeEventLogPath = join(tempDir, "merge-events.json");
    paseoCalls = [];
    initRepo();
    // Real git in the throwaway repos; the `paseo` client is stubbed so no live
    // plugin reload or agent delivery ever runs in the test.
    setExecFileAsyncForTest(async (file: string, args: readonly string[], opts?: unknown) => {
      if (file === "paseo") {
        paseoCalls.push([...args]);
        return { stdout: "", stderr: "" };
      }
      return (await realExecFile(file, args as string[], opts as any)) as any;
    });
  });

  afterEach(() => {
    setExecFileAsyncForTest(null);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("fast-forwards a merged repo, reloads the plugin, and announces from->to with the applied titles", async () => {
    const router = makeRouter({
      mergeEventHooks: { [REPO]: { checkoutPath: checkoutDir, pluginId: "uppidi-fleet" } },
    });
    router.writeFrontDesk("frontdesk-agent");
    router.writeOrchestrator(REPO, "orchestrator-agent");
    const before = headOf(checkoutDir);
    pushCommit("fix-a.txt", "a\n", "fix(uppidi-fleet): first merged fix (#1068)");
    pushCommit("fix-b.txt", "b\n", "fix(uppidi-fleet): second merged fix (#1072)");

    const res = await router.runMergeEvent(mergedPrBody());

    assert.equal(res.status, "fast-forwarded");
    assert.equal(res.fastForwarded, true);
    assert.equal(res.reloaded, true);
    const after = headOf(checkoutDir);
    assert.notEqual(after, before);
    assert.equal(res.fromSha, before.slice(0, 7));
    assert.equal(res.toSha, after.slice(0, 7));
    assert.deepEqual(res.titles, [
      "fix(uppidi-fleet): first merged fix (#1068)",
      "fix(uppidi-fleet): second merged fix (#1072)",
    ]);
    assert.deepEqual(reloadCalls(), [["plugin", "reload", "uppidi-fleet"]]);

    const frontDesk = sentMessages("frontdesk-agent").join("\n");
    const orchestrator = sentMessages("orchestrator-agent").join("\n");
    assert.match(frontDesk, /Merge Event/);
    assert.match(frontDesk, /first merged fix/);
    assert.match(orchestrator, /Merge Event/);
    assert.match(orchestrator, /second merged fix/);

    const records = readMergeEventRecords(mergeEventLogPath);
    assert.equal(records.length, 1);
    assert.equal(records[0].repo, REPO_KEY);
    assert.equal(records[0].fromSha, before.slice(0, 7));
    assert.equal(records[0].toSha, after.slice(0, 7));
    assert.equal(records[0].status, "fast-forwarded");
    assert.equal(records[0].reloaded, true);
  });

  it("skips a dirty checkout and reports exactly why", async () => {
    const router = makeRouter({
      mergeEventHooks: { [REPO]: { checkoutPath: checkoutDir, pluginId: "uppidi-fleet" } },
    });
    writeFileSync(join(checkoutDir, "README.md"), "dirty local edit\n");
    const before = headOf(checkoutDir);
    pushCommit("fix.txt", "x\n", "fix: remote change");

    const res = await router.runMergeEvent(mergedPrBody());

    assert.equal(res.status, "skipped");
    assert.match(res.reason, /dirty/);
    assert.match(res.reason, /README\.md/);
    assert.equal(headOf(checkoutDir), before);
    assert.equal(reloadCalls().length, 0);
    const records = readMergeEventRecords(mergeEventLogPath);
    assert.equal(records.length, 1);
    assert.equal(records[0].status, "skipped");
  });

  it("skips a divergent checkout without merging and reports the divergence", async () => {
    const router = makeRouter({
      mergeEventHooks: { [REPO]: { checkoutPath: checkoutDir, pluginId: "uppidi-fleet" } },
    });
    writeFileSync(join(checkoutDir, "local.txt"), "local\n");
    git(checkoutDir, "add", "local.txt");
    git(checkoutDir, "commit", "-m", "local: diverging commit");
    const localHead = headOf(checkoutDir);
    pushCommit("remote.txt", "remote\n", "fix: remote commit");

    const res = await router.runMergeEvent(mergedPrBody());

    assert.equal(res.status, "skipped");
    assert.match(res.reason, /diverged/);
    assert.equal(headOf(checkoutDir), localHead);
    assert.equal(reloadCalls().length, 0);
  });

  it("fast-forwards without reloading when no plugin is bound", async () => {
    const router = makeRouter({
      mergeEventHooks: { [REPO]: { checkoutPath: checkoutDir } },
    });
    pushCommit("fix.txt", "x\n", "fix: no plugin bound");

    const res = await router.runMergeEvent(mergedPrBody());

    assert.equal(res.status, "fast-forwarded");
    assert.equal(res.reloaded, false);
    assert.match(res.record!.reloadReason, /no plugin bound/);
    assert.equal(reloadCalls().length, 0);
  });

  it("is a no-op for a repo with no merge-event mapping", async () => {
    const router = makeRouter({ mergeEventHooks: {} });
    const before = headOf(checkoutDir);
    pushCommit("fix.txt", "x\n", "fix: unmapped");

    const res = await router.runMergeEvent(mergedPrBody());

    assert.equal(res.acted, false);
    assert.match(res.reason, /no merge-event mapping/);
    assert.equal(headOf(checkoutDir), before);
    assert.equal(readMergeEventRecords(mergeEventLogPath).length, 0);
  });

  it("is idempotent: a merge with nothing new announces already current", async () => {
    const router = makeRouter({
      mergeEventHooks: { [REPO]: { checkoutPath: checkoutDir, pluginId: "uppidi-fleet" } },
    });
    router.writeFrontDesk("frontdesk-agent");
    pushCommit("fix.txt", "x\n", "fix: only merge");
    await router.runMergeEvent(mergedPrBody());
    paseoCalls = [];

    const res = await router.runMergeEvent(mergedPrBody());

    assert.equal(res.status, "already-current");
    assert.equal(res.alreadyCurrent, true);
    assert.match(res.reason, /already current/);
    assert.match(sentMessages("frontdesk-agent").join("\n"), /already current/);
    assert.equal(reloadCalls().length, 0);
  });

  it("resolves a binding across bare and forge-qualified repo keys", () => {
    assert.deepEqual(
      resolveMergeEventHook(REPO_KEY, { [REPO]: { checkoutPath: "/tmp/x" } }),
      { checkoutPath: "/tmp/x" },
    );
    assert.deepEqual(
      resolveMergeEventHook(REPO, { [REPO_KEY]: { checkoutPath: "/tmp/y", pluginId: "p" } }),
      { checkoutPath: "/tmp/y", pluginId: "p" },
    );
    assert.equal(resolveMergeEventHook(REPO, {}), null);
  });

  it("formats the applied commit titles into the notice body", () => {
    const body = formatMergeEventNotice({
      repo: REPO_KEY,
      checkoutPath: "/tmp/checkout",
      pluginId: "uppidi-fleet",
      timestamp: "2026-10-07T00:00:00.000Z",
      fromSha: "aaaaaaa",
      toSha: "bbbbbbb",
      titles: ["fix: one", "fix: two"],
      fastForwarded: true,
      alreadyCurrent: false,
      reloaded: true,
      reloadReason: "ok",
      newRevision: "bbbbbbb",
      status: "fast-forwarded",
      reason: "2 commit(s) applied; reload ok",
    });
    assert.match(body, /aaaaaaa.*bbbbbbb/);
    assert.match(body, /fix: one/);
    assert.match(body, /fix: two/);
  });

  it("dispatches a merged pull_request.closed event to the merge-event handler", async () => {
    const router = makeRouter();
    const seen: any[] = [];
    (router as any).runMergeEvent = async (body: any) => {
      seen.push(body);
      return { acted: true, reason: "stub" };
    };

    await router.runDirectActions("pull_request", { action: "closed", pull_request: { merged: true } });
    await router.runDirectActions("pull_request", { action: "closed", pull_request: { merged: false } });
    await router.runDirectActions("pull_request", { action: "opened", pull_request: { merged: true } });

    assert.equal(seen.length, 1);
  });
});

describe("HookRouter Paseo SDK capture and host checkout fallback (#1170)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-sdk-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
    clearHookLogs();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    setActivePaseo(null);
    setActiveHookRouter(null);
  });

  it("retains active Paseo SDK instance across setActivePaseo and assigns to active and new routers", () => {
    const mockPaseo1 = { workspaces: { list: async () => ({ entries: [] }) } } as any;
    const mockPaseo2 = { workspaces: { list: async () => ({ entries: [] }) } } as any;

    const router1 = new HookRouter({} as any, { queueDir, stateDir, port: 0 });
    assert.equal(router1.getPaseo(), null);

    // Set globally via module function
    setActivePaseo(mockPaseo1);

    // Active router registered via setActiveHookRouter picks up activePaseoInstance
    setActiveHookRouter(router1);
    assert.equal(router1.getPaseo(), mockPaseo1);
    assert.equal(getActiveHookRouter(), router1);

    // HookRouter.setActivePaseo updates active router
    HookRouter.setActivePaseo(mockPaseo2);
    assert.equal(router1.getPaseo(), mockPaseo2);

    // New router registered gets active Paseo
    const router2 = new HookRouter({} as any, { queueDir, stateDir, port: 0 });
    setActiveHookRouter(router2);
    assert.equal(router2.getPaseo(), mockPaseo2);

    // Direct instance method works as well
    router2.setActivePaseo(mockPaseo1);
    assert.equal(router2.getPaseo(), mockPaseo1);
  });

  it("resolveWorkspaceCanonical returns null when daemon list has no match and does not fall back to host checkout", async () => {
    const fakeHome = mkdtempSync(join(tempDir, "fake-home-"));
    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      const repoName = "test-repo-fallback";
      const checkoutDir = join(fakeHome, "code", repoName);
      mkdirSync(checkoutDir, { recursive: true });

      const mockPaseo = {
        workspaces: {
          list: async () => ({ entries: [] }),
        },
      } as any;

      const router = new HookRouter({} as any, { queueDir, stateDir, port: 0 });
      router.setActivePaseo(mockPaseo);

      const resolved = await (router as any).resolveWorkspaceCanonical(repoName);
      assert.equal(resolved, null);
    } finally {
      process.env.HOME = origHome;
    }
  });

  it("resolveWorkspaceCanonical resolves when daemon list matches registered workspace", async () => {
    const repoName = "test-repo-registered";
    const mockPaseo = {
      workspaces: {
        list: async () => ({
          entries: [
            {
              workspaceId: "wks_registered",
              cwd: "/some/path/to/test-repo-registered",
              repo: repoName,
            },
          ],
        }),
      },
    } as any;

    const router = new HookRouter({} as any, { queueDir, stateDir, port: 0 });
    router.setActivePaseo(mockPaseo);

    const resolved = await (router as any).resolveWorkspaceCanonical(repoName);
    assert.deepEqual(resolved, {
      workspaceId: "wks_registered",
      cwd: "/some/path/to/test-repo-registered",
      projectId: undefined,
      displayName: undefined,
      repo: repoName,
    });
  });

  it("resolveWorkspaceCanonical returns null when paseo is null", async () => {
    const fakeHome = mkdtempSync(join(tempDir, "fake-home-"));
    const origHome = process.env.HOME;
    process.env.HOME = fakeHome;

    try {
      const repoName = "test-repo-no-paseo";
      const checkoutDir = join(fakeHome, "code", repoName);
      mkdirSync(checkoutDir, { recursive: true });

      const router = new HookRouter({} as any, { queueDir, stateDir, port: 0 });
      assert.equal(router.getPaseo(), null);

      const resolved = await (router as any).resolveWorkspaceCanonical(repoName);
      assert.equal(resolved, null);
    } finally {
      process.env.HOME = origHome;
    }
  });
});

describe("HookRouter fleet dormancy and hibernation (#1181)", () => {
  let tempDir: string;
  let queueDir: string;
  let stateDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-dormancy-test-"));
    queueDir = join(tempDir, "queues");
    stateDir = join(tempDir, "state");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("WAKEUP_RULES and isActionableWakeupEvent", () => {
    it("matches operator slash commands in comments and reviews", () => {
      assert.equal(
        isActionableWakeupEvent("issue_comment", {
          comment: { body: "Hey @agent, please /orchestrator inspect this issue" },
        }),
        true,
      );
      assert.equal(
        isActionableWakeupEvent("pull_request_review", {
          review: { body: "Looks solid, /approve" },
        }),
        true,
      );
      assert.equal(
        isActionableWakeupEvent("issue_comment", {
          comment: { body: "/sweep" },
        }),
        true,
      );
      assert.equal(SLASH_SWEEP_RE.test("/sweep"), true);
      assert.equal(SLASH_SWEEP_RE.test("please /sweep now"), true);
      assert.equal(SLASH_SWEEP_RE.test("/sweeper"), false);
    });

    it("matches action-token label additions", () => {
      const actionableLabels = [
        "attention/orchestrator",
        "attention/frontdesk",
        "priority/sos",
        "state/review",
        "review/needed",
        "flag/stop-work",
      ];
      for (const name of actionableLabels) {
        assert.equal(
          isActionableWakeupEvent("issues", {
            action: "labeled",
            label: { name },
          }),
          true,
          `expected label ${name} to trigger wakeup`,
        );
      }
      // Unlabeled action-token is passive, not a wakeup
      assert.equal(
        isActionableWakeupEvent("issues", {
          action: "unlabeled",
          label: { name: "attention/orchestrator" },
        }),
        false,
      );
    });

    it("matches lifecycle advance events", () => {
      assert.equal(isActionableWakeupEvent("issues", { action: "opened" }), true);
      assert.equal(isActionableWakeupEvent("issues", { action: "reopened" }), true);
      assert.equal(isActionableWakeupEvent("pull_request", { action: "opened" }), true);
      assert.equal(isActionableWakeupEvent("pull_request", { action: "ready_for_review" }), true);
    });

    it("treats passive noise, self-stamped comments, closed issues, and metadata labels as non-actionable", () => {
      // Self-stamped comments
      assert.equal(
        isActionableWakeupEvent("issue_comment", {
          action: "created",
          comment: {
            body: "Completed task\n\n---\n<sub>🤖 **Worker** (`abc1234`) · `model` · `repo:branch` · _now_</sub>",
          },
        }),
        false,
      );

      // Issues closed
      assert.equal(isActionableWakeupEvent("issues", { action: "closed" }), false);

      // Unlabeled
      assert.equal(
        isActionableWakeupEvent("issues", {
          action: "unlabeled",
          label: { name: "state/wip" },
        }),
        false,
      );

      // Cosmetic / metadata labels
      assert.equal(
        isActionableWakeupEvent("issues", {
          action: "labeled",
          label: { name: "format/needed" },
        }),
        false,
      );
      assert.equal(
        isActionableWakeupEvent("issues", {
          action: "labeled",
          label: { name: "size/m" },
        }),
        false,
      );
      assert.equal(
        isActionableWakeupEvent("issues", {
          action: "labeled",
          label: { name: "target/upstream" },
        }),
        false,
      );

      // Unknown / cosmetic edits
      assert.equal(isActionableWakeupEvent("issues", { action: "edited" }), false);
      assert.equal(isActionableWakeupEvent("pull_request", { action: "synchronize" }), false);
    });
  });

  describe("dormancy state tracking (isDormant, refreshDormancy, exitQuiescence)", () => {
    it("evaluates isDormant correctly based on queues, unstaffed enrolled queues, and running turns", () => {
      const router = new HookRouter({} as any, { queueDir, stateDir, port: 0 });

      // Clean empty router with no agent map -> dormant
      assert.equal(router.isDormant(), true);

      // If there are live running turns in agentMap -> not dormant
      const runningMap = new Map<string, any>([
        ["ag-1", { id: "ag-1", status: "running" }],
      ]);
      assert.equal(router.isDormant(runningMap), false);

      const busyMap = new Map<string, any>([
        ["ag-2", { id: "ag-2", status: "idle", activeTurn: { id: "turn-1" } }],
      ]);
      assert.equal(router.isDormant(busyMap), false);

      const idleMap = new Map<string, any>([
        ["ag-3", { id: "ag-3", status: "idle" }],
      ]);
      assert.equal(router.isDormant(idleMap), true);

      // If halted -> never dormant
      router.halt();
      assert.equal(router.isDormant(), false);
      router.resume("all");
      (router as any).isHaltedState = false;

      // If queues have messages -> not dormant
      router.enqueue("xpufx-org/test", "Hello queue");
      assert.equal(router.isDormant(), false);
    });

    it("refreshes dormancy and transitions quiescent state", () => {
      const router = new HookRouter({} as any, { queueDir, stateDir, port: 0 });
      assert.equal(router.isQuiescent, false);

      // refresh with idle fleet -> enters quiescent
      const q = router.refreshDormancy(new Map());
      assert.equal(q, true);
      assert.equal(router.isQuiescent, true);
      assert.ok(router.lastQuiescenceChangeAt);

      // explicit exitQuiescence leaves quiescent mode
      router.exitQuiescence("test wakeup");
      assert.equal(router.isQuiescent, false);
    });
  });

  describe("delta-gated board sweep notification suppression", () => {
    it("suppresses Front Desk notification when actionable candidates digest is unchanged", async () => {
      const deliveries: Array<{ agentId: string; prompt: string }> = [];
      const mockPaseo = {
        agents: {
          ref: (id: string) => ({
            send: async (prompt: string) => {
              deliveries.push({ agentId: id, prompt });
              return { ok: true };
            },
          }),
        },
      } as any;

      const router = new HookRouter({} as any, { queueDir, stateDir, port: 0 });
      router.setActivePaseo(mockPaseo);

      // Register front desk agent so notifications have a target
      router.writeFrontDesk("fd-1", "operator");

      const candidates = [
        {
          number: 101,
          title: "Fix issue",
          labels: [{ name: "attention/orchestrator" }],
          category: "actionable",
          is_dispatchable: true,
          created_at: new Date().toISOString(),
          comments: 2,
        },
      ];

      const io: IssuesCheckIo = {
        getOpenIssues: async () => ({
          ok: true,
          issues: candidates as any,
        }),
        getLatestComments: async () => [],
        getIssueComments: async () => [],
        runStaleWipCommand: async () => true,
        loadCache: async () => ({}),
        saveCache: async () => {},
      };

      // First sweep: actionable work found, candidate digest is recorded, Front Desk is notified
      const firstSweep = await router.runBoardSweep(["xpufx-org/paseo"], io);
      assert.equal(firstSweep.ok, true);
      assert.equal(firstSweep.notified, 1);
      assert.equal(deliveries.length, 1);
      assert.ok(deliveries[0].prompt.includes("xpufx-org/paseo: 1 actionable"));

      // Second sweep with identical candidates: suppressed due to delta gating
      const secondSweep = await router.runBoardSweep(["xpufx-org/paseo"], io);
      assert.equal(secondSweep.ok, true);
      assert.equal(secondSweep.notified, 0);
      assert.equal(deliveries.length, 1, "expected no new notification delivered");

      // Third sweep with explicit: true: delivers despite unchanged digest
      const explicitSweep = await router.runBoardSweep(["xpufx-org/paseo"], io, { explicit: true });
      assert.equal(explicitSweep.ok, true);
      assert.equal(explicitSweep.notified, 1);
      assert.equal(deliveries.length, 2, "expected explicit sweep to deliver");

      // Fourth sweep with changed candidates: delivers again
      const changedCandidates = [
        ...candidates,
        {
          number: 102,
          title: "Another issue",
          labels: [{ name: "priority/sos" }],
          category: "actionable",
          is_dispatchable: true,
          created_at: new Date().toISOString(),
          comments: 0,
        },
      ];
      const changedIo: IssuesCheckIo = {
        ...io,
        getOpenIssues: async () => ({
          ok: true,
          issues: changedCandidates as any,
        }),
      };
      const fourthSweep = await router.runBoardSweep(["xpufx-org/paseo"], changedIo);
      assert.equal(fourthSweep.ok, true);
      assert.equal(fourthSweep.notified, 1);
      assert.equal(deliveries.length, 3, "expected delivery when candidate set changes");
    });
  });
});

