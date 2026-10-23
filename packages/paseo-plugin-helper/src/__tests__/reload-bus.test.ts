import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notifyPluginReload,
  enqueuePluginReload,
  flushReloadBusNow,
  resetReloadBus,
  formatReloadMessage,
  deliverReloadToast,
  getPendingReloadPlugins,
  getLastReloadToastTime,
  DEFAULT_RELOAD_DEBOUNCE_MS,
  DEFAULT_RELOAD_QUENCH_MS,
} from "../core/reload-bus.js";
import { initClientHelpers } from "../core/host.js";

describe("Global Reload Bus & Storm Debouncing (#1343)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetReloadBus();
    // Reset global plugin load count
    const countStore = (globalThis as any).__PASEO_PLUGIN_LOAD_COUNT__;
    if (countStore) {
      for (const k of Object.keys(countStore)) {
        delete countStore[k];
      }
    }
    // Reset host
    delete (globalThis as any).__PASEO_HOST__;
  });

  afterEach(() => {
    resetReloadBus();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("formatReloadMessage", () => {
    it("formats message for zero plugins", () => {
      expect(formatReloadMessage([])).toBe(
        "⚡ Plugin reloaded on daemon. Press Ctrl+R to refresh open views.",
      );
    });

    it("formats message for single plugin", () => {
      expect(formatReloadMessage(["top"])).toBe(
        "⚡ Plugin top reloaded on daemon. Press Ctrl+R to refresh open views.",
      );
    });

    it("formats message for 2-3 coalesced plugins", () => {
      expect(formatReloadMessage(["top", "slash"])).toBe(
        "⚡ 2 plugins reloaded (top, slash). Press Ctrl+R to refresh.",
      );
      expect(formatReloadMessage(["top", "slash", "fleet"])).toBe(
        "⚡ 3 plugins reloaded (top, slash, fleet). Press Ctrl+R to refresh.",
      );
    });

    it("formats message for >3 plugins with ellipsis", () => {
      expect(formatReloadMessage(["top", "slash", "fleet", "twofado"])).toBe(
        "⚡ 4 plugins reloaded (top, slash, fleet...). Press Ctrl+R to refresh.",
      );
    });
  });

  describe("deliverReloadToast", () => {
    it("delivers to globalThis.__PASEO_HOST__.toast.show", () => {
      const show = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show } };

      const delivered = deliverReloadToast("Hello world");
      expect(delivered).toBe(true);
      expect(show).toHaveBeenCalledTimes(1);
      expect(show).toHaveBeenCalledWith(
        "Hello world",
        expect.objectContaining({
          duration: 10000,
          action: expect.objectContaining({
            label: "Reload Now",
            onClick: expect.any(Function),
          }),
        }),
      );
    });

    it("delivers to getOptionalClientHost()?.useToast()", () => {
      const toastShow = vi.fn();
      initClientHelpers({
        Icon: {} as any,
        Modal: {} as any,
        useRpc: (() => async () => ({})) as any,
        useToast: () => ({ show: toastShow }),
      });

      const delivered = deliverReloadToast("Test message via host");
      expect(delivered).toBe(true);
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow).toHaveBeenCalledWith(
        "Test message via host",
        expect.objectContaining({ duration: 10000 }),
      );
    });

    it("executes window.location.reload when action onClick is invoked", () => {
      const show = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show } };

      const originalWindow = (globalThis as any).window;
      const reloadMock = vi.fn();
      (globalThis as any).window = { location: { reload: reloadMock } };

      try {
        deliverReloadToast("Reloading");
        const action = show.mock.calls[0][1]?.action;
        expect(action).toBeDefined();
        action.onClick();
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });
  });

  describe("notifyPluginReload lifecycle & debouncing", () => {
    it("does not trigger toast on initial evaluation (loadCount === 1)", () => {
      const toastShow = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show: toastShow } };

      const queued = notifyPluginReload("top");
      expect(queued).toBe(false);
      expect(getPendingReloadPlugins()).toEqual([]);

      vi.advanceTimersByTime(DEFAULT_RELOAD_DEBOUNCE_MS + 100);
      expect(toastShow).not.toHaveBeenCalled();
    });

    it("triggers single-plugin toast on re-evaluation (loadCount === 2)", () => {
      const toastShow = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show: toastShow } };

      // Initial load
      expect(notifyPluginReload("top")).toBe(false);

      // Re-evaluation (reload)
      expect(notifyPluginReload("top")).toBe(true);
      expect(getPendingReloadPlugins()).toEqual(["top"]);

      // Not fired yet before debounce
      expect(toastShow).not.toHaveBeenCalled();

      // Advance debounce window (500ms)
      vi.advanceTimersByTime(DEFAULT_RELOAD_DEBOUNCE_MS);
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow).toHaveBeenCalledWith(
        "⚡ Plugin top reloaded on daemon. Press Ctrl+R to refresh open views.",
        expect.anything(),
      );
      expect(getPendingReloadPlugins()).toEqual([]);
    });

    it("supports options.force to queue without initial evaluation", () => {
      const toastShow = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show: toastShow } };

      expect(notifyPluginReload("forced-plugin", { force: true })).toBe(true);
      vi.advanceTimersByTime(DEFAULT_RELOAD_DEBOUNCE_MS);

      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow).toHaveBeenCalledWith(
        "⚡ Plugin forced-plugin reloaded on daemon. Press Ctrl+R to refresh open views.",
        expect.anything(),
      );
    });

    it("coalesces multi-plugin concurrent burst into a single toast", () => {
      const toastShow = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show: toastShow } };

      // Simulate reloads of 3 plugins firing within 100ms of each other
      enqueuePluginReload("top");
      vi.advanceTimersByTime(50);
      enqueuePluginReload("slash");
      vi.advanceTimersByTime(50);
      enqueuePluginReload("uppidi-fleet");

      expect(getPendingReloadPlugins()).toEqual(["top", "slash", "uppidi-fleet"]);
      expect(toastShow).not.toHaveBeenCalled();

      // Advance past debounce window from the last enqueue
      vi.advanceTimersByTime(DEFAULT_RELOAD_DEBOUNCE_MS);

      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow).toHaveBeenCalledWith(
        "⚡ 3 plugins reloaded (top, slash, uppidi-fleet). Press Ctrl+R to refresh.",
        expect.anything(),
      );
      expect(getPendingReloadPlugins()).toEqual([]);
    });

    it("quenches toast flood within the 5-second cooldown window", () => {
      const toastShow = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show: toastShow } };

      // Burst 1: At T=0
      enqueuePluginReload("top");
      vi.advanceTimersByTime(DEFAULT_RELOAD_DEBOUNCE_MS); // T=500ms
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(getLastReloadToastTime()).toBe(500);

      // Burst 2: At T=1500ms (1000ms after burst 1 toast, inside 5000ms quench window)
      vi.advanceTimersByTime(1000); // T=1500ms
      enqueuePluginReload("slash");
      vi.advanceTimersByTime(DEFAULT_RELOAD_DEBOUNCE_MS); // T=2000ms

      // Should be quenched! No additional toast delivered
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(getPendingReloadPlugins()).toEqual([]);

      // Burst 3: At T=6000ms (5500ms after burst 1 toast, after quench window has expired)
      vi.advanceTimersByTime(4000); // T=6000ms
      enqueuePluginReload("uppidi-fleet");
      vi.advanceTimersByTime(DEFAULT_RELOAD_DEBOUNCE_MS); // T=6500ms

      // Quench window passed: second toast is delivered!
      expect(toastShow).toHaveBeenCalledTimes(2);
      expect(toastShow).toHaveBeenLastCalledWith(
        "⚡ Plugin uppidi-fleet reloaded on daemon. Press Ctrl+R to refresh open views.",
        expect.anything(),
      );
    });

    it("flushReloadBusNow delivers pending items immediately", () => {
      const toastShow = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show: toastShow } };

      enqueuePluginReload("instant-1");
      enqueuePluginReload("instant-2");
      expect(toastShow).not.toHaveBeenCalled();

      const flushed = flushReloadBusNow();
      expect(flushed).toBe(true);
      expect(toastShow).toHaveBeenCalledTimes(1);
      expect(toastShow).toHaveBeenCalledWith(
        "⚡ 2 plugins reloaded (instant-1, instant-2). Press Ctrl+R to refresh.",
        expect.anything(),
      );
    });

    it("resetReloadBus clears timers and pending items", () => {
      const toastShow = vi.fn();
      (globalThis as any).__PASEO_HOST__ = { toast: { show: toastShow } };

      enqueuePluginReload("cancelled-plugin");
      expect(getPendingReloadPlugins()).toEqual(["cancelled-plugin"]);

      resetReloadBus();
      expect(getPendingReloadPlugins()).toEqual([]);

      vi.advanceTimersByTime(DEFAULT_RELOAD_DEBOUNCE_MS * 2);
      expect(toastShow).not.toHaveBeenCalled();
    });
  });
});
