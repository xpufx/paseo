import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskLogger, defaultScopedLogDir } from "./disk-logger.js";

describe("DiskLogger (#1115)", () => {
  let tempDir: string;
  let logDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-disk-logger-test-"));
    logDir = join(tempDir, "logs");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("resolves default scoped log directory in test mode", () => {
    const dir = defaultScopedLogDir("uppidi-fleet");
    assert.ok(dir.includes("logs"));
    assert.ok(dir.includes("uppidi-fleet"));
    assert.ok(!dir.includes(".paseo/logs"), "must never write to ~/.paseo/logs");
  });

  it("uses PluginStorage's namespace path for the default log file", () => {
    const logger = new DiskLogger({ storageBaseDir: tempDir });
    assert.equal(logger.logFilePath, join(tempDir, "uppidi-fleet", "logs", "hook.log"));
  });

  it("writes formatted log lines with timestamp and newline", () => {
    const logger = new DiskLogger({ logDir, fileName: "hook.log" });
    logger.log("[info] test entry 1");
    logger.log("[warn] test entry 2");

    const filePath = join(logDir, "hook.log");
    assert.ok(existsSync(filePath));

    const content = readFileSync(filePath, "utf8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^\[\d{4}-\d{2}-\d{2}T.*\] \[info\] test entry 1$/);
    assert.match(lines[1], /^\[\d{4}-\d{2}-\d{2}T.*\] \[warn\] test entry 2$/);
  });

  it("preserves existing timestamp prefix if already formatted", () => {
    const logger = new DiskLogger({ logDir, fileName: "hook.log" });
    const preformatted = "[2026-10-07T23:00:00.000Z] [info] existing timestamp";
    logger.log(preformatted);

    const filePath = join(logDir, "hook.log");
    const content = readFileSync(filePath, "utf8");
    assert.equal(content.trim(), preformatted);
  });

  it("rotates log files when maxBytes threshold is reached", () => {
    // maxBytes = 100 bytes, keep up to 2 rotated files (hook.log, hook.log.1, hook.log.2)
    const logger = new DiskLogger({
      logDir,
      fileName: "hook.log",
      maxBytes: 100,
      maxFiles: 2,
    });

    // Write enough data to trigger rotation multiple times
    for (let i = 1; i <= 10; i++) {
      logger.log(`[info] iteration message number ${i} with padding text to exceed size`);
    }

    const files = readdirSync(logDir).sort();
    assert.ok(files.includes("hook.log"));
    assert.ok(files.includes("hook.log.1"));
    assert.ok(files.includes("hook.log.2"));
    // hook.log.3 should not exist since maxFiles = 2
    assert.ok(!files.includes("hook.log.3"));
  });

  it("tolerates unwriteable directory without throwing", () => {
    // Give an invalid path like a file as directory
    const filePath = join(tempDir, "a-file");
    writeFileSync(filePath, "cannot create subfolder here");
    const logger = new DiskLogger({ logDir: join(filePath, "sub", "logs") });

    assert.doesNotThrow(() => {
      logger.log("should safely drop without crash");
    });
  });
});
