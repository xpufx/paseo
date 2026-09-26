import { describe, expect, it, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { defaultDarkTheme } from "../client/theme/provider.js";
import {
  registerSidebarSurface,
  DEFAULT_SIDEBAR_MAX_CONTENT_WIDTH,
} from "../client/surface.js";

const colors: any = {
  surface0: "#18181b", surface1: "#27272a", surface2: "#3f3f46", border: "#3f3f46",
  foreground: "#fafafa", foregroundMuted: "#a1a1aa", accent: "#3b82f6",
  accentForeground: "#ffffff", statusSuccess: "#22c55e", statusWarning: "#eab308",
  statusDanger: "#ef4444",
};

beforeEach(() => {
  initClientHelpers({
    Icon: (p: any) => React.createElement("mock-icon", p),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any, colors, fonts: {} as any,
    layout: { compact: false, platform: "web" } as any, flair: {} as any,
    isCompact: false, isMobile: false, touchTargetMin: 28,
    alpha: (c: string, o: number) => `${c}:${o}`, resolveRadius: () => 6,
  } as any);
});

/** Styles of the column the registrar wraps the surface in, if any. */
function columnStyle(overrides: Record<string, unknown> = {}): Record<string, unknown> | null {
  let registered: any;
  const plugin: any = {
    addSurface: (_id: string, C: any) => { registered = C; return () => {}; },
    addSidebarItem: () => () => {},
  };
  registerSidebarSurface(plugin, {
    id: "s", title: "S", icon: "Square",
    Component: () => React.createElement("mock-body", null),
    ...overrides,
  } as any);
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(registered, {
        theme: defaultDarkTheme,
        layout: { compact: false, platform: "web" },
      } as any)
    );
  });
  // Select the column by the property under test. The theme/scroll providers
  // render Views of their own, so positional lookup finds the wrong element and
  // `mock-body.parent` resolves to a composite, not a host View.
  for (const v of renderer!.root.findAllByType("View" as any)) {
    const s = v.props?.style;
    const flat = Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean)) : s;
    if (flat && flat.maxWidth != null) return flat;
  }
  return null;
}

describe("registerSidebarSurface content cap (#625)", () => {
  it("caps by default, because opt-in is what produced the inconsistency", () => {
    expect(DEFAULT_SIDEBAR_MAX_CONTENT_WIDTH).toBe(1280);
    const style = columnStyle();
    expect(style, "default must wrap the surface in a capped column").not.toBeNull();
    expect(style!.maxWidth).toBe(DEFAULT_SIDEBAR_MAX_CONTENT_WIDTH);
  });

  it("stays fluid below the cap — width 100%, not a fixed width", () => {
    const style = columnStyle();
    expect(style!.width).toBe("100%");
    expect(style!.flex).toBe(1);
  });

  it("honours an explicit number", () => {
    const style = columnStyle({ maxContentWidth: 900 });
    expect(style!.maxWidth).toBe(900);
  });

  it("opts out entirely for canvas-shaped surfaces", () => {
    // A graph visualiser must not be boxed into a centred column.
    expect(columnStyle({ maxContentWidth: false })).toBeNull();
  });
});
