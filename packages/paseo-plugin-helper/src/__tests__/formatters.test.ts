import { describe, it, expect } from "vitest";
import {
  formatBytes,
  formatUptime,
  formatDuration,
  formatNumber,
  truncate,
  stripAnsi,
  resolveMetricStatus,
} from "../shared/formatters.js";

describe("Shared Formatters", () => {
  it("formats bytes correctly across units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500.0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 4.5)).toBe("4.5 MB");
    expect(formatBytes(1024 * 1024 * 1024 * 2.25)).toBe("2.3 GB");
  });

  it("supports compact byte formatting without spaces", () => {
    expect(formatBytes(1024, { compact: true })).toBe("1.0K");
    expect(formatBytes(1024 * 1024 * 5.3, { compact: true })).toBe("5.3M");
    expect(formatBytes(1024 * 1024 * 1024 * 12.8, { compact: true })).toBe("12.8G");
  });

  it("resolves metric status with standard and inverted thresholds", () => {
    // Standard: >= 90 danger, >= 75 warning
    expect(resolveMetricStatus(50)).toBe("success");
    expect(resolveMetricStatus(75)).toBe("warning");
    expect(resolveMetricStatus(92)).toBe("danger");

    // Custom thresholds
    expect(resolveMetricStatus(65, { warning: 60, danger: 80 })).toBe("warning");

    // Inverted (lower is worse, e.g. free disk / battery)
    expect(resolveMetricStatus(95, { invert: true, warning: 20, danger: 10 })).toBe("success");
    expect(resolveMetricStatus(18, { invert: true, warning: 20, danger: 10 })).toBe("warning");
    expect(resolveMetricStatus(5, { invert: true, warning: 20, danger: 10 })).toBe("danger");
  });

  it("formats uptime duration into readable text", () => {
    expect(formatUptime(0)).toBe("0m");
    expect(formatUptime(45)).toBe("45s");
    expect(formatUptime(150)).toBe("2m");
    expect(formatUptime(3665)).toBe("1h 1m");
    expect(formatUptime(86400 * 3 + 3600 * 4 + 60 * 12)).toBe("3d 4h 12m");
  });

  it("formats duration in milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(150)).toBe("150ms");
    expect(formatDuration(1200)).toBe("1.2s");
    expect(formatDuration(65000)).toBe("1m");
  });

  it("formats numbers with comma separators", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });

  it("truncates long strings with ellipsis", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("", 5)).toBe("");
  });

  it("strips ANSI escape codes from terminal strings", () => {
    expect(stripAnsi("\u001b[32mOK\u001b[0m")).toBe("OK");
    expect(stripAnsi("\u001b[1m\u001b[31mError:\u001b[0m failed")).toBe("Error: failed");
    expect(stripAnsi("clean text")).toBe("clean text");
    expect(stripAnsi("")).toBe("");
  });
});
