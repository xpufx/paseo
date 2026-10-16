import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  installStorageGuard,
  ScopedStorageViolationError,
  PluginStorage,
} from "paseo-plugin-helper/server";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  stateDir,
  legacyStateDir,
  defaultRegistryPath,
  readRegistry,
  mutateRegistry,
  migrateFromRoot,
  migrateStateFromOldDir,
} from "./registry.ts";
import {
  enqueueDefer,
  claimNextDefer,
  completeDeferItem,
  releaseDeferItem,
  removeDeferItem,
  listWaiting,
  deferQueueDir,
} from "./defer-queue.ts";
import {
  writeConversationsSnapshot,
  readConversationsSnapshot,
  recordSend,
  CONVERSATIONS_SNAPSHOT_FILE,
} from "./conversations-snapshot.ts";
import { emptyConversationsSnapshot } from "../shared/conversations-snapshot.ts";
import contribute from "../index.server.ts";

function withSandboxedHome(fn: (home: string) => void): void {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "xcomms-guard-test-"));
  const prevHome = process.env.HOME;
  const prevPaseoHome = process.env.PASEO_HOME;
  process.env.HOME = home;
  delete process.env.PASEO_HOME;
  try {
    fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevPaseoHome === undefined) delete process.env.PASEO_HOME;
    else process.env.PASEO_HOME = prevPaseoHome;
    try {
      fs.rmSync(home, { recursive: true, force: true });
    } catch {}
  }
}

describe("x-comms scoped storage guard (#1411)", () => {
  it("allows writes within scoped x-comms plugin storage and tmp", () => {
    withSandboxedHome((home) => {
      const uninstall = installStorageGuard({ pluginId: "x-comms" });
      try {
        const scopedDir = stateDir();
        fs.mkdirSync(scopedDir, { recursive: true });
        const testFile = path.join(scopedDir, "probe.json");
        fs.writeFileSync(testFile, JSON.stringify({ ok: true }), "utf8");
        assert.equal(fs.existsSync(testFile), true);

        // Temp writes are also allowed
        const tmpFile = path.join(os.tmpdir(), `xcomms-guard-${Date.now()}.json`);
        fs.writeFileSync(tmpFile, "tmp", "utf8");
        assert.equal(fs.existsSync(tmpFile), true);
        fs.unlinkSync(tmpFile);
      } finally {
        uninstall();
      }
    });
  });

  it("blocks and throws on write operations outside permitted scopes", () => {
    withSandboxedHome((home) => {
      const uninstall = installStorageGuard({ pluginId: "x-comms", allowTmp: false });
      try {
        const forbiddenFile = path.join(home, ".paseo", "unauthorized.json");
        assert.throws(
          () => {
            fs.writeFileSync(forbiddenFile, "forbidden");
          },
          (err: unknown) => {
            return (
              err instanceof ScopedStorageViolationError &&
              err.code === "ERR_SCOPED_STORAGE_VIOLATION" &&
              err.message.includes("Scoped storage violation")
            );
          },
        );
      } finally {
        uninstall();
      }
    });
  });
});

