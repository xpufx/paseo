import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { SectionHeader } from "../client/components/SectionHeader.js";
import { Badge } from "../client/components/Badge.js";

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

function installStubs(flair: any = { headingTransform: "uppercase" }) {
  initClientHelpers({
    Icon: (props: any) => React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors,
    fonts: {} as any,
    layout: { compact: false, platform: "web" } as any,
    flair,
    isCompact: false,
    isMobile: false,
    touchTargetMin: 36,
    alpha: (c: string, _o: number) => c,
    getContrastColor: () => "#fff",
    getStatusColor: () => "#fff",
    getVariantPalette: () => ({ bg: "#000", text: "#fff", border: "#333" }),
    resolveRadius: () => 8,
    padding: { horizontal: 12, vertical: 8, gap: 8 },
  } as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
  installStubs();
});

function render(el: React.ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer!;
}

function flatStyles(style: any): any[] {
  return Array.isArray(style) ? style.flat(Infinity) : [style];
}

describe("SectionHeader", () => {
  it("is exported as a function", () => {
    expect(typeof SectionHeader).toBe("function");
  });

  it("renders title with themed muted style", () => {
    const renderer = render(React.createElement(SectionHeader, { title: "Overview" }));
    const text = renderer.root.findByType(Text as any);
    expect(text.props.children).toBe("Overview");
    const flat = flatStyles(text.props.style);
    expect(flat.some((s: any) => s?.color === colors.foregroundMuted)).toBe(true);
    expect(flat.some((s: any) => s?.fontSize === 11)).toBe(true);
    expect(flat.some((s: any) => s?.fontWeight === "700")).toBe(true);
    expect(flat.some((s: any) => s?.letterSpacing === 0.8)).toBe(true);
  });

  it("uppercases title when flair.headingTransform is uppercase", () => {
    const renderer = render(React.createElement(SectionHeader, { title: "T" }));
    const flat = flatStyles(renderer.root.findByType(Text as any).props.style);
    expect(flat.some((s: any) => s?.textTransform === "uppercase")).toBe(true);
  });

  it("respects headingTransform none", () => {
    vi.restoreAllMocks();
    installStubs({ headingTransform: "none" });
    const renderer = render(React.createElement(SectionHeader, { title: "T" }));
    const flat = flatStyles(renderer.root.findByType(Text as any).props.style);
    expect(flat.some((s: any) => s?.textTransform === "none")).toBe(true);
  });

  it("omits badge when count is undefined", () => {
    const renderer = render(React.createElement(SectionHeader, { title: "T" }));
    expect(renderer.root.findAllByType(Badge as any).length).toBe(0);
  });

  it("renders warning solid badge when count > 0", () => {
    const renderer = render(React.createElement(SectionHeader, { title: "T", count: 3 }));
    const badge = renderer.root.findByType(Badge as any);
    expect(badge.props.label).toBe("3");
    expect(badge.props.variant).toBe("warning");
    expect(badge.props.styleVariant).toBe("solid");
  });

  it("renders neutral tinted badge when count is 0", () => {
    const renderer = render(React.createElement(SectionHeader, { title: "T", count: 0 }));
    const badge = renderer.root.findByType(Badge as any);
    expect(badge.props.label).toBe("0");
    expect(badge.props.variant).toBe("neutral");
    expect(badge.props.styleVariant).toBe("tinted");
  });

  it("honors badgeVariant override", () => {
    const renderer = render(
      React.createElement(SectionHeader, { title: "T", count: 5, badgeVariant: "success" }),
    );
    const badge = renderer.root.findByType(Badge as any);
    expect(badge.props.variant).toBe("success");
    expect(badge.props.styleVariant).toBe("solid");
  });

  it("applies row container layout with section spacing", () => {
    const renderer = render(React.createElement(SectionHeader, { title: "T" }));
    const container = renderer.root.findByType("View" as any);
    const flat = flatStyles(container.props.style);
    expect(flat.some((s: any) => s?.flexDirection === "row")).toBe(true);
    expect(flat.some((s: any) => s?.alignItems === "center")).toBe(true);
    expect(flat.some((s: any) => s?.gap === 8)).toBe(true);
    expect(flat.some((s: any) => s?.marginTop === 8)).toBe(true);
    expect(flat.some((s: any) => s?.marginBottom === 2)).toBe(true);
  });
});
