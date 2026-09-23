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

describe("uppidi-forge hook server handlers", () => {
  let prevHookPort: string | undefined;

  beforeEach(() => {
    prevHookPort = process.env.HOOK_PORT;
    process.env.HOOK_PORT = "0";
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
});
