import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { getFleetHarness } from "./testing/fleet-harness.js";

interface RenderedNode {
  type?: string;
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

describe("Issue #1177: Action Runs workflow titles as clickable links", () => {
  it("renders workflow run title as a clickable link navigating to html_url", async () => {
    const harness = await getFleetHarness();
    const { ActionsTabView } = await import("./actions-tab.js");

    const openedUrls: string[] = [];
    (globalThis as any).__fleetLinking = {
      openURL: async (url: string) => {
        openedUrls.push(url);
      },
      canOpenURL: async () => true,
    };

    const targetUrl = "https://forge.mrs.uppidi.com/xpufx-org/paseo/actions/runs/5001";
    harness.payloads["uppidi-fleet.action-runs"] = {
      ok: true,
      repo: "xpufx-org/paseo",
      runs: [
        {
          id: 5001,
          name: "CI / build-and-test",
          html_url: targetUrl,
          status: "completed",
          conclusion: "success",
          workflow_id: "ci.yml",
          ref: "refs/heads/main",
          branch: "main",
          event: "push",
          run_number: 42,
          created_at: "2026-10-20T08:00:00Z",
          updated_at: "2026-10-20T08:05:00Z",
          run_started_at: "2026-10-20T08:00:10Z",
          completed_at: "2026-10-20T08:04:30Z",
          head_commit: {
            id: "abc1234",
            message: "feat: add action runs",
            sha: "abc1234567890",
          },
          user: {
            login: "developer",
          },
        },
      ],
      totalCount: 1,
      page: 1,
      limit: 10,
      hasMore: false,
    };

    const { renderer } = await harness.renderWithRoot(
      <ActionsTabView
        workspaceId="test-ws"
        selectedRepo="xpufx-org/paseo"
        onSelectRepo={() => {}}
        enrolledRepos={["xpufx-org/paseo"]}
      />,
    );

    await harness.TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const nodes = flatten(renderer?.toJSON() as RenderedNode | null);
    assert.match(renderedText(renderer?.toJSON() as RenderedNode | null), /CI \/ build-and-test/);

    // Find the link Pressable / node with accessibilityRole="link"
    const linkNode = nodes.find(
      (n) => n.props?.accessibilityRole === "link" && typeof n.props?.onPress === "function",
    );
    assert.ok(linkNode, "workflow run title must render a node with accessibilityRole='link' and onPress handler");

    // Verify pressing it invokes Linking.openURL with run.html_url
    await harness.TestRenderer.act(async () => {
      linkNode.props?.onPress();
    });

    assert.equal(openedUrls.length, 1);
    assert.equal(openedUrls[0], targetUrl);
  });

  it("does not call Linking.openURL when run.html_url is empty", async () => {
    const harness = await getFleetHarness();
    const { ActionsTabView } = await import("./actions-tab.js");

    const openedUrls: string[] = [];
    (globalThis as any).__fleetLinking = {
      openURL: async (url: string) => {
        openedUrls.push(url);
      },
      canOpenURL: async () => true,
    };

    harness.payloads["uppidi-fleet.action-runs"] = {
      ok: true,
      repo: "xpufx-org/paseo",
      runs: [
        {
          id: 5002,
          name: "CI / no-link",
          html_url: "",
          status: "completed",
          conclusion: "success",
          workflow_id: "ci.yml",
          ref: "refs/heads/main",
          branch: "main",
          event: "push",
          run_number: 43,
          created_at: "2026-10-20T08:00:00Z",
          updated_at: "2026-10-20T08:05:00Z",
          run_started_at: "2026-10-20T08:00:10Z",
          completed_at: "2026-10-20T08:04:30Z",
          head_commit: {
            id: "abc1234",
            message: "no link commit",
            sha: "abc1234567890",
          },
          user: {
            login: "developer",
          },
        },
      ],
      totalCount: 1,
      page: 1,
      limit: 10,
      hasMore: false,
    };

    const { renderer } = await harness.renderWithRoot(
      <ActionsTabView
        workspaceId="test-ws"
        selectedRepo="xpufx-org/paseo"
        onSelectRepo={() => {}}
        enrolledRepos={["xpufx-org/paseo"]}
      />,
    );

    await harness.TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const nodes = flatten(renderer?.toJSON() as RenderedNode | null);
    const linkNode = nodes.find(
      (n) => n.props?.accessibilityRole === "link" && typeof n.props?.onPress === "function",
    );
    assert.ok(linkNode, "node with accessibilityRole='link' must still exist");

    await harness.TestRenderer.act(async () => {
      linkNode.props?.onPress();
    });

    assert.equal(openedUrls.length, 0, "Linking.openURL must not be called when html_url is empty");
  });
});
