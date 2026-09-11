import { describe, it, expect } from "vitest";
import { CpuSampler, getSystemMetrics } from "../server/system.js";

describe("Server System Metrics", () => {
  it("returns populated system metrics structure", () => {
    const metrics = getSystemMetrics();

    expect(metrics.hostname).toBeDefined();
    expect(metrics.platform).toBe(process.platform);
    expect(metrics.arch).toBe(process.arch);
    expect(metrics.uptimeSeconds).toBeGreaterThan(0);
    expect(metrics.cpu.cores).toBeGreaterThan(0);
    expect(metrics.memory.totalBytes).toBeGreaterThan(0);
    expect(metrics.memory.usedBytes).toBeGreaterThan(0);
    expect(metrics.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.memory.usedPercent).toBeLessThanOrEqual(100);
  });

  it("CpuSampler tracks deltas across calls", async () => {
    const sampler = new CpuSampler();
    // Allow minimal tick delta
    await new Promise((r) => setTimeout(r, 50));
    const sample = sampler.sample();

    expect(sample.usagePercent).toBeGreaterThanOrEqual(0);
    expect(sample.usagePercent).toBeLessThanOrEqual(100);
    expect(Array.isArray(sample.perCore)).toBe(true);
    expect(sample.perCore.length).toBeGreaterThan(0);
  });
});
