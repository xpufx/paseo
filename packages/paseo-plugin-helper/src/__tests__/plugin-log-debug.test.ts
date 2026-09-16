import { describe, expect, it, vi, afterEach } from "vitest";
import {
  createPluginLogger,
  isDevelopmentEnv,
  isProductionEnv,
  resolveDefaultMinLevel,
  resolveMinLevelFromEnv,
} from "../server/logger.js";
import { reportSuppressed } from "../shared/suppressed.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveMinLevelFromEnv", () => {
  it("prefers PASEO_PLUGIN_LOG_LEVEL", () => {
    expect(resolveMinLevelFromEnv({ PASEO_PLUGIN_LOG_LEVEL: "debug" } as never)).toBe("debug");
  });

  it("maps PASEO_DEBUG=1 to debug", () => {
    expect(resolveMinLevelFromEnv({ PASEO_DEBUG: "1" } as never)).toBe("debug");
  });

  it("returns undefined when unset", () => {
    expect(resolveMinLevelFromEnv({} as never)).toBeUndefined();
  });

  it("ignores invalid levels", () => {
    expect(resolveMinLevelFromEnv({ PASEO_PLUGIN_LOG_LEVEL: "verbose" } as never)).toBeUndefined();
  });
});

describe("resolveDefaultMinLevel", () => {
  it("defaults to info when no env is set", () => {
    expect(resolveDefaultMinLevel({} as never)).toBe("info");
  });

  it("enables debug with PASEO_DEBUG=1", () => {
    expect(resolveDefaultMinLevel({ PASEO_DEBUG: "1" } as never)).toBe("debug");
  });

  it("stays quiet (info) in production", () => {
    expect(resolveDefaultMinLevel({ NODE_ENV: "production" } as never)).toBe("info");
  });

  it("enables debug when NODE_ENV is explicitly development", () => {
    expect(resolveDefaultMinLevel({ NODE_ENV: "development" } as never)).toBe("debug");
  });

  it("lets explicit env win in both modes", () => {
    expect(
      resolveDefaultMinLevel({ NODE_ENV: "development", PASEO_LOG_LEVEL: "error" } as never),
    ).toBe("error");
    expect(
      resolveDefaultMinLevel({ NODE_ENV: "production", PASEO_LOG_LEVEL: "debug" } as never),
    ).toBe("debug");
    expect(
      resolveDefaultMinLevel({ PASEO_PLUGIN_LOG_LEVEL: "error" } as never),
    ).toBe("error");
  });

  it("isDevelopmentEnv only treats explicit dev values as development", () => {
    expect(isDevelopmentEnv({} as never)).toBe(false);
    expect(isDevelopmentEnv({ NODE_ENV: "production" } as never)).toBe(false);
    expect(isDevelopmentEnv({ NODE_ENV: "test" } as never)).toBe(false);
    expect(isDevelopmentEnv({ NODE_ENV: "development" } as never)).toBe(true);
    expect(isDevelopmentEnv({ NODE_ENV: "dev" } as never)).toBe(true);
  });

  it("isProductionEnv only treats production as production", () => {
    expect(isProductionEnv({} as never)).toBe(false);
    expect(isProductionEnv({ NODE_ENV: "development" } as never)).toBe(false);
    expect(isProductionEnv({ NODE_ENV: "production" } as never)).toBe(true);
  });
});

describe("createPluginLogger", () => {
  it("emits debug when env enables it", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createPluginLogger("test-plugin", {
      banner: false,
      version: "0.0.0-test",
      minLevel: resolveMinLevelFromEnv({ PASEO_DEBUG: "1" } as never) ?? "info",
    });
    logger.debug("hello");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG] hello"));
  });

  it("suppresses debug at explicit info level (production default)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createPluginLogger("test-plugin", {
      banner: false,
      version: "0.0.0-test",
      minLevel: resolveDefaultMinLevel({ NODE_ENV: "production" } as never),
    });
    logger.debug("hidden");
    expect(spy).not.toHaveBeenCalled();
  });

  it("suppresses debug by default with no env set (shipped default)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createPluginLogger("test-plugin", {
      banner: false,
      version: "0.0.0-test",
      minLevel: resolveDefaultMinLevel({} as never),
    });
    logger.debug("hidden-by-default");
    expect(spy).not.toHaveBeenCalled();
  });

  it("emits debug when NODE_ENV is explicitly development", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createPluginLogger("test-plugin", {
      banner: false,
      version: "0.0.0-test",
      minLevel: resolveDefaultMinLevel({ NODE_ENV: "development" } as never),
    });
    logger.debug("visible-dev");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG] visible-dev"));
  });

  it("suppressed() routes caught errors to debug", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createPluginLogger("test-plugin", {
      banner: false,
      version: "0.0.0-test",
      minLevel: "debug",
    });
    logger.suppressed("poll failed", new Error("boom"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("poll failed: boom"));
  });
});

describe("reportSuppressed", () => {
  it("forwards to sink debug without throwing", () => {
    const debug = vi.fn();
    expect(() => reportSuppressed({ debug }, "ctx", new Error("x"))).not.toThrow();
    expect(debug).toHaveBeenCalledWith("ctx: x", expect.any(Error));
  });

  it("tolerates undefined sink", () => {
    expect(() => reportSuppressed(undefined, "ctx", new Error("x"))).not.toThrow();
  });
});
