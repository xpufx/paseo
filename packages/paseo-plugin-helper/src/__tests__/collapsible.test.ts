import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import {
  Collapsible,
  resolveCollapsibleChevron,
  resolveCollapsibleHeaderBackground,
} from "../client/components/Collapsible.js";

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

function installStubs() {
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
    flair: {} as any,
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

function findPressable(root: TestRenderer.ReactTestInstance) {
  return root.findByType("Pressable" as any);
}

function pressStyle(pressable: TestRenderer.ReactTestInstance, pressed: boolean) {
  const fn = pressable.props.style;
  const out = typeof fn === "function" ? fn({ pressed }) : fn;
  return TestRenderer as never, Array.isArray(out) ? out.flat(Infinity) : [out];
}

describe("Collapsible helpers", () => {
  it("resolves chevron by state", () => {
    expect(resolveCollapsibleChevron(true)).toBe("ChevronDown");
    expect(resolveCollapsibleChevron(false)).toBe("ChevronRight");
  });

  it("resolves header background with pressed feedback", () => {
    expect(resolveCollapsibleHeaderBackground(colors, true)).toBe(colors.surface1);
    expect(resolveCollapsibleHeaderBackground(colors, false)).toBe(colors.surface0);
  });
});

describe("Collapsible component", () => {
  it("renders collapsed by default and expands on press", () => {
    const onToggle = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(Collapsible, { title: "Details", onToggle , children: "body"}),
      );
    });
    const pressable = findPressable(renderer!.root);
    expect(renderer!.root.findAllByType(Text as any).length).toBeGreaterThan(0);
    act(() => {
      pressable.props.onPress();
    });
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(
      renderer!.root.findAll(
        (n: any) =>
          typeof n.type === "string" &&
          typeof n.props?.children === "string" &&
          n.props.children === "body",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("header has pointer cursor and pressed background tint", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(Collapsible, { title: "T" , children: "x"}),
      );
    });
    const styles = pressStyle(findPressable(renderer!.root), true);
    expect(styles.some((s: any) => s?.cursor === "pointer")).toBe(true);
    expect(styles.some((s: any) => s?.backgroundColor === colors.surface1)).toBe(true);
    const idle = pressStyle(findPressable(renderer!.root), false);
    expect(idle.some((s: any) => s?.backgroundColor === colors.surface0)).toBe(true);
  });

  it("renders chevron badge container and correct icon per state", () => {
    let collapsed: TestRenderer.ReactTestRenderer;
    act(() => {
      collapsed = TestRenderer.create(
        React.createElement(Collapsible, { title: "T" , children: "x"}),
      );
    });
    const icons = collapsed!.root.findAllByType("mock-icon" as any);
    expect(icons[0].props.name).toBe("ChevronRight");
    let expanded: TestRenderer.ReactTestRenderer;
    act(() => {
      expanded = TestRenderer.create(
        React.createElement(Collapsible, { title: "T", initiallyExpanded: true , children: "x"}),
      );
    });
    expect(expanded!.root.findAllByType("mock-icon" as any)[0].props.name).toBe(
      "ChevronDown",
    );
  });

  it("renders subtitle, summary, badge, headerRight and custom node title", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    const summary = React.createElement("mock-summary", null);
    const headerRight = React.createElement("mock-right", null);
    const nodeTitle = React.createElement("mock-title", null, "custom");
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          Collapsible,
          {
            title: nodeTitle,
            subtitle: "sub",
            summary,
            badge: React.createElement("mock-badge", null),
            headerRight,
            initiallyExpanded: true,
            children: "body",
          },
        ),
      );
    });
    const root = renderer!.root;
    expect(root.findAllByType("mock-summary" as any).length).toBeGreaterThan(0);
    expect(root.findAllByType("mock-right" as any).length).toBeGreaterThan(0);
    expect(root.findAllByType("mock-badge" as any).length).toBeGreaterThan(0);
    expect(root.findAllByType("mock-title" as any).length).toBeGreaterThan(0);
  });

  it("shows summary in collapsed state and border separator when expanded", () => {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          Collapsible,
          { title: "T", summary: React.createElement("mock-summary", null), initiallyExpanded: true, children: "body" },
        ),
      );
    });
    expect(
      renderer!.root.findAllByType("mock-summary" as any).length,
    ).toBeGreaterThan(0);
    const contentViews = renderer!.root.findAll(
      (n: any) =>
        n.type === "View" &&
        Array.isArray(n.props?.style) &&
        n.props.style.some((s: any) => s?.borderTopColor === colors.border),
    );
    expect(contentViews.length).toBeGreaterThan(0);
  });

  it("supports controlled isExpanded without internal state change", () => {
    const onToggle = vi.fn();
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(
          Collapsible,
          { title: "T", isExpanded: false, onToggle, children: "body" },
        ),
      );
    });
    act(() => {
      findPressable(renderer!.root).props.onPress();
    });
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(
      renderer!.root.findAll(
        (n: any) =>
          typeof n.type === "string" &&
          typeof n.props?.children === "string" &&
          n.props.children === "body",
      ).length,
    ).toBe(0);
  });
});
