import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Pressable, ScrollView, Text } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { CodeBlock } from "../client/components/CodeBlock.js";
import { Tabs } from "../client/components/Tabs.js";
import { Select } from "../client/components/Select.js";

const colors: any = {
  surface0: "#18181b",
  surface1: "#27272a",
  surface2: "#3f3f46",
  border: "#3f3f46",
  foreground: "#fafafa",
  foregroundMuted: "#a1a1aa",
  accent: "#3b82f6",
  statusSuccess: "#22c55e",
};

// Distinctive stub for the injected host sheet scroller. If any inner
// component renders through the host ScrollView, it shows up here.
function HostSheetScrollView(props: Record<string, unknown>) {
  return React.createElement("mock-host-sheet-scrollview", props);
}

function installStubs() {
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({ show() {}, error() {} }),
    ScrollView: HostSheetScrollView as any,
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors,
    fonts: {} as any,
    layout: { compact: true, platform: "ios" } as any,
    flair: {} as any,
    isCompact: true,
    isMobile: true,
    touchTargetMin: 36,
    alpha: (c: string, _o: number) => c,
    getContrastColor: () => "#fff",
    getStatusColor: () => "#fff",
    getVariantPalette: () => ({ bg: "#000", text: "#fff", border: "#333" }),
    resolveRadius: () => 8,
    padding: { horizontal: 12, vertical: 8, gap: 8 },
    typography: {
      caption: { fontSize: 11 },
      bodyStrong: { fontSize: 13 },
    },
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

describe("inner scrollers never use the host sheet ScrollView (#219)", () => {
  it("CodeBlock renders code with plain scrollers only", () => {
    const r = render(<CodeBlock language="bash" code="[INFO] ok" copyable={false} />);
    expect(r.root.findAllByType(HostSheetScrollView)).toHaveLength(0);
    // Outer bounded + inner horizontal: both plain React Native scrollers.
    expect(r.root.findAllByType(ScrollView)).toHaveLength(2);
    const texts = r.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts).toContain("[INFO] ok");
  });

  it("Tabs scroll mode strips horizontally with a plain scroller", () => {
    const r = render(
      <Tabs
        tabs={[
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ]}
        activeTab="a"
        onTabChange={() => {}}
        mode="scroll"
      />,
    );
    expect(r.root.findAllByType(HostSheetScrollView)).toHaveLength(0);
    expect(r.root.findAllByType(ScrollView)).toHaveLength(1);
    expect(r.root.findAllByType(Pressable).length).toBeGreaterThan(0);
  });

  it("Select dropdown list scrolls with a plain scroller", () => {
    const r = render(
      <Select
        value="a"
        options={[
          { label: "Alpha", value: "a" },
          { label: "Beta", value: "b" },
        ]}
        onValueChange={() => {}}
      />,
    );
    const trigger = r.root.findAllByType(Pressable)[0];
    act(() => {
      trigger.props.onPress();
    });
    expect(r.root.findAllByType(HostSheetScrollView)).toHaveLength(0);
    expect(r.root.findAllByType(ScrollView)).toHaveLength(1);
    const texts = r.root.findAllByType(Text).map((t) => t.props.children);
    expect(texts).toContain("Alpha");
    expect(texts).toContain("Beta");
  });
});
