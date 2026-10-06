import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ScrollView, Text, View } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initClientHelpers } from "paseo-plugin-helper/core";
import {
  PermissionAuditThemeProvider,
  PermissionAuditView,
  usePermissionAuditColors,
} from "./client.js";
import type { AuditRecord } from "./shared.js";
import type { PluginTheme } from "paseo-plugin-helper/shared";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Render tests for the migrated `PermissionAuditView` (paseo#847 Phase 3).
 *
 * The view no longer renders `ModalBody`: the page variant owns exactly one
 * scroller (the host `ScrollView` it renders directly), and the compact
 * variant renders no scroller at all. These tests pin that contract — scroll
 * must keep working with no `ModalBody` scroll owner anywhere in the tree —
 * and pin the host-theme flow through the view's theme provider.
 */

const HOST_THEME: PluginTheme = {
  colors: {
    surface0: "#101010",
    surface1: "#202020",
    surface2: "#303030",
    border: "#404040",
    foreground: "#eeeeee",
    foregroundMuted: "#999999",
    accent: "#0066cc",
    accentForeground: "#ffffff",
    statusSuccess: "#00aa44",
    statusWarning: "#cc8800",
    statusDanger: "#cc2200",
  },
};

const ENTRIES: AuditRecord[] = [
  {
    id: "r1",
    timestamp: "2026-09-28T10:00:00.000Z",
    agentId: "agent-1",
    kind: "tool",
    name: "bash",
    input: { command: "ls" },
    decision: "allow",
  },
  {
    id: "r2",
    timestamp: "2026-09-28T10:05:00.000Z",
    agentId: "agent-2",
    kind: "tool",
    name: "read",
    input: { path: "/etc/hosts" },
    decision: "deny",
  },
  {
    recordType: "tool_call",
    id: "call-1",
    timestamp: "2026-09-28T10:06:00.000Z",
    turnId: "turn-9",
    sequence: 3,
    agentId: "agent-1",
    kind: "tool_call",
    name: "Write",
    input: { filePath: "/tmp/out.txt" },
    outcome: "success",
  },
];

function installHost() {
  initClientHelpers({
    Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({ entries: ENTRIES, total: ENTRIES.length }),
    useToast: () => ({}),
  } as unknown as Parameters<typeof initClientHelpers>[0]);
}

function renderView(props: React.ComponentProps<typeof PermissionAuditView>) {
  installHost();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>
        <PermissionAuditView {...props} />
      </QueryClientProvider>,
    );
  });
  return renderer;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (node && typeof node === "object") {
    const el = node as { type?: unknown; children?: unknown };
    if (el.type === "mock-icon") return "";
    if ("children" in el) return textOf(el.children);
  }
  return "";
}

describe("PermissionAuditView scroll ownership after ModalBody removal", () => {
  it("page variant owns exactly one scroller and renders audit rows", async () => {
    const renderer = renderView({ variant: "page" });
    await settle();
    expect(renderer.root.findAllByType(ScrollView)).toHaveLength(1);
    const text = textOf(renderer.toJSON());
    expect(text).toContain("bash");
    expect(text).toContain("read");
  });

  it("compact variant renders rows without nesting its own scroller", async () => {
    const renderer = renderView({ variant: "compact" });
    await settle();
    expect(renderer.root.findAllByType(ScrollView)).toHaveLength(0);
    const text = textOf(renderer.toJSON());
    expect(text).toContain("bash");
    expect(text).toContain("Denied");
  });

  it("page variant renders no ModalBody scroll-owner context consumer", async () => {
    const renderer = renderView({ variant: "page" });
    await settle();
    // The single scroller is the view's own ScrollView; nothing else in the
    // tree provides one, so content reaches the bottom of a long list.
    const scrollViews = renderer.root.findAllByType(ScrollView);
    expect(scrollViews).toHaveLength(1);
    expect(scrollViews[0].props.contentContainerStyle).toBeTruthy();
  });
});

describe("PermissionAuditView host theme flow", () => {
  it("paints with the host theme provided via the view's theme provider", async () => {
    let captured: string | null = null;
    function Probe() {
      const colors = usePermissionAuditColors();
      captured = colors.foreground;
      return <Text>probe</Text>;
    }
    installHost();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    act(() => {
      TestRenderer.create(
        <QueryClientProvider client={client}>
          <PermissionAuditThemeProvider theme={HOST_THEME}>
            <Probe />
          </PermissionAuditThemeProvider>
        </QueryClientProvider>,
      );
    });
    expect(captured).toBe("#eeeeee");
  });

  it("wraps provided theme around the whole view (page variant)", async () => {
    const renderer = renderView({ variant: "page", theme: HOST_THEME });
    await settle();
    // The view provides its host theme when supplied; rows still render.
    const text = textOf(renderer.toJSON());
    expect(text).toContain("bash");
  });
});

describe("PermissionAuditView data behavior", () => {
  it("scopes rows to the selected agent", async () => {
    const renderer = renderView({ variant: "compact", agentId: "agent-2" });
    await settle();
    const text = textOf(renderer.toJSON());
    expect(text).toContain("read");
    expect(text).not.toContain("bash");
  });

  it("renders tool calls with an outcome badge alongside permissions", async () => {
    const renderer = renderView({ variant: "compact" });
    await settle();
    const text = textOf(renderer.toJSON());
    expect(text).toContain("Write");
    expect(text).toContain("Success");
    expect(text).toContain("Allowed");
    expect(text).toContain("Denied");
  });

  it("renders the empty state when no entries match", async () => {
    const renderer = renderView({ variant: "compact", agentId: "no-such-agent" });
    await settle();
    const text = textOf(renderer.toJSON());
    expect(text).toContain("No audit entries yet");
  });
});
