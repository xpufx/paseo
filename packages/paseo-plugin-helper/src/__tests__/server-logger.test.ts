import { describe, it, expect, vi } from "vitest";
import { createPluginLogger } from "../server/logger.js";

describe("createPluginLogger", () => {
  it("emits startup banner with name and version by default", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    createPluginLogger("my-plugin", { version: "1.2.0" });

    expect(spy).toHaveBeenCalled();
    const bannerLine = spy.mock.calls[0][0];
    expect(bannerLine).toContain("[my-plugin v1.2.0]");
    expect(bannerLine).toContain("Initializing plugin");
    expect(bannerLine).toContain("pid");

    spy.mockRestore();
  });

  it("can disable startup banner", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    createPluginLogger("my-plugin", { banner: false });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("formats key-value data cleanly on a single line and redacts secrets", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = createPluginLogger("top", { version: "0.1.0", banner: false });
    logger.info("Poll metrics", {
      cpu: 14.2,
      apiKey: "sk-secret-token-12345",
    });

    expect(spy).toHaveBeenCalled();
    const logLine = spy.mock.calls[0][0];
    expect(logLine).toContain("[top v0.1.0] [INFO] Poll metrics");
    expect(logLine).toContain("cpu=14.2");
    // Secret should be redacted
    expect(logLine).not.toContain("sk-secret-token-12345");
    expect(logLine).toContain("sk-...345");

    spy.mockRestore();
  });

  it("sends errors to stderr and respects minLevel", () => {
    const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const spyErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const logger = createPluginLogger("top", { banner: false, minLevel: "warn" });

    logger.debug("debug message"); // suppressed
    logger.info("info message");   // suppressed
    logger.warn("warning message"); // emitted
    logger.error("error message");  // emitted

    expect(spyLog).not.toHaveBeenCalled();
    expect(spyErr).toHaveBeenCalledTimes(2);

    spyLog.mockRestore();
    spyErr.mockRestore();
  });

  it("supports child loggers with subsystems", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const logger = createPluginLogger("top", { version: "0.1.0", banner: false });
    const pollerLog = logger.child("poller");

    pollerLog.info("Tick");

    expect(spy).toHaveBeenCalled();
    const logLine = spy.mock.calls[0][0];
    expect(logLine).toContain("[top v0.1.0:poller] [INFO] Tick");

    spy.mockRestore();
  });
});
