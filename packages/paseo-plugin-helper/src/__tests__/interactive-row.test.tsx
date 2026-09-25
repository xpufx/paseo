import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { InteractiveRow } from "../client/components/InteractiveRow.js";

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
  vi.restoreAllMocks();
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

function flatStyles(style: any): any[] {
  return Array.isArray(style) ? style.flat(Infinity) : [style];
}

describe("InteractiveRow", () => {
  it("forwards the press event so callers can stop propagation", () => {
    const onPress = vi.fn();
    const renderer = render(<InteractiveRow onPress={onPress} accessibilityLabel="Open agent" />);
    const row = renderer.root.findByType("Pressable" as any);

    const stopPropagation = vi.fn();
    act(() => row.props.onPress({ stopPropagation }));
    expect(onPress).toHaveBeenCalledOnce();
    expect(onPress.mock.calls[0][0].stopPropagation).toBe(stopPropagation);
  });

  it("attaches the RN-web title tooltip and reports hover changes", () => {
    const onHoverChange = vi.fn();
    const renderer = render(
      <InteractiveRow title="Agent (idle)" onPress={() => {}} onHoverChange={onHoverChange} />,
    );
    const row = renderer.root.findByType("Pressable" as any);
    expect(row.props.title).toBe("Agent (idle)");

    act(() => row.props.onMouseEnter());
    expect(onHoverChange).toHaveBeenCalledWith(true);

    act(() => row.props.onMouseLeave());
    expect(onHoverChange).toHaveBeenCalledWith(false);
  });

  it("tints the background while hovered when hoverTint is set", () => {
    const renderer = render(<InteractiveRow hoverTint onPress={() => {}} />);
    const row = renderer.root.findByType("Pressable" as any);

    const resting = flatStyles(row.props.style);
    expect(resting.some((s: any) => s?.backgroundColor === `${colors.accent}:0.05`)).toBe(false);

    act(() => row.props.onMouseEnter());
    const hovered = flatStyles(renderer.root.findByType("Pressable" as any).props.style);
    expect(hovered.some((s: any) => s?.backgroundColor === `${colors.accent}:0.05`)).toBe(true);
  });

  it("applies pressed opacity and a pointer cursor", () => {
    const renderer = render(<InteractiveRow onPress={() => {}} pressedOpacity={0.6} />);
    const row = renderer.root.findByType("Pressable" as any);
    expect(flatStyles(row.props.style).some((s: any) => s?.cursor === "pointer")).toBe(true);

    act(() => row.props.onPressIn());
    const pressed = flatStyles(renderer.root.findByType("Pressable" as any).props.style);
    expect(pressed.some((s: any) => s?.opacity === 0.6)).toBe(true);

    act(() => renderer.root.findByType("Pressable" as any).props.onPressOut());
    const released = flatStyles(renderer.root.findByType("Pressable" as any).props.style);
    expect(released.some((s: any) => s?.opacity === 1)).toBe(true);
  });

  it("honors disabled: muted opacity, no hover state, no pointer cursor", () => {
    const onHoverChange = vi.fn();
    const renderer = render(
      <InteractiveRow disabled hoverTint onHoverChange={onHoverChange} />,
    );
    const row = renderer.root.findByType("Pressable" as any);
    expect(row.props.disabled).toBe(true);
    expect(flatStyles(row.props.style).some((s: any) => s?.opacity === 0.45)).toBe(true);
    expect(flatStyles(row.props.style).some((s: any) => s?.cursor === "pointer")).toBe(false);

    act(() => row.props.onMouseEnter());
    expect(onHoverChange).not.toHaveBeenCalled();
  });

  it("defaults the accessibility role from the presence of onPress", () => {
    const interactive = render(<InteractiveRow onPress={() => {}} />);
    expect(interactive.root.findByType("Pressable" as any).props.accessibilityRole).toBe("button");

    const inert = render(<InteractiveRow />);
    expect(inert.root.findByType("Pressable" as any).props.accessibilityRole).toBeUndefined();
  });
});
