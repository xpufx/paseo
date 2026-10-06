import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initClientHelpers } from "paseo-plugin-helper/core";
import { scrollContainers, sheetScrollersInsideModal } from "paseo-plugin-ui-testing";
import { contributeClient } from "./pill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The host SDK's react-native entry is `export {}` at runtime; the host bundler
// injects the real primitives. The test supplies the same stubs at that seam,
// with distinct element types so the plugin's `HostScroll` (the host scroller)
// is distinguishable from a plain React Native ScrollView.
vi.mock("@getpaseo/plugin/client", () => ({
  useWorkspace: (_id: string, sel: (w: unknown) => unknown) => sel({ directory: "/repo" }),
  useAgent: (_id: string, sel: (a: unknown) => unknown) =>
    sel({ title: "Worker", model: "gpt-5.4", provider: "codex", status: "running" }),
  useRpc: () => async () => ({}),
}));

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
  ScrollView: (props: Record<string, unknown>) =>
    React.createElement("host-scroll-view", props, props.children as React.ReactNode),
  useToast: () => ({ show: () => {}, error: () => {} }),
  copyText: async () => {},
}));

const RESOURCES = {
  cpuUsagePercent: 24,
  memoryUsedBytes: 1024 ** 3,
  memoryTotalBytes: 8 * 1024 ** 3,
  memoryUsedPercent: 26,
  loadAvg: [1.23, 1.0, 0.8],
  uptimeSeconds: 90_000,
  branch: "main",
  hostname: "host",
  version: "9.9.9",
  mcpInstalled: true,
  mcpRunning: true,
  mcp: { healthy: 1, total: 1, down: 0, degraded: 0, isStale: false, servers: [] },
  lastTurn: {
    turnCount: 14,
    toolCalls: 9,
    toolErrors: 1,
    gitInsertions: 12,
    gitDeletions: 3,
    inputTokens: 500,
    outputTokens: 388,
  },
};

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
    useRpc: () => async () => RESOURCES,
    useToast: () => ({ show: () => {}, error: () => {} }),
    copyText: async () => {},
    FlatList: () => null,
    TextInput: () => null,
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
 * Registers the real top pill through `contributeClient` and returns the live
 * trigger icon plus its opener, so the test drives the same centered-modal path
 * the host mounts (not a reconstructed copy of it).
 */
function registerTopPill() {
  let PillIcon: React.ComponentType<Record<string, unknown>> | undefined;
  let openPill: (() => void) | undefined;
  const client = {
    addComposerPill: (contribution: {
      button: { icon: React.ComponentType<Record<string, unknown>>; behavior: { onPress?: () => void } };
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
 * Regression for xpufx-org/paseo#975 and #1043/#1054: the top pill modal is
 * the single scroll owner, and its scroller must not carry the host's sheet
 * gestures.
 *
 * The centered composer-pill wrapper hands `renderModal` a bounded `flex: 1`
 * frame and (with the default `hostScroll: false`) no scroller, so the plugin's
 * modal scroller must be the single, bounded owner. When the #847/#957
 * migration replaced `ModalBody`'s `flex: 1`/`minHeight: 0` root with a plain
 * `HostModalSection`, the section sized to its content and the scroller never
 * got a viewport. This pins the single-owner contract: exactly one scroll
 * container, and every flex ancestor above it bounded so content can overflow
 * into a scroll range instead of being clipped.
 *
 * The #1043 census then found the same defect mcp-tools had (#219): the owner
 * used the host SDK `ScrollView`, which wires the host's sheet pan gestures, as
 * the inner scroller of `<Modal.Content scrollable={false}>`, handing the same
 * gesture to two recognizers. The modal body must use the plain React Native
 * `ScrollView`; the full-page surface and turn panel keep the host scroller
 * (they have no enclosing modal gesture to fight).
 */
describe("top pill modal scroll ownership (#975/#1054)", () => {
  it("owns the scroll with a plain React Native scroller, not the host sheet", async () => {
    const pill = registerTopPill();
    await act(async () => {
      await Promise.resolve();
    });
    const Icon = pill.PillIcon();
    expect(Icon).toBeDefined();

    act(() => pill.open());
    mounted = renderModal(Icon!);
    cleanupPill = pill.cleanup;

    // Let the resource stopwatch settle so the system tab mounts.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // Exactly one plugin scroller, and it is the plain React Native one.
    const scrollers = mounted.root.findAll((node) => typeOf(node) === "ScrollView");
    expect(scrollers).toHaveLength(1);
    // The host SDK's sheet-gesture scroller must not appear inside the modal.
    expect(mounted.root.findAll((node) => typeOf(node) === "host-scroll-view")).toHaveLength(0);

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

  it("carries no host sheet scroller inside the modal body (harness invariant)", async () => {
    const pill = registerTopPill();
    await act(async () => {
      await Promise.resolve();
    });
    const Icon = pill.PillIcon();
    act(() => pill.open());
    mounted = renderModal(Icon!);
    cleanupPill = pill.cleanup;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const tree = mounted.toJSON();
    expect(sheetScrollersInsideModal(tree)).toEqual([]);
    const owners = scrollContainers(tree).filter((container) => !container.hostOwned);
    expect(owners).toHaveLength(1);
  });
});
