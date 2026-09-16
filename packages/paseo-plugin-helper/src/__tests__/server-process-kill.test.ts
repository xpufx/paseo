import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { safeExec, safeSpawn } from "../server/process.js";

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pgrep(pattern: string): string {
  try {
    // Bracket trick: the regex matches target command lines but not our own
    // pgrep invocation, which literally contains "[...]".
    const disguised = `[${pattern[0]}]${pattern.slice(1)}`;
    return execSync(`pgrep -f "${disguised}" || true`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

describe("server/process group termination", () => {
  it("safeExec timeout rejects and reaps shell plus grandchildren", async () => {
    const marker = `paseo-guard-test-sleep-${process.pid}`;
    await expect(
      safeExec(`sh -c 'sleep 60 # ${marker}'`, { timeoutMs: 100 }),
    ).rejects.toThrow(/timed out/);
    await tick(300);
    expect(pgrep(marker)).toBe("");
  });

  it("safeSpawn timeout rejects and reaps the child", async () => {
    const marker = `paseo-guard-test-spawn-${process.pid}`;
    await expect(
      safeSpawn("sh", ["-c", `sleep 60 # ${marker}`], { timeoutMs: 100 }),
    ).rejects.toThrow(/timed out/);
    await tick(300);
    expect(pgrep(marker)).toBe("");
  });

  it("fast commands still resolve normally", async () => {
    const res = await safeExec("echo hello", { timeoutMs: 5000 });
    expect(res.stdout).toBe("hello");
    expect(res.code).toBe(0);
    const spawned = await safeSpawn("echo", ["world"], { timeoutMs: 5000 });
    expect(spawned.stdout).toBe("world");
  });
});
