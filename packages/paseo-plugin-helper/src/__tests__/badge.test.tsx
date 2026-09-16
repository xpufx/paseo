import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { resolveTypography } from "../client/theme/tokens.js";
import { Badge } from "../client/components/Badge.js";

const iconCalls: Array<{ name: string; size?: number; color?: string }> = [];
const typography = resolveTypography({ compact: false, platform: "web" }, "comfortable");

function installStubs() {
  iconCalls.length = 0;
  initClientHelpers({
    Icon: (props: any) => {
      iconCalls.push(props);
      return React.createElement("mock-icon", { name: props.name });
    },
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors: {
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
    },
    fonts: {} as any,
    layout: { compact: false, platform: "web" } as any,
    flair: { headingTransform: "none" },
    isCompact: false,
    isMobile: false,
    touchTargetMin: 36,
    alpha: (c: string) => c,
    getContrastColor: () => "#fff",
    getStatusColor: () => "#fff",
    getVariantPalette: () => ({ bg: "#000", text: "#fff", border: "#333" }),
    resolveRadius: () => 8,
    padding: { horizontal: 12, vertical: 8, gap: 8 },
    typography,
  } as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
  installStubs();
});

function render(el: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function styleValue(style: any, key: string): any {
  const flat = Array.isArray(style) ? style.flat(Infinity) : [style];
  return flat.find((s) => s && s[key] !== undefined)?.[key];
}

function badgeParts(el: React.ReactElement) {
  const renderer = render(el);
  const view = renderer.root.findAllByType(View as any)[0];
  const text = renderer.root.findByType(Text as any);
  return { view, text };
}

describe("Badge size", () => {
  it("defaults to md with the unchanged theme caption metrics", () => {
    const { view, text } = badgeParts(React.createElement(Badge, { label: "Online" }));

    // caption = 11/15 comfortable => pv max(2, floor(15/5)) = 3, ph 8
    expect(styleValue(view.props.style, "paddingVertical")).toBe(3);
    expect(styleValue(view.props.style, "paddingHorizontal")).toBe(8);
    expect(styleValue(text.props.style, "fontSize")).toBe(11);
    expect(styleValue(text.props.style, "lineHeight")).toBe(15);
  });

  it("renders md identically whether the size prop is explicit or omitted", () => {
    const omitted = badgeParts(React.createElement(Badge, { label: "Online" }));
    const explicit = badgeParts(React.createElement(Badge, { label: "Online", size: "md" }));

    expect(styleValue(explicit.view.props.style, "paddingVertical")).toBe(
      styleValue(omitted.view.props.style, "paddingVertical"),
    );
    expect(styleValue(explicit.text.props.style, "fontSize")).toBe(
      styleValue(omitted.text.props.style, "fontSize"),
    );
  });

  it("renders the compact sm pill", () => {
    const { view, text } = badgeParts(
      React.createElement(Badge, { label: "bug", size: "sm" }),
    );

    expect(styleValue(view.props.style, "paddingVertical")).toBe(1);
    expect(styleValue(view.props.style, "paddingHorizontal")).toBe(5);
    expect(styleValue(text.props.style, "fontSize")).toBe(10);
    expect(styleValue(text.props.style, "lineHeight")).toBe(12);
  });

  it("sizes the icon to the selected size", () => {
    render(React.createElement(Badge, { label: "Online", icon: "Rocket" }));
    expect(iconCalls.at(-1)).toMatchObject({ name: "Rocket", size: 11 });

    render(React.createElement(Badge, { label: "bug", icon: "Rocket", size: "sm" }));
    expect(iconCalls.at(-1)).toMatchObject({ name: "Rocket", size: 10 });
  });

  it("keeps caller style and textStyle overrides on top of the size metrics", () => {
    const { view, text } = badgeParts(
      React.createElement(Badge, {
        label: "bug",
        size: "sm",
        style: { marginRight: 4 },
        textStyle: { letterSpacing: 1 },
      }),
    );

    expect(styleValue(view.props.style, "marginRight")).toBe(4);
    expect(styleValue(text.props.style, "letterSpacing")).toBe(1);
    // Overrides layer on top, they do not replace the sm metrics.
    expect(styleValue(text.props.style, "fontSize")).toBe(10);
  });

  it("highlights matches in the label when highlightQuery is set", () => {
    const renderer = render(
      React.createElement(Badge, { label: "bug report", highlightQuery: "bug" }),
    );
    const matched = renderer.root
      .findAllByType(Text as any)
      .filter((node) => styleValue(node.props.style, "backgroundColor") === "#3b82f6");
    expect(matched).toHaveLength(1);
    expect(matched[0].props.children).toBe("bug");
  });
});
