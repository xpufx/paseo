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
};

const HALTED_STATUS = {
  ...RUNNING_STATUS,
  paused: ["all"],
  halted: true,
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
