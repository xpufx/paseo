import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { getFleetHarness } from "./testing/fleet-harness.js";

interface RenderedNode {
  props?: Record<string, any>;
  children?: RenderedNode[] | string | Array<RenderedNode | string | null>;
}

function flatten(node: unknown, out: RenderedNode[] = []): RenderedNode[] {
  if (!node || typeof node !== "object") return out;
  const current = node as RenderedNode;
  out.push(current);
  for (const child of (Array.isArray(current.children) ? current.children : []) as RenderedNode[]) {
    flatten(child, out);
  }
  return out;
}

function findByTestID(tree: unknown, testID: string): RenderedNode[] {
  return flatten(tree).filter((n) => n?.props?.testID === testID);
}

function findByAccessibilityLabel(tree: unknown, label: string): RenderedNode[] {
  return flatten(tree).filter((n) => n?.props?.accessibilityLabel === label);
}

function renderedText(tree: unknown): string {
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

const RUNNING_STATUS = {
  ok: true,
  paused: [],
  halted: false,
  teardownInProgress: false,
  totalQueued: 0,
  repoCount: 0,
  mode: "RUN",
};

const HALTED_STATUS = {
  ...RUNNING_STATUS,
  paused: ["all"],
  halted: true,
  mode: "HALT",
};

/**
 * Mounts the real surface and lets the hook-status query settle before reading
 * the tree. `renderWithRoot`'s 5ms flush is not always enough for the query
 * cache to deliver the polled status.
 */
async function renderSurface(harness: Awaited<ReturnType<typeof getFleetHarness>>) {
  const { renderer, root } = await harness.renderWithRoot(
    React.createElement(harness.UppidiFleetSurface, {}),
  );
  await harness.TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return { renderer, root, tree: renderer.toJSON() };
}

describe("Issue #1034: removal of legacy HALT button, modal, and banner", () => {
  it("does not render the legacy HALT button in the header bar while running", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;

    const { tree } = await renderSurface(harness);
    assert.equal(findByAccessibilityLabel(tree, "HALT").length, 0, "legacy HALT button must not render");
    assert.equal(findByTestID(tree, "fleet-halted-banner").length, 0);
    assert.equal(findByAccessibilityLabel(tree, "Resume fleet from halt").length, 0);
  });

  it("does not render the legacy HaltedBanner when halted, renders ModeBanner instead", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = HALTED_STATUS;

    const { tree } = await renderSurface(harness);

    assert.equal(findByTestID(tree, "fleet-halted-banner").length, 0, "legacy banner must not render");
    assert.equal(findByAccessibilityLabel(tree, "Resume fleet from halt").length, 0, "legacy resume must not render");
    assert.ok(findByTestID(tree, "fleet-mode-banner-halt").length > 0, "unified HALT mode banner must render");
    assert.match(renderedText(tree), /HALT.*mode active/);
  });
});

