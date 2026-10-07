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

function subtreeHasTestID(node: RenderedNode, testID: string): boolean {
  if (node.props?.testID === testID) return true;
  for (const child of (Array.isArray(node.children) ? node.children : []) as RenderedNode[]) {
    if (child && typeof child === "object" && subtreeHasTestID(child, testID)) return true;
  }
  return false;
}

function styleList(style: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(style)) return style.filter((s): s is Record<string, unknown> => !!s && typeof s === "object");
  return style && typeof style === "object" ? [style as Record<string, unknown>] : [];
}

describe("Issue #791: Uppidi Fleet sidebar issues tab and repo dropdown", () => {
  it("mounts ForgeIssuesView without throwing 'Plugin state hooks must run inside a workspace panel' outside workspace panel", async () => {
    const harness = await getFleetHarness();
    const { ForgeIssuesView } = await import("./forges-tab.js");

    let openIssuesCalledWith: any = null;
    harness.payloads["forge.open-issues"] = (input: any) => {
      openIssuesCalledWith = input;
      return {
        ok: true,
        repo: "xpufx-org/paseo",
        host: "forge.mrs.uppidi.com",
        issues: [
          {
            number: 791,
            title: "Uppidi Fleet when launched from the side navbar issues tab",
            state: "open",
            author: "operator",
            labels: ["state/1-wip"],
            comments: 2,
            url: "https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/791",
            repo: "xpufx-org/paseo",
          },
        ],
        totalOpenCount: 1,
      };
    };

    harness.payloads["forge.context"] = {
      directory: "/home/user/.paseo/worktrees/2h0dw6vb/fix-791-fleet-sidebar-issues-tab",
      derivedRepo: "xpufx-org/paseo",
      derivedHost: "forge.mrs.uppidi.com",
    };

    // Render ForgeIssuesView directly with no workspace panel or PluginClientStateProvider.
    // Pre-fix: this throws "Plugin failed: Plugin state hooks must run inside a workspace panel"
    const { renderer } = await harness.renderWithRoot(
      <ForgeIssuesView
        workspaceId="sidebar-ws-id"
        enrolledRepos={["xpufx-org/paseo", "xpufx-org/2fado"]}
        activeRepo="xpufx-org/paseo"
      />,
    );

    await harness.TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const text = renderedText(renderer?.toJSON());
    assert.match(text, /Forge Issues/);
    assert.match(text, /#\s*791/);
    assert.match(text, /Uppidi Fleet when launched from the side navbar issues tab/);
    assert.ok(openIssuesCalledWith, "forge.open-issues query must be called");
  });

  it("defaults repo selector to active workspace repo when active, and supports All Enrolled Repositories", async () => {
    const harness = await getFleetHarness();
    const { ForgeIssuesView } = await import("./forges-tab.js");

    let lastIssuesInput: any = null;
    harness.payloads["forge.open-issues"] = (input: any) => {
      lastIssuesInput = input;
      return {
        ok: true,
        repo: input?.repo || "xpufx-org/paseo",
        host: "forge.mrs.uppidi.com",
        issues: [
          {
            number: 791,
            title: "Paseo issue",
            state: "open",
            author: "alice",
            labels: [],
            comments: 1,
            url: "https://forge.example/791",
            repo: "xpufx-org/paseo",
          },
          {
            number: 800,
            title: "2fado issue",
            state: "open",
            author: "bob",
            labels: [],
            comments: 0,
            url: "https://forge.example/800",
            repo: "xpufx-org/2fado",
          },
        ],
        totalOpenCount: 2,
      };
    };

    let selectedRepoState = "xpufx-org/paseo";
    const res1 = await harness.renderWithRoot(
      <ForgeIssuesView
        workspaceId="ws-1"
        enrolledRepos={["xpufx-org/paseo", "xpufx-org/2fado"]}
        activeRepo="xpufx-org/paseo"
        selectedRepo={selectedRepoState}
        onSelectRepo={(r) => {
          selectedRepoState = r;
        }}
      />,
    );

    await harness.TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    // When activeRepo is set, only active repo issue is shown (xpufx-org/paseo)
    let text = renderedText(res1.renderer.toJSON());
    assert.match(text, /#\s*791/);
    assert.doesNotMatch(text, /#\s*800/);

    // Now render with "all" (All Enrolled Repositories)
    const res2 = await harness.renderWithRoot(
      <ForgeIssuesView
        workspaceId="ws-1"
        enrolledRepos={["xpufx-org/paseo", "xpufx-org/2fado"]}
        activeRepo="xpufx-org/paseo"
        selectedRepo="all"
        onSelectRepo={(r) => {
          selectedRepoState = r;
        }}
      />,
    );

    await harness.TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    text = renderedText(res2.renderer.toJSON());
    // In "all" mode, both issues are displayed
    assert.match(text, /#\s*791/);
    assert.match(text, /#\s*800/);
    assert.match(text, /All Enrolled Repositories/);
  });

  it("defaults to 'all' when no active repo is provided", async () => {
    const harness = await getFleetHarness();
    const { ForgeIssuesView } = await import("./forges-tab.js");

    harness.payloads["forge.open-issues"] = {
      ok: true,
      repo: null,
      host: "forge.mrs.uppidi.com",
      issues: [],
      totalOpenCount: 0,
    };
    harness.payloads["forge.context"] = {
      directory: null,
      derivedRepo: null,
      derivedHost: null,
    };

    const { renderer } = await harness.renderWithRoot(
      <ForgeIssuesView
        workspaceId=""
        enrolledRepos={["xpufx-org/paseo", "xpufx-org/2fado"]}
      />,
    );

    await harness.TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const text = renderedText(renderer.toJSON());
    assert.match(text, /All Enrolled Repositories/);
  });

  it("renders the canonical repo name in the Forge Issues header", async () => {
    const harness = await getFleetHarness();
    const { ForgeIssuesView } = await import("./forges-tab.js");

    harness.payloads["forge.open-issues"] = {
      ok: true,
      repo: "xpufx-org/paseo",
      host: "forge.mrs.uppidi.com",
      issues: [],
      totalOpenCount: 0,
    };
    harness.payloads["forge.context"] = {
      directory: null,
      derivedRepo: null,
      derivedHost: null,
    };

    const { renderer } = await harness.renderWithRoot(
      <ForgeIssuesView
        workspaceId=""
        enrolledRepos={["xpufx-org/paseo"]}
        activeRepo="xpufx-org/paseo"
      />,
    );

    await harness.TestRenderer.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    const text = renderedText(renderer.toJSON());
    assert.match(
      text,
      /forge\.mrs\.uppidi\.com\/xpufx-org\/paseo/,
      "the Forge Issues surface must render the one canonical repo name",
    );
  });

  describe("Issue #888: canonical repo identity resolution", () => {
    const KNOWN = [
      "forge.mrs.uppidi.com/xpufx-org/paseo",
      "forge.mrs.uppidi.com/xpufx-org/agent-mux",
      "forge.mrs.uppidi.com/xpufx-org/2fado",
    ];

    it("resolves every accepted input form to the one canonical name", async () => {
      const { resolveForgeSelection, canonicalForgeUrl } = await import("./forges-tab.js");
      const expected = "forge.mrs.uppidi.com/xpufx-org/paseo";
      for (const input of [
        "paseo",
        "xpufx-org/paseo",
        "forge.mrs.uppidi.com/xpufx-org/paseo",
        "https://forge.mrs.uppidi.com/xpufx-org/paseo",
        "https://forge.mrs.uppidi.com/xpufx-org/paseo.git",
        "git@forge.mrs.uppidi.com:xpufx-org/paseo.git",
        "ssh://git@forge.mrs.uppidi.com:222/xpufx-org/paseo.git",
      ]) {
        const resolved = resolveForgeSelection(input, KNOWN);
        assert.equal(resolved?.key, expected, `${input} must resolve to the canonical name`);
        assert.equal(resolved?.compact, "xpufx-org/paseo");
        assert.equal(canonicalForgeUrl(resolved!), `https://${expected}`);
      }
    });

    it("resolves a known bare repo to its own canonical name, not the current repo", async () => {
      const { resolveForgeSelection } = await import("./forges-tab.js");
      assert.equal(
        resolveForgeSelection("agent-mux", KNOWN)?.key,
        "forge.mrs.uppidi.com/xpufx-org/agent-mux",
      );
      assert.equal(
        resolveForgeSelection("https://forge.mrs.uppidi.com/agent-mux", KNOWN)?.key,
        "forge.mrs.uppidi.com/xpufx-org/agent-mux",
      );
    });

    it("shows an explicit unresolved state instead of scoping to another repo", async () => {
      const { resolveForgeSelection } = await import("./forges-tab.js");
      assert.equal(resolveForgeSelection("agent-mux", []), null);
      assert.equal(resolveForgeSelection("https://forge.mrs.uppidi.com/agent-mux", []), null);
      assert.equal(resolveForgeSelection("forge.mrs.uppidi.com", KNOWN), null);
      assert.equal(resolveForgeSelection("all"), null);
      assert.equal(resolveForgeSelection(""), null);
      assert.equal(resolveForgeSelection(null), null);
      assert.equal(resolveForgeSelection(undefined), null);
    });

    it("keeps a full remote that already names its owner/repo", async () => {
      const { resolveForgeSelection } = await import("./forges-tab.js");
      assert.equal(
        resolveForgeSelection("https://github.com/someone/other-repo")?.key,
        "github.com/someone/other-repo",
      );
    });
  });

  describe("Issue #1074: repo Select overlay and readable options", () => {
    const FULL_A = "forge.mrs.uppidi.com/xpufx-org/paseo";
    const FULL_B = "forge.mrs.uppidi.com/xpufx-org/2fado";
    const OPTIONS = [
      { label: "All Enrolled Repositories", value: "all" },
      { label: FULL_A, value: FULL_A, display: "xpufx-org/paseo" },
      { label: FULL_B, value: FULL_B, display: "xpufx-org/2fado" },
    ];

    async function openSelect(): Promise<{
      harness: Awaited<ReturnType<typeof getFleetHarness>>;
      root: any;
      renderer: any;
    }> {
      const harness = await getFleetHarness();
      const { Select } = await import("./host-ui.js");
      const { root, renderer } = await harness.renderWithRoot(
        <Select value="all" options={OPTIONS} onValueChange={() => {}} />,
      );
      const trigger = root.find(
        (n: any) =>
          n.props?.accessibilityRole === "button" &&
          n.props?.accessibilityLabel === "All Enrolled Repositories",
      );
      assert.ok(trigger, "the repo Select trigger must render");
      await harness.TestRenderer.act(async () => {
        trigger.props.onPress();
      });
      return { harness, root, renderer };
    }

    it("opens the option list as an absolute Modal portal, not an in-flow child of the trigger container", async () => {
      const { root, renderer } = await openSelect();
      const tree = renderer.toJSON() as RenderedNode | null;
      assert.ok(tree, "the Select must render a tree");

      const overlay = flatten(tree).find(
        (n) => n.props?.testID === "fleet-select-overlay",
      );
      assert.ok(overlay, "the open list must render an overlay container");
      assert.ok(
        styleList(overlay!.props?.style).some((s) => s.position === "absolute"),
        "the option list must be absolutely positioned so it floats over the surrounding content",
      );

      const modalHost = flatten(tree).find(
        (n) => n.type === "Modal" && subtreeHasTestID(n, "fleet-select-overlay"),
      );
      assert.ok(
        modalHost,
        "the option list must be portaled through a Modal so it cannot grow or be clipped by the trigger's parent",
      );

      const selectRoot = flatten(tree).find(
        (n) => n.props?.testID === "fleet-select-root",
      );
      assert.ok(selectRoot, "the trigger container must render");
      const directChildren = (
        Array.isArray(selectRoot!.children) ? selectRoot!.children : []
      ) as RenderedNode[];
      assert.ok(
        !directChildren.some((child) => child?.props?.testID === "fleet-select-overlay"),
        "the open list must not be an in-flow child that expands the trigger container",
      );
      void root;
    });

    it("shows distinguishable short labels and reveals the full value on hover/focus", async () => {
      const { root, renderer } = await openSelect();
      const initialText = renderedText(renderer.toJSON() as RenderedNode | null);
      assert.ok(initialText.includes("xpufx-org/paseo"), "the paseo option must show its repo tail");
      assert.ok(initialText.includes("xpufx-org/2fado"), "the 2fado option must show its repo tail");
      assert.ok(
        !initialText.includes(FULL_A) && !initialText.includes(FULL_B),
        "the open rows must not render the identical truncated forge host",
      );

      const option = root.find(
        (n: any) => n.props?.testID === `fleet-select-option-${FULL_A}`,
      );
      assert.ok(option, "the paseo option row must render");
      assert.equal(
        option.props.accessibilityLabel,
        FULL_A,
        "the option must expose its full label to assistive tech",
      );

      await (await getFleetHarness()).TestRenderer.act(async () => {
        option.props.onMouseEnter();
      });
      const revealed = flatten(renderer.toJSON() as RenderedNode | null).find(
        (n) => n.props?.testID === `fleet-select-option-full-${FULL_A}`,
      );
      assert.ok(revealed, "hovering an option must reveal its full value");
      assert.match(
        renderedText(revealed!),
        new RegExp(FULL_A.replace(/\./g, "\\.")),
        "the revealed text must be the full repo value",
      );
    });

    it("middle-truncates a long shared prefix so the repo tail stays visible", async () => {
      const { middleTruncate } = await import("./host-ui.js");
      const a = middleTruncate(FULL_A);
      const b = middleTruncate(FULL_B);
      assert.notEqual(a, b, "two repos sharing the forge host must not truncate identically");
      assert.match(a, /paseo$/);
      assert.match(b, /2fado$/);
    });
  });
});
