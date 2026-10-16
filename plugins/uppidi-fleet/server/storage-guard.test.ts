import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installStorageGuard,
  ScopedStorageViolationError,
  resolvePaseoHome,
} from "paseo-plugin-helper/server";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server.js";
import {
  HookRouter,
  defaultCircuitBreakerPath,
  defaultModelAlertsPath,
  getFleetRosterInfo,
} from "./hook-router.js";

function withSandboxedHome(fn: (home: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "uppidi-fleet-guard-test-"));
  const prevHome = process.env.HOME;
  const prevPaseoHome = process.env.PASEO_HOME;
  const prevQueueDir = process.env.HOOK_QUEUE_DIR;
  const prevStateDir = process.env.HOOK_STATE_DIR;
  process.env.HOME = home;
  delete process.env.PASEO_HOME;
  delete process.env.HOOK_QUEUE_DIR;
  delete process.env.HOOK_STATE_DIR;
  try {
    fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevPaseoHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = prevPaseoHome;
    if (prevQueueDir === undefined) delete process.env.HOOK_QUEUE_DIR;
    else process.env.HOOK_QUEUE_DIR = prevQueueDir;
    if (prevStateDir === undefined) delete process.env.HOOK_STATE_DIR;
    else process.env.HOOK_STATE_DIR = prevStateDir;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {}
  }
}

