import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Pressable } from "react-native";
import { TopTimelineTelemetryCard } from "./telemetry";
import type { TopTimelineTelemetryData } from "../shared/resources";

vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
}));

// The host SDK's react-native entry is `export {}` at runtime (the host
// bundler injects the real primitives), so the test supplies the same seams
// the plugin initialises with.
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
  ScrollView: (props: { children?: unknown }) =>
    React.createElement("mock-scrollview", props, props.children as React.ReactNode),
  copyText: async () => {},
  useToast: () => ({}),
}));

// Enable every metric on the timeline surface. The real per-metric defaults
// leave several vitals pill-only, which would hide the density under test.
vi.mock("paseo-plugin-helper/core", () => {
  const ids = [
    "cpu_ram",
    "branch",
    "worktree",
    "agent_id",
    "load",
    "uptime",
    "mcp",
    "agent_title",
    "agent",
    "agent_provider",
    "agent_activity",
    "changes",
    "tokens",
    "tools",
    "turns",
  ];
  const settings = { metricSurfaces: Object.fromEntries(ids.map((id) => [id, "both"])) };
  return { usePluginSettings: () => ({ settings }) };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const DATA: TopTimelineTelemetryData = {
  turnId: "turn-1",
  agentId: "8f4aa62abcdef",
  outcomeKind: "failed",
  timestamp: "2026-10-06T18:12:16.000Z",
  durationMs: 1000,
  cpuPercent: 7,
  memUsedBytes: 3.8 * 1024 ** 3,
  memTotalBytes: 24 * 1024 ** 3,
  memPercent: 16,
  loadAvg1m: 0.15,
  mcpInstalled: true,
  mcpRunning: true,
  mcpHealthy: 1,
  mcpTotal: 2,
  agentModel: "gemini-3.8-flash-low",
  agentProvider: "antigravity",
  agentTitle: "Front Desk",
  branch: "main",
  worktree: "/home/dev-user/worktrees/front-desk",
  uptimeSeconds: 101_000,
  toolCalls: 137,
  toolErrors: 0,
  turnCount: 57,
  inputTokens: 5954,
  outputTokens: 338,
  cachedTokens: 422_263,
  contextUsedTokens: 63_000,
  contextMaxTokens: 1_000_000,
};

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object") {
    const el = node as { type?: unknown; children?: unknown };
    if (el.type === "mock-icon") return "";
    if ("children" in el) return textOf(el.children);
  }
  return "";
}

type StyleNode = { style: Record<string, unknown>; children: unknown[] };

/** Collect every node that carries a style object along with its children. */
function styledNodes(node: unknown): StyleNode[] {
  const out: StyleNode[] = [];
  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    if (!current || typeof current !== "object") return;
    const el = current as { props?: { style?: unknown }; children?: unknown };
    const style = el.props?.style;
    const merged: Record<string, unknown> = {};
    for (const entry of Array.isArray(style) ? style.flat(Infinity) : [style]) {
      if (entry && typeof entry === "object") Object.assign(merged, entry);
    }
    if (Object.keys(merged).length > 0) {
      out.push({ style: merged, children: Array.isArray(el.children) ? el.children : [] });
    }
    if ("children" in el) walk(el.children);
  };
  walk(node);
  return out;
}

function styleOf(child: unknown): Record<string, unknown> {
  const style = (child as { props?: { style?: unknown } })?.props?.style;
  const merged: Record<string, unknown> = {};
  for (const entry of Array.isArray(style) ? style.flat(Infinity) : [style]) {
    if (entry && typeof entry === "object") Object.assign(merged, entry);
  }
  return merged;
}

function renderCard() {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <TopTimelineTelemetryCard
        item={{ type: "plugin", kind: "top-turn-telemetry", version: 1, data: DATA }}
        agentId={DATA.agentId}
        host={{ id: "h", label: "Host" }}
        theme={LIGHT as never}
        layout={{ compact: false, platform: "web" }}
        timestamp={new Date("2026-10-06T18:12:16.000Z")}
      />,
    );
  });
  return renderer;
}

function toggle(renderer: TestRenderer.ReactTestRenderer) {
  const header = renderer.root
    .findAllByType(Pressable)
    .find(
      (node) =>
        (node.props.accessibilityState as { expanded?: boolean } | undefined)?.expanded !==
        undefined,
    );
  if (!header) throw new Error("collapsible header pressable not found");
  act(() => {
    (header.props.onPress as () => void)();
  });
}

/**
 * Regression for xpufx-org/paseo#1010: the timeline telemetry card lost its
 * density in the helper-UI migration. The pre-migration card surfaced the
 * default vitals while collapsed and packed them several per row. These tests
 * drive the real `TopTimelineTelemetryCard` render path.
 */
describe("TopTimelineTelemetryCard layout density (#1010)", () => {
  it("surfaces the default vitals while collapsed, without expanding", () => {
    const renderer = renderCard();
    const text = textOf(renderer.toJSON());

    expect(text).toContain("Turn Failed");
    expect(text).toContain("CPU 7%");
    expect(text).toContain("Load 0.15");
    expect(text).toContain("gemini-3.8-flash-low");
    expect(text).toContain("antigravity");
    expect(text).toContain("Front Desk");
    expect(text).toContain("57 turns");
    // The detail sections stay behind the expand toggle.
    expect(text).not.toContain("Tokens & Context");
  });

  it("packs many vitals into wrapping rows instead of one pill per line", () => {
    const renderer = renderCard();
    const nodes = styledNodes(renderer.toJSON());

    const chips = nodes.filter((node) => node.style.maxWidth === 110);
    expect(chips.length).toBeGreaterThanOrEqual(6);
    for (const chip of chips) {
      expect(chip.style.flexGrow).toBe(1);
      expect(chip.style.width).not.toBe("100%");
    }

    // The chips must live inside a wrap row, so the browser can flow several
    // per line. Without this the (width: 100%) HostRow base forced one per line.
    const wrappingRow = nodes.find(
      (node) =>
        node.style.flexWrap === "wrap" &&
        node.children.some((child) => styleOf(child).maxWidth === 110),
    );
    expect(wrappingRow).toBeDefined();
  });

  it("keeps the dense vitals visible when expanded and adds the detail sections", () => {
    const renderer = renderCard();
    toggle(renderer);
    const text = textOf(renderer.toJSON());

    expect(text).toContain("CPU 7%");
    expect(text).toContain("57 turns");
    expect(text).toContain("Tokens & Context");
    expect(text).toContain("Turn Details");
  });
});
