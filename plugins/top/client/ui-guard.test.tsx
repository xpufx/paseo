import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { checkInvariants, type GuardReport } from "paseo-plugin-ui-testing";
import { TopTimelineTelemetryCard } from "./telemetry";
import type { TopTimelineTelemetryData } from "../shared/resources";

vi.mock("@getpaseo/plugin/client", () => ({
  useAgent: () => undefined,
}));

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
  ScrollView: (props: { children?: unknown }) =>
    React.createElement("mock-scrollview", props, props.children as React.ReactNode),
  copyText: async () => {},
  useToast: () => ({}),
}));

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

const PALETTE = Object.values(LIGHT.colors);

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
  worktree: "/srv/work/paseo",
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

function renderCard(compact: boolean) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <TopTimelineTelemetryCard
        item={{ type: "plugin", kind: "top-turn-telemetry", version: 1, data: DATA }}
        agentId={DATA.agentId}
        host={{ id: "h", label: "Host" }}
        theme={LIGHT as never}
        layout={{ compact, platform: compact ? "ios" : "web" } as never}
        timestamp={new Date("2026-10-06T18:12:16.000Z")}
      />,
    );
  });
  return renderer;
}

function format(surface: string, width: number, report: GuardReport): string {
  return `${surface} at ${width}px: ` +
    `containment=${report.containment.length} colors=${report.colors.length} ` +
    `truncation=${report.truncation.length} sheet=${report.sheetScrollers.length} ` +
    `owners=${report.scroll.filter((c) => !c.hostOwned).length}`;
}

/**
 * Census of the shared render guard over the top telemetry card (#1043, #1010).
 *
 * The card has no scroll owner of its own and takes its colors from the host
 * theme, so the containment, color, and truncation invariants apply. The card
 * previously lost its density in the helper-UI migration; this is the shared
 * harness applied to the same surface, not a replacement for the targeted
 * `telemetry-layout.test.tsx` cases.
 */
describe("top telemetry card UI-guard census (#1043)", () => {
  for (const compact of [true, false]) {
    it(`holds the invariants at ${compact ? "compact" : "wide"} width`, () => {
      const width = compact ? 390 : 1400;
      const renderer = renderCard(compact);
      const report = checkInvariants(renderer.toJSON(), {
        width,
        palette: PALETTE,
        expectedScrollOwners: 0,
      });
      expect(report.containment, format("telemetry-card", width, report)).toEqual([]);
      expect(report.colors, format("telemetry-card", width, report)).toEqual([]);
      expect(report.truncation, format("telemetry-card", width, report)).toEqual([]);
      expect(report.sheetScrollers, format("telemetry-card", width, report)).toEqual([]);
      renderer.unmount();
    });
  }
});
