import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import {
  CopyButton,
  resolveCopyButtonFeedback,
} from "../client/components/CopyButton.js";

const colors: any = {
  surface0: "#18181b",
  surface1: "#27272a",
  surface2: "#3f3f46",
  border: "#3f3f46",
  foreground: "#fafafa",
  foregroundMuted: "#a1a1aa",
  accent: "#3b82f6",
  accentForeground: "#ffffff",
  statusSuccess: "#22c55e",
  statusWarning: "#eab308",
  statusDanger: "#ef4444",
};

const copyText = vi.fn(async () => {});
const toastShow = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  copyText.mockClear();
  copyText.mockResolvedValue(undefined);
  toastShow.mockClear();
  initClientHelpers({
    Icon: (props: any) => React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({ show: toastShow }),
    copyText,
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors,
    fonts: {} as any,
    layout: { compact: false, platform: "web" } as any,
    flair: {},
    isCompact: false,
    isMobile: false,
    touchTargetMin: 36,
    alpha: (c: string, o: number) => `${c}:${o}`,
    resolveRadius: () => 6,
  } as any);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(el: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function textOf(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text as any)
    .map((node) => node.props.children)
    .flat()
    .join("");
}

describe("resolveCopyButtonFeedback", () => {
  it("defaults to the Copy / Copy idle state", () => {
    expect(resolveCopyButtonFeedback(false)).toEqual({ icon: "Copy", label: "Copy" });
  });

  it("flips to Check / Copied! once copied", () => {
    expect(resolveCopyButtonFeedback(true)).toEqual({ icon: "Check", label: "Copied!" });
  });

  it("honours caller icon and label overrides but keeps the copied affordance", () => {
    expect(
      resolveCopyButtonFeedback(false, { icon: "Clipboard", label: "Duplicate" }),
    ).toEqual({ icon: "Clipboard", label: "Duplicate" });
    expect(
      resolveCopyButtonFeedback(true, {
        icon: "Clipboard",
        label: "Duplicate",
        copiedLabel: "Saved!",
      }),
    ).toEqual({ icon: "Check", label: "Saved!" });
  });
});

describe("CopyButton", () => {
  it("copies the literal text and shows Check / Copied! feedback", async () => {
    const renderer = render(React.createElement(CopyButton, { text: "hello" }));
    expect(textOf(renderer)).toBe("Copy");

    const button = renderer.root.findByType("Pressable" as any);
    await act(async () => {
      await button.props.onPress();
    });

    expect(copyText).toHaveBeenCalledWith("hello");
    expect(textOf(renderer)).toBe("Copied!");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(textOf(renderer)).toBe("Copy");
  });

  it("resolves getText lazily at press time and prefers it over text", async () => {
    const getText = vi.fn(() => "lazy-value");
    const renderer = render(
      React.createElement(CopyButton, { text: "ignored", getText }),
    );

    const button = renderer.root.findByType("Pressable" as any);
    await act(async () => {
      await button.props.onPress();
    });

    expect(getText).toHaveBeenCalledOnce();
    expect(copyText).toHaveBeenCalledWith("lazy-value");
  });

  it("awaits a promise-returning getText", async () => {
    const getText = vi.fn(async () => "async-value");
    const renderer = render(React.createElement(CopyButton, { getText }));

    const button = renderer.root.findByType("Pressable" as any);
    await act(async () => {
      await button.props.onPress();
    });

    expect(copyText).toHaveBeenCalledWith("async-value");
    expect(textOf(renderer)).toBe("Copied!");
  });

  it("renders nothing when no copy source is provided", () => {
    const renderer = render(React.createElement(CopyButton, {}));
    expect(renderer.toJSON()).toBeNull();
  });

  it("exposes an accessible button and forwards the toast message", async () => {
    const renderer = render(
      React.createElement(CopyButton, {
        text: "payload",
        accessibilityLabel: "Copy timeline card",
        toastMessage: "timeline card",
      }),
    );

    const button = renderer.root.findByType("Pressable" as any);
    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Copy timeline card");

    await act(async () => {
      await button.props.onPress();
    });

    expect(toastShow).toHaveBeenCalledWith(
      "Copied timeline card to clipboard",
      { variant: "success" },
    );
  });

  it("stays disabled without copying when disabled", async () => {
    const renderer = render(
      React.createElement(CopyButton, { text: "nope", disabled: true }),
    );
    const button = renderer.root.findByType("Pressable" as any);
    expect(button.props.disabled).toBe(true);

    await act(async () => {
      await button.props.onPress();
    });
    expect(copyText).not.toHaveBeenCalled();
  });
});
