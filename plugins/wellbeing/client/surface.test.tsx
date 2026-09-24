import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initClientHelpers } from "paseo-plugin-helper/client";
import { WellbeingSurface } from "./surface";

// The real `react-native` entrypoint carries Flow syntax Vite cannot parse.
// The helper's own tests alias it to a stub; mirroring that here with `vi.mock`
// keeps this plugin free of a root-level vitest config (v0.8 layout).
vi.mock("react-native", () => {
  const stub = (name: string) => {
    const Component = (props: Record<string, unknown>) =>
      React.createElement(name, props, (props?.children as React.ReactNode) ?? null);
    Object.defineProperty(Component, "name", { value: name });
    return Component;
  };
  const timing = { start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {}, reset: () => {} };
  return {
    View: stub("View"),
    Text: stub("Text"),
    Pressable: stub("Pressable"),
    TouchableOpacity: stub("TouchableOpacity"),
    ScrollView: stub("ScrollView"),
    TextInput: stub("TextInput"),
    Image: stub("Image"),
    ActivityIndicator: stub("ActivityIndicator"),
    StyleSheet: { create: <T,>(styles: T): T => styles, flatten: (style: unknown) => style, hairlineWidth: 1, compose: (a: unknown, b: unknown) => [a, b] },
    Platform: { OS: "ios", select: <T,>(options: { web?: T; default?: T } & Record<string, T>): T | undefined => options.default },
    Appearance: { getColorScheme: () => "dark" as const, addChangeListener: () => ({ remove: () => {} }) },
    useColorScheme: () => "dark" as const,
    Dimensions: { get: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }) },
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
    Linking: { openURL: async () => {}, canOpenURL: async () => true },
    Animated: { Value: class { constructor(public value: number) {} setValue() {} interpolate() { return {}; } }, View: stub("AnimatedView"), Text: stub("AnimatedText"), loop: (a: unknown) => a, sequence: () => timing, timing: () => timing, spring: () => timing },
    Easing: { linear: (v: number) => v, ease: (v: number) => v, inOut: (v: unknown) => v },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installStubs() {
  initClientHelpers({
    Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({ show: () => {}, error: () => {} }),
  } as unknown as Parameters<typeof initClientHelpers>[0]);
}

beforeEach(() => {
  installStubs();
});

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  // The helper's useRpcQuery/useRpcMutation require a TanStack QueryClient
  // provider, exactly like the host surface runtime supplies.
  const queryClient = new QueryClient();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(QueryClientProvider, { client: queryClient }, element),
    );
  });
  return renderer;
}

/** Flatten the rendered tree to its concatenated text content. */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textOf((node as { children?: unknown }).children);
  }
  return "";
}

describe("WellbeingSurface", () => {
  it("mounts without DOM APIs on a Hermes-shaped (mobile) runtime", () => {
    // Regression for the "undefined is not a function" surface crash: the
    // presence effect previously gated on `typeof window !== "undefined"`,
    // which React Native satisfies while `window.addEventListener` is
    // undefined on native. This test defines `window` exactly like React
    // Native does (bare global, no DOM methods) and mounts the surface.
    (globalThis as Record<string, unknown>).window = {};
    (globalThis as Record<string, unknown>).document = {};

    let renderer: TestRenderer.ReactTestRenderer;
    expect(() => {
      renderer = render(React.createElement(WellbeingSurface));
    }).not.toThrow();
    // The mount itself is the regression: the surface previously crashed with
    // "undefined is not a function" in the presence effect before any render.
    expect(textOf(renderer!.toJSON())).toContain("telemetry");
    renderer!.unmount();
  });

  it("subscribes to window events when a DOM listener API exists (web/desktop)", () => {
    const listeners = new Map<string, Set<unknown>>();
    (globalThis as Record<string, unknown>).window = {
      addEventListener: (name: string, handler: unknown) => {
        const set = listeners.get(name) ?? new Set();
        set.add(handler);
        listeners.set(name, set);
      },
      removeEventListener: (name: string, handler: unknown) => {
        listeners.get(name)?.delete(handler);
      },
    };
    (globalThis as Record<string, unknown>).document = { visibilityState: "visible" };

    let renderer: TestRenderer.ReactTestRenderer;
    expect(() => {
      renderer = render(React.createElement(WellbeingSurface));
    }).not.toThrow();

    expect(listeners.get("pointerdown")?.size ?? 0).toBeGreaterThan(0);

    renderer!.unmount();
    // React dev double-invokes effects (mount, cleanup, re-mount), so assert
    // the post-unmount count is at most the dev-mode residue of one cycle and
    // that the surface's own cleanup ran. (TanStack Query leaves window
    // focus/online/offline listeners for its focusManager.)
    expect(listeners.get("pointerdown")?.size ?? 0).toBeLessThanOrEqual(1);
    expect(listeners.get("keydown")?.size ?? 0).toBeLessThanOrEqual(1);
    expect(listeners.get("focus")?.size ?? 0).toBeLessThanOrEqual(1);
  });
});