import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCompanionController,
  pluginRootCandidates,
  resolveCompanionScript,
} from "./companion";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "twofado-companion-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("index.server companion wiring", () => {
  const source = fs.readFileSync(path.join(pluginRoot, "index.server.ts"), "utf8");

  it("registers every companion daemon RPC", () => {
    for (const contract of [
      "daemonStatus",
      "daemonStart",
      "daemonStop",
      "daemonRestart",
      "daemonLogs",
      "daemonInstall",
    ]) {
      expect(source).toMatch(new RegExp(`server\\.handle\\(\\s*${contract}\\b`));
    }
  });

  it("creates the controller and tears it down on cleanup", () => {
    expect(source).toMatch(/createCompanionController\(\{[\s\S]*?\bbinDir\b/);
    expect(source).toMatch(/companion\.shutdown\(\)/);
  });

  it("auto-starts the supervised daemon from settings on contribute", () => {
    expect(source).toMatch(/maybeAutoStart\(\s*initial\.autoStartDaemon/);
  });
});

describe("resolveCompanionScript", () => {
  it("resolves the ported scripts from the plugin root", () => {
    expect(resolveCompanionScript("daemon-supervisor.mjs", { rootDir: pluginRoot })).toBe(
      path.join(pluginRoot, "scripts", "daemon-supervisor.mjs"),
    );
    expect(resolveCompanionScript("install-companion.mjs", { rootDir: pluginRoot })).toBe(
      path.join(pluginRoot, "scripts", "install-companion.mjs"),
    );
  });

  it("returns null when the script is absent from the root", () => {
    const dir = makeTempDir();
    expect(resolveCompanionScript("daemon-supervisor.mjs", { rootDir: dir })).toBeNull();
  });
});

describe("pluginRootCandidates", () => {
  it("honors the TWOFADO_PLUGIN_ROOT override first", () => {
    const root = makeTempDir();
    const candidates = pluginRootCandidates({
      env: { TWOFADO_PLUGIN_ROOT: root },
      home: makeTempDir(),
    });
    expect(candidates[0]).toBe(path.resolve(root));
  });

  it("reads plugin install paths from ~/.paseo/config.json, self ids first", () => {
    const home = makeTempDir();
    fs.mkdirSync(path.join(home, ".paseo"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".paseo", "config.json"),
      JSON.stringify({
        plugins: {
          other: { path: "/opt/other-plugin" },
          twofado: { path: "/opt/twofado-plugin" },
        },
      }),
    );
    const candidates = pluginRootCandidates({ env: {}, home });
    const twofadoIndex = candidates.indexOf("/opt/twofado-plugin");
    const otherIndex = candidates.indexOf("/opt/other-plugin");
    expect(twofadoIndex).toBeGreaterThanOrEqual(0);
    expect(otherIndex).toBeGreaterThan(twofadoIndex);
  });

  it("discovers managed install checkouts under ~/.paseo/plugins", () => {
    const home = makeTempDir();
    fs.mkdirSync(path.join(home, ".paseo", "plugins", "twofado", "abc-123", "checkout"), {
      recursive: true,
    });
    const candidates = pluginRootCandidates({ env: {}, home });
    expect(candidates).toContain(
      path.join(home, ".paseo", "plugins", "twofado", "abc-123", "checkout"),
    );
  });
});

describe("createCompanionController (real ported supervisor)", () => {
  it("loads the dynamic .mjs supervisor and reports an offline status for a dead socket", async () => {
    const dir = makeTempDir();
    const controller = createCompanionController({ rootDir: pluginRoot, env: {} });
    const status = await controller.status({
      socketPath: path.join(dir, "missing.sock"),
    });
    expect(status.state).toBe("offline");
    expect(status.managed).toBe("none");
    expect(status.socketPath).toBe(path.join(dir, "missing.sock"));
    expect(controller.rootDir()).toBe(pluginRoot);
    await controller.shutdown();
  });

  it("fails soft when the supervisor script cannot be located", async () => {
    const dir = makeTempDir();
    const controller = createCompanionController({ rootDir: dir, env: {} });
    const status = await controller.status({ socketPath: "/tmp/nope.sock" });
    expect(status.state).toBe("offline");
    expect(status.managed).toBe("none");
    const stop = await controller.stop();
    expect(stop.stopped).toBe(true);
    const logs = await controller.logs();
    expect(logs.entries).toEqual([]);
  });

  it("returns a structured error for start when the module is unavailable", async () => {
    const dir = makeTempDir();
    const controller = createCompanionController({ rootDir: dir, env: {} });
    const result = await controller.start({ socketPath: "/tmp/nope.sock" });
    expect(result.success).toBe(false);
    expect(result.socketPath).toBe("/tmp/nope.sock");
    expect(result.error).toContain("daemon-supervisor.mjs");
  });
});
