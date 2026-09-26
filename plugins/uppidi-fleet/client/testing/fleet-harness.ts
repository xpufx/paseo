import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Shared render harness for fleet client tests.
 *
 * `react-native` carries Flow syntax `tsx` cannot parse, so it is aliased to a
 * data-URL stub via a module resolve hook; every other module (react,
 * react-test-renderer, react-query, paseo-plugin-helper) is the real thing.
 * Extracted from `entry.test.ts` so the crash harness and the mobile-layout
 * measurement harness drive the identical real render path.
 *
 * The resolve hook is process-global and one-shot, so `getFleetHarness()`
 * memoises the whole harness for the lifetime of the test process.
 */
const require = createRequire(import.meta.url);
const REACT_URL = pathToFileURL(require.resolve("react")).href;

const RN_STUB_SOURCE = `
import React from ${JSON.stringify(REACT_URL)};
function stub(name) {
  function RNStub(props) { return React.createElement(name, props, props?.children); }
  Object.defineProperty(RNStub, "name", { value: "RN" + name });
  return RNStub;
}
class AnimatedValue { constructor(v) { this.value = v; } setValue(v) { this.value = v; } interpolate(c) { return { config: c }; } }
const anim = { start: (cb) => cb?.({ finished: true }), stop() {}, reset() {} };
export const View = stub("View");
export const Text = stub("Text");
export const Pressable = stub("Pressable");
export const ScrollView = stub("ScrollView");
export const TextInput = stub("TextInput");
export const Image = stub("Image");
export const FlatList = stub("FlatList");
export const RefreshControl = stub("RefreshControl");
export const ActivityIndicator = stub("ActivityIndicator");
// Select's overlay portal (helper >= #520) renders the option list in a RN
// Modal; the stub must expose it so the real Select module instantiates.
export const Modal = stub("Modal");
export const TouchableWithoutFeedback = stub("TouchableWithoutFeedback");
export const StyleSheet = { create: (s) => s, flatten: (s) => s, hairlineWidth: 1, compose: (a, b) => [a, b], absoluteFill: {} };
export const Platform = { OS: "web", select: (o) => o.web ?? o.default };
export const Appearance = { getColorScheme: () => "dark", addChangeListener: (cb) => { cb({ colorScheme: "dark" }); return { remove() {} }; } };
export const useColorScheme = () => "dark";
export const Dimensions = { get: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }) };
export const useWindowDimensions = () => ({ width: 800, height: 600, scale: 1, fontScale: 1 });
export const Linking = { openURL: async () => {}, canOpenURL: async () => true };
export const PanResponder = { create: () => ({ panHandlers: {} }) };
export const Animated = {
  Value: AnimatedValue,
  View: stub("AnimatedView"),
  Text: stub("AnimatedText"),
  loop: (a) => a ?? anim,
  sequence: () => anim,
  timing: () => anim,
  spring: () => anim,
};
export const Easing = { linear: (v) => v, ease: (v) => v };
export default {
  View, Text, Pressable, ScrollView, TextInput, Image, FlatList, RefreshControl,
  ActivityIndicator, StyleSheet, Platform, Appearance, useColorScheme, Dimensions,
  useWindowDimensions, Linking, PanResponder, Animated, Easing,
};
`;

const RN_STUB_URL = `data:text/javascript,${encodeURIComponent(RN_STUB_SOURCE)}`;

const PASEO_RN_STUB_SOURCE = `
import React from ${JSON.stringify(REACT_URL)};
export const useToast = () => ({ show() {}, error() {}, copied() {} });
export const Icon = (props) => React.createElement("mock-icon", { name: props?.name });
export const Modal = Object.assign(
  (props) => React.createElement("mock-modal", props, props?.children),
  { Content: (props) => React.createElement("mock-modal-content", props, props?.children) },
);
export const ScrollView = (props) => React.createElement("mock-scroll", props, props?.children);
export const FlatList = (props) => React.createElement("mock-flatlist", props, props?.children);
export const TextInput = (props) => React.createElement("mock-textinput", props);
export const copyText = async () => {};
export const useRevealedText = (text) => text;
`;

const PASEO_RN_STUB_URL = `data:text/javascript,${encodeURIComponent(PASEO_RN_STUB_SOURCE)}`;

