import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  installStorageGuard,
  resolvePaseoHome,
  ScopedStorageViolationError,
  type PaseoPluginInfo,
  type SafeSpawnResult,
} from "paseo-plugin-helper/server";
import contribute from "../index.server.js";
import { testing } from "./updates";

function result(stdout = "", code = 0, stderr = ""): SafeSpawnResult {
  return { stdout, stderr, code, signal: null, durationMs: 1 };
}

function hex(char: string): string {
  return char.repeat(40);
}

const LOCAL = hex("a");
const REMOTE = hex("b");
const TREE_LOCAL = hex("1");
const TREE_REMOTE = hex("2");

function plugin(id = "demo", pluginPath = "/repo/plugins/demo"): PaseoPluginInfo {
  return { id, path: pluginPath, enabled: true, status: "running" };
}

test("storage guard is enabled during server initialization and uninstalls cleanly (#1408)", () => {
  const handlers = new Map<string, Function>();
  const mockServer: any = {
    handle: (contract: any, handler: Function) => {
      handlers.set(contract?.name ?? String(contract), handler);
    },
  };

  const uninstall = contribute(mockServer);
  assert.equal(typeof uninstall, "function");

  const scopedRoot = path.join(resolvePaseoHome(), "plugin-data", "xpufx", "plugin-updates");
  const testFile = path.join(scopedRoot, "guard-test.json");
  const unauthorizedFile = path.join(os.homedir(), ".config", "unauthorized.json");

  try {
    fs.mkdirSync(scopedRoot, { recursive: true });
    fs.writeFileSync(testFile, JSON.stringify({ ok: true }), "utf8");
    assert.equal(fs.existsSync(testFile), true);

    assert.throws(
      () => {
        fs.writeFileSync(unauthorizedFile, "should fail");
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
    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch {
      // cleanup best effort
    }
    uninstall();
  }
});

test("cache operations succeed in scoped storage under active storage guard (#1408)", async () => {
  const uninstall = installStorageGuard({ pluginId: "plugin-updates" });
  const scopedCache = path.join(resolvePaseoHome(), "plugin-data", "xpufx", "plugin-updates", "cache");

  try {
    const runner = async (command: string, args: string[]) => {
      if (command !== "git") return result("", 1, "unexpected command");
      const inCache = args[0] === "-C";
      const gitArgs = inCache ? args.slice(2) : args;
      const cmd = gitArgs[0];

      if (cmd === "rev-parse") {
        if (!inCache) {
          if (gitArgs[1] === "--show-toplevel") return result("/repo\n");
          if (gitArgs[1] === "--abbrev-ref" && gitArgs[2] === "--symbolic-full-name") return result("origin/main\n");
          if (gitArgs[1] === "HEAD") return result(`${LOCAL}\n`);
        }
        const expr = gitArgs[1]!;
        if (expr === `${LOCAL}:plugins/demo`) return result(`${TREE_LOCAL}\n`);
        if (expr === `${REMOTE}:plugins/demo`) return result(`${TREE_REMOTE}\n`);
        return result("", 128, "not found");
      }
      if (cmd === "remote") {
        return result("https://example.test/repo.git\n");
      }
      if (cmd === "ls-remote") {
        return result(`${REMOTE}\trefs/heads/main\n`);
      }
      if (cmd === "init" || cmd === "fetch") return result("");
      if (cmd === "merge-base" && gitArgs[1] === "--is-ancestor") return result("", 0);
      return result("", 1, `unexpected git command: ${gitArgs.join(" ")}`);
    };

    const checked = await testing.checkInstalledPlugins(
      undefined,
      runner,
      [plugin("demo", "/repo/plugins/demo")],
      {
        scanOrphans: false,
        readFile: async () => {
          throw new Error("missing file");
        },
      },
    );

    assert.equal(checked.plugins.length, 1);
    assert.equal(checked.plugins[0]?.status, "behind");
    assert.equal(fs.existsSync(scopedCache), true);
  } finally {
    uninstall();
    try {
      if (fs.existsSync(scopedCache)) {
        fs.rmSync(scopedCache, { recursive: true, force: true });
      }
    } catch {
      // cleanup best effort
    }
  }
});

test("cache operations fail with ScopedStorageViolationError if legacy cache path is used (#1408)", async () => {
  const uninstall = installStorageGuard({ pluginId: "plugin-updates" });
  const legacyCache = path.join(os.homedir(), ".paseo", "plugins", ".cache", "plugin-updates");

  try {
    const runner = async (command: string, args: string[]) => {
      if (command !== "git") return result("", 1, "unexpected command");
      const inCache = args[0] === "-C";
      const gitArgs = inCache ? args.slice(2) : args;
      const cmd = gitArgs[0];

      if (cmd === "rev-parse") {
        if (!inCache) {
          if (gitArgs[1] === "--show-toplevel") return result("/repo\n");
          if (gitArgs[1] === "--abbrev-ref" && gitArgs[2] === "--symbolic-full-name") return result("origin/main\n");
          if (gitArgs[1] === "HEAD") return result(`${LOCAL}\n`);
        }
        return result(`${TREE_LOCAL}\n`);
      }
      if (cmd === "remote") {
        return result("https://example.test/repo.git\n");
      }
      if (cmd === "ls-remote") {
        return result(`${REMOTE}\trefs/heads/main\n`);
      }
      return result("");
    };

    await assert.rejects(
      async () => {
        await testing.checkInstalledPlugins(
          undefined,
          runner,
          [plugin("demo", "/repo/plugins/demo")],
          {
            scanOrphans: false,
            cacheRoot: legacyCache,
            readFile: async () => {
              throw new Error("missing file");
            },
          },
        );
      },
      (err: unknown) => {
        return (
          err instanceof ScopedStorageViolationError &&
          err.code === "ERR_SCOPED_STORAGE_VIOLATION" &&
          err.attemptedPath.includes(legacyCache)
        );
      },
    );
  } finally {
    uninstall();
  }
});
