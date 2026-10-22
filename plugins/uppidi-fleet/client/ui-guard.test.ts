import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { getFleetHarness } from "./testing/fleet-harness.js";
import { colorsOutsidePalette } from "paseo-plugin-ui-testing";
import type { UppidiAgent } from "../shared/contracts.js";

/**
 * A sentinel host theme. Every token is a unique value that appears nowhere in
 * the shipped code, so any color the tree paints that is not one of these is a
 * raw literal that ignored the host `theme` prop (Class B). T1 used to paint
 * `#10b981` / `#f59e0b` / `#ef4444` regardless of the host palette.
 */
const SENTINEL_THEME = {
  colors: {
    surface0: "#010101",
    surface1: "#020202",
    surface2: "#030303",
    border: "#040404",
    foreground: "#050505",
    foregroundMuted: "#060606",
    accent: "#070707",
    accentForeground: "#080808",
    statusSuccess: "#090909",
    statusWarning: "#0a0a0a",
    statusDanger: "#0b0b0b",
  },
} as const;
const SENTINEL_PALETTE = Object.values(SENTINEL_THEME.colors);

function makeAgent(overrides: Partial<UppidiAgent> = {}): UppidiAgent {
  return {
    id: "agent-" + Math.random().toString(36).slice(2, 7),
    category: "worker",
    status: "idle",
    deterministicState: "idle:waiting",
    ...overrides,
  } as UppidiAgent;
}

describe("uppidi-fleet UI-guard census (#1043)", () => {
  it("paints the status-light trio from the host palette, never the raw taxonomy hexes (T1)", async () => {
    const harness = await getFleetHarness();
    const [{ HostThemeProvider }, { AgentStatusLightsRow }] = await Promise.all([
      import("./theme.js"),
      import("./tree-view.js"),
    ]);
    const agents = [
      makeAgent({ id: "a-working", status: "running", deterministicState: "working" }),
      makeAgent({ id: "a-idle", status: "idle", deterministicState: "idle:waiting" }),
      makeAgent({ id: "a-failed", status: "error", deterministicState: "failed:error" }),
    ];
    const { renderer } = await harness.renderWithRoot(
      React.createElement(
        HostThemeProvider,
        { theme: SENTINEL_THEME } as never,
        React.createElement(AgentStatusLightsRow, { agents }),
      ),
    );
    const outside = colorsOutsidePalette(renderer.toJSON(), SENTINEL_PALETTE);
    assert.deepEqual(
      outside.map((c) => `${c.property}=${c.value}`),
      [],
      "status lights must resolve to host theme tokens (statusSuccess/Warning/Danger)",
    );
    renderer.unmount();
  });
});
