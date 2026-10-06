import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initClientHelpers } from "paseo-plugin-helper/core";
import {
  heightClamps,
  scrollContainers,
  sheetScrollersInsideModal,
} from "paseo-plugin-ui-testing";
import { contributeClient } from "./pill";
import { HostModalSection } from "./host-ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The host SDK's react-native entry is `export {}` at runtime; the host bundler
// injects the real primitives. The test supplies the same stubs at that seam,
// with distinct element types so a plugin scroller (`host-scroll-view`) is
// distinguishable from the host modal body (`host-modal-content`).
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

async function openTopPill() {
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
  return mounted;
}

/**
 * Regression for xpufx-org/paseo#975 / #1054: the top pill modal must have one
 * scroll owner, and on the centered path that owner is the host.
 *
 * #1056 removed the host sheet scroller and put a plain React Native
 * `ScrollView` inside `<Modal.Content scrollable={false}>`, asserting the
 * plugin's `flex: 1` chain bounded it. That chain is not a viewport on native:
 * `Modal.Content` with `scrollable={false}` does not hand the body a bounded
 * frame, so the inner scroller had no scroll range and the modal froze. The
 * supported single-owner model is the helper's `hostScroll: true`: the host
 * `<Modal.Content scrollable={true}>` is the ONLY scroller and the plugin
 * renders fluid, unconstrained content beneath it. This test pins that model,
 * so it fails on the #1056 tree (host scrollable=false + one nested plugin
 * scroller) and passes only when the host owns the scroll.
 */
describe("top pill modal scroll ownership (#975/#1054)", () => {
  it("delegates the single scroll to the host and renders no nested scroller", async () => {
    const renderer = await openTopPill();

    const modalContent = renderer.root.find((node) => typeOf(node) === "host-modal-content");
    expect(modalContent.props.scrollable).toBe(true);

    const tree = renderer.toJSON();
    const containers = scrollContainers(tree);
    const pluginOwned = containers.filter((container) => !container.hostOwned);
    // The host body is the one and only scroll boundary; no nested scroller may
    // compete with it (plain RN or the host's sheet-gesture scroller).
    expect(pluginOwned, "no plugin-owned scroller may sit inside the host modal body").toEqual([]);
    expect(containers.filter((container) => container.hostOwned)).toHaveLength(1);
    expect(sheetScrollersInsideModal(tree)).toEqual([]);
    expect(renderer.root.findAll((node) => typeOf(node) === "ScrollView")).toHaveLength(0);
    expect(renderer.root.findAll((node) => typeOf(node) === "host-scroll-view")).toHaveLength(0);
  });

  it("keeps the host-scrolled section fluid instead of clamping it to the viewport", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <HostModalSection>
          <React.Fragment />
        </HostModalSection>,
      );
    });
    const section = renderer.root.findAll((node) => typeOf(node) === "View")[0];
    expect(section).toBeDefined();
    const style = flattenStyle(section!.props.style);
    // A host ScrollView measures its children: a flex: 1 / minHeight: 0 section
    // would be pinned to the viewport and clip everything past the first screen
    // instead of extending the scroll range.
    expect(style.flex, "HostModalSection must not flex-fill under host scroll").toBeUndefined();
    expect(style.minHeight, "HostModalSection must not clamp its height").toBeUndefined();
    expect(style.width).toBe("100%");
  });

  it("renders no height-clamped boxes in the host-scrolled body (#975/#1054)", async () => {
    const renderer = await openTopPill();
    expect(heightClamps(renderer.toJSON())).toEqual([]);
  });
});