export interface FleetRenderHarness {
  React: any;
  UppidiFleetSurface: any;
  UppidiFleetTreeView: any;
  DenseAgentRow: any;
  TestRenderer: any;
  /** Mutable per-contract RPC payloads consulted by the injected `useRpc` seam. */
  payloads: Record<string, unknown>;
  render(element: unknown): Promise<unknown>;
  /** Like `render` but also exposes the test renderer root for interaction. */
  renderWithRoot(element: unknown): Promise<{ tree: unknown; root: any; renderer: any }>;
  /**
   * Renders through the real `UppidiFleetPanel` (so the plugin's `VisualFlair`
   * and the helper's measuring container are both in play) and fires the
   * container `onLayout` with `width`, which is how the theme provider learns
   * the real viewport. Without this the provider keeps its non-compact default
   * and the measurement would describe a layout no phone ever renders.
   */
  renderPanelAtWidth(
    width: number,
    tabIndex?: number,
  ): Promise<{ tree: unknown; root: any; renderer: any }>;
}

let harnessPromise: Promise<FleetRenderHarness> | undefined;

export async function getFleetHarness(): Promise<FleetRenderHarness> {
  if (!harnessPromise) {
    harnessPromise = (async () => {
      const nodeModule = await import("node:module");
      (nodeModule as any).registerHooks({
        resolve(specifier: string, context: unknown, nextResolve: (s: string, c: unknown) => unknown) {
          if (specifier === "react-native") return { url: RN_STUB_URL, shortCircuit: true };
          if (specifier === "@getpaseo/plugin/client/react-native") {
            return { url: PASEO_RN_STUB_URL, shortCircuit: true };
          }
          return nextResolve(specifier, context);
        },
      });

      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

      const React = (await import("react")).default;
      const TestRenderer = (await import("react-test-renderer")).default;
      const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
      const { initClientHelpers, defaultDarkTheme } = await import("paseo-plugin-helper/client");
      const { UppidiFleetSurface } = await import("../surface.js");
      const { UppidiFleetTreeView, DenseAgentRow } = await import("../tree-view.js");
      const { UppidiFleetPanel } = await import("../panel.js");

      const payloads: Record<string, unknown> = {};

      initClientHelpers({
        Icon: () => null,
        Modal: Object.assign(() => null, { Content: () => null }),
        // Every RPC read resolves from the mutable payload map. A contract with
        // no entry yields `undefined`, which is exactly the missing-data case.
        useRpc: (contract: { name?: string }) => async () => payloads[contract?.name ?? ""],
        useToast: () => ({ show() {}, error() {}, copied() {} }),
      } as any);

      async function renderWithRoot(element: unknown): Promise<{ tree: unknown; root: any; renderer: any }> {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
        let renderer: any;
        await TestRenderer.act(async () => {
          renderer = TestRenderer.create(
            React.createElement(
              QueryClientProvider,
              { client: queryClient },
              element as React.ReactNode,
            ),
          );
          // Let React Query settle pending undefined-payload queries.
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
        return { tree: renderer.toJSON(), root: renderer.root, renderer };
      }

      async function render(element: unknown): Promise<unknown> {
        return (await renderWithRoot(element)).tree;
      }

      async function renderPanelAtWidth(
        width: number,
        tabIndex?: number,
      ): Promise<{ tree: unknown; root: any; renderer: any }> {
        // `layout` carries no `width` in the host SDK, so the helper provider
        // wraps the surface in a measuring View. Fire it the way a real device
        // would, then let the re-render settle before measuring.
        const { root, renderer } = await renderWithRoot(
          React.createElement(UppidiFleetPanel, {
            theme: defaultDarkTheme,
            host: { id: "test", label: "test" },
            layout: { compact: false, platform: "web" },
            context: "workspace",
            workspaceId: "test-workspace",
          }),
        );
        const measurers = root.findAll((n: any) => typeof n.props?.onLayout === "function", {
          deep: true,
        });
        if (measurers.length > 0) {
          await TestRenderer.act(async () => {
            measurers[0].props.onLayout({ nativeEvent: { layout: { width, height: 844 } } });
          });
        }
        if (tabIndex !== undefined) {
          const tabs = root.findAll((n: any) => n.props?.accessibilityRole === "tab", {
            deep: true,
          });
          if (tabs[tabIndex]) {
            await TestRenderer.act(async () => {
              tabs[tabIndex].props.onPress();
            });
          }
        }
        return { tree: renderer.toJSON(), root, renderer };
      }

      return {
        React,
        UppidiFleetSurface,
        UppidiFleetTreeView,
        DenseAgentRow,
        TestRenderer,
        payloads,
        render,
        renderWithRoot,
        renderPanelAtWidth,
      };
    })();
  }
  return harnessPromise;
}

