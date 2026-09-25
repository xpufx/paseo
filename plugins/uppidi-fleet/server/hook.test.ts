import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveHookUrl,
  handleHookStatus,
  handleHookServiceStatus,
  handleHookInfo,
  handleHookServiceAction,
  handleHookConfigure,
  handleHookLogTail,
} from "./hook.js";
import {
  HookRouter,
  setActiveHookRouter,
  getActiveHookRouter,
  clearHookLogs,
} from "./hook-router.js";
import {
  getUppidiFleetSettingsStorage,
  migrateLegacyConfigIfNeeded,
  getLegacyRouterConfig,
} from "./settings.js";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("uppidi-fleet hook server handlers", () => {
  let prevHookPort: string | undefined;
  let prevNodeEnv: string | undefined;
  let prevHookStateDir: string | undefined;
  let prevHookQueueDir: string | undefined;
  let stateDir: string;

  beforeEach(() => {
    prevHookPort = process.env.HOOK_PORT;
    prevNodeEnv = process.env.NODE_ENV;
    prevHookStateDir = process.env.HOOK_STATE_DIR;
    prevHookQueueDir = process.env.HOOK_QUEUE_DIR;
    process.env.HOOK_PORT = "0";
    process.env.NODE_ENV = "test";
    stateDir = mkdtempSync(join(tmpdir(), "uppidi-fleet-hook-state-"));
    // Mirror production: frontdesk.json sits one level above the state dir.
    process.env.HOOK_STATE_DIR = join(stateDir, "orchestrators");
    process.env.HOOK_QUEUE_DIR = join(stateDir, "queues");
    mkdirSync(process.env.HOOK_STATE_DIR, { recursive: true });
    mkdirSync(process.env.HOOK_QUEUE_DIR, { recursive: true });
    clearHookLogs();
  });

  afterEach(async () => {
    const router = getActiveHookRouter();
    if (router) {
      await router.stop();
      setActiveHookRouter(null);
    }
    if (prevHookPort !== undefined) {
      process.env.HOOK_PORT = prevHookPort;
    } else {
      delete process.env.HOOK_PORT;
    }
    if (prevNodeEnv !== undefined) {
      process.env.NODE_ENV = prevNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (prevHookStateDir !== undefined) {
      process.env.HOOK_STATE_DIR = prevHookStateDir;
    } else {
      delete process.env.HOOK_STATE_DIR;
    }
    if (prevHookQueueDir !== undefined) {
      process.env.HOOK_QUEUE_DIR = prevHookQueueDir;
    } else {
      delete process.env.HOOK_QUEUE_DIR;
    }
    rmSync(stateDir, { recursive: true, force: true });
    clearHookLogs();
  });

  it("resolves default hook URL when omitted or empty", () => {
    assert.equal(resolveHookUrl(), "http://127.0.0.1:8099");
    assert.equal(resolveHookUrl(""), "http://127.0.0.1:8099");
    assert.equal(resolveHookUrl("   "), "http://127.0.0.1:8099");
  });

  it("normalizes trailing slashes in custom hook URL", () => {
    assert.equal(resolveHookUrl("http://localhost:9000/"), "http://localhost:9000");
    assert.equal(resolveHookUrl("http://localhost:9000///"), "http://localhost:9000");
  });

  it("resolves FORGE_HOOK_URL when no explicit URL is provided (#464)", () => {
    const prev = process.env.FORGE_HOOK_URL;
    try {
      process.env.FORGE_HOOK_URL = "http://10.20.30.24:8123/";
      assert.equal(resolveHookUrl(), "http://10.20.30.24:8123");
      assert.equal(resolveHookUrl("http://localhost:9000"), "http://localhost:9000");
    } finally {
      if (prev !== undefined) process.env.FORGE_HOOK_URL = prev;
      else delete process.env.FORGE_HOOK_URL;
    }
  });

  it("resolves the active hook router address dynamically (#464)", async () => {
    await handleHookServiceAction({ action: "start" });
    const router = getActiveHookRouter();
    assert.ok(router, "active router must exist after start");

    const status = await handleHookServiceStatus();
    assert.equal(status.active, true);
    assert.ok(status.port && status.port > 0);
    assert.equal(resolveHookUrl(), `http://127.0.0.1:${status.port}`);

    await handleHookServiceAction({ action: "stop" });
  });

  it("maps wildcard-bound router hosts to loopback (#464)", async () => {
    await handleHookServiceAction({ action: "start" });
    const router = getActiveHookRouter();
    assert.ok(router, "active router must exist after start");

    const configured = await handleHookConfigure({ host: "0.0.0.0", port: 0, restart: true });
    assert.equal(configured.ok, true);
    assert.equal(configured.activePort && configured.activePort > 0, true);

    const status = await handleHookServiceStatus();
    assert.equal(status.host, "0.0.0.0");
    assert.equal(resolveHookUrl(), `http://127.0.0.1:${status.port}`);

    await handleHookServiceAction({ action: "stop" });
  });

  it("reports null-safe hook.info when the router has not started (#545)", async () => {
    assert.equal(getActiveHookRouter(), null);

    const info = await handleHookInfo();
    assert.equal(info.ok, true);
    assert.equal(info.running, false);
    assert.equal(info.hookHost, null);
    assert.equal(info.hookPort, null);
    assert.equal(info.url, null);
    assert.equal(info.isListening, false);
    assert.equal(info.frontDeskAgentId, null);
    assert.deepEqual(info.registeredRepoKeys, []);
    assert.equal(info.registeredRepoCount, 0);
    assert.equal(info.uptime, 0);
  });

  it("resolves live hook.info from the running router without reading settings (#545)", async () => {
    await handleHookServiceAction({ action: "start" });
    const router = getActiveHookRouter();
    assert.ok(router, "active router must exist after start");

    const status = await handleHookServiceStatus();
    const info = await handleHookInfo();

    assert.equal(info.ok, true);
    assert.equal(info.running, true);
    assert.equal(info.isListening, true);
    assert.equal(info.hookHost, router.configuredHost);
    assert.equal(info.hookPort, router.configuredPort);
    assert.equal(info.url, `http://${router.configuredHost}:${router.configuredPort}`);
    assert.equal(info.uptime, router.getUptime());
    // The bound port is dynamic in tests; configured port remains the stable value.
    assert.equal(status.configuredHost, info.hookHost);
    assert.equal(status.configuredPort, info.hookPort);

    await handleHookServiceAction({ action: "stop" });
  });

  it("resolves the front desk and enrolled repos via the live chain (#545)", async () => {
    await handleHookServiceAction({ action: "start" });
    const router = getActiveHookRouter();
    assert.ok(router, "active router must exist after start");

    router.writeFrontDesk("fd-live-1", "frontdesk");
    router.enrollRepo("forge.mrs.uppidi.com/xpufx-org/paseo");
    router.enrollRepo("forge.mrs.uppidi.com/xpufx-org/platform");

    const info = await handleHookInfo();
    assert.equal(info.frontDeskAgentId, "fd-live-1");
    assert.deepEqual(
      [...info.registeredRepoKeys].sort(),
      ["forge.mrs.uppidi.com/xpufx-org/paseo", "forge.mrs.uppidi.com/xpufx-org/platform"],
    );
    assert.equal(info.registeredRepoCount, 2);

    await handleHookServiceAction({ action: "stop" });
  });

  it("maps wildcard-bound router hosts to loopback in hook.info (#545)", async () => {
    await handleHookServiceAction({ action: "start" });
    const configured = await handleHookConfigure({ host: "0.0.0.0", port: 0, restart: true });
    assert.equal(configured.ok, true);

    const info = await handleHookInfo();
    assert.equal(info.hookHost, "0.0.0.0");
    assert.equal(info.url, "http://127.0.0.1:0");
    assert.equal(info.isListening, true);

    await handleHookServiceAction({ action: "stop" });
  });

  it("manages bundled hook service lifecycle without systemctl", async () => {
    // 1. Initial status when not running
    const initialStatus = await handleHookServiceStatus();
    assert.equal(initialStatus.ok, true);
    assert.equal(initialStatus.active, false);
    assert.equal(initialStatus.state, "inactive");
    assert.equal(initialStatus.description, "Bundled hook router is inactive");
    assert.equal(initialStatus.pid, process.pid);

    // 2. Start bundled service
    const startRes = await handleHookServiceAction({ action: "start" });
    assert.equal(startRes.ok, true);
    assert.equal(startRes.action, "start");
    assert.ok(startRes.message?.includes("Bundled hook router started on port"));

    // 3. Status after starting
    const activeStatus = await handleHookServiceStatus();
    assert.equal(activeStatus.ok, true);
    assert.equal(activeStatus.active, true);
    assert.equal(activeStatus.state, "active");
    assert.ok(activeStatus.description?.includes("Bundled hook router listening on port"));
    assert.equal(activeStatus.pid, process.pid);

    // 4. Reload bundled service
    const reloadRes = await handleHookServiceAction({ action: "reload" });
    assert.equal(reloadRes.ok, true);
    assert.equal(reloadRes.action, "reload");
    assert.ok(reloadRes.message?.includes("reloaded successfully"));

    // 5. Restart bundled service
    const restartRes = await handleHookServiceAction({ action: "restart" });
    assert.equal(restartRes.ok, true);
    assert.equal(restartRes.action, "restart");
    assert.ok(restartRes.message?.includes("restarted on port"));

    const restartedStatus = await handleHookServiceStatus();
    assert.equal(restartedStatus.active, true);
    assert.equal(restartedStatus.state, "active");

    // 6. Log tailing returns buffered events
    const logRes = await handleHookLogTail({ lines: 10 });
    assert.equal(logRes.ok, true);
    assert.ok(Array.isArray(logRes.lines));
    assert.ok(logRes.lines.length > 0);
    assert.ok(logRes.lines.some((line) => line.includes("Bundled hook router listening")));
    assert.ok(logRes.lines.some((line) => line.includes("Service action executed: start")));

    // 7. Stop bundled service
    const stopRes = await handleHookServiceAction({ action: "stop" });
    assert.equal(stopRes.ok, true);
    assert.equal(stopRes.action, "stop");
    assert.ok(stopRes.message?.includes("stopped successfully"));

    const stoppedStatus = await handleHookServiceStatus();
    assert.equal(stoppedStatus.ok, true);
    assert.equal(stoppedStatus.active, false);
    assert.equal(stoppedStatus.state, "inactive");
  });

  it("configures hook service listen address and port (#427)", async () => {
    // Start router
    await handleHookServiceAction({ action: "start" });
    const initialStatus = await handleHookServiceStatus();
    assert.equal(initialStatus.active, true);
    assert.ok(initialStatus.availableInterfaces.includes("127.0.0.1"));

    // Configure new host and dynamic port with restart
    const configureResult = await handleHookConfigure({
      host: "127.0.0.1",
      port: 0,
      restart: true,
    });

    assert.equal(configureResult.ok, true);
    assert.equal(configureResult.restarted, true);
    assert.equal(configureResult.configuredHost, "127.0.0.1");
    assert.equal(configureResult.activeHost, "127.0.0.1");
    assert.ok(configureResult.activePort > 0);

    const reconfiguredStatus = await handleHookServiceStatus();
    assert.equal(reconfiguredStatus.active, true);
    assert.equal(reconfiguredStatus.host, "127.0.0.1");
    assert.equal(reconfiguredStatus.configuredHost, "127.0.0.1");

    await handleHookServiceAction({ action: "stop" });
  });
  it("reports x-comms presence via the helper plugin registry, tolerating absence (#572)", async () => {
    // No context: presence falls through to the daemon query and must surface a
    // boolean without throwing, whatever the host daemon reports.
    const status = await handleHookStatus({ hookUrl: "http://127.0.0.1:1" });
    assert.equal(status.ok, false);
    assert.equal(typeof status.capabilities.xCommsInstalled, "boolean");
  });

  it("tolerates an unusable presence surface (absence -> false, never throws) (#572)", async () => {
    const context = {
      paseo: {
        plugins: {
          list: async () => {
            throw new Error("daemon unreachable");
          },
        },
      },
    } as unknown as Parameters<typeof handleHookStatus>[1];

    const status = await handleHookStatus({ hookUrl: "http://127.0.0.1:1" }, context);
    assert.equal(status.capabilities.xCommsInstalled, false);
  });

  it("reports x-comms installed when the daemon surface says it is running (#572)", async () => {
    const context = {
      paseo: {
        plugins: {
          list: async () => [{ id: "x-comms", status: "running", enabled: true }],
        },
      },
    } as unknown as Parameters<typeof handleHookStatus>[1];

    const status = await handleHookStatus({ hookUrl: "http://127.0.0.1:1" }, context);
    assert.equal(status.capabilities.xCommsInstalled, true);
  });

  it("treats a disabled x-comms as not installed (#572)", async () => {
    const context = {
      paseo: {
        plugins: {
          list: async () => [{ id: "x-comms", status: "disabled", enabled: false }],
        },
      },
    } as unknown as Parameters<typeof handleHookStatus>[1];

    const status = await handleHookStatus({ hookUrl: "http://127.0.0.1:1" }, context);
    assert.equal(status.capabilities.xCommsInstalled, false);
  });

  it("persists hook configuration into plugin settings and migrates legacy config (#444)", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "uppidi-settings-test-"));
    try {
      const legacyPath = join(tmpDir, "legacy-router-config.json");
      writeFileSync(
        legacyPath,
        JSON.stringify({
          host: "192.168.1.50",
          port: 8123,
          enrolledRepos: ["xpufx-org/paseo"],
          mutedRepos: ["xpufx-org/muted"],
        }),
        "utf8",
      );

      const storage = getUppidiFleetSettingsStorage({ baseDir: tmpDir });
      const migrated = migrateLegacyConfigIfNeeded(storage, legacyPath);
      assert.equal(migrated, true);

      const loaded = storage.read();
      assert.equal(loaded.hookHost, "192.168.1.50");
      assert.equal(loaded.hookPort, 8123);
      assert.deepEqual(loaded.enrolledRepos, ["xpufx-org/paseo"]);
      assert.deepEqual(loaded.mutedRepos, ["xpufx-org/muted"]);

      // Verify handleHookConfigure updates settings
      await handleHookServiceAction({ action: "start" });
      const configureResult = await handleHookConfigure({
        host: "127.0.0.1",
        port: 0,
        restart: true,
      });
      assert.equal(configureResult.ok, true);

      await handleHookServiceAction({ action: "stop" });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
