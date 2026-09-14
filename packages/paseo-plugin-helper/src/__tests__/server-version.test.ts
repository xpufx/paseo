import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolvePluginVersion, stampVersion } from "../server/version.js";
import { createPluginLogger } from "../server/logger.js";

describe("resolvePluginVersion", () => {
  it("resolves version from package.json in current directory", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const version = resolvePluginVersion();
    expect(version).toContain(pkg.version);
  });

  it("falls back to default fallback when package.json is missing", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-test-ver-"));
    const version = resolvePluginVersion({ cwd: tempDir, includeGit: false, fallback: "1.0.0-fallback" });
    expect(version).toBe("1.0.0-fallback");
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("stamps version into target file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-stamp-"));
    const targetFile = path.join(tempDir, "version.ts");

    const result = stampVersion({ cwd: process.cwd(), targetFile });
    expect(result.updated).toBe(true);
    expect(result.version).toBeDefined();

    const written = fs.readFileSync(targetFile, "utf8");
    expect(written).toContain(`export const PLUGIN_VERSION = "${result.version}";`);

    // Stamping again with same content returns updated: false
    const secondResult = stampVersion({ cwd: process.cwd(), targetFile });
    expect(secondResult.updated).toBe(false);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("createPluginLogger auto-resolves version when version option is omitted", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    createPluginLogger("auto-plugin");

    expect(spy).toHaveBeenCalled();
    const bannerLine = spy.mock.calls[0][0];
    expect(bannerLine).toContain(`[auto-plugin v${pkg.version}`);

    spy.mockRestore();
  });
});