describe("peer registry with storage guard active (#1411)", () => {
  it("reads existing state from legacy paseo-x-comms namespace if x-comms registry is absent", () => {
    withSandboxedHome(() => {
      const legacyDir = legacyStateDir();
      fs.mkdirSync(legacyDir, { recursive: true });
      const legacyFile = path.join(legacyDir, "registry.json");
      fs.writeFileSync(
        legacyFile,
        JSON.stringify({ legacyPeer: "192.168.1.100:6767" }, null, 2),
        "utf8",
      );

      const uninstall = installStorageGuard({ pluginId: "x-comms" });
      try {
        const reg = readRegistry(defaultRegistryPath());
        assert.equal(reg.ok, true);
        assert.equal(reg.exists, true);
        const daemons = reg.daemons.filter((d) => d.source === "registry");
        assert.equal(daemons.length, 1);
        assert.equal(daemons[0]?.name, "legacyPeer");
        assert.equal(daemons[0]?.value, "192.168.1.100:6767");
      } finally {
        uninstall();
      }
    });
  });

  it("mutates registry and writes inside x-comms storage cleanly with guard active", () => {
    withSandboxedHome(() => {
      const uninstall = installStorageGuard({ pluginId: "x-comms" });
      try {
        const regPath = defaultRegistryPath();
        const res = mutateRegistry(regPath, (daemons) => ({
          ...daemons,
          remote1: "10.0.0.1:6767",
        }));
        assert.equal(res.saved, true);
        assert.equal(res.error, null);
        assert.ok(fs.existsSync(regPath));
        assert.ok(regPath.includes(path.join("plugin-data", "xpufx", "x-comms")));

        const readBack = readRegistry(regPath);
        assert.equal(readBack.ok, true);
        const found = readBack.daemons.find((d) => d.name === "remote1");
        assert.ok(found);
        assert.equal(found?.value, "10.0.0.1:6767");
      } finally {
        uninstall();
      }
    });
  });

  it("retires legacy migration unlinks so migrateFromRoot and migrateStateFromOldDir run without violation", () => {
    withSandboxedHome((home) => {
      // Create legacy root file and legacy old state dir with files
      const rootPaseo = path.join(home, ".paseo");
      fs.mkdirSync(rootPaseo, { recursive: true });
      fs.writeFileSync(path.join(rootPaseo, "paseo-x-comms-plugin.json"), JSON.stringify({ legacy: true }), "utf8");

      const oldStateDir = path.join(rootPaseo, "paseo-x-comms");
      fs.mkdirSync(oldStateDir, { recursive: true });
      fs.writeFileSync(path.join(oldStateDir, "registry.json"), JSON.stringify({ oldPeer: "10.0.0.5:6767" }), "utf8");
      fs.writeFileSync(path.join(oldStateDir, "mesh-key.json"), "stale-key", "utf8");

      const uninstall = installStorageGuard({ pluginId: "x-comms" });
      try {
        // Must not throw ScopedStorageViolationError even though legacy files exist outside x-comms
        migrateFromRoot("paseo-x-comms-plugin.json", path.join(stateDir(), "plugin.json"));
        migrateStateFromOldDir();

        // Files migrated into scoped stateDir
        assert.ok(fs.existsSync(path.join(stateDir(), "plugin.json")));
        assert.ok(fs.existsSync(path.join(stateDir(), "registry.json")));

        // Legacy files are left untouched without attempting forbidden unlinks outside scoped storage
        assert.ok(fs.existsSync(path.join(rootPaseo, "paseo-x-comms-plugin.json")));
        assert.ok(fs.existsSync(path.join(oldStateDir, "registry.json")));
      } finally {
        uninstall();
      }
    });
  });
});

describe("defer queue with storage guard active (#1411)", () => {
  it("enqueueDefer, claim, and complete operate cleanly in scoped defer directory under guard", () => {
    withSandboxedHome(() => {
      const uninstall = installStorageGuard({ pluginId: "x-comms" });
      try {
        const queueDir = deferQueueDir();
        assert.ok(queueDir.includes(path.join("plugin-data", "xpufx", "x-comms", "pending")));

        const enqueued = enqueueDefer(
          {
            daemon: "remote-daemon",
            agentId: "agent-target",
            prompt: "Test deferred message",
            messageId: "msg-defer-1",
            fromAgentId: "agent-source",
          },
          { dir: queueDir },
        );
        assert.ok(enqueued.entry);
        assert.equal(enqueued.error, null);

        const waiting = listWaiting(queueDir);
        assert.equal(waiting.length, 1);
        assert.equal(waiting[0]?.messageId, "msg-defer-1");

        const target = { daemon: "remote-daemon", agentId: "agent-target" };
        const claim = claimNextDefer(queueDir, target);
        assert.ok(claim);
        assert.equal(claim?.messageId, "msg-defer-1");

        completeDeferItem(queueDir, claim!.id);
        assert.equal(listWaiting(queueDir).length, 0);
      } finally {
        uninstall();
      }
    });
  });

  it("releaseDeferItem and removeDeferItem operate without storage violation under guard", () => {
    withSandboxedHome(() => {
      const uninstall = installStorageGuard({ pluginId: "x-comms" });
      try {
        const queueDir = deferQueueDir();
        enqueueDefer(
          {
            daemon: "remote-daemon",
            agentId: "agent-target",
            prompt: "Message to release",
            messageId: "msg-defer-2",
          },
          { dir: queueDir },
        );

        const target = { daemon: "remote-daemon", agentId: "agent-target" };
        const claim = claimNextDefer(queueDir, target);
        assert.ok(claim);

        releaseDeferItem(queueDir, claim!.id);
        assert.equal(listWaiting(queueDir).length, 1);

        const claim2 = claimNextDefer(queueDir, target);
        assert.ok(claim2);
        removeDeferItem(queueDir, claim2!.id);
        assert.equal(listWaiting(queueDir).length, 0);
      } finally {
        uninstall();
      }
    });
  });
});

