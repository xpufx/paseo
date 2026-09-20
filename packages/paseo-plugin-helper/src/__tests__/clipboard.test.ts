import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clipboardTierOrder,
  copyToClipboard,
  type ClipboardEnvironment,
} from "../client/utils/clipboard.js";
import { initClientHelpers } from "../client/host.js";

const fourFieldHost = {
  Icon: (() => null) as any,
  Modal: Object.assign(() => null, { Content: () => null }) as any,
  useRpc: (() => async () => ({})) as any,
  useToast: (() => ({})) as any,
};

const baseEnv: ClipboardEnvironment = {
  hasNavigatorClipboard: false,
  hasHostCopyText: false,
  hasRnClipboard: false,
  hasRnSetStringAsync: false,
  isDom: true,
};

function defineNavigatorClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText } },
    configurable: true,
    writable: true,
  });
}

describe("clipboardTierOrder", () => {
  it("prefers the rejecting navigator API over the host callback", () => {
    expect(
      clipboardTierOrder({ ...baseEnv, hasNavigatorClipboard: true, hasHostCopyText: true }),
    ).toEqual(["navigator", "host", "execCommand"]);
  });

  it("uses the host callback when navigator clipboard is unavailable", () => {
    expect(clipboardTierOrder({ ...baseEnv, hasHostCopyText: true })).toEqual([
      "host",
      "execCommand",
    ]);
  });

  it("skips the silent RN-web setString on DOM, but keeps the checked execCommand fallback", () => {
    const order = clipboardTierOrder({ ...baseEnv, hasRnClipboard: true, isDom: true });
    expect(order).not.toContain("rnSync");
    expect(order).toEqual(["execCommand"]);
  });

  it("uses the native RN setString off-DOM", () => {
    expect(
      clipboardTierOrder({ ...baseEnv, hasRnClipboard: true, hasRnSetStringAsync: false, isDom: false }),
    ).toEqual(["rnSync", "execCommand"]);
  });

  it("prefers the checked RN async API over the sync one", () => {
    expect(
      clipboardTierOrder({ ...baseEnv, hasRnClipboard: true, hasRnSetStringAsync: true, isDom: false }),
    ).toEqual(["rnAsync", "execCommand"]);
  });

  it("skips BOTH RN paths on a DOM even when setStringAsync exists (unverifiable execCommand)", () => {
    const order = clipboardTierOrder({
      ...baseEnv,
      hasRnClipboard: true,
      hasRnSetStringAsync: true,
      isDom: true,
    });
    expect(order).not.toContain("rnAsync");
    expect(order).not.toContain("rnSync");
    expect(order).toEqual(["execCommand"]);
  });

  it("always ends with the execCommand fallback", () => {
    expect(clipboardTierOrder(baseEnv)).toEqual(["execCommand"]);
  });
});

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    initClientHelpers({ ...fourFieldHost });
  });

  afterEach(() => {
    delete (globalThis as any).navigator;
    delete (globalThis as any).document;
  });

  it("returns false for null or undefined input", async () => {
    expect(await copyToClipboard(null as any)).toBe(false);
    expect(await copyToClipboard(undefined as any)).toBe(false);
  });

  it("copies the passed string via navigator.clipboard", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    defineNavigatorClipboard(writeTextMock);

    const toastShow = vi.fn();
    const result = await copyToClipboard("hello-world", {
      toast: { show: toastShow } as any,
      toastMessage: "Greeting",
    });

    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("hello-world");
    expect(toastShow).toHaveBeenCalledWith("Copied Greeting to clipboard", { variant: "success" });
  });

  it("supports Paseo toast.copied callback", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    defineNavigatorClipboard(writeTextMock);

    const toastCopied = vi.fn();
    const result = await copyToClipboard("123", {
      toast: { copied: toastCopied } as any,
      toastMessage: "Host",
    });

    expect(result).toBe(true);
    expect(toastCopied).toHaveBeenCalledWith("Host");
  });

  it("prefers navigator.clipboard over host copyText when both are supplied", async () => {
    const hostCopy = vi.fn().mockResolvedValue(undefined);
    initClientHelpers({ ...fourFieldHost, copyText: hostCopy });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    defineNavigatorClipboard(writeTextMock);

    const result = await copyToClipboard("nav-first");
    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("nav-first");
    expect(hostCopy).not.toHaveBeenCalled();
  });

  it("falls through to host copyText when navigator.clipboard rejects", async () => {
    const hostCopy = vi.fn().mockResolvedValue(undefined);
    initClientHelpers({ ...fourFieldHost, copyText: hostCopy });
    const writeTextMock = vi.fn().mockRejectedValue(new Error("denied"));
    defineNavigatorClipboard(writeTextMock);

    const result = await copyToClipboard("fallback-next");
    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("fallback-next");
    expect(hostCopy).toHaveBeenCalledWith("fallback-next");
  });

  it("copies the passed string through execCommand when the async APIs are unavailable", async () => {
    initClientHelpers({ ...fourFieldHost });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({ style: {}, focus: () => {}, select: () => {} }),
        body: { appendChild: () => {}, removeChild: () => {} },
        execCommand,
      },
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard("plain-init");
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure (never a silent success) when every tier fails", async () => {
    initClientHelpers({ ...fourFieldHost });
    const hostCopy = vi.fn().mockRejectedValue(new Error("denied"));
    initClientHelpers({ ...fourFieldHost, copyText: hostCopy });
    const writeTextMock = vi.fn().mockRejectedValue(new Error("denied"));
    defineNavigatorClipboard(writeTextMock);
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({ style: {}, focus: () => {}, select: () => {} }),
        body: { appendChild: () => {}, removeChild: () => {} },
        execCommand: () => false,
      },
      configurable: true,
      writable: true,
    });

    expect(await copyToClipboard("stale-would-remain")).toBe(false);
  });

  it("uses the checked execCommand on a DOM even when a fake RN-web setStringAsync exists", async () => {
    initClientHelpers({ ...fourFieldHost });
    // A web bundle that exposes a setStringAsync whose fallback is an
    // unverifiable execCommand (expo-clipboard on web) must NOT fake success:
    // the digest still has to reach the checked execCommand path.
    const rn = { Clipboard: { setStringAsync: vi.fn().mockResolvedValue(true) } };
    vi.mock("react-native", () => rn);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(globalThis, "document", {
      value: {
        createElement: () => ({ style: {}, focus: () => {}, select: () => {} }),
        body: { appendChild: () => {}, removeChild: () => {} },
        execCommand,
      },
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard("digest-not-fake");
    expect(result).toBe(true);
    expect(rn.Clipboard.setStringAsync).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
  });
});
