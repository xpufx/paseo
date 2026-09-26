import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, ScrollView, View } from "react-native";
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

describe("ModalBody size contract", () => {
  const flatten = (style: unknown): Record<string, unknown> => {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
    return (style ?? {}) as Record<string, unknown>;
  };

  it("fills the host allocation on a compact helper-owned scroller", () => {
    installStubs(true, false);
    const r = render(
      <ModalBody>
        <Text>body</Text>
      </ModalBody>,
    );
    const root = r.root.findAllByType(ScrollView)[0];
    const style = flatten(root.props.style);
    expect(style.flex).toBe(1);
    expect(style.minHeight).toBe(0);
    expect(style.width).toBe("100%");
  });

  it("fills the host allocation on a non-compact host-owned desktop surface", () => {
    installStubs(false, false);
    const r = render(
      <ModalBody>
        <Text>body</Text>
      </ModalBody>,
    );
    const root = r.root.findAllByType(View)[0];
    const style = flatten(root.props.style);
    expect(style.flex).toBe(1);
    expect(style.minHeight).toBe(0);
    expect(style.width).toBe("100%");
  });

  it("adds no size constraint by default", () => {
    installStubs(false, false);
    const r = render(
      <ModalBody>
        <Text>body</Text>
      </ModalBody>,
    );
    const style = flatten(r.root.findAllByType(View)[0].props.style);
    expect(style.minWidth).toBeUndefined();
  });

  it("applies no width floor for size=large so the host owns the dialog", () => {
    installStubs(false, false);
    const r = render(
      <ModalBody size="large">
        <Text>body</Text>
      </ModalBody>,
    );
    const style = flatten(r.root.findAllByType(View)[0].props.style);
    expect(style.minWidth).toBeUndefined();
  });

  it("caps and centers the content column when maxContentWidth is set", () => {
    installStubs(false, false);
    const r = render(
      <ModalBody maxContentWidth={600}>
        <Text>body</Text>
      </ModalBody>,
    );
    const column = r.root.findAll((node) => flatten(node.props?.style).maxWidth === 600)[0];
    const style = flatten(column.props.style);
    expect(style.width).toBe("100%");
    // Centering uses auto side margins, never alignSelf: on a ScrollView content
    // container alignSelf stops the column stretching to the viewport, so a
    // wrapping row sizes to its children and never wraps (#202 regression).
    expect(style.marginLeft).toBe("auto");
    expect(style.marginRight).toBe("auto");
    expect(style.alignSelf).toBeUndefined();
  });

  it("caps the helper-owned scroller content column too", () => {
    installStubs(true, false);
    const r = render(
      <ModalBody maxContentWidth={600}>
        <Text>body</Text>
      </ModalBody>,
    );
    const style = flatten(r.root.findAllByType(ScrollView)[0].props.contentContainerStyle);
    expect(style.maxWidth).toBe(600);
    expect(style.marginLeft).toBe("auto");
    expect(style.marginRight).toBe("auto");
    expect(style.alignSelf).toBeUndefined();
  });

  it("keeps the content column fluid on a mobile sheet narrower than the cap", () => {
    // The mobile bottom sheet is full-bleed and the cap is an upper bound only:
    // width:"100%" stays below it, so maxWidth 600 never constrains a phone
    // sheet (and the column must not shrink-wrap to its children). #202.
    installStubs(true, true);
    const r = render(
      <ModalBody maxContentWidth={600}>
        <Text>body</Text>
      </ModalBody>,
    );
    const style = flatten(r.root.findAllByType(ScrollView)[0].props.contentContainerStyle);
    expect(style.width).toBe("100%");
    expect(style.maxWidth).toBe(600);
    expect(style.marginLeft).toBe("auto");
    expect(style.marginRight).toBe("auto");
    expect(style.alignSelf).toBeUndefined();
  });

  it("adds no numeric content-width cap by default", () => {
    installStubs(false, false);
    const r = render(
      <ModalBody>
        <Text>body</Text>
      </ModalBody>,
    );
    const capped = r.root.findAll(
      (node) => typeof flatten(node.props?.style).maxWidth === "number",
    );
    expect(capped).toHaveLength(0);
  });

  it("applies no width floor for size=large on compact and mobile surfaces", () => {
    installStubs(true, false);
    const compact = render(
      <ModalBody size="large">
        <Text>body</Text>
      </ModalBody>,
    );
    expect(
      flatten(compact.root.findAllByType(ScrollView)[0].props.style).minWidth,
    ).toBeUndefined();

    installStubs(true, true);
    const mobile = render(
      <ModalBody size="large">
        <Text>body</Text>
      </ModalBody>,
    );
    expect(
      flatten(mobile.root.findAllByType(ScrollView)[0].props.style).minWidth,
    ).toBeUndefined();
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
