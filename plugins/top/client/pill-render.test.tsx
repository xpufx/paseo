import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initClientHelpers } from "paseo-plugin-helper/client";
import { SingleItemPillView, type SingleItemPillViewProps } from "./pill";
import type { PillItemType } from "./pill-labels";

vi.mock("@getpaseo/plugin/client", () => ({
  useWorkspace: (_id: string, sel: (w: unknown) => unknown) =>
    sel({ directory: "/home/user/.paseo/worktrees/2h0dw6vb/money-lion" }),
  useAgent: (_id: string, sel: (a: unknown) => unknown) => sel(agent),
  useRpc: () => async () => ({}),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let agent: Record<string, unknown> = {};

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
  mcp: {
    healthy: 1,
    total: 1,
    down: 0,
    degraded: 0,
    isStale: false,
    updatedAt: "2026-09-24T00:00:00.000Z",
    servers: [],
  },
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

function installHost() {
  initClientHelpers({
    Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => RESOURCES,
    useToast: () => ({}),
  } as unknown as Parameters<typeof initClientHelpers>[0]);
}

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

const MOBILE_LAYOUT = { compact: true, platform: "ios", width: 390, height: 844 } as const;

const renderProps: Omit<SingleItemPillViewProps, "item"> = {
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  workspaceId: "w1",
  agentId: "a1",
  theme: { colors: {} } as never,
  layout: MOBILE_LAYOUT as never,
  host: { id: "h", label: "Host" },
};

function renderPill(item: PillItemType): TestRenderer.ReactTestRenderer {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>
        <SingleItemPillView item={item} {...renderProps} />
      </QueryClientProvider>,
    );
  });
  return renderer;
}

/** Let the mocked resource query settle so the pill renders with data, not "top...". */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** Collect every style object reachable in the rendered tree. */
function collectStyles(node: unknown): Array<Record<string, unknown>> {
  const styles: Array<Record<string, unknown>> = [];
  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }
    if (!current || typeof current !== "object") return;
    const el = current as { props?: { style?: unknown }; children?: unknown };
    const style = el.props?.style;
    for (const entry of Array.isArray(style) ? style.flat(Infinity) : [style]) {
      if (entry && typeof entry === "object") styles.push(entry as Record<string, unknown>);
    }
    if ("children" in el) walk(el.children);
  };
  walk(node);
  return styles;
}

beforeEach(() => {
  installHost();
  agent = { title: "Worker", model: "gpt-5.4", provider: "codex", status: "running" };
});

/**
 * Regression for xpufx-org/paseo#507: the top pill body could render with no
 * text and no enforced height on a mobile viewport, collapsing to an unreadable
 * skinny/empty line. These tests drive the real render path (`SingleItemPillView`
 * -> `PillSegment` -> `PillItemContent`) under a compact iOS layout.
 */
describe("top pill body never renders empty/collapsed on mobile (#507)", () => {
  it("renders meaningful, non-empty text for the default (cpu_ram) pill", async () => {
    const renderer = renderPill("cpu_ram");
    await settle();
    const text = textOf(renderer.toJSON()).trim();
    expect(text.length).toBeGreaterThan(0);
    // A CPU/RAM pill must carry both readings, not one blank half.
    expect(text).toMatch(/%/);
    expect(text).not.toBe("-- · --");
  });

  it("renders non-empty text for every pill item even when the host fields are blank strings", async () => {
    // Blank-but-present values are the exact failure class: `??` treats "" as
    // present, so the descriptor emitted an empty label and the body vanished.
    agent = { title: "", model: "", provider: "", status: "running", lastActivityAt: "" };
    const items: PillItemType[] = [
      "cpu_ram",
      "branch",
      "worktree",
      "agent_title",
      "agent",
      "agent_provider",
      "agent_activity",
      "agent_id",
      "load",
      "uptime",
      "mcp",
      "changes",
      "tokens",
      "tools",
      "turns",
    ];
    for (const item of items) {
      const renderer = renderPill(item);
      await settle();
      const text = textOf(renderer.toJSON()).trim();
      expect(text.length, `${item} pill rendered empty content`).toBeGreaterThan(0);
      renderer.unmount();
    }
  });

  it("enforces a minimum height so the pill body cannot collapse to a skinny line", async () => {
    agent = { title: "", model: "", provider: "", status: "running", lastActivityAt: "" };
    const renderer = renderPill("agent_title");
    await settle();
    const minHeights = collectStyles(renderer.toJSON())
      .map((style) => style.minHeight)
      .filter((value): value is number => typeof value === "number" && value > 0);
    expect(minHeights.length).toBeGreaterThan(0);
    expect(Math.max(...minHeights)).toBeGreaterThanOrEqual(20);
  });
});