describe("Issue #1373: unified fleet mode selector", () => {
  it("renders four mode pills (RUN, DRAIN, HALT, STOP) on the dashboard surface", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;

    const { tree } = await renderSurface(harness);
    const text = renderedText(tree);
    assert.match(text, /RUN/);
    assert.match(text, /DRAIN/);
    assert.match(text, /HALT/);
    assert.match(text, /STOP/);
  });

  it("shows a mode banner when not in RUN mode", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = {
      ...RUNNING_STATUS,
      mode: "DRAIN",
    };

    const { tree } = await renderSurface(harness);
    assert.ok(
      findByTestID(tree, "fleet-mode-banner-drain").length > 0,
      "DRAIN mode banner must render",
    );
    assert.match(renderedText(tree), /DRAIN.*mode active/);
    assert.ok(
      findByAccessibilityLabel(tree, "Return to RUN mode").length > 0,
      "Return to RUN button must be present",
    );
  });

  it("shows a HALT mode banner when mode is HALT", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = HALTED_STATUS;

    const { tree } = await renderSurface(harness);
    assert.ok(
      findByTestID(tree, "fleet-mode-banner-halt").length > 0,
      "HALT mode banner must render",
    );
    assert.match(renderedText(tree), /HALT.*mode active/);
  });

  it("does not show a mode banner when mode is RUN", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;

    const { tree } = await renderSurface(harness);
    assert.equal(findByTestID(tree, "fleet-mode-banner-run").length, 0);
  });

  it("calls set-fleet-mode RPC when clicking RUN or DRAIN directly", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    let setModeCalls = 0;
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;
    harness.payloads[contracts.uppidiFleetSetModeContract.name] = () => {
      setModeCalls += 1;
      return { ok: true, mode: "DRAIN", previousMode: "RUN", message: "Fleet mode changed to DRAIN" };
    };

    const { tree } = await renderSurface(harness);

    // Find the DRAIN pill and click it
    const drainPill = findByAccessibilityLabel(tree, "Set fleet mode to DRAIN")[0];
    assert.ok(drainPill, "DRAIN pill must be present");

    await harness.TestRenderer.act(async () => {
      drainPill.props?.onPress?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(setModeCalls, 1, "DRAIN click must call set-fleet-mode RPC");
  });

  it("opens ModeTransitionModal when clicking HALT from the pill bar", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    const { ModeTransitionModal } = await import("./surface.js");
    let setModeCalls = 0;
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;
    harness.payloads[contracts.uppidiFleetSetModeContract.name] = () => {
      setModeCalls += 1;
      return { ok: true, mode: "HALT", previousMode: "RUN", message: "Fleet mode changed to HALT" };
    };

    const { tree, root } = await renderSurface(harness);

    const haltPill = findByAccessibilityLabel(tree, "Set fleet mode to HALT")[0];
    assert.ok(haltPill, "HALT pill must be present");

    await harness.TestRenderer.act(async () => {
      haltPill.props?.onPress?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const modal = root.findAllByType(ModeTransitionModal)[0];
    assert.ok(modal, "ModeTransitionModal must be rendered for HALT");
    assert.equal(modal?.props?.visible, true, "modal must be visible");
    assert.equal(modal?.props?.mode, "HALT", "modal must show HALT mode");
  });

  it("calls set-fleet-mode RPC from the Return to RUN button", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    let setModeCalls = 0;
    harness.payloads[contracts.uppidiHookStatusContract.name] = {
      ...RUNNING_STATUS,
      mode: "DRAIN",
    };
    harness.payloads[contracts.uppidiFleetSetModeContract.name] = () => {
      setModeCalls += 1;
      return { ok: true, mode: "RUN", previousMode: "DRAIN", message: "Fleet mode changed to RUN" };
    };

    const { tree } = await renderSurface(harness);

    const returnToRun = findByAccessibilityLabel(tree, "Return to RUN mode")[0];
    assert.ok(returnToRun, "Return to RUN button must be present");

    await harness.TestRenderer.act(async () => {
      returnToRun.props?.onPress?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(setModeCalls, 1, "Return to RUN must call set-fleet-mode RPC");
  });

  it("confirms HALT mode transition via ModeTransitionModal and calls set-fleet-mode RPC", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    const { ModeTransitionModal } = await import("./surface.js");
    let setModeCalls = 0;
    let targetMode: string | undefined;
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;
    harness.payloads[contracts.uppidiFleetSetModeContract.name] = (input: any) => {
      setModeCalls += 1;
      targetMode = input?.mode;
      return { ok: true, mode: "HALT", previousMode: "RUN", message: "Fleet mode changed to HALT" };
    };

    const { tree, root } = await renderSurface(harness);

    // Click HALT pill -> opens ModeTransitionModal -> confirm -> calls set-fleet-mode
    const haltPill = findByAccessibilityLabel(tree, "Set fleet mode to HALT")[0];
    assert.ok(haltPill);
    await harness.TestRenderer.act(async () => {
      haltPill.props?.onPress?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const modal = root.findAllByType(ModeTransitionModal)[0];
    assert.ok(modal?.props?.visible);
    await harness.TestRenderer.act(async () => {
      await modal.props?.onConfirm?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(setModeCalls, 1, "HALT via mode selector must call set-fleet-mode RPC");
    assert.equal(targetMode, "HALT");

    // Verify the legacy HALT button is absent from the header bar
    assert.equal(findByAccessibilityLabel(tree, "HALT").length, 0);
  });
});
