import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { getFleetHarness } from "./testing/fleet-harness.js";
import type { UppidiAgent } from "../shared/contracts.js";

// Types for dynamic imports
type KpiStatStripModule = typeof import("./components/kpi-stat-strip.js");
let mod: KpiStatStripModule;

function makeAgent(overrides: Partial<UppidiAgent> = {}): UppidiAgent {
  return {
    id: "agent-" + Math.random().toString(36).slice(2, 8),
    shortId: "a1",
    name: "Test Worker",
    category: "worker",
    status: "idle",
    deterministicState: "unknown",
    ...overrides,
  };
}

describe("Executive KPI Stat Strip (#1086)", () => {
  before(async () => {
    await getFleetHarness();
    mod = await import("./components/kpi-stat-strip.js");
  });

  describe("isTerminalAgentStatus helper", () => {
    it("recognizes all terminal and completed lifecycle statuses", () => {
      assert.equal(mod.isTerminalAgentStatus("closed"), true);
      assert.equal(mod.isTerminalAgentStatus("done"), true);
      assert.equal(mod.isTerminalAgentStatus("failed"), true);
      assert.equal(mod.isTerminalAgentStatus("cancelled"), true);
      assert.equal(mod.isTerminalAgentStatus("completed"), true);
      assert.equal(mod.isTerminalAgentStatus("terminated"), true);
      assert.equal(mod.isTerminalAgentStatus("archived"), true);
      assert.equal(mod.isTerminalAgentStatus("CLOSED"), true);
    });

    it("returns false for non-terminal statuses", () => {
      assert.equal(mod.isTerminalAgentStatus("running"), false);
      assert.equal(mod.isTerminalAgentStatus("thinking"), false);
      assert.equal(mod.isTerminalAgentStatus("idle"), false);
      assert.equal(mod.isTerminalAgentStatus("waiting"), false);
      assert.equal(mod.isTerminalAgentStatus(""), false);
      assert.equal(mod.isTerminalAgentStatus(null), false);
      assert.equal(mod.isTerminalAgentStatus(undefined), false);
    });
  });

  describe("isSameLocalDay and isCompletedRecently", () => {
    const fixedNow = new Date("2026-11-06T12:00:00Z");

    it("matches timestamps on the same calendar day", () => {
      assert.equal(mod.isSameLocalDay("2026-11-06T08:00:00Z", fixedNow), true);
      assert.equal(mod.isSameLocalDay("2026-11-06T23:59:59Z", fixedNow), true);
      assert.equal(mod.isSameLocalDay("2026-11-05T01:00:00Z", fixedNow), false);
      assert.equal(mod.isSameLocalDay(null, fixedNow), false);
    });

    it("considers agents completed within 24 hours as recent", () => {
      const agentWithin24h = makeAgent({
        status: "closed",
        updatedAt: new Date(fixedNow.getTime() - 2 * 3600 * 1000).toISOString(),
      });
      assert.equal(mod.isCompletedRecently(agentWithin24h, fixedNow), true);

      const agent3DaysAgo = makeAgent({
        status: "closed",
        updatedAt: new Date(fixedNow.getTime() - 72 * 3600 * 1000).toISOString(),
      });
      assert.equal(mod.isCompletedRecently(agent3DaysAgo, fixedNow), false);
    });
  });

  describe("calculateKpiStats calculation", () => {
    const fixedNow = new Date("2026-11-06T12:00:00Z");

    it("handles empty agent list gracefully", () => {
      const stats = mod.calculateKpiStats([], { now: fixedNow });
      assert.deepEqual(stats, {
        activeCount: 0,
        blockedCount: 0,
        completedToday: 0,
        queueDepth: 0,
      });
    });

    it("accurately calculates all 4 live KPI metrics", () => {
      const agents: UppidiAgent[] = [
        // Active agents (running/working)
        makeAgent({ id: "a1", deterministicState: "working", status: "running" }),
        makeAgent({ id: "a2", deterministicState: "running", status: "running" }),
        makeAgent({ id: "a3", deterministicState: "unknown", status: "thinking" }),

        // Blocked / waiting agents
        makeAgent({ id: "b1", deterministicState: "attention-required", status: "idle" }),
        makeAgent({ id: "b2", deterministicState: "permission-prompt", status: "idle" }),
        makeAgent({
          id: "b3",
          status: "idle",
          pendingPermissions: [
            {
              id: "p1",
              tool: "bash",
              description: "push",
            },
          ],
        }),
        makeAgent({ id: "b4", isPaused: true, status: "idle" }),
        makeAgent({ id: "b5", deterministicState: "failed:error", status: "error" }),

        // Completed today
        makeAgent({
          id: "c1",
          status: "closed",
          updatedAt: new Date(fixedNow.getTime() - 3 * 3600 * 1000).toISOString(),
        }),
        makeAgent({
          id: "c2",
          status: "done",
          lastActivityAt: new Date(fixedNow.getTime() - 1 * 3600 * 1000).toISOString(),
        }),

        // Completed 4 days ago (should NOT be counted in completedToday)
        makeAgent({
          id: "c3",
          status: "closed",
          updatedAt: new Date(fixedNow.getTime() - 96 * 3600 * 1000).toISOString(),
        }),
      ];

      const stats = mod.calculateKpiStats(agents, {
        queueDepth: 7,
        now: fixedNow,
      });

      assert.equal(stats.activeCount, 3, "activeCount must be 3");
      assert.equal(stats.blockedCount, 5, "blockedCount must be 5");
      assert.equal(stats.completedToday, 2, "completedToday must be 2");
      assert.equal(stats.queueDepth, 7, "queueDepth must be 7");
    });

    it("computes queue depth from repoQueuedHooks or totalQueued when queueDepth is omitted", () => {
      const statsHooks = mod.calculateKpiStats([], {
        repoQueuedHooks: { "repo-a": 3, "repo-b": 4 },
        now: fixedNow,
      });
      assert.equal(statsHooks.queueDepth, 7);

      const statsTotal = mod.calculateKpiStats([], {
        totalQueued: 12,
        now: fixedNow,
      });
      assert.equal(statsTotal.queueDepth, 12);
    });
  });

  describe("matchesKpiFilter predicate", () => {
    const activeAgent = makeAgent({ deterministicState: "working", status: "running" });
    const blockedAgent = makeAgent({ deterministicState: "attention-required", status: "idle" });
    const completedAgent = makeAgent({ status: "closed" });
    const queuedAgent = makeAgent({ queuedHooksCount: 3 });

    it("matches all agents when filter is 'all'", () => {
      assert.equal(mod.matchesKpiFilter(activeAgent, "all"), true);
      assert.equal(mod.matchesKpiFilter(blockedAgent, "all"), true);
      assert.equal(mod.matchesKpiFilter(completedAgent, "all"), true);
    });

    it("matches only active agents when filter is 'active'", () => {
      assert.equal(mod.matchesKpiFilter(activeAgent, "active"), true);
      assert.equal(mod.matchesKpiFilter(blockedAgent, "active"), false);
      assert.equal(mod.matchesKpiFilter(completedAgent, "active"), false);
    });

    it("matches only blocked agents when filter is 'blocked'", () => {
      assert.equal(mod.matchesKpiFilter(activeAgent, "blocked"), false);
      assert.equal(mod.matchesKpiFilter(blockedAgent, "blocked"), true);
      assert.equal(mod.matchesKpiFilter(completedAgent, "blocked"), false);
    });

    it("matches only completed agents when filter is 'completed'", () => {
      assert.equal(mod.matchesKpiFilter(activeAgent, "completed"), false);
      assert.equal(mod.matchesKpiFilter(blockedAgent, "completed"), false);
      assert.equal(mod.matchesKpiFilter(completedAgent, "completed"), true);
    });

    it("matches agents with queued work when filter is 'queue'", () => {
      assert.equal(mod.matchesKpiFilter(queuedAgent, "queue"), true);
      assert.equal(mod.matchesKpiFilter(activeAgent, "queue"), false);
    });
  });

  describe("<KpiStatStrip> component rendering and filter toggles", () => {
    it("renders all 4 metric tiles with live badges and labels", async () => {
      const h = await getFleetHarness();

      const tree = await h.render(
        <mod.KpiStatStrip
          stats={{
            activeCount: 4,
            blockedCount: 2,
            completedToday: 9,
            queueDepth: 15,
          }}
          activeFilter="all"
          onFilterChange={() => {}}
        />
      );

      assert.ok(tree, "KpiStatStrip must render a valid tree");

      // Verify that all 4 tile labels appear
      const rendered = JSON.stringify(tree);
      assert.ok(rendered.includes("Active Agents"), "must render Active Agents tile");
      assert.ok(rendered.includes("Blocked / Waiting"), "must render Blocked / Waiting tile");
      assert.ok(rendered.includes("Completed Today"), "must render Completed Today tile");
      assert.ok(rendered.includes("Queue Depth"), "must render Queue Depth tile");

      // Verify values
      assert.ok(rendered.includes("4"), "must render active count 4");
      assert.ok(rendered.includes("2"), "must render blocked count 2");
      assert.ok(rendered.includes("9"), "must render completed count 9");
      assert.ok(rendered.includes("15"), "must render queue depth 15");
    });

    it("clicking an inactive metric tile triggers onFilterChange with that filter id", async () => {
      const h = await getFleetHarness();
      const actions: string[] = [];

      const tree = await h.render(
        <mod.KpiStatStrip
          stats={{ activeCount: 3, blockedCount: 1, completedToday: 0, queueDepth: 2 }}
          activeFilter="all"
          onFilterChange={(f) => actions.push(f)}
        />
      );

      // Find the blocked tile pressable
      function findTileByTestId(node: any, testID: string): any {
        if (!node) return null;
        if (node.props?.testID === testID) return node;
        const children = Array.isArray(node.children) ? node.children : [];
        for (const child of children) {
          const found = findTileByTestId(child, testID);
          if (found) return found;
        }
        return null;
      }

      const blockedTile = findTileByTestId(tree, "kpi-tile-blocked");
      assert.ok(blockedTile, "kpi-tile-blocked must exist");
      assert.equal(typeof blockedTile.props.onPress, "function");

      // Trigger click
      blockedTile.props.onPress();
      assert.deepEqual(actions, ["blocked"], "clicking blocked tile should set filter to 'blocked'");
    });

    it("clicking the currently active tile toggles the filter back to 'all'", async () => {
      const h = await getFleetHarness();
      const actions: string[] = [];

      const tree = await h.render(
        <mod.KpiStatStrip
          stats={{ activeCount: 5, blockedCount: 2, completedToday: 4, queueDepth: 1 }}
          activeFilter="active"
          onFilterChange={(f) => actions.push(f)}
        />
      );

      function findTileByTestId(node: any, testID: string): any {
        if (!node) return null;
        if (node.props?.testID === testID) return node;
        const children = Array.isArray(node.children) ? node.children : [];
        for (const child of children) {
          const found = findTileByTestId(child, testID);
          if (found) return found;
        }
        return null;
      }

      const activeTile = findTileByTestId(tree, "kpi-tile-active");
      assert.ok(activeTile, "kpi-tile-active must exist");

      // Trigger click on already active tile
      activeTile.props.onPress();
      assert.deepEqual(actions, ["all"], "clicking active tile must toggle filter back to 'all'");
    });

    it("renders empty state cleanly with 0 values without throwing", async () => {
      const h = await getFleetHarness();
      const tree = await h.render(
        <mod.KpiStatStrip
          activeCount={0}
          blockedCount={0}
          completedToday={0}
          queueDepth={0}
          activeFilter="all"
        />
      );

      assert.ok(tree, "empty stat strip should render cleanly");
      const rendered = JSON.stringify(tree);
      assert.ok(rendered.includes("0"), "should render 0 values cleanly");
    });
  });
});
