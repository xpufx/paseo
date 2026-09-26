import { describe, expect, it, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { Button } from "../client/components/Button.js";

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

type Theme = { touchTargetMin: number; isCompact: boolean; isMobile: boolean };

function mockTheme({ touchTargetMin, isCompact, isMobile }: Theme) {
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors,
    fonts: {} as any,
    layout: { compact: isCompact, platform: isMobile ? "ios" : "web" } as any,
    flair: {} as any,
    isCompact,
    isMobile,
    touchTargetMin,
    alpha: (color: string, opacity: number) => `${color}:${opacity}`,
    resolveRadius: () => 6,
  } as any);
}

function renderButton(size: "sm" | "md" | "lg") {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Button, { size, label: "Add" }));
  });
  const pressable = renderer!.root.findByType("Pressable" as any);
  const resolved = (pressable.props.style as (s: { pressed: boolean }) => unknown[])({
    pressed: false,
  });
  return {
    hitSlop: pressable.props.hitSlop as number,
    style: resolved.filter((s): s is Record<string, unknown> => !!s && typeof s === "object"),
  };
}

beforeEach(() => {
  initClientHelpers({
    Icon: (props: any) => React.createElement("mock-icon", props),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
});

describe("Button touch target (#647)", () => {
  it("does not inflate the painted box to meet the touch target", () => {
    // Mobile: touchTargetMin 44 used to force minHeight 40 on every size,
    // so `sm` rendered ~50% taller than its own recipe asks for.
    for (const platform of [
      { touchTargetMin: 44, isCompact: false, isMobile: true },
      { touchTargetMin: 36, isCompact: true, isMobile: false },
      { touchTargetMin: 28, isCompact: false, isMobile: false },
    ]) {
      mockTheme(platform);
      for (const size of ["sm", "md", "lg"] as const) {
        const { style } = renderButton(size);
        const hasMinHeight = style.some((s: any) => s && typeof s === "object" && "minHeight" in s);
        expect(
          hasMinHeight,
          `size=${size} on ${JSON.stringify(platform)} must not set minHeight`
        ).toBe(false);
      }
    }
  });

  it("still reaches the touch target via hitSlop, derived from the actual recipe height", () => {
    const cases: Array<[Theme, "sm" | "md" | "lg", number]> = [
      // mobile, sm: recipe ~26px -> slop must cover the 18px shortfall
      [{ touchTargetMin: 44, isCompact: false, isMobile: true }, "sm", 9],
      // mobile, md: recipe ~36px -> 4px each side
      [{ touchTargetMin: 44, isCompact: false, isMobile: true }, "md", 4],
      // mobile, lg: recipe ~42px, already over 44 minus rounding -> no slop
      [{ touchTargetMin: 44, isCompact: false, isMobile: true }, "lg", 1],
      // compact desktop, sm: py 5 + fontSize 12 -> contentHeight 24, slop 6
      [{ touchTargetMin: 36, isCompact: true, isMobile: false }, "sm", 6],
    ];
    for (const [theme, size, expected] of cases) {
      mockTheme(theme);
      const { hitSlop } = renderButton(size);
      expect(Math.round(hitSlop), `size=${size} on ${JSON.stringify(theme)}`).toBe(expected);
    }
  });

  it("never produces negative slop when the recipe already exceeds the minimum", () => {
    mockTheme({ touchTargetMin: 28, isCompact: false, isMobile: false });
    const { hitSlop } = renderButton("lg");
    expect(hitSlop).toBeGreaterThanOrEqual(0);
  });
});
