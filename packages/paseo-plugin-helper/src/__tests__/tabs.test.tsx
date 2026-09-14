import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Pressable, StyleSheet, Text } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { Tabs } from "../client/components/Tabs.js";
import { spacing } from "../client/theme/tokens.js";

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

function installStubs(isCompact = false) {
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
    layout: { compact: isCompact, platform: "web" } as any,
    flair: {} as any,
    isCompact,
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
  installStubs(false);
});

function render(el: React.ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer!;
}

function flatStyles(style: any): any[] {
  if (typeof style === "function") {
    style = style({ pressed: false });
  }
  return Array.isArray(style) ? style.flat(Infinity) : [style];
}

describe("Tabs component", () => {
  const sampleTabs = [
    { id: "system", label: "Activity", shortLabel: "Activity", icon: "Activity" },
    { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Sliders" },
    { id: "about", label: "About", shortLabel: "About", icon: "Info" },
  ];

  const fourTabs = [
    { id: "system", label: "System", shortLabel: "System", icon: "Activity" },
    { id: "context", label: "Workspace", shortLabel: "Workspace", icon: "GitBranch" },
    { id: "settings", label: "Settings", shortLabel: "Settings", icon: "Sliders" },
    { id: "about", label: "About", shortLabel: "About", icon: "Info" },
  ];

  it("renders tabs in fit mode without wrapping and with shrinkable items", () => {
    const onTabChange = vi.fn();
    const tree = render(
      <Tabs
        tabs={sampleTabs}
        activeTab="system"
        onTabChange={onTabChange}
      />
    );

    const pressables = tree.root.findAllByType(Pressable);
    expect(pressables.length).toBe(3);

    for (const pressable of pressables) {
      const flat = flatStyles(pressable.props.style);
      expect(flat.some((s: any) => s?.flex === 1)).toBe(true);
      expect(flat.some((s: any) => s?.flexShrink === 1)).toBe(true);
      expect(flat.some((s: any) => s?.minWidth === 0)).toBe(true);
      // For 3 tabs on desktop, paddingHorizontal should be spacing.sm
      expect(flat.some((s: any) => s?.paddingHorizontal === spacing.sm)).toBe(true);
    }
  });

  it("applies compact horizontal padding when 4 tabs render on compact viewport", () => {
    installStubs(true);
    const onTabChange = vi.fn();
    const tree = render(
      <Tabs
        tabs={fourTabs}
        activeTab="system"
        onTabChange={onTabChange}
      />
    );

    const pressables = tree.root.findAllByType(Pressable);
    expect(pressables.length).toBe(4);

    for (const pressable of pressables) {
      const flat = flatStyles(pressable.props.style);
      // Compact with > 3 tabs uses spacing.xs for single-line fit
      expect(flat.some((s: any) => s?.paddingHorizontal === spacing.xs)).toBe(true);
      expect(flat.some((s: any) => s?.flexShrink === 1)).toBe(true);
      expect(flat.some((s: any) => s?.minWidth === 0)).toBe(true);
    }
  });

  it("ensures tabText has flexShrink and minWidth: 0 to prevent overflow", () => {
    const onTabChange = vi.fn();
    const tree = render(
      <Tabs
        tabs={sampleTabs}
        activeTab="system"
        onTabChange={onTabChange}
      />
    );

    const pressables = tree.root.findAllByType(Pressable);
    expect(pressables.length).toBe(3);

    for (const pressable of pressables) {
      const textNode = pressable.findByType(Text);
      const flat = flatStyles(textNode.props.style);
      expect(flat.some((s: any) => s?.flexShrink === 1)).toBe(true);
      expect(flat.some((s: any) => s?.minWidth === 0)).toBe(true);
    }
  });

  it("invokes onTabChange when tab is pressed", () => {
    const onTabChange = vi.fn();
    const tree = render(
      <Tabs
        tabs={sampleTabs}
        activeTab="system"
        onTabChange={onTabChange}
      />
    );

    const pressables = tree.root.findAllByType(Pressable);
    act(() => {
      pressables[1].props.onPress();
    });

    expect(onTabChange).toHaveBeenCalledWith("settings");
  });
});
