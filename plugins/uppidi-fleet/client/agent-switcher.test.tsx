import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { getFleetHarness } from "./testing/fleet-harness.js";
import { mapAgentSwitcherData } from "./agent-switcher-data.js";
import type { UppidiAgent } from "../shared/contracts.js";

function makeAgent(overrides: Partial<UppidiAgent> = {}): UppidiAgent {
  return {
    id: "agent-" + Math.random().toString(36).slice(2, 7),
    category: "worker",
    status: "idle",
    deterministicState: "idle:waiting",
    ...overrides,
  } as UppidiAgent;
}

interface RenderedNode {
  props?: Record<string, any>;
  children?: RenderedNode[] | string | Array<RenderedNode | string | null>;
}

function flatten(node: RenderedNode | null, out: RenderedNode[] = []): RenderedNode[] {
  if (!node) return out;
  out.push(node);
  for (const child of (Array.isArray(node.children) ? node.children : []) as RenderedNode[]) {
    flatten(child, out);
  }
  return out;
}

function renderedText(tree: RenderedNode | null): string {
  const parts: string[] = [];
  for (const node of flatten(tree)) {
    if (typeof node.props?.label === "string") parts.push(node.props.label);
    if (typeof node.children === "string") parts.push(node.children);
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (typeof child === "string") parts.push(child);
      }
    }
  }
  return parts.join(" ");
}

