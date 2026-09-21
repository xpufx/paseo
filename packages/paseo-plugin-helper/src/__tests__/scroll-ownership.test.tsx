import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { View, ScrollView } from "react-native";
import { initClientHelpers, type ComposerPillRegistrar } from "../client/host.js";
import { registerComposerPill } from "../client/pill.js";
import * as themeProvider from "../client/theme/provider.js";
import { ModalBody } from "../client/layout/ModalBody.js";
import { defaultDarkTheme } from "../client/theme/provider.js";

const colors: any = { surface0: "#18181b", accent: "#3b82f6" };

function installStubs() {
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
    layout: { compact: true, platform: "web" } as any,
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
  } as any);
}

function buttonRegistrar() {
  const pills: Array<{ contribution: any }> = [];
  const subscribers = new Set<(update: any) => void>();
  const client = {
    addComposerPill(contribution: any) {
      if (!contribution.button) throw new TypeError("expected button shape");
      const stored = { contribution };
      pills.push(stored);
      return {
        update: () => {},
        remove: () => {
          const i = pills.indexOf(stored);
          if (i >= 0) pills.splice(i, 1);
        },
      };
    },
    paseo: {
      agents: {
        subscribe: (cb: (update: any) => void) => {
          subscribers.add(cb);
          return () => subscribers.delete(cb);
        },
        list: async () => ({ entries: [] }),
      },
    },
    emit(update: any) {
      for (const cb of subscribers) cb(update);
    },
  } as unknown as ComposerPillRegistrar & { emit(update: any): void };
  return { client, pills };
}

beforeEach(() => vi.restoreAllMocks());

describe("0.8 popover scroll ownership (#110)", () => {
  it("0.8 popovers yield scroll ownership to Paseo's outer surface", () => {
    installStubs();
    const { client, pills } = buttonRegistrar();
    const cleanup = registerComposerPill(client, {
      id: "scroll-own",
      title: "Scroll",
      renderModal: () => (
        <ModalBody>
          <View />
        </ModalBody>
      ),
    });
    (client as any).emit({ kind: "upsert", agent: { id: "a1", workspaceId: "w1" } });
    const Content = pills[0].contribution.button.behavior.Content;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <Content
          agentId="a1"
          workspaceId="w1"
          theme={defaultDarkTheme}
          layout={{ compact: true, platform: "web" }}
          close={() => {}}
        />,
      );
    });

    // Outer: the popover container View directly under the theme provider must be
    // a plain View (no ScrollView ancestor above the inner body).
    const scrolls = renderer.root.findAllByType(ScrollView);
    expect(scrolls.length).toBe(0);

    // The helper supplies only a finite max-height so Paseo can establish its
    // viewport; it must not impose a fixed height, clipping, or an inner
    // ScrollView that would take ownership from FloatingScrollView/
    // BottomSheetScrollView.
    const views = renderer.root.findAllByType(View);
    const containers = views.filter((v: any) => {
      const s = v.props.style;
      const flat = Array.isArray(s) ? Object.assign({}, ...s) : s;
      return flat && flat.width === "100%";
    });
    expect(containers.length).toBeGreaterThan(0);
    expect(containers.some((c: any) => {
      const s: any = Array.isArray(c.props.style)
        ? Object.assign({}, ...c.props.style)
        : c.props.style;
      return typeof s.maxHeight === "number" && s.maxHeight > 0;
    })).toBe(true);
    for (const c of containers) {
      const s: any = Array.isArray(c.props.style)
        ? Object.assign({}, ...c.props.style)
        : c.props.style;
      expect(s.height).toBeUndefined();
      expect(s.overflow).toBeUndefined();
    }
    cleanup();
  });

  it("headerMode=scroll renders header INSIDE the scroller (mcp-tools pattern)", () => {
    installStubs();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ModalBody header={<View testID="hdr" />}>
          <View testID="body-child" />
        </ModalBody>,
      );
    });
    const scrolls = renderer.root.findAllByType(ScrollView);
    expect(scrolls.length).toBe(1);
    // Header must be a descendant of the ScrollView, not a sibling above it.
    const hdr = renderer.root.findByProps({ testID: "hdr" });
    let p: any = hdr.parent;
    let inside = false;
    while (p) {
      if (p.type === ScrollView) { inside = true; break; }
      p = p.parent;
    }
    expect(inside).toBe(true);
  });

  it("headerMode=pinned keeps header above the scroller", () => {
    installStubs();
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <ModalBody headerMode="pinned" header={<View testID="hdr" />}>
          <View testID="body-child" />
        </ModalBody>,
      );
    });
    const hdr = renderer.root.findByProps({ testID: "hdr" });
    let p: any = hdr.parent;
    let inside = false;
    while (p) {
      if (p.type === ScrollView) { inside = true; break; }
      p = p.parent;
    }
    expect(inside).toBe(false);
  });
});
