import { describe, expect, it, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { InlineButton } from "../client/components/InlineButton.js";

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

beforeEach(() => {
  initClientHelpers({
    Icon: (props: any) => React.createElement("mock-icon", props),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors,
    fonts: {} as any,
    layout: { compact: false, platform: "web" } as any,
    flair: {} as any,
    isCompact: false,
    isMobile: false,
    touchTargetMin: 36,
    alpha: (color: string, opacity: number) => `${color}:${opacity}`,
    resolveRadius: () => 6,
  } as any);
});

function render(element: React.ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer!;
}

describe("InlineButton", () => {
  it("renders an accessible compact action and invokes its handler", () => {
    const onPress = vi.fn();
    const renderer = render(<InlineButton label="Open issue" icon="ExternalLink" onPress={onPress} />);
    const button = renderer.root.findByType("Pressable" as any);

    expect(button.props.accessibilityRole).toBe("button");
    expect(button.props.accessibilityLabel).toBe("Open issue");
    act(() => button.props.onPress());
    expect(onPress).toHaveBeenCalledOnce();
  });

  it("preserves disabled behavior", () => {
    const onPress = vi.fn();
    const renderer = render(<InlineButton label="Copy" onPress={onPress} disabled />);
    const button = renderer.root.findByType("Pressable" as any);

    expect(button.props.disabled).toBe(true);
    const styles = button.props.style({ pressed: false }) as Array<Record<string, unknown>>;
    expect(styles.some((style) => style?.opacity === 0.45)).toBe(true);
  });
});
