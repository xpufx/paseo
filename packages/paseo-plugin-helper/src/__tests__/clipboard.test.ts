import { describe, it, expect, vi, beforeEach } from "vitest";
import { copyToClipboard } from "../client/utils/clipboard.js";
import { initClientHelpers } from "../client/host.js";

const fourFieldHost = {
  Icon: (() => null) as any,
  Modal: Object.assign(() => null, { Content: () => null }) as any,
  useRpc: (() => async () => ({})) as any,
  useToast: (() => ({})) as any,
};

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    initClientHelpers({ ...fourFieldHost });
  });

  it("returns false for null or undefined input", async () => {
    expect(await copyToClipboard(null as any)).toBe(false);
    expect(await copyToClipboard(undefined as any)).toBe(false);
  });

  it("copies via navigator.clipboard when available", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: { writeText: writeTextMock },
      },
      configurable: true,
      writable: true,
    });

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
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: { writeText: writeTextMock },
      },
      configurable: true,
      writable: true,
    });

    const toastCopied = vi.fn();
    const result = await copyToClipboard("123", {
      toast: { copied: toastCopied } as any,
      toastMessage: "Host",
    });

    expect(result).toBe(true);
    expect(toastCopied).toHaveBeenCalledWith("Host");
  });

  it("prefers host copyText over navigator.clipboard when supplied", async () => {
    const hostCopy = vi.fn().mockResolvedValue(undefined);
    initClientHelpers({ ...fourFieldHost, copyText: hostCopy });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: { writeText: writeTextMock },
      },
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard("host-first");
    expect(result).toBe(true);
    expect(hostCopy).toHaveBeenCalledWith("host-first");
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it("falls through to navigator.clipboard when host copyText rejects", async () => {
    const hostCopy = vi.fn().mockRejectedValue(new Error("denied"));
    initClientHelpers({ ...fourFieldHost, copyText: hostCopy });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: { writeText: writeTextMock },
      },
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard("fallback-next");
    expect(result).toBe(true);
    expect(hostCopy).toHaveBeenCalledWith("fallback-next");
    expect(writeTextMock).toHaveBeenCalledWith("fallback-next");
  });

  it("keeps working with the original four-field init and no host copyText", async () => {
    initClientHelpers({ ...fourFieldHost });
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: {
        clipboard: { writeText: writeTextMock },
      },
      configurable: true,
      writable: true,
    });

    const result = await copyToClipboard("plain-init");
    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("plain-init");
  });
});
