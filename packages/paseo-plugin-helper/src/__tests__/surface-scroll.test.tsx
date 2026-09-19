import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, ScrollView, View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { registerSidebarSurface } from "../client/surface.js";
import { ModalBody, ModalBodyScrollOwnerContext } from "../client/layout/ModalBody.js";
import { defaultDarkTheme } from "../client/theme/provider.js";

const colors: any = { surface0: "#18181b", accent: "#3b82f6" };

/**
 * Regression: "plugin page does not scroll" (xpufx-org/paseo#213).
 *
 * A sidebar surface is a full host page. Paseo does not wrap the surface body
 * in a host scroller, so a `ModalBody` inside it must own the scroll on every
 * surface — including a NON-compact desktop window. Before the fix, the
 * non-compact branch rendered a plain `<View>` and clipped overflowing content.
 */
function installStubs(isCompact: boolean, isMobile = false) {
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

beforeEach(() => vi.restoreAllMocks());

function surfaceWithBody(body: React.ReactElement) {
  const registered: Array<{ id: string; Component: any }> = [];
  const client = {
    addSurface(id: string, Component: any) {
      registered.push({ id, Component });
      return () => {};
    },
    addSidebarItem() {
      return () => {};
    },
  } as any;
  registerSidebarSurface(client, {
    id: "main",
    title: "Main",
    icon: "PhoneOutgoing",
    Component: () => body,
  });
  return registered[0].Component;
}

function renderSurface(Component: any, isCompact: boolean) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <Component
        theme={defaultDarkTheme}
        layout={{ compact: isCompact, platform: "web" }}
      />,
    );
  });
  return renderer;
}

describe("sidebar surface scroll ownership (#213)", () => {
  it.each([true, false])(
    "a ModalBody inside a registered surface owns a scroller (compact=%s)",
    (isCompact) => {
      installStubs(isCompact);
      const Component = surfaceWithBody(
        <ModalBody headerMode="pinned" header={<Text>hdr</Text>}>
          <Text>body</Text>
        </ModalBody>,
      );
      const renderer = renderSurface(Component, isCompact);
      // The whole point: a scroller must exist even on a wide desktop window.
      expect(renderer.root.findAllByType(ScrollView).length).toBe(1);
    },
  );

  it("keeps the pinned header outside the surface scroller", () => {
    installStubs(false);
    const Component = surfaceWithBody(
      <ModalBody headerMode="pinned" header={<Text testID="pinned">hdr</Text>}>
        <Text>body</Text>
      </ModalBody>,
    );
    const renderer = renderSurface(Component, false);
    const header = renderer.root.findByProps({ testID: "pinned" });
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

  it("still defers scroll to the host inside a composer popover", () => {
    // Popover subtrees are marked "host"; surfaces must not override that.
    installStubs(false);
    const renderer = renderSurface(
      () => (
        <ModalBodyScrollOwnerContext.Provider value="host">
          <ModalBody>
            <Text>popover</Text>
          </ModalBody>
        </ModalBodyScrollOwnerContext.Provider>
      ),
      false,
    );
    expect(renderer.root.findAllByType(ScrollView).length).toBe(0);
  });
});

describe("registerSidebarSurface disposer", () => {
  function registrar() {
    const removed: string[] = [];
    const client = {
      addSurface(id: string) {
        return { remove: () => removed.push(`surface:${id}`) };
      },
      addSidebarItem(contribution: any) {
        return { remove: () => removed.push(`item:${contribution.id}`) };
      },
    } as any;
    return { client, removed };
  }

  it("removes both the surface and the sidebar item, once", () => {
    const { client, removed } = registrar();
    const dispose = registerSidebarSurface(client, {
      id: "main",
      title: "Main",
      icon: "Activity",
      Component: () => null,
    });
    expect(typeof dispose).toBe("function");

    dispose();
    expect(removed.sort()).toEqual(["item:main", "surface:main"]);

    // Idempotent: a second call must not remove again.
    dispose();
    expect(removed).toHaveLength(2);
  });

  it("tolerates a host that returns a bare remover function", () => {
    const removed: string[] = [];
    const client = {
      addSurface: () => () => removed.push("surface"),
      addSidebarItem: () => () => removed.push("item"),
    } as any;
    registerSidebarSurface(client, {
      id: "main",
      title: "Main",
      icon: "Activity",
      Component: () => null,
    })();
    expect(removed.sort()).toEqual(["item", "surface"]);
  });

  it("tolerates a host that returns nothing", () => {
    const client = { addSurface: () => undefined, addSidebarItem: () => undefined } as any;
    const dispose = registerSidebarSurface(client, {
      id: "main",
      title: "Main",
      icon: "Activity",
      Component: () => null,
    });
    expect(() => dispose()).not.toThrow();
  });
});

