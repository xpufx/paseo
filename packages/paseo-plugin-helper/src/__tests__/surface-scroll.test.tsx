import { describe, it, expect } from "vitest";
import React, { useContext } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { registerSidebarSurface } from "../lifecycle/surface.js";
import { ModalBodyScrollOwnerContext } from "../lifecycle/scroll-owner.js";
import type { PluginTheme } from "../shared/types.js";

const hostTheme: PluginTheme = {
  colors: {
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
  },
};

/**
 * Regression: "plugin page does not scroll" (xpufx-org/paseo#213).
 *
 * A sidebar surface is a full host page. Paseo does not wrap the surface body
 * in a host scroller, so the registrar marks the subtree as a required scroll
 * owner; anything reading the context must see "required".
 */
function registerSurface(Component: any) {
  let registered: any;
  const client = {
    addSurface(_id: string, C: any) {
      registered = C;
      return () => {};
    },
    addSidebarItem() {
      return () => {};
    },
  } as any;
  registerSidebarSurface(client, { id: "main", title: "Main", icon: "Activity", Component });
  return registered;
}

function renderSurface(Component: any) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <Component theme={hostTheme} layout={{ compact: false, platform: "web" }} />,
    );
  });
  return renderer;
}

describe("sidebar surface scroll ownership (#213)", () => {
  it("marks the surface subtree as a required scroll owner", () => {
    let captured: string | undefined;
    function Probe() {
      captured = useContext(ModalBodyScrollOwnerContext);
      return <Text>probe</Text>;
    }
    renderSurface(registerSurface(() => <Probe />));
    expect(captured).toBe("required");
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

  it("prefers addScreen and addSidebarHeaderItem when present (Paseo 0.11+)", () => {
    const screens: any[] = [];
    const headerItems: any[] = [];
    const legacySurfaces: any[] = [];
    const legacyItems: any[] = [];
    const removed: string[] = [];

    const client = {
      addScreen(screen: any) {
        screens.push(screen);
        return () => removed.push(`screen:${screen.id}`);
      },
      addSidebarHeaderItem(item: any) {
        headerItems.push(item);
        return () => removed.push(`headerItem:${item.id}`);
      },
      addSurface(id: string) {
        legacySurfaces.push(id);
        return () => removed.push(`surface:${id}`);
      },
      addSidebarItem(item: any) {
        legacyItems.push(item);
        return () => removed.push(`sidebarItem:${item.id}`);
      },
    } as any;

    const dispose = registerSidebarSurface(client, {
      id: "modern-surface",
      title: "Modern Surface",
      icon: "Terminal",
      Component: () => null,
    });

    expect(screens).toHaveLength(1);
    expect(screens[0].id).toBe("modern-surface");
    expect(screens[0].title).toBe("Modern Surface");
    expect(screens[0].Component).toBeDefined();

    expect(headerItems).toHaveLength(1);
    expect(headerItems[0]).toEqual({
      id: "modern-surface",
      title: "Modern Surface",
      icon: "Terminal",
      screen: "modern-surface",
    });

    // Legacy methods must not be called when modern ones are present
    expect(legacySurfaces).toHaveLength(0);
    expect(legacyItems).toHaveLength(0);

    // Disposer removes both
    dispose();
    expect(removed.sort()).toEqual(["headerItem:modern-surface", "screen:modern-surface"]);
  });
});

