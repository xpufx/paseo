import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import React from "react";
// Type-only, so it is erased at runtime and cannot pull `react-native` in early.
import type { Skin, SurfaceLayout } from "../kit.js";

/**
 * The host stand-in the client tests render through.
 *
 * `react-native` ships Flow syntax `tsx` cannot parse, and the plugin's host
 * component entry pulls in the real one, so both are aliased to data-URL stubs
 * through a resolve hook. Everything else — react, react-test-renderer, the
 * real views, the real `SkinProvider` — is the real thing. Only those two host
 * modules are fake, and only because they are the two that cannot be parsed.
 *
 * Nothing here imports `./kit.tsx` or a view statically: those pull in
 * `react-native` at module scope, so they may only be loaded *after*
 * {@link installHostStubs} has installed the hooks.
 */
const require = createRequire(import.meta.url);
const REACT_URL = pathToFileURL(require.resolve("react")).href;

const RN_STUB = `
import React from ${JSON.stringify(REACT_URL)};
function stub(name) {
  function RNStub(props) { return React.createElement(name, props, props?.children); }
  Object.defineProperty(RNStub, "name", { value: "RN" + name });
  return RNStub;
}
class AnimatedValue {
  constructor(v) { this.value = v; }
  setValue(v) { this.value = v; }
  interpolate() { return this; }
}
const anim = { start: (cb) => cb?.({ finished: true }), stop() {}, reset() {} };
export const View = stub("View");
export const Text = stub("Text");
export const Pressable = stub("Pressable");
export const ScrollView = stub("ScrollView");
export const TextInput = stub("TextInput");
export const Modal = stub("Modal");
export const ActivityIndicator = stub("ActivityIndicator");
export const StyleSheet = { create: (s) => s, flatten: (s) => s, hairlineWidth: 1, compose: (a, b) => [a, b], absoluteFill: {} };
export const Platform = { OS: "web", select: (o) => o.web ?? o.default };
export const Appearance = { getColorScheme: () => "dark", addChangeListener: () => ({ remove() {} }) };
export const useColorScheme = () => "dark";
export const Dimensions = { get: () => ({ width: 1400, height: 900, scale: 1, fontScale: 1 }) };
export const useWindowDimensions = () => ({ width: 1400, height: 900, scale: 1, fontScale: 1 });
export const Linking = { openURL: async () => {}, canOpenURL: async () => true };
export const Animated = {
  Value: AnimatedValue,
  View: stub("AnimatedView"),
  Text: stub("AnimatedText"),
  loop: (a) => a ?? anim,
  sequence: () => anim,
  timing: () => anim,
  parallel: () => anim,
};
`;

