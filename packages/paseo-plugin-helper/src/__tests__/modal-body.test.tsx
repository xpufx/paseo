import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, ScrollView } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { ModalBody } from "../client/layout/ModalBody.js";

const colors: any = {
  surface0: "#18181b",
  accent: "#3b82f6",
};

function installStubs(isCompact = true) {
  initClientHelpers({
    Icon: () => null,
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
});

function render(el: React.ReactElement) {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer!;
}

describe.each([false, true])("ModalBody pinned header (compact=%s)", (isCompact) => {
  it("renders a ScrollView body even on compact without a host scroller", () => {
    installStubs(isCompact);
    const r = render(
      <ModalBody header={<Text>tabs</Text>}>
        <Text>body</Text>
      </ModalBody>,
    );
    const scrollViews = r.root.findAllByType(ScrollView);
    expect(scrollViews.length).toBeGreaterThan(0);
  });

  it("keeps header outside the ScrollView", () => {
    installStubs(isCompact);
    const r = render(
      <ModalBody headerMode="pinned" header={<Text testID="pinned-tabs">tabs</Text>}>
        <Text>body</Text>
      </ModalBody>,
    );
    const header = r.root.findByProps({ testID: "pinned-tabs" });
    let node: any = header.parent;
    let insideScroll = false;
    while (node) {
      if (node.type === ScrollView) {
        insideScroll = true;
        break;
      }
      node = node.parent;
    }
    expect(insideScroll).toBe(false);
  });
});
