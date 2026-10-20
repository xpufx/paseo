import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Pressable } from "react-native";
import { TopTimelineTelemetryCard } from "./telemetry";
import type { TopTimelineTelemetryData } from "../shared/resources";

let mockAgentUsage: Record<string, unknown> | undefined = undefined;

vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: (_id?: string, selector?: (a: { lastUsage?: unknown }) => unknown) => {
    const snap = { lastUsage: mockAgentUsage };
    return selector ? selector(snap) : snap;
  },
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

let mockPluginSettings: { metricSurfaces?: Record<string, string> } = {
  metricSurfaces: Object.fromEntries(
    [
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
      "velocity",
    ].map((id) => [id, "both"]),
  ),
};

vi.mock("paseo-plugin-helper/core", () => {
  return { usePluginSettings: () => ({ settings: mockPluginSettings }) };
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

function renderCard(
  layout: { compact: boolean; platform: string } = { compact: false, platform: "web" },
  dataOverrides: Partial<TopTimelineTelemetryData> = {},
) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <TopTimelineTelemetryCard
        item={{
          type: "plugin",
          kind: "top-turn-telemetry",
          version: 1,
          data: { ...DATA, ...dataOverrides },
        }}
        agentId={DATA.agentId}
        host={{ id: "h", label: "Host" }}
        theme={LIGHT as never}
        layout={layout as never}
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

const COMPACT = { compact: true, platform: "ios" };

/**
 * Regression for the mobile half of xpufx-org/paseo#1010. On native Yoga the
 * collapsible header slots are auto-width, so a nested `HostRow` (base
 * `width: 100%`) resolves its percentage against an indefinite parent and the
 * title column collapses to zero width. The card then grew a tall blank block
 * and stranded the outcome/time row mid-card, and the expanded detail spilled
 * under the composer. These tests drive the real compact render path and pin
 * the structural fixes: content-sized header rows, a visible summary, and
 * bottom clearance for the expanded content.
 */
describe("TopTimelineTelemetryCard compact layout (#1010 mobile)", () => {
  it("keeps the collapsed card content-sized with the summary vitals visible", () => {
    const renderer = renderCard(COMPACT);
    const text = textOf(renderer.toJSON());

    expect(text).toContain("Turn Failed");
    expect(text).toContain("CPU 7%");
    expect(text).toContain("57 turns");
    expect(text).not.toContain("Tokens & Context");

    // The card container must not grow or reserve a fixed height to fill the
    // timeline cell; the collapsed card is header + summary only.
    const [card] = styledNodes(renderer.toJSON());
    expect(card.style).toBeDefined();
    expect(card.style.flex).toBeUndefined();
    expect(card.style.flexGrow).toBeUndefined();
    expect(card.style.height).toBeUndefined();
    expect(card.style.minHeight).toBeUndefined();
  });

  it("opts the header rows out of the full-width default that collapsed them on Yoga", () => {
    const renderer = renderCard(COMPACT);
    const nodes = styledNodes(renderer.toJSON());

    // The title row and headerRight row (the two nested HostRows) must not
    // claim the full header width. On native Yoga that is what resolves to a
    // zero-width title column and the tall blank region.
    const inlineHeaderRows = nodes.filter((node) => node.style.width === "auto");
    expect(inlineHeaderRows.length).toBeGreaterThanOrEqual(2);

    const titleRow = inlineHeaderRows[0];
    expect(textOf(titleRow.children)).toContain("Turn Failed");
    const headerRightRow = inlineHeaderRows[1];
    expect(textOf(headerRightRow.children)).toContain("via top");
  });

  it("gives the expanded detail bottom clearance so it cannot sit under the composer", () => {
    const renderer = renderCard(COMPACT);
    toggle(renderer);

    const nodes = styledNodes(renderer.toJSON());
    const content = nodes.find(
      (node) => typeof node.style.paddingBottom === "number" && node.style.paddingBottom >= 32,
    );
    expect(content).toBeDefined();
    // The detail sections still render below the always-visible summary.
    expect(textOf(renderer.toJSON())).toContain("Tokens & Context");
  });

  it("uses tighter compact padding than the desktop frame", () => {
    const compactNodes = styledNodes(renderCard(COMPACT).toJSON());
    const desktopNodes = styledNodes(renderCard().toJSON());

    const compactPaddings = new Set(
      compactNodes.map((node) => node.style.paddingHorizontal).filter(Boolean),
    );
    const desktopPaddings = new Set(
      desktopNodes.map((node) => node.style.paddingHorizontal).filter(Boolean),
    );

    expect(compactPaddings.has(10)).toBe(true);
    expect(desktopPaddings.has(10)).toBe(false);
  });
});

describe("TopTimelineTelemetryCard velocity badge (#1308)", () => {
  it("renders the velocity badge with icon next to duration with valid tokensPerSecond", () => {
    // 38 tok/s rendered with ⚡ icon
    const renderer = renderCard(undefined, {
      durationMs: 30000,
      tokensPerSecond: 38,
    });
    const text = textOf(renderer.toJSON());
    expect(text).toContain("30.0s");
    expect(text).toContain("⚡ 38 tok/s");
  });

  it("rounds tokensPerSecond to nearest integer in velocity badge", () => {
    const renderer = renderCard(undefined, {
      durationMs: 10000,
      tokensPerSecond: 7.4,
    });
    const text = textOf(renderer.toJSON());
    expect(text).toContain("10.0s");
    expect(text).toContain("⚡ 7 tok/s");
  });

  it("appends context pressure indicators for warning and high levels", () => {
    const warnRenderer = renderCard(undefined, {
      tokensPerSecond: 38,
      contextPressureLevel: "warning",
    });
    expect(textOf(warnRenderer.toJSON())).toContain("⚡ 38 tok/s · ⚠️ warn ctx");

    const highRenderer = renderCard(undefined, {
      tokensPerSecond: 38,
      contextPressureLevel: "high",
    });
    expect(textOf(highRenderer.toJSON())).toContain("⚡ 38 tok/s · ⚠️ high ctx");
  });

  it("omits the velocity header badge when tokensPerSecond is absent or non-finite", () => {
    const missingTokens = renderCard(undefined, {
      durationMs: 5000,
      tokensPerSecond: undefined,
    });
    const nodes = styledNodes(missingTokens.toJSON());
    const headerBadges = nodes.filter(
      (node) => node.style.flexShrink === 0 && textOf(node.children).includes("⚡"),
    );
    expect(headerBadges.length).toBe(0);

    const nanTokens = renderCard(undefined, {
      durationMs: 5000,
      tokensPerSecond: NaN,
    });
    const nanNodes = styledNodes(nanTokens.toJSON());
    const nanHeaderBadges = nanNodes.filter(
      (node) => node.style.flexShrink === 0 && textOf(node.children).includes("⚡"),
    );
    expect(nanHeaderBadges.length).toBe(0);
  });

  it("does not render redundant non-icon throughput badge even with outputTokens and durationMs", () => {
    const renderer = renderCard(undefined, {
      durationMs: 30000,
      outputTokens: 1140,
      tokensPerSecond: undefined,
    });
    const text = textOf(renderer.toJSON());
    expect(text).toContain("30.0s");
    expect(text).not.toContain("⚡");
    expect(text).not.toContain("38 tok/s");
  });

  it("does not render duplicate velocity in the summary row (#1465)", () => {
    const renderer = renderCard(undefined, {
      durationMs: 30000,
      tokensPerSecond: 38,
    });
    const text = textOf(renderer.toJSON());
    expect(text).toContain("⚡ 38 tok/s");
    // Verify velocity appears only once across the rendered card (in header badge, not bottom summary)
    const matches = text.match(/tok\/s/g);
    expect(matches).toHaveLength(1);
    expect(text).not.toContain("vel --");
  });

  it("gates velocity badge behind the velocity setting", () => {
    const orig = mockPluginSettings;
    try {
      mockPluginSettings = {
        metricSurfaces: {
          ...orig.metricSurfaces,
          velocity: "none",
        },
      };
      const disabled = renderCard(undefined, {
        durationMs: 30000,
        tokensPerSecond: 38,
      });
      const textDisabled = textOf(disabled.toJSON());
      expect(textDisabled).toContain("30.0s");
      expect(textDisabled).not.toContain("⚡ 38 tok/s");

      mockPluginSettings = {
        metricSurfaces: {
          ...orig.metricSurfaces,
          velocity: "timeline",
        },
      };
      const enabled = renderCard(undefined, {
        durationMs: 30000,
        tokensPerSecond: 38,
      });
      const textEnabled = textOf(enabled.toJSON());
      expect(textEnabled).toContain("30.0s");
      expect(textEnabled).toContain("⚡ 38 tok/s");
    } finally {
      mockPluginSettings = orig;
    }
  });

  it("ensures duration and velocity badges do not collapse on compact/mobile (flexShrink: 0)", () => {
    const renderer = renderCard(COMPACT, {
      durationMs: 30000,
      tokensPerSecond: 38,
    });
    const nodes = styledNodes(renderer.toJSON());
    // Find badge nodes in the title row
    const nonShrinkingBadges = nodes.filter(
      (node) =>
        node.style.flexShrink === 0 &&
        (textOf(node.children).includes("30.0s") || textOf(node.children).includes("⚡ 38 tok/s")),
    );
    expect(nonShrinkingBadges.length).toBe(2);
  });
});

describe("TopTimelineTelemetryCard historical isolation from liveUsage (#1480)", () => {
  it("does not reflect liveUsage when data.inputTokens, data.outputTokens, and data.contextUsedTokens are absent", () => {
    mockAgentUsage = {
      inputTokens: 99_999,
      outputTokens: 11_111,
      cachedInputTokens: 50_000,
      contextWindowUsedTokens: 88_888,
      contextWindowMaxTokens: 200_000,
      totalCostUsd: 12.34,
    };

    try {
      const renderer = renderCard(undefined, {
        inputTokens: undefined,
        outputTokens: undefined,
        cachedTokens: undefined,
        cachedInputTokens: undefined,
        contextUsedTokens: undefined,
        contextMaxTokens: undefined,
        costUsd: undefined,
      });

      const textCollapsed = textOf(renderer.toJSON());
      // Summary vitals must display placeholder '--' instead of bleeding active liveUsage backwards
      expect(textCollapsed).toContain("tok --");
      expect(textCollapsed).not.toContain("99,999");
      expect(textCollapsed).not.toContain("11,111");
      expect(textCollapsed).not.toContain("88k");
      expect(textCollapsed).not.toContain("12.34");

      // Expand card to check detail section
      toggle(renderer);
      const textExpanded = textOf(renderer.toJSON());
      expect(textExpanded).toContain("Tokens & Context");
      expect(textExpanded).toContain("Not reported by provider");
      expect(textExpanded).not.toContain("99,999");
      expect(textExpanded).not.toContain("11,111");
      expect(textExpanded).not.toContain("12.34");

      // Verify explicit Copy handler also isolates from liveUsage
      const copyButton = renderer.root.find(
        (node) => node.props.accessibilityLabel === "Copy timeline card",
      );
      const copyText = copyButton.props.getText();
      expect(copyText).not.toContain("99999");
      expect(copyText).not.toContain("11111");
      expect(copyText).not.toContain("12.34");
    } finally {
      mockAgentUsage = undefined;
    }
  });

  it("does not dynamically update historical cards when liveUsage changes across turns", () => {
    mockAgentUsage = {
      inputTokens: 12_000,
      outputTokens: 3_000,
    };

    try {
      const renderer = renderCard(undefined, {
        inputTokens: undefined,
        outputTokens: undefined,
        contextUsedTokens: undefined,
        contextMaxTokens: undefined,
      });

      const textBefore = textOf(renderer.toJSON());
      expect(textBefore).toContain("tok --");
      expect(textBefore).not.toContain("12,000");

      // Simulate live agent executing new turns and updating liveUsage in memory
      mockAgentUsage = {
        inputTokens: 850_000,
        outputTokens: 42_000,
      };

      const textAfter = textOf(renderer.toJSON());
      expect(textAfter).toContain("tok --");
      expect(textAfter).not.toContain("850,000");
      expect(textAfter).not.toContain("42,000");
    } finally {
      mockAgentUsage = undefined;
    }
  });

  it("renders turn-specific telemetry data faithfully without interference from liveUsage", () => {
    mockAgentUsage = {
      inputTokens: 99_999,
      outputTokens: 11_111,
      contextWindowUsedTokens: 88_888,
      totalCostUsd: 99.99,
    };

    try {
      const renderer = renderCard(undefined, {
        inputTokens: 500,
        outputTokens: 200,
        contextUsedTokens: 1200,
        contextMaxTokens: 4000,
        costUsd: 0.05,
      });

      const textCollapsed = textOf(renderer.toJSON());
      expect(textCollapsed).toContain("1.2k/4k (30% ctx)");
      expect(textCollapsed).not.toContain("88k");

      toggle(renderer);
      const textExpanded = textOf(renderer.toJSON());
      expect(textExpanded).toContain("In: 500");
      expect(textExpanded).toContain("Out: 200");
      expect(textExpanded).toContain("$0.05");
      expect(textExpanded).not.toContain("99,999");
      expect(textExpanded).not.toContain("99.99");
    } finally {
      mockAgentUsage = undefined;
    }
  });
});
