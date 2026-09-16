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

function installStubs(isCompact = true, isMobile = false) {
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
    layout: { compact: isCompact, platform: isMobile ? "ios" : "web" } as any,
    flair: {} as any,
    isCompact,
    isMobile,
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
  it("uses host scrolling on compact/mobile and avoids nested desktop scrolling", () => {
    installStubs(isCompact);
    const r = render(
      <ModalBody header={<Text>tabs</Text>}>
        <Text>body</Text>
      </ModalBody>,
    );
    const scrollViews = r.root.findAllByType(ScrollView);
    expect(scrollViews.length).toBe(isCompact ? 1 : 0);
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
    expect(r.root.findAllByType(ScrollView)).toHaveLength(isCompact ? 1 : 0);
    if (!isCompact) {
      const headerView: any = header.parent;
      const headerStyle = Array.isArray(headerView.props.style)
        ? Object.assign({}, ...headerView.props.style)
        : headerView.props.style;
      expect(headerStyle.position).toBe("sticky");
    }
  });
});

describe("ModalBody bottom reserve", () => {
  const flatten = (style: unknown): { paddingBottom?: number } => {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
    return (style ?? {}) as { paddingBottom?: number };
  };

  function readBottomPadding(r: TestRenderer.ReactTestRenderer): number {
    const scroll = r.root.findAllByType(ScrollView)[0];
    return flatten(scroll.props.contentContainerStyle).paddingBottom as number;
  }

  it("reserves the large navigation-bar inset only on a mobile platform", () => {
    installStubs(true, true);
    const mobile = render(
      <ModalBody>
        <Text>body</Text>
      </ModalBody>,
    );
    expect(readBottomPadding(mobile)).toBe(48);

    installStubs(true, false);
    const compactDesktop = render(
      <ModalBody>
        <Text>body</Text>
      </ModalBody>,
    );
    expect(readBottomPadding(compactDesktop)).toBe(20);
  });

  it("keeps the small reserve on a non-compact desktop surface", () => {
    installStubs(false, false);
    const r = render(
      <ModalBody>
        <Text>body</Text>
      </ModalBody>,
    );
    // Non-compact desktop is host-owned scroll, so the padding lives on the
    // plain content wrapper rather than a ScrollView.
    const content = r.root.findAll((node) => flatten(node.props?.style).paddingBottom !== undefined)[0];
    expect(flatten(content.props.style).paddingBottom).toBe(20);
  });

  it("adds extraBottomInset on top of the mobile reserve", () => {
    installStubs(true, true);
    const r = render(
      <ModalBody extraBottomInset={10}>
        <Text>body</Text>
      </ModalBody>,
    );
    expect(readBottomPadding(r)).toBe(58);
  });
});
