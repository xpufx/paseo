import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { getFleetHarness } from "./testing/fleet-harness.js";
import { colorsOutsidePalette, checkInvariants, type GuardReport } from "paseo-plugin-ui-testing";
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

/**
 * Census of the shared render guard over the uppidi-fleet agent switcher
 * (xpufx-org/paseo#1043, #893).
 *
 * The switcher popover renders inside the host popover, which is the single
 * scroll owner: the plugin "required" scroll-owner contract means it must add
 * none of its own. That is the invariant this file pins through the shared
 * harness — the same check `agent-switcher.test.tsx` makes against the raw
 * render tree, expressed as the shared one.
 */

function makeAgent(overrides: Partial<UppidiAgent> = {}): UppidiAgent {
  return {
    id: "agent-" + Math.random().toString(36).slice(2, 7),
    category: "worker",
    status: "idle",
    deterministicState: "idle:waiting",
    ...overrides,
  } as UppidiAgent;
}

function summary(surface: string, width: number, report: GuardReport): string {
  return (
    `${surface} at ${width}px: containment=${report.containment.length} ` +
    `colors=${report.colors.length} truncation=${report.truncation.length} ` +
    `sheet=${report.sheetScrollers.length} owners=${report.scroll.filter((c) => !c.hostOwned).length}`
  );
}

describe("uppidi-fleet agent-switcher UI-guard census (#1043)", () => {
  it("keeps containment, truncation, and scroll ownership clean at a phone width", async () => {
    const harness = await getFleetHarness();
    const { AgentSwitcherPopover } = await import("./agent-switcher.js");
    const { HostThemeProvider } = await import("./theme.js");

    harness.payloads["uppidi-fleet.agents"] = {
      ok: true,
      frontDesk: [makeAgent({ id: "fd-1", category: "front-desk", name: "Front Desk" })],
      orchestrators: [
        makeAgent({
          id: "orch-1",
          category: "orchestrator",
          name: "paseo orchestrator",
          project: "xpufx-org/paseo",
        }),
      ],
      workers: [],
      tree: [],
      enrolledRepos: ["xpufx-org/paseo"],
      pausedRepos: [],
      repoQueuedHooks: {},
    };

    const { renderer } = await harness.renderWithRoot(
      React.createElement(
        HostThemeProvider,
        { theme: SENTINEL_THEME } as never,
        React.createElement(AgentSwitcherPopover, {
          host: { id: "srv-test", label: "Test" },
          layout: { compact: true, platform: "ios" },
          close: () => {},
          openScreen: () => {},
        } as never),
      ),
    );
    await harness.TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const report = checkInvariants(renderer.toJSON(), {
      width: 390,
      palette: SENTINEL_PALETTE,
      expectedScrollOwners: 0,
    });
    assert.deepEqual(
      report.colors.map((c) => `${c.property}=${c.value}`),
      [],
      summary("agent-switcher", 390, report),
    );
    assert.deepEqual(
      report.containment.map((f) => `${f.testID ?? f.type}:+${f.excess}`),
      [],
      summary("agent-switcher", 390, report),
    );
    assert.deepEqual(
      report.truncation.map((t) => t.text.slice(0, 40)),
      [],
      summary("agent-switcher", 390, report),
    );
    assert.equal(
      report.scroll.filter((c) => !c.hostOwned).length,
      0,
      "the host popover owns the scroll; the switcher must add none",
    );
    assert.deepEqual(report.sheetScrollers, [], summary("agent-switcher", 390, report));
    renderer.unmount();
  });

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
