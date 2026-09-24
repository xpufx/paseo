import { describe, expect, it } from "vitest";
import {
  daemonInstall,
  daemonLogs,
  daemonRestart,
  daemonStart,
  daemonStatus,
  daemonStop,
} from "./companion";

describe("companion daemon contracts", () => {
  it("parses a supervisor-managed online status", () => {
    const parsed = daemonStatus.output.parse({
      state: "online",
      managed: "supervisor",
      pid: 4242,
      socketPath: "/tmp/2fado.sock",
      version: "0.1.0-dev",
      uptimeSeconds: 12,
    });
    expect(parsed.state).toBe("online");
    expect(parsed.managed).toBe("supervisor");
    expect(parsed.pid).toBe(4242);
  });

  it("accepts a nullable pid/uptime from an adopted external daemon", () => {
    const parsed = daemonStatus.output.parse({
      state: "online",
      managed: "external",
      pid: null,
      socketPath: "/tmp/2fado.sock",
      uptimeSeconds: null,
    });
    expect(parsed.managed).toBe("external");
    expect(parsed.pid).toBeNull();
  });

  it("requires a state and managed value for status", () => {
    expect(() => daemonStatus.output.parse({ socketPath: "/tmp/x" })).toThrow();
  });

  it("accepts a start failure with an error string", () => {
    const parsed = daemonStart.output.parse({
      success: false,
      socketPath: "/tmp/2fado.sock",
      error: "Daemon failed to bind socket",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("bind socket");
  });

  it("defaults a start success without optional fields", () => {
    const parsed = daemonStart.output.parse({ success: true, socketPath: "/tmp/2fado.sock" });
    expect(parsed.success).toBe(true);
    expect(parsed.pid).toBeUndefined();
  });

  it("maps stop/restart/logs/install outputs", () => {
    expect(daemonStop.output.parse({ stopped: true, alreadyStopped: true }).alreadyStopped).toBe(true);
    expect(
      daemonRestart.output.parse({ success: true, socketPath: "/tmp/2fado.sock", pid: 7 }).pid,
    ).toBe(7);
    const logs = daemonLogs.output.parse({
      entries: [{ timestamp: "2026-01-01T00:00:00.000Z", stream: "stdout", message: "ready" }],
    });
    expect(logs.entries[0].message).toBe("ready");
    expect(daemonInstall.output.parse({ success: true, binPath: "/x/bin/2fado", status: "installed" }).status).toBe(
      "installed",
    );
  });

  it("rejects a logs limit above the ring buffer cap", () => {
    expect(() => daemonLogs.input.parse({ limit: 200 })).toThrow();
    expect(daemonLogs.input.parse({ limit: 150 }).limit).toBe(150);
  });
});
