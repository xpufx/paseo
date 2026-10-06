import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act, type ReactTestInstance } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initClientHelpers } from "paseo-plugin-helper/core";
import { contributeClient } from "./pill";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const LIGHT = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#d4d4d8",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#16a34a",
    statusWarning: "#ca8a04",
    statusDanger: "#dc2626",
  },
} as const;
const FALLBACK_ACCENT = "#3b82f6";
const layout = { compact: false, platform: "web" } as const;

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

function registerTopPill() {
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
        <Icon agentId="a1" workspaceId="w1" theme={LIGHT} layout={layout} host={{ id: "h", label: "H" }} />
      </QueryClientProvider>,
    );
  });
  return renderer;
}

function pressTab(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const tabs = renderer.root.findAll(
    (node: ReactTestInstance) => node.props?.accessibilityRole === "tab",
  );
  const target = tabs.find((tab) => {
    const text = tab.findAll((node) => typeof node.props?.children === "string");
    return text.some((node) => node.props.children === label);
  });
  if (!target) throw new Error(`tab "${label}" not found`);
  act(() => target.props.onPress());
}

function accentBackgrounds(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node: ReactTestInstance) => typeof node.props?.style !== "undefined")
    .map((node) => flattenStyle(node.props.style).backgroundColor)
    .filter((color): color is string => typeof color === "string");
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
 * Regression for xpufx-org/paseo#1009: the permission-audit filter tabs painted
 * a hardcoded dark fallback because `PermissionAuditView` keeps its own colors
 * context and top never handed it the host `theme`. Rendering the pill modal on
 * a light host must resolve the light accent.
 */
describe("top surfaces obey the host light/dark mode (#1009)", () => {
  it("threads the host theme into the permission-audit filter tabs", async () => {
    const pill = registerTopPill();
    await act(async () => {
      await Promise.resolve();
    });
    const Icon = pill.PillIcon();
    expect(Icon).toBeDefined();

    act(() => pill.open());
    mounted = renderModal(Icon!);
    cleanupPill = pill.cleanup;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    pressTab(mounted, "Permissions");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const backgrounds = accentBackgrounds(mounted);
    expect(backgrounds).toContain(LIGHT.colors.accent);
    expect(backgrounds).not.toContain(FALLBACK_ACCENT);
  });
});