const PASEO_RN_STUB = `
import React from ${JSON.stringify(REACT_URL)};
export const useToast = () => ({ show() {}, error() {} });
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

const STUB_URL = `data:text/javascript,${encodeURIComponent(RN_STUB)}`;
const PASEO_RN_STUB_URL = `data:text/javascript,${encodeURIComponent(PASEO_RN_STUB)}`;

/**
 * Installs the resolve hooks and the React act environment. Idempotent, so every
 * test file can call it from its own `before` without coordinating.
 */
let installed = false;
export function installHostStubs(): void {
  if (installed) return;
  installed = true;
  const nodeModule = require("node:module") as unknown as {
    registerHooks(hooks: {
      resolve(specifier: string, context: unknown, next: (s: string, c: unknown) => unknown): unknown;
    }): void;
  };
  nodeModule.registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "react-native") return { url: STUB_URL, shortCircuit: true };
      if (specifier === "@getpaseo/plugin/client/react-native") {
        return { url: PASEO_RN_STUB_URL, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

/** The parts of `react-test-renderer` the harness uses, without its types. */
interface TestRenderer {
  create(element: unknown): { toJSON(): unknown; unmount(): void };
  act(callback: () => void | Promise<void>): void;
}

let rendererPromise: Promise<TestRenderer> | undefined;

async function loadRenderer(): Promise<TestRenderer> {
  if (!rendererPromise) {
    rendererPromise = import("react-test-renderer").then(
      (mod) => (mod as { default: TestRenderer }).default,
    );
  }
  return rendererPromise;
}

type Kit = typeof import("../kit.js");
let kitPromise: Promise<Kit> | undefined;

/** Loads the surface kit, which is only loadable once the hooks are installed. */
function loadKit(): Promise<Kit> {
  if (!kitPromise) kitPromise = import("../kit.js");
  return kitPromise;
}

export interface LoadedViews {
  FleetView: typeof import("../fleet-view.js").FleetView;
  QueueView: typeof import("../queue-view.js").QueueView;
  TicketsView: typeof import("../tickets-view.js").TicketsView;
  TicketDetail: typeof import("../ticket-detail.js").TicketDetail;
}

let viewsPromise: Promise<LoadedViews> | undefined;

/** The four surfaces #684 names, loaded through the same host stubs. */
export function loadViews(): Promise<LoadedViews> {
  if (!viewsPromise) {
    viewsPromise = (async () => {
      const [fleet, queue, tickets, detail] = await Promise.all([
        import("../fleet-view.js"),
        import("../queue-view.js"),
        import("../tickets-view.js"),
        import("../ticket-detail.js"),
      ]);
      return {
        FleetView: fleet.FleetView,
        QueueView: queue.QueueView,
        TicketsView: tickets.TicketsView,
        TicketDetail: detail.TicketDetail,
      };
    })();
  }
  return viewsPromise;
}

export interface RenderedSurface {
  /** The rendered element tree, for the layout measurement in `flex-measure`. */
  readonly tree: unknown;
  /** Every `testID` in the tree. */
  readonly ids: Set<string>;
  /** Every text leaf in the tree, flattened. */
  readonly texts: string[];
  /**
   * Presses the element carrying `testID` and re-collects. Needed for the state
   * a surface only reaches by interaction, e.g. the narrow modal branch of the
   * tickets view, which is exactly the branch a width-derived fix has to hold.
   */
  press(testID: string): void;
  unmount(): void;
}

/**
 * Renders an element inside the real `SkinProvider`, so a surface resolves the
 * same width/platform signals it resolves in the host. `layout.width` is the
 * viewport the host allocated, which is the only thing a responsive decision in
 * this plugin is allowed to consult.
 */
export async function renderInSkin(
  element: React.ReactElement,
  options: { theme?: unknown; layout?: Partial<SurfaceLayout> } = {},
): Promise<RenderedSurface> {
  const [{ SkinProvider }, renderer] = await Promise.all([loadKit(), loadRenderer()]);
  let instance:
    | {
        toJSON(): unknown;
        unmount(): void;
        root: { find(predicate: (node: any) => boolean): any };
      }
    | undefined;
  // React 19 defers the initial mount until `act` flushes it, so the tree has to
  // be created inside `act` for `toJSON()` to have anything in it.
  renderer.act(() => {
    instance = renderer.create(
      React.createElement(SkinProvider, {
        theme: options.theme as never,
        layout: { compact: false, platform: "web", width: 1400, ...options.layout } as never,
        onCopy: () => {},
        children: element,
      }),
    ) as never;
  });

  const ids = new Set<string>();
  const texts: string[] = [];
  let snapshot: unknown = null;
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const typed = node as { props?: Record<string, unknown>; children?: unknown };
    if (typed.props?.testID) ids.add(String(typed.props.testID));
    if (Array.isArray(typed.children)) {
      for (const child of typed.children) {
        if (child && typeof child === "object" && "type" in (child as object)) {
          const childProps = (child as { props?: Record<string, unknown> }).props;
          if (typeof childProps?.children === "string") texts.push(childProps.children);
          walk(child);
        } else if (typeof child === "string") {
          texts.push(child);
        } else {
          walk(child);
        }
      }
    }
  };
  const collect = (): void => {
    snapshot = instance!.toJSON();
    ids.clear();
    texts.length = 0;
    walk(snapshot);
  };
  collect();

  return {
    get tree() {
      return snapshot;
    },
    ids,
    texts,
    press(testID: string) {
      const node = instance!.root.find((candidate: any) => candidate?.props?.testID === testID);
      if (!node) throw new Error(`no rendered element carries testID=${testID}`);
      renderer.act(() => {
        node.props.onPress?.();
      });
      collect();
    },
    unmount: () => instance!.unmount(),
  };
}

/**
 * The `Skin` a given layout descriptor resolves to, read through the real
 * provider rather than by re-deriving the breakpoint arithmetic in the test.
 */
export async function readSkin(layout: Partial<SurfaceLayout>): Promise<Skin> {
  const { SkinProvider, useSkin } = await loadKit();
  const renderer = await loadRenderer();
  let captured: Skin | undefined;
  function Probe() {
    captured = useSkin();
    return null;
  }
  let tree: { unmount(): void } | undefined;
  renderer.act(() => {
    tree = renderer.create(
      React.createElement(SkinProvider, {
        theme: undefined as never,
        layout: { compact: false, platform: "web", width: 1400, ...layout } as never,
        onCopy: () => {},
        children: React.createElement(Probe),
      }),
    );
  });
  const skin = captured;
  tree!.unmount();
  if (!skin) throw new Error("the skin probe never rendered");
  return skin;
}

export { React };