describe("snapshot with storage guard active (#1411)", () => {
  it("writes and reads conversations snapshot cleanly under storage guard", () => {
    withSandboxedHome(() => {
      const uninstall = installStorageGuard({ pluginId: "x-comms" });
      try {
        const testSnapshot = recordSend(emptyConversationsSnapshot(), {
          peerAlias: "peer-host",
          peerServerId: "srv_remote_1",
          peerAgentId: "agent-remote-1",
          peerAgentName: "Peer Remote",
          localAgentId: "local-agent-1",
          at: "2026-10-16T12:00:00.000Z",
        });

        writeConversationsSnapshot(testSnapshot);
        const reloaded = readConversationsSnapshot();
        assert.equal(reloaded.threads.length, 1);
        assert.equal(reloaded.threads[0]?.peerAlias, "peer-host");
      } finally {
        uninstall();
      }
    });
  });

  it("reads legacy conversations snapshot if x-comms snapshot does not exist", () => {
    withSandboxedHome(() => {
      const legacyStore = new PluginStorage(
        "paseo-x-comms",
        CONVERSATIONS_SNAPSHOT_FILE,
        { defaultData: emptyConversationsSnapshot() },
      );
      const legacySnapshot = recordSend(emptyConversationsSnapshot(), {
        peerAlias: "legacy-peer",
        peerServerId: "srv_legacy_1",
        peerAgentId: "agent-legacy-1",
        peerAgentName: null,
        localAgentId: "local-1",
        at: "2026-10-15T10:00:00.000Z",
      });
      legacyStore.write(legacySnapshot);

      const uninstall = installStorageGuard({ pluginId: "x-comms" });
      try {
        const loaded = readConversationsSnapshot();
        assert.equal(loaded.threads.length, 1);
        assert.equal(loaded.threads[0]?.peerAlias, "legacy-peer");
      } finally {
        uninstall();
      }
    });
  });
});

describe("index.server contribute lifecycle with storage guard (#1411)", () => {
  it("enables storage guard and disposes cleanly via uninstall hook", () => {
    withSandboxedHome((home) => {
      const handledRpc: unknown[] = [];
      const listeners: Record<string, unknown> = {};
      const mockServer = {
        handle: (rpc: unknown) => {
          handledRpc.push(rpc);
        },
        on: (event: string, handler: unknown) => {
          listeners[event] = handler;
          return () => {
            delete listeners[event];
          };
        },
        before: () => () => {},
      } as unknown as PluginServerContext;

      const dispose = contribute(mockServer);
      const forbiddenPath = path.resolve("/nonexistent-violation-test.json");
      try {
        // Verify storage guard is active: writing outside permitted storage throws
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
        // Verify disposal uninstalls storage guard cleanly
        dispose();
      }

      // Now writing outside permitted storage does not throw ScopedStorageViolationError
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
