import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveHookUrl,
  handleHookServiceStatus,
  handleHookServiceAction,
  handleHookConfigure,
  handleHookLogTail,
} from "./hook.js";
import {
  setActiveHookRouter,
  getActiveHookRouter,
  clearHookLogs,
} from "./hook-router.js";
import {
  getUppidiFleetSettingsStorage,
  migrateLegacyConfigIfNeeded,
  getLegacyRouterConfig,
} from "./settings.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("uppidi-fleet hook server handlers", () => {
  let prevHookPort: string | undefined;
  let prevNodeEnv: string | undefined;

  beforeEach(() => {
    prevHookPort = process.env.HOOK_PORT;
    prevNodeEnv = process.env.NODE_ENV;
    process.env.HOOK_PORT = "0";
    process.env.NODE_ENV = "test";
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