describe("Issue #893: Desktop Agent Switcher Dropdown", () => {
  describe("mapAgentSwitcherData", () => {
    it("returns null frontDesk and empty orchestrators when input is null or undefined", () => {
      assert.deepEqual(mapAgentSwitcherData(null), {
        frontDesk: null,
        orchestratorsByRepo: [],
      });
      assert.deepEqual(mapAgentSwitcherData(undefined), {
        frontDesk: null,
        orchestratorsByRepo: [],
      });
    });

    it("extracts the first live front desk agent", () => {
      const fd1 = makeAgent({ id: "fd-1", category: "front-desk", name: "Front Desk Live" });
      const fd2 = makeAgent({ id: "fd-2", category: "front-desk", name: "Front Desk Backup" });
      const res = mapAgentSwitcherData({
        frontDesk: [fd1, fd2],
        orchestrators: [],
      });
      assert.equal(res.frontDesk?.id, "fd-1");
      assert.equal(res.frontDesk?.name, "Front Desk Live");
    });

    it("groups orchestrators by repo and sorts them alphabetically", () => {
      const orch1 = makeAgent({
        id: "orch-repo-b",
        category: "orchestrator",
        name: "Repo B Orch",
        project: "xpufx-org/repo-b",
      });
      const orch2 = makeAgent({
        id: "orch-repo-a",
        category: "orchestrator",
        name: "Repo A Orch",
        project: "xpufx-org/repo-a",
      });
      const orchDup = makeAgent({
        id: "orch-repo-a-dup",
        category: "orchestrator",
        name: "Repo A Orch Second",
        project: "xpufx-org/repo-a",
      });

      const res = mapAgentSwitcherData({
        frontDesk: [],
        orchestrators: [orch1, orch2, orchDup],
      });

      assert.equal(res.orchestratorsByRepo.length, 2);
      assert.equal(res.orchestratorsByRepo[0]!.repo, "xpufx-org/repo-a");
      assert.equal(res.orchestratorsByRepo[0]!.orchestrator.id, "orch-repo-a");
      assert.equal(res.orchestratorsByRepo[1]!.repo, "xpufx-org/repo-b");
      assert.equal(res.orchestratorsByRepo[1]!.orchestrator.id, "orch-repo-b");
    });

    it("falls back to attributedWork.repo or labels['repo'] when project is missing", () => {
      const orch1 = makeAgent({
        id: "orch-attr",
        category: "orchestrator",
        attributedWork: { repo: "xpufx-org/attr-repo" },
      });
      const orch2 = makeAgent({
        id: "orch-label",
        category: "orchestrator",
        labels: { repo: "xpufx-org/label-repo" },
      });

      const res = mapAgentSwitcherData({
        frontDesk: [],
        orchestrators: [orch1, orch2],
      });

      assert.equal(res.orchestratorsByRepo.length, 2);
      assert.equal(res.orchestratorsByRepo[0]!.repo, "xpufx-org/attr-repo");
      assert.equal(res.orchestratorsByRepo[1]!.repo, "xpufx-org/label-repo");
    });

    it("prefers the registry repo key over display-derived project and labels (#1078)", () => {
      const orch = makeAgent({
        id: "orch-registry",
        category: "orchestrator",
        name: "Orchestrator · paseo",
        project: "stale/display-project",
        labels: { repo: "stale/label-repo" },
        registryRepoKey: "forge.example.com/xpufx-org/paseo",
      });

      const res = mapAgentSwitcherData({ frontDesk: [], orchestrators: [orch] });
      assert.equal(res.orchestratorsByRepo.length, 1);
      assert.equal(res.orchestratorsByRepo[0]!.repo, "forge.example.com/xpufx-org/paseo");
    });
  });

  describe("AgentSwitcherDropdown UI rendering", () => {
    it("renders empty states gracefully when no frontdesk and no orchestrators", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherDropdown } = await import("./agent-switcher.js");

      const { renderer } = await harness.renderWithRoot(
        React.createElement(AgentSwitcherDropdown, {
          frontDesk: null,
          orchestratorsByRepo: [],
          onSelectAgent: () => {},
        }),
      );

      const text = renderedText(renderer.toJSON());
      assert.match(text, /Front Desk/);
      assert.match(text, /No live Front Desk/);
      assert.match(text, /Orchestrators/);
      assert.match(text, /No orchestrators registered/);
    });

    it("renders live Front Desk and registered orchestrators with navigation trigger on select", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherDropdown } = await import("./agent-switcher.js");

      const fd = makeAgent({
        id: "fd-live-id",
        name: "Front Desk Primary",
        category: "front-desk",
        deterministicState: "running",
      });

      const orch = makeAgent({
        id: "orch-paseo-id",
        name: "Paseo Orchestrator",
        category: "orchestrator",
        project: "xpufx-org/paseo",
        deterministicState: "working",
      });

      const selectedAgents: string[] = [];
      let closed = false;

      const { root, renderer } = await harness.renderWithRoot(
        React.createElement(AgentSwitcherDropdown, {
          frontDesk: fd,
          orchestratorsByRepo: [{ repo: "xpufx-org/paseo", orchestrator: orch }],
          onSelectAgent: (id) => selectedAgents.push(id),
          close: () => {
            closed = true;
          },
        }),
      );

      const text = renderedText(renderer.toJSON());
      assert.match(text, /Front Desk Primary/);
      assert.match(text, /Paseo Orchestrator/);
      assert.match(text, /xpufx-org\/paseo/);

      // Find pressables / interactive rows by testID
      const fdRow = root.find((n: any) => n.props?.testID === "agent-row-fd-live-id");
      const orchRow = root.find((n: any) => n.props?.testID === "agent-row-orch-paseo-id");
      assert.ok(fdRow, "must render Front Desk row");
      assert.ok(orchRow, "must render Orchestrator row");

      // Press Front Desk row
      await harness.TestRenderer.act(async () => {
        fdRow.props.onPress();
      });
      assert.equal(selectedAgents[0], "fd-live-id");
      assert.equal(closed, true);

      // Press Orchestrator row
      await harness.TestRenderer.act(async () => {
        orchRow.props.onPress();
      });
      assert.equal(selectedAgents[1], "orch-paseo-id");
    });
  });

  describe("AgentSwitcherSidebarItem and in-client navigation", () => {
    it("renders the sidebar icon with the RadioTower glyph", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherSidebarIcon } = await import("./agent-switcher.js");

      const { renderer } = await harness.renderWithRoot(
        React.createElement(AgentSwitcherSidebarIcon, {
          size: 18,
          color: "#fff",
        } as any),
      );

      const json = renderer.toJSON();
      assert.equal(json?.type, "mock-icon");
      assert.equal(json?.props?.name, "RadioTower");
    });

    it("opens the switcher popover from the host SidebarRow", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherSidebarItem } = await import("./agent-switcher.js");

      let opened: unknown;
      const { root } = await harness.renderWithRoot(
        React.createElement(AgentSwitcherSidebarItem, {
          theme: {},
          host: { id: "srv-test", label: "Test" },
          layout: { compact: false, platform: "web" },
          currentScreen: null,
          openScreen: () => {},
          openPopover: (Content: unknown) => {
            opened = Content;
          },
        } as any),
      );

      const row = root.find((n: any) => n.type === "SidebarRow");
      assert.ok(row, "sidebar item must render a host SidebarRow");
      await harness.TestRenderer.act(async () => {
        row.props.onPress();
      });
      assert.equal(
        typeof opened,
        "function",
        "openPopover must receive the switcher content component",
      );
    });

    it("hands the selected agent to the jump screen through openScreen", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherPopover, AGENT_SWITCHER_JUMP_SCREEN_ID } = await import(
        "./agent-switcher.js"
      );

      const fd = makeAgent({
        id: "fd-pop-id",
        name: "Live Front Desk",
        category: "front-desk",
        deterministicState: "running",
      });

      const orch = makeAgent({
        id: "orch-pop-id",
        name: "Repo Orchestrator",
        category: "orchestrator",
        project: "xpufx-org/paseo",
        deterministicState: "working",
      });

      harness.payloads["uppidi-fleet.agents"] = {
        ok: true,
        frontDesk: [fd],
        orchestrators: [orch],
        workers: [],
        tree: [],
        enrolledRepos: ["xpufx-org/paseo"],
        pausedRepos: [],
        repoQueuedHooks: {},
      };

      const opened: Array<{ screenId: string; params?: Record<string, string> }> = [];
      const { root, renderer } = await harness.renderWithRoot(
        React.createElement(AgentSwitcherPopover, {
          theme: {},
          host: { id: "srv-test", label: "Test Host" },
          layout: { compact: false, platform: "web" },
          close: () => {},
          openScreen: (input: { screenId: string; params?: Record<string, string> }) => {
            opened.push(input);
          },
        } as any),
      );

      await harness.TestRenderer.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });

      const text = renderedText(renderer.toJSON());
      assert.match(text, /Live Front Desk/);
      assert.match(text, /Repo Orchestrator/);

      const fdRow = root.find((n: any) => n.props?.testID === "agent-row-fd-pop-id");
      const orchRow = root.find((n: any) => n.props?.testID === "agent-row-orch-pop-id");
      assert.ok(fdRow, "must find Front Desk row in popover");
      assert.ok(orchRow, "must find Orchestrator row in popover");

      await harness.TestRenderer.act(async () => {
        fdRow.props.onPress();
      });
      await harness.TestRenderer.act(async () => {
        orchRow.props.onPress();
      });

      assert.deepEqual(opened, [
        {
          screenId: AGENT_SWITCHER_JUMP_SCREEN_ID,
          params: { agentId: "fd-pop-id", serverId: "srv-test" },
        },
        {
          screenId: AGENT_SWITCHER_JUMP_SCREEN_ID,
          params: { agentId: "orch-pop-id", serverId: "srv-test" },
        },
      ]);
    });

    it("jump screen forwards the selection to navigation.openAgent on mount", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherJumpScreen } = await import("./agent-switcher.js");

      const navigations: Array<{ agentId: string; serverId?: string }> = [];
      await harness.renderWithRoot(
        React.createElement(AgentSwitcherJumpScreen, {
          theme: {},
          host: { id: "srv-host", label: "Test" },
          layout: { compact: false, platform: "web" },
          params: { agentId: "agent-9", serverId: "srv-param" },
          navigation: {
            openAgent: (input: { agentId: string; serverId?: string }) =>
              navigations.push(input),
          },
        } as any),
      );

      assert.deepEqual(navigations, [{ agentId: "agent-9", serverId: "srv-param" }]);
    });

    it("jump screen degrades when the host exposes no navigation", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherJumpScreen } = await import("./agent-switcher.js");

      const { renderer } = await harness.renderWithRoot(
        React.createElement(AgentSwitcherJumpScreen, {
          theme: {},
          host: { id: "srv-host", label: "Test" },
          layout: { compact: false, platform: "ios" },
          params: { agentId: "agent-9" },
          navigation: undefined,
        } as any),
      );

      assert.match(renderedText(renderer.toJSON()), /navigation is unavailable/i);
    });

    it("keeps exactly one scroll owner (no nested ScrollView inside popover content)", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherPopover } = await import("./agent-switcher.js");

      harness.payloads["uppidi-fleet.agents"] = {
        ok: true,
        frontDesk: [makeAgent({ id: "fd-1", category: "front-desk" })],
        orchestrators: [makeAgent({ id: "orch-1", category: "orchestrator", project: "xpufx-org/paseo" })],
        workers: [],
        tree: [],
        enrolledRepos: ["xpufx-org/paseo"],
        pausedRepos: [],
        repoQueuedHooks: {},
      };

      const { root } = await harness.renderWithRoot(
        React.createElement(AgentSwitcherPopover, {
          theme: {},
          host: { id: "srv-test", label: "Test" },
          layout: { compact: false, platform: "web" },
          close: () => {},
          openScreen: () => {},
        } as any),
      );

      await harness.TestRenderer.act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });

      // The popover relies on the host popover container as single scroll owner
      // and must NOT render an inner ScrollView.
      const scrollViews = root.findAll((n: any) => n.type === "mock-scrollview" || n.type?.name === "ScrollView");
      assert.equal(
        scrollViews.length,
        0,
        "AgentSwitcherPopover must not contain a nested ScrollView; host popover owns scroll",
      );
    });
  });
});
