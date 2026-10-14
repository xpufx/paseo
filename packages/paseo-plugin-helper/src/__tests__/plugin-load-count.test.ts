import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  bumpPluginLoadCount,
  getPluginLoadCount,
  isPluginReloaded,
} from "../core/plugin-load-count.js";

// ---------------------------------------------------------------------------
// Helpers -------------------------------------------------------------------
// ---------------------------------------------------------------------------

/** Reset the global load-count store so tests are isolated. */
function resetStore() {
  // Clear every key that our tests may have written.
  const keys = Object.keys(globalThis.__PASEO_PLUGIN_LOAD_COUNT__ || {});
  for (const k of keys) {
    delete (globalThis as any).__PASEO_PLUGIN_LOAD_COUNT__[k];
  }
}

afterEach(() => {
  resetStore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests ---------------------------------------------------------------------
// ---------------------------------------------------------------------------

describe("bumpPluginLoadCount", () => {
  it("returns 1 on first call for a new plugin", () => {
    expect(bumpPluginLoadCount("test-plugin")).toBe(1);
  });

  it("increments across evaluations", () => {
    bumpPluginLoadCount("test-plugin");
    expect(getPluginLoadCount("test-plugin")).toBe(1);

    bumpPluginLoadCount("test-plugin");
    expect(getPluginLoadCount("test-plugin")).toBe(2);

    bumpPluginLoadCount("test-plugin");
    expect(getPluginLoadCount("test-plugin")).toBe(3);
  });

  it("tracks multiple plugins independently", () => {
    bumpPluginLoadCount("plugin-a");
    bumpPluginLoadCount("plugin-b");
    bumpPluginLoadCount("plugin-a");

    expect(getPluginLoadCount("plugin-a")).toBe(2);
    expect(getPluginLoadCount("plugin-b")).toBe(1);
  });
});

describe("getPluginLoadCount", () => {
  it("returns 0 for an untracked plugin", () => {
    expect(getPluginLoadCount("nonexistent")).toBe(0);
  });

  it("returns the correct count after bumps", () => {
    bumpPluginLoadCount("x");
    expect(getPluginLoadCount("x")).toBe(1);
    bumpPluginLoadCount("x");
    expect(getPluginLoadCount("x")).toBe(2);
  });
});

describe("isPluginReloaded", () => {
  it("returns false on initial load (count === 1)", () => {
    bumpPluginLoadCount("fresh");
    expect(isPluginReloaded("fresh")).toBe(false);
  });

  it("returns true when reloaded (count > 1)", () => {
    bumpPluginLoadCount("reloaded");
    bumpPluginLoadCount("reloaded");
    expect(isPluginReloaded("reloaded")).toBe(true);
  });

  it("returns false for an untracked plugin", () => {
    expect(isPluginReloaded("never-seen")).toBe(false);
  });
});
