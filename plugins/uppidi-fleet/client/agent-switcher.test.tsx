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


  describe("AgentSwitcherPopover and header icon integration", () => {
    it("renders AgentSwitcherHeaderIcon with RadioTower icon", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherHeaderIcon } = await import("./agent-switcher.js");

      const { renderer } = await harness.renderWithRoot(
        React.createElement(AgentSwitcherHeaderIcon, {
          size: 18,
          color: "#fff",
        } as any),
      );

      const json = renderer.toJSON();
      assert.equal(json?.type, "mock-icon");
      assert.equal(json?.props?.name, "RadioTower");
    });

    it("navigates to the clicked agent through the host route on web", async () => {
      const harness = await getFleetHarness();
      const { AgentSwitcherPopover } = await import("./agent-switcher.js");

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

      const opened: Array<{ url: string; target?: string }> = [];
      (globalThis as any).__fleetLinking = {
        openURL: async (url: string, target?: string) => {
          opened.push({ url, target });
        },
        canOpenURL: async () => true,
      };

      try {
        const { root, renderer } = await harness.renderWithRoot(
          React.createElement(AgentSwitcherPopover, {
            close: () => {},
            host: { id: "srv-test", label: "Test Host" },
            layout: { compact: false, platform: "web" },
            workspaceId: "ws-test",
            context: "workspace",
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
          { url: "/h/srv-test/agent/fd-pop-id", target: "_self" },
          { url: "/h/srv-test/agent/orch-pop-id", target: "_self" },
        ]);
      } finally {
        delete (globalThis as any).__fleetLinking;
      }
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
          close: () => {},
          workspaceId: "ws-test",
          context: "workspace",
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

    it("builds the web route and the native paseo deep link for a selected agent", async () => {
      await getFleetHarness();
      const { buildAgentHref } = await import("./agent-switcher.js");

      assert.equal(
        buildAgentHref({ serverId: "srv-1", agentId: "agent-2", platform: "web" }),
        "/h/srv-1/agent/agent-2",
      );
      assert.equal(
        buildAgentHref({ serverId: "srv-1", agentId: "agent-2", platform: "ios" }),
        "paseo://h/srv-1/agent/agent-2",
      );
      assert.equal(
        buildAgentHref({ serverId: "srv 1", agentId: "agent/2", platform: "android" }),
        "paseo://h/srv%201/agent/agent%2F2",
      );
    });
  });
});

