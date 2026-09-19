import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ScrollView, Text, View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { ModalContent } from "../client/layout/ModalContent.js";

const colors: any = {
  surface0: "#18181b",
  accent: "#3b82f6",
};

// Host stub whose Modal.Content records the props the helper hands the host, so
// the test can assert the constraint that keeps the desktop card bounded.
let hostContentProps: Record<string, unknown> | null = null;

function installStubs(isCompact = true, isMobile = false) {
  hostContentProps = null;
  const HostContent = (props: Record<string, unknown>) => {
    hostContentProps = props;
    return <View testID="host-modal-content">{props.children as React.ReactNode}</View>;
  };
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: HostContent }),
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

const flatten = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style ?? {}) as Record<string, unknown>;
};

describe("ModalContent host allocation", () => {
  it("always disables host content scrolling so the desktop card is bounded", () => {
    installStubs(false, false);
    render(
      <ModalContent>
        <Text>body</Text>
      </ModalContent>,
    );
    expect(hostContentProps?.scrollable).toBe(false);
  });

  it("renders the shared ModalBody so content cannot drive the frame", () => {
    installStubs(false, false);
    const r = render(
      <ModalContent>
        <Text>body</Text>
      </ModalContent>,
    );
    expect(r.root.findByProps({ testID: "host-modal-content" })).toBeTruthy();
    // The host content view is bounded, so ModalContent forces the helper to
    // own the scroller even on a non-compact desktop surface.
    const scroller = r.root.findAllByType(ScrollView)[0];
    const style = flatten(scroller.props.style);
    expect(style.flex).toBe(1);
    expect(style.minHeight).toBe(0);
    expect(style.width).toBe("100%");
  });

  it("forwards the size preset to ModalBody", () => {
    installStubs(false, false);
    const r = render(
      <ModalContent size="large">
        <Text>body</Text>
      </ModalContent>,
    );
    const wide = r.root.findAll((node) => flatten(node.props?.style).minWidth === 640);
    expect(wide.length).toBeGreaterThan(0);
  });

  it("defers to the host scroller on compact hosts instead of sizing to content", () => {
    installStubs(true, false);
    const r = render(
      <ModalContent>
        <Text>body</Text>
      </ModalContent>,
    );
    expect(hostContentProps?.scrollable).toBe(false);
    expect(r.root.findAllByType(ScrollView)).toHaveLength(1);
  });
});
