import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initClientHelpers } from "paseo-plugin-helper/core";
import { contributeClient } from "./pill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The host SDK's react-native entry is `export {}` at runtime; the host bundler
// injects the real primitives. The test supplies the same stubs at that seam,
// with distinct element types so the plugin's local `HostScroll` (which wraps
// the host `ScrollView`) is distinguishable from a plain React Native scroller.
vi.mock("@getpaseo/plugin/client", () => ({
  useWorkspace: (_id: string, sel: (w: unknown) => unknown) => sel({ directory: "/repo" }),
  useAgent: (_id: string, sel: (a: unknown) => unknown) => sel({ title: "Worker", status: "running" }),
  useRpc: () => async () => ({ results: [] }),
}));

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
  Modal: Object.assign(
    (props: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, props.children),
    { Content: (props: { children?: React.ReactNode }) => props.children },
  ),
  ScrollView: (props: Record<string, unknown>) =>
    React.createElement("host-scroll-view", props, props.children as React.ReactNode),
  TextInput: () => null,
  useToast: () => ({ show: () => {}, error: () => {} }),
  copyText: async () => {},
}));

const RPC_RESULT = { results: [], servers: [], paseoTools: [], provider: "stub", cwd: null, error: null };

const theme = {
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
} as never;
const layout = { compact: false, platform: "web" } as never;

function installHost() {
  initClientHelpers({
    Icon: (props: Record<string, unknown>) =>
      React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(
      (props: { open?: boolean; children?: React.ReactNode }) =>
        props.open ? React.createElement(React.Fragment, null, props.children) : null,
      {
        Content: (props: { children?: React.ReactNode; scrollable?: boolean }) =>
          React.createElement(
            "host-modal-content",
            { scrollable: props.scrollable },
            props.children,
          ),
      },
    ),
    ScrollView: (props: Record<string, unknown>) =>
      React.createElement("host-scroll-view", props, props.children as React.ReactNode),
    TextInput: () => null,
    useRpc: () => async () => RPC_RESULT,
    useToast: () => ({ show: () => {}, error: () => {} }),
    copyText: async () => {},
    FlatList: () => null,
  } as unknown as Parameters<typeof initClientHelpers>[0]);
}

/** Flattens an RN style prop (arrays, nested arrays) into one object. */
function flattenStyle(style: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visit = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object") Object.assign(out, value);
  };
  visit(style);
  return out;
}

function typeOf(node: ReactTestInstance): string {
  return String(node.type);
}

function ancestorsOf(node: ReactTestInstance): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  let current = node.parent;
  while (current) {
    out.push(current);
    current = current.parent;
  }
  return out;
}

/**
 * Registers the real mcp-tools pill through `contributeClient` and returns the
 * live trigger icon plus its opener, so the test drives the same centered-modal
 * path the host mounts (not a reconstructed copy of it).
 */
function registerMcpPill() {
  let PillIcon: React.ComponentType<Record<string, unknown>> | undefined;
  let openPill: (() => void) | undefined;
  const client = {
    addComposerPill: (contribution: {
      button: {
        icon: React.ComponentType<Record<string, unknown>>;
        behavior: { onPress?: () => void };
      };
    }) => {
      PillIcon = contribution.button.icon;
      openPill = contribution.button.behavior.onPress;
      return { update: () => {}, remove: () => {} };
    },
    paseo: {
      agents: {
        subscribe: () => () => {},
        list: async () => ({ entries: [{ agent: { id: "a1", workspaceId: "w1" } }] }),
      },
    },
  };
  let cleanup: (() => void) | undefined;
  act(() => {
    cleanup = contributeClient(client as never);
  });
  return {
    PillIcon: () => PillIcon,
    open: () => openPill?.(),
    cleanup: () => cleanup?.(),
  };
}

function renderModal(Icon: React.ComponentType<Record<string, unknown>>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Icon agentId="a1" workspaceId="w1" theme={theme} layout={layout} host={{ id: "h", label: "H" }} />
      </QueryClientProvider>,
    );
  });
  return renderer;
}

let mounted: TestRenderer.ReactTestRenderer | undefined;
let cleanupPill: (() => void) | undefined;

beforeEach(() => {
  installHost();
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  cleanupPill?.();
  cleanupPill = undefined;
});

/**
 * Regression for xpufx-org/paseo#1043: the MCP pill modal did not scroll.
 *
 * Like the #975 top surface, the centered composer-pill wrapper hands
 * `renderModal` a bounded `flex: 1` frame and, with `hostScroll` unset, renders
 * `<Modal.Content scrollable={false}>`. The plugin is therefore the required
 * scroll owner and must supply exactly one scroller (`HostScroll`) inside a
 * fully flex-bounded chain. Before the fix `HostModalSection` merely had
 * `width`/`gap`, so it sized to its content, the scroller never got a viewport,
 * and content clipped. This pins the single-owner contract for mcp-tools.
 */
describe("mcp-tools pill modal scroll ownership (#1043)", () => {
  it("renders exactly one scroll owner inside a fully bounded flex chain", async () => {
    const pill = registerMcpPill();
    await act(async () => {
      await Promise.resolve();
    });
    const Icon = pill.PillIcon();
    expect(Icon).toBeDefined();

    act(() => pill.open());
    mounted = renderModal(Icon!);
    cleanupPill = pill.cleanup;

    // Let the settings + MCP queries settle so the servers tab mounts.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const scrollers = mounted.root.findAll((node) => typeOf(node) === "host-scroll-view");
    expect(scrollers).toHaveLength(1);
    // No second, plain React Native scroller nested under it.
    expect(mounted.root.findAll((node) => typeOf(node) === "ScrollView")).toHaveLength(0);

    const modalContent = mounted.root.find((node) => typeOf(node) === "host-modal-content");
    expect(modalContent.props.scrollable).toBe(false);

    // Every View between the host's modal body and the single scroller must
    // flex-fill, or one of them sizes to its content and the scroller collapses.
    const chain = ancestorsOf(scrollers[0]!);
    const modalIndex = chain.findIndex((node) => typeOf(node) === "host-modal-content");
    expect(modalIndex).toBeGreaterThan(0);
    const innerViews = chain.slice(0, modalIndex).filter((node) => typeOf(node) === "View");
    expect(innerViews.length).toBeGreaterThanOrEqual(3);
    for (const view of innerViews) {
      const style = flattenStyle(view.props.style);
      expect(style.flex, `flex ancestor ${typeOf(view)} must flex-fill`).toBe(1);
      expect(style.minHeight, `flex ancestor ${typeOf(view)} must allow shrink`).toBe(0);
    }
  });
});