describe("uppidi-fleet scoped storage guard (#1423)", () => {
  it("permits writes inside scoped plugin storage directory and temp", () => {
    withSandboxedHome((home) => {
      const uninstall = installStorageGuard({
        pluginId: "uppidi-fleet",
        namespace: "plugin-data/xpufx",
        allowTmp: true,
        mode: "enforce",
      });

      try {
        const scopedDir = path.join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");
        fs.mkdirSync(scopedDir, { recursive: true });
        const testFile = path.join(scopedDir, "probe.json");
        fs.writeFileSync(testFile, JSON.stringify({ ok: true }), "utf8");
        assert.equal(fs.existsSync(testFile), true);

        // Temp write is also allowed
        const tmpFile = path.join(os.tmpdir(), `fleet-guard-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, "tmp-ok", "utf8");
        assert.equal(fs.existsSync(tmpFile), true);
        fs.unlinkSync(tmpFile);
      } finally {
        uninstall();
      }
    });
  });

  it("blocks and throws on write operations outside permitted scopes", () => {
    withSandboxedHome((home) => {
      const uninstall = installStorageGuard({
        pluginId: "uppidi-fleet",
        namespace: "plugin-data/xpufx",
        allowTmp: false,
        mode: "enforce",
      });

      try {
        const legacyFile = path.join(home, ".paseo", "forgejo-hook", "frontdesk.json");
        assert.throws(
          () => {
            fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
            fs.writeFileSync(legacyFile, "legacy");
          },
          (err: unknown) => {
            return (
              err instanceof ScopedStorageViolationError &&
              err.code === "ERR_SCOPED_STORAGE_VIOLATION" &&
              err.message.includes("Scoped storage violation")
            );
          },
        );

        const configQueueFile = path.join(home, ".config", "uppidi-fleet", "queues", "q.json");
        assert.throws(
          () => {
            fs.mkdirSync(path.dirname(configQueueFile), { recursive: true });
            fs.writeFileSync(configQueueFile, "queue");
          },
          (err: unknown) => {
            return (
              err instanceof ScopedStorageViolationError &&
              err.code === "ERR_SCOPED_STORAGE_VIOLATION"
            );
          },
        );
      } finally {
        uninstall();
      }
    });
  });

  it("restores standard filesystem behavior after uninstalling guard", () => {
    withSandboxedHome((home) => {
      const uninstall = installStorageGuard({
        pluginId: "uppidi-fleet",
        namespace: "plugin-data/xpufx",
        allowTmp: false,
        mode: "enforce",
      });

      uninstall();

      const outsidePath = path.join(home, "unblocked.txt");
      fs.writeFileSync(outsidePath, "allowed now", "utf8");
      assert.equal(fs.existsSync(outsidePath), true);
    });
  });
});

describe("uppidi-fleet path harmonization (#1423)", () => {
  it("resolves default circuit breaker path within scoped storage", () => {
    withSandboxedHome((home) => {
      const prevNodeEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      try {
        const cbPath = defaultCircuitBreakerPath();
        const expected = path.join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "model-health.json");
        assert.equal(cbPath, expected);
      } finally {
        process.env.NODE_ENV = prevNodeEnv;
      }
    });
  });

  it("resolves default model alerts path within scoped storage", () => {
    withSandboxedHome((home) => {
      const alertsPath = defaultModelAlertsPath();
      const expected = path.join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "model-alerts.json");
      assert.equal(alertsPath, expected);
    });
  });

  it("resolves queueDir in getFleetRosterInfo under scoped storage", () => {
    withSandboxedHome((home) => {
      const scopedQueues = path.join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "queues");
      fs.mkdirSync(scopedQueues, { recursive: true });
      fs.writeFileSync(
        path.join(scopedQueues, "repo-1.json"),
        JSON.stringify([{ id: "q1", key: "repo-1" }, { id: "q2", key: "repo-1" }]),
        "utf8",
      );

      const info = getFleetRosterInfo();
      assert.equal(info.repoQueuedHooks["repo-1"], 2);
    });
  });
});

describe("HookRouter execution under active storage guard (#1423)", () => {
  it("writes, reads, and unlinks queues and registrations cleanly under storage guard", () => {
    withSandboxedHome((home) => {
      const uninstall = installStorageGuard({
        pluginId: "uppidi-fleet",
        namespace: "plugin-data/xpufx",
        allowTmp: true,
        mode: "enforce",
      });

      try {
        const scopedRoot = path.join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet");
        const router = new HookRouter(undefined, {
          isTestMode: false,
          queueDir: path.join(scopedRoot, "queues"),
          stateDir: path.join(scopedRoot, "orchestrators"),
          logDir: path.join(scopedRoot, "logs"),
        });

        // 1. Write frontdesk
        router.writeFrontDesk("frontdesk-agent-1", "test");
        const fd = router.readFrontDesk();
        assert.equal(fd?.agentId, "frontdesk-agent-1");

        // 2. Enqueue item and verify persistence
        router.enqueue("xpufx-org/paseo", "test webhook event");
        assert.equal(router.getQueue("xpufx-org/paseo").length, 1);

        // 3. Clear queue
        const cleared = router.clearQueue("xpufx-org/paseo");
        assert.equal(cleared, 1);
        assert.equal(router.getQueue("xpufx-org/paseo").length, 0);

        // 4. Clear frontdesk
        const fdCleared = router.clearFrontDesk();
        assert.ok(fdCleared >= 1);
        assert.equal(router.readFrontDesk(), null);
      } finally {
        uninstall();
      }
    });
  });
});

describe("index.server contribute lifecycle with storage guard (#1423)", () => {
  it("installs storage guard on contribute and uninstalls cleanly on disposal", () => {
    withSandboxedHome((home) => {
      const handledRpc: unknown[] = [];
      const listeners: Record<string, unknown> = {};
      const mockServer = {
        handle: (contract: unknown, handler: unknown) => {
          handledRpc.push({ contract, handler });
        },
        on: (event: string, handler: unknown) => {
          listeners[event] = handler;
          return () => {
            delete listeners[event];
          };
        },
      } as unknown as PluginServerContext;

      const dispose = contribute(mockServer);
      const forbiddenPath = path.resolve("/nonexistent-violation-test.json");

      try {
        // Guard should be active: writing outside permitted storage throws
        assert.throws(
          () => {
            fs.writeFileSync(forbiddenPath, "blocked");
          },
          (err: unknown) => {
            return (
              err instanceof ScopedStorageViolationError &&
              err.code === "ERR_SCOPED_STORAGE_VIOLATION"
            );
          },
        );
      } finally {
        // Dispose plugin and ensure uninstall runs cleanly
        dispose();
      }

      // After disposal, writing outside is unblocked (does not throw ScopedStorageViolationError)
      let caughtErr: unknown = null;
      try {
        fs.writeFileSync(forbiddenPath, "unblocked");
      } catch (err: unknown) {
        caughtErr = err;
      }
      assert.notEqual((caughtErr as any)?.code, "ERR_SCOPED_STORAGE_VIOLATION");
    });
  });
});
