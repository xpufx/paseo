import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { bumpPluginLoadCount, initClientHelpers } from "paseo-plugin-helper/core";
import { PluginReloadBanner } from "paseo-plugin-helper/ui";
import { TopDashboardSurface } from "./surface";
import { Pressable, Text } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => ({}),
  useWorkspace: (_id: string, sel: (w: unknown) => unknown) => sel({ directory: "/repo" }),
  useAgent: (_id: string, sel: (a: unknown) => unknown) =>
    sel({ title: "Worker", model: "gpt-5.4", provider: "codex", status: "running" }),
}));

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
  ScrollView: (props: Record<string, unknown>) =>
    React.createElement("host-scroll-view", props, props.children as React.ReactNode),
  useToast: () => ({ show: () => {}, error: () => {} }),
  copyText: async () => {},
}));

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
    useRpc: () => async () => ({}),
    useToast: () => ({ show: () => {}, error: () => {} }),
    copyText: async () => {},
    FlatList: () => null,
    TextInput: () => null,
  } as unknown as Parameters<typeof initClientHelpers>[0]);
}

function renderSurface() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={queryClient}>
        <TopDashboardSurface theme={LIGHT} layout={layout} host={{ id: "h", label: "H" }} />
      </QueryClientProvider>,
    );
  });
  return renderer;
}

function getAllText(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text as any)
    .map((n: any) => n.props.children)
    .flat();
}

describe("TopDashboardSurface reload banner (#1343)", () => {
  beforeEach(() => {
    installHost();
    const keys = Object.keys((globalThis as any).__PASEO_PLUGIN_LOAD_COUNT__ || {});
    for (const k of keys) {
      delete (globalThis as any).__PASEO_PLUGIN_LOAD_COUNT__[k];
    }
  });

  afterEach(() => {
    const keys = Object.keys((globalThis as any).__PASEO_PLUGIN_LOAD_COUNT__ || {});
    for (const k of keys) {
      delete (globalThis as any).__PASEO_PLUGIN_LOAD_COUNT__[k];
    }
    vi.restoreAllMocks();
  });

  it("does not display reload banner on initial load (bump count === 1)", () => {
    bumpPluginLoadCount("top");
    const renderer = renderSurface();
    const banner = renderer.root.findAllByType(PluginReloadBanner);
    expect(banner).toHaveLength(0);
    const texts = getAllText(renderer);
    expect(texts.some((t) => typeof t === "string" && t.includes("Plugin was reloaded"))).toBe(false);
  });

  it("mounts and displays the reload banner when bundle evaluated multiple times (reloaded)", () => {
    bumpPluginLoadCount("top");
    bumpPluginLoadCount("top");
    const renderer = renderSurface();
    const banner = renderer.root.findAllByType(PluginReloadBanner);
    expect(banner).toHaveLength(1);
    expect(banner[0].props.pluginId).toBe("top");

    const texts = getAllText(renderer);
    expect(texts.some((t) => t === "⚡")).toBe(true);
    expect(
      texts.some(
        (t) =>
          typeof t === "string" &&
          t.includes("Plugin was reloaded on the daemon. Please refresh to load updated views."),
      ),
    ).toBe(true);
  });

  it("dismisses the reload banner when Dismiss button is tapped", () => {
    bumpPluginLoadCount("top");
    bumpPluginLoadCount("top");
    const renderer = renderSurface();

    const banner = renderer.root.findByType(PluginReloadBanner);
    expect(banner).toBeDefined();

    const pressables = banner.findAllByType(Pressable as any);
    const dismissBtn = pressables.find((p: any) => {
      const child = p.props.children;
      if (child && typeof child === "object" && "props" in child) {
        return child.props.children === "Dismiss";
      }
      return false;
    });
    expect(dismissBtn).toBeDefined();

    act(() => {
      dismissBtn!.props.onPress!();
    });

    const texts = getAllText(renderer);
    expect(texts.some((t) => typeof t === "string" && t.includes("Plugin was reloaded"))).toBe(false);
  });
});
