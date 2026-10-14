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

describe("Issue #1013: fleet HALT control and halted-state banner", () => {
  it("renders the HALT action without the banner while the fleet is running", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;

    const { tree } = await renderSurface(harness);
    assert.match(renderedText(tree), /HALT/);
    assert.equal(findByTestID(tree, "fleet-halted-banner").length, 0);
    assert.equal(findByAccessibilityLabel(tree, "Resume fleet from halt").length, 0);
  });

  it("shows the persistent halted banner with a RESUME control when halted", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = HALTED_STATUS;

    const { tree } = await renderSurface(harness);

    assert.ok(findByTestID(tree, "fleet-halted-banner").length > 0, "banner must render while halted");
    assert.match(renderedText(tree), /HALTED/);

    const resume = findByAccessibilityLabel(tree, "Resume fleet from halt");
    assert.equal(resume.length, 1, "exactly one RESUME control");
    assert.equal(resume[0]?.props?.disabled, false);
  });

  it("disables RESUME while a teardown is mid-flight", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    harness.payloads[contracts.uppidiHookStatusContract.name] = {
      ...HALTED_STATUS,
      teardownInProgress: true,
    };

    const { tree } = await renderSurface(harness);

    assert.match(renderedText(tree), /Teardown in progress/);
    const resume = findByAccessibilityLabel(tree, "Resume fleet from halt");
    assert.equal(resume[0]?.props?.disabled, true, "RESUME must be disabled during teardown");
  });

  it("invokes the fleet-resume RPC from the banner RESUME control", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    let resumeCalls = 0;
    harness.payloads[contracts.uppidiHookStatusContract.name] = HALTED_STATUS;
    harness.payloads[contracts.uppidiFleetResumeContract.name] = () => {
      resumeCalls += 1;
      return { ok: true, halted: false, teardownInProgress: false, message: "resumed" };
    };

    const { tree } = await renderSurface(harness);

    const resume = findByAccessibilityLabel(tree, "Resume fleet from halt")[0];
    assert.ok(resume, "RESUME control must be present");
    await harness.TestRenderer.act(async () => {
      await resume.props?.onPress?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(resumeCalls, 1, "RESUME must call the fleet-resume RPC");
  });

  it("opens the HALT confirmation and calls the fleet-halt RPC on confirm", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    const { HaltConfirmModal } = await import("./surface.js");
    let haltCalls = 0;
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;
    harness.payloads[contracts.uppidiFleetHaltContract.name] = () => {
      haltCalls += 1;
      return { ok: true, halted: true, alreadyHalted: false, teardownInProgress: false };
    };

    const { tree, root } = await renderSurface(harness);

    const haltButton = findByAccessibilityLabel(tree, "HALT")[0];
    assert.ok(haltButton, "HALT control must be present");
    assert.equal(
      root.findAllByType(HaltConfirmModal)[0]?.props?.visible,
      false,
      "confirmation starts closed",
    );

    await harness.TestRenderer.act(async () => {
      haltButton.props?.onPress?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const modal = root.findAllByType(HaltConfirmModal)[0];
    assert.equal(modal?.props?.visible, true, "HALT must open the confirmation modal");

    await harness.TestRenderer.act(async () => {
      await modal.props?.onConfirm?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(haltCalls, 1, "confirming must call the fleet-halt RPC");
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

    const { tree, root } = await renderSurface(harness);

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

  it("preserves existing HALT/RESUME contracts still working", async () => {
    const harness = await getFleetHarness();
    const contracts = await import("../shared/contracts.js");
    const { HaltConfirmModal, ModeTransitionModal } = await import("./surface.js");
    let haltCalls = 0;
    let resumeCalls = 0;
    let setModeCalls = 0;
    harness.payloads[contracts.uppidiHookStatusContract.name] = RUNNING_STATUS;
    harness.payloads[contracts.uppidiFleetHaltContract.name] = () => {
      haltCalls += 1;
      return { ok: true, halted: true, alreadyHalted: false, teardownInProgress: false };
    };
    harness.payloads[contracts.uppidiFleetResumeContract.name] = () => {
      resumeCalls += 1;
      return { ok: true, halted: false, teardownInProgress: false };
    };
    harness.payloads[contracts.uppidiFleetSetModeContract.name] = () => {
      setModeCalls += 1;
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
      modal.props?.onConfirm?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(setModeCalls, 1, "HALT via mode selector must call set-fleet-mode RPC");

    // Now verify the original HALT button from the header bar still works
    const haltButton = findByAccessibilityLabel(tree, "HALT")[0];
    assert.ok(haltButton);
    await harness.TestRenderer.act(async () => {
      haltButton.props?.onPress?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    const haltModal = root.findAllByType(HaltConfirmModal)[0];
    assert.ok(haltModal?.props?.visible);
    await harness.TestRenderer.act(async () => {
      haltModal.props?.onConfirm?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    assert.equal(haltCalls, 1, "Original HALT button must still work");
  });
});
