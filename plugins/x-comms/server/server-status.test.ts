import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { serverCandidates, serverPath } from "./server-status.ts";

/**
 * Regression for xpufx-org/paseo#214: a `source: directory` install could not
 * resolve the bundled MCP server, so the agent.create injection hook was
 * skipped on every reload and x-comms never reached agents.
 *
 * Ground truth measured on the live daemon (temporary diagnostic):
 *   cwd = the daemon's own working directory (NOT the plugin dir)
 *   import.meta.url = undefined (Paseo bundles and inlines the server)
 *
 * So neither of the original locators could ever work. The dependable source is
 * the install path the daemon records in `~/.paseo/config.json`.
 */

const BUNDLED = "paseo-x-comms.bundled.mjs";

function sandbox(fn: (root: string, home: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "xcomms-serverpath-"));
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const prev = {
    home: process.env.HOME,
    override: process.env.PASEO_X_COMMS_MCP_SERVER,
    cwd: process.cwd(),
  };
  process.env.HOME = home;
  delete process.env.PASEO_X_COMMS_MCP_SERVER;
  try {
    fn(root, home);
  } finally {
    process.chdir(prev.cwd);
    if (prev.home === undefined) delete process.env.HOME;
    else process.env.HOME = prev.home;
    if (prev.override === undefined) delete process.env.PASEO_X_COMMS_MCP_SERVER;
    else process.env.PASEO_X_COMMS_MCP_SERVER = prev.override;
    rmSync(root, { recursive: true, force: true });
  }
}

function writeBundle(dir: string): string {
  const mcp = join(dir, "mcp");
  mkdirSync(mcp, { recursive: true });
  const file = join(mcp, BUNDLED);
  writeFileSync(file, "// bundle");
  return file;
}

function writeConfig(home: string, plugins: Record<string, string>): void {
  const entries = Object.fromEntries(
    Object.entries(plugins).map(([id, dir]) => [id, { source: "directory", path: dir, enabled: true }]),
  );
  writeFileSync(join(home, ".paseo", "config.json"), JSON.stringify({ plugins: entries }));
}

describe("x-comms serverPath (#214)", () => {
  it("resolves a directory install from the recorded plugin path", () => {
    sandbox((root, home) => {
      const pluginDir = join(root, "checkout", "plugins", "x-comms");
      const expected = writeBundle(pluginDir);
      mkdirSync(join(home, ".paseo"), { recursive: true });
      writeConfig(home, { "x-comms": pluginDir });
      assert.equal(serverPath(), expected);
    });
  });

  it("prefers a recorded x-comms path over unrelated plugin installs", () => {
    sandbox((root, home) => {
      const other = join(root, "checkout", "plugins", "forges");
      writeBundle(other);
      const pluginDir = join(root, "checkout", "plugins", "x-comms");
      const expected = writeBundle(pluginDir);
      mkdirSync(join(home, ".paseo"), { recursive: true });
      writeConfig(home, { forges: other, "x-comms": pluginDir });
      assert.equal(serverPath(), expected);
    });
  });

  it("honours PASEO_X_COMMS_MCP_SERVER as the highest-priority locator", () => {
    sandbox((root, home) => {
      const elsewhere = writeBundle(join(root, "elsewhere"));
      const pluginDir = join(root, "checkout", "plugins", "x-comms");
      writeBundle(pluginDir);
      mkdirSync(join(home, ".paseo"), { recursive: true });
      writeConfig(home, { "x-comms": pluginDir });
      process.env.PASEO_X_COMMS_MCP_SERVER = elsewhere;
      assert.equal(serverCandidates()[0], elsewhere);
      assert.equal(serverPath(), elsewhere);
    });
  });

  it("still resolves the managed git-source checkout layout", () => {
    sandbox((root, home) => {
      const checkout = join(home, ".paseo", "plugins", "x-comms", "abc123", "checkout");
      const expected = writeBundle(checkout);
      // No config.json -> falls through to the managed layout.
      const empty = join(root, "empty");
      mkdirSync(empty, { recursive: true });
      process.chdir(empty);
      assert.ok(serverCandidates().includes(expected));
    });
  });

  it("does not crash on a malformed config.json", () => {
    sandbox((root, home) => {
      mkdirSync(join(home, ".paseo"), { recursive: true });
      writeFileSync(join(home, ".paseo", "config.json"), "{ not json");
      const empty = join(root, "empty");
      mkdirSync(empty, { recursive: true });
      process.chdir(empty);
      // Must not throw a parse error; either resolves a real bundle or fails
      // with the documented locator message.
      const outcome = (() => {
        try {
          return serverPath();
        } catch (error) {
          return `ERROR: ${(error as Error).message}`;
        }
      })();
      if (outcome.startsWith("ERROR:")) {
        assert.match(outcome, /could not locate bundled mcp server/);
        assert.match(outcome, /PASEO_X_COMMS_MCP_SERVER/);
      }
    });
  });

  it("never resolves a path inside an unrelated empty directory", () => {
    sandbox((root, home) => {
      mkdirSync(join(home, ".paseo"), { recursive: true });
      writeConfig(home, {});
      const empty = join(root, "empty");
      mkdirSync(empty, { recursive: true });
      process.chdir(empty);
      const resolved = (() => {
        try {
          return serverPath();
        } catch {
          return null;
        }
      })();
      if (resolved !== null) {
        assert.equal(resolved.startsWith(empty + sep), false);
        assert.ok(serverCandidates().includes(resolved));
      }
    });
  });
});
