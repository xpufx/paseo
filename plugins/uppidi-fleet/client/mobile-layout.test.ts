import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFleetHarness } from "./testing/fleet-harness.js";
import { installPayloads } from "./testing/fleet-fixtures.js";
import {
  findHorizontalOverflows,
  type OverflowFinding,
} from "./testing/flex-measure.js";

/**
 * Mobile layout guard (#621).
 *
 * The fleet surface reported "overlapping fields and similar visual issues" on
 * a phone. The cause was not the three visible fields: it was that the fleet
 * chips (worktree paths, agent ids, model ids, `via <parent>` lineage pills,
 * state labels) are unbounded strings, and React Native's Yoga — unlike CSS —
 * defaults `flexShrink` to 0, so a chip inside a row insists on its full text
 * width and pushes the row past the viewport. Rows that also set
 * `overflow: "visible"` then paint that overflow over the sibling group rather
 * than clipping it, which is the "overlap" an operator sees.
 *
 * This guard renders the real surface through the real panel at phone widths
 * and fails if any container's children cannot be compressed to fit. It exists
 * to catch the *class*: a new chip, a new unbounded `<Text>`, or a new
 * `minWidth` floor that reintroduces the bug fails here rather than in the
 * operator's hand.
 */

/**
 * Glyph metrics in {@link measureText} are estimated, so a finding this small
 * could be estimation noise. The real defect measured 60–200px of overflow on
 * a 320–390px viewport, so a narrow band keeps the guard from being brittle
 * without letting a genuine overlap through.
 */
const GLYPH_ESTIMATE_BAND_PX = 6;

/** Phone-class widths: the narrowest common phone through a large one. */
const PHONE_WIDTHS = [320, 360, 390, 430];

/** The surface's three tabs, in render order. */
const TABS = ["tree", "dashboard", "settings"] as const;

function formatFindings(label: string, findings: OverflowFinding[]): string {
  return [
    `${label}: ${findings.length} horizontal overflow(s)`,
    ...findings.map(
      (f) =>
        `  +${f.excess}px  ${f.type} avail=${f.available} demand=${f.demanded}` +
        `${f.testID ? ` testID=${f.testID}` : ""} near="${f.label}"` +
        `${f.culprits.length ? ` via ${f.culprits.slice(0, 4).join(", ")}` : ""}`,
    ),
  ].join("\n");
}

/** Counts rendered nodes of one host type. */
function countType(tree: unknown, type: string): number {
  let count = 0;
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === type) count += 1;
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child);
  };
  walk(tree);
  return count;
}

function assertNoOverflow(label: string, tree: unknown, width: number): void {
  const findings = findHorizontalOverflows(tree, width).filter(
    (f) => f.excess > GLYPH_ESTIMATE_BAND_PX,
  );
  assert.equal(
    findings.length,
    0,
    `${formatFindings(`${label} at ${width}px`, findings)}\n` +
      `A row whose children cannot shrink past the viewport overlaps its sibling. ` +
      `Give the text a numberOfLines/flexShrink budget (Badge/Button now do this ` +
      `by default) and drop any minWidth that floors the shrink.`,
  );
}

describe("uppidi-fleet mobile layout (#621)", () => {
  it("lays out every surface tab without horizontal overflow at phone widths", async () => {
    const h = await getFleetHarness();
    installPayloads(h.payloads);

    for (const width of PHONE_WIDTHS) {
      for (let tab = 0; tab < TABS.length; tab += 1) {
        const { tree } = await h.renderPanelAtWidth(width, tab);
        assertNoOverflow(`UppidiFleetPanel[${TABS[tab]}]`, tree, width);
      }
    }
  });

  it("lays out the agent tree standalone at phone widths", async () => {
    const h = await getFleetHarness();
    installPayloads(h.payloads);

    for (const width of PHONE_WIDTHS) {
      const tree = await h.render(
        h.React.createElement(h.UppidiFleetTreeView, {
          agentsData: h.payloads["uppidi-fleet.agents"],
        }),
      );
      assertNoOverflow("UppidiFleetTreeView", tree, width);
    }
  });

  it("lays out a dense agent row with its worst-case chips at phone widths", async () => {
    const h = await getFleetHarness();
    installPayloads(h.payloads);
    const agents = (h.payloads["uppidi-fleet.agents"] as any).tree;
    const rows = [
      ...agents[0].children,
      agents[0],
      agents[1],
    ];

    for (const width of PHONE_WIDTHS) {
      for (const node of rows) {
        const tree = await h.render(
          h.React.createElement(h.DenseAgentRow, {
            node,
            colors: {},
            typography: {},
            onArchiveAgent: async () => {},
          }),
        );
        assertNoOverflow(`DenseAgentRow(${node.agent.shortId})`, tree, width);
      }
    }
  });

  it("keeps exactly one scroll owner so the surface stays reachable (#326 class)", async () => {
    // The x-comms family (#326) was a nested-scroll trap: two scrollers in one
    // surface fight over the gesture. The fleet panel declares
    // `ModalBodyScrollOwnerContext` = "required", so `ModalBody` must render
    // the single scroller and nothing below it may add a second.
    const h = await getFleetHarness();
    installPayloads(h.payloads);

    for (const width of [320, 390]) {
      for (let tab = 0; tab < TABS.length; tab += 1) {
        const { tree } = await h.renderPanelAtWidth(width, tab);
        const scrollers = countType(tree, "ScrollView");
        assert.equal(
          scrollers,
          1,
          `UppidiFleetPanel[${TABS[tab]}] at ${width}px must have exactly one ` +
            `ScrollView, saw ${scrollers}. A second scroller traps the gesture.`,
        );
      }
    }
  });

  it("keeps the metrics card legible when expanded at phone widths", async () => {
    // The expanded card replaces a 4px gauge with a full key/value grid, so it
    // is a wider surface than the collapsed row it replaces (#560).
    const h = await getFleetHarness();
    installPayloads(h.payloads);
    const node = (h.payloads["uppidi-fleet.agents"] as any).tree[0];

    for (const width of PHONE_WIDTHS) {
      const { root, renderer } = await h.renderWithRoot(
        h.React.createElement(h.DenseAgentRow, {
          node,
          colors: {},
          typography: {},
          onArchiveAgent: async () => {},
        }),
      );
      const gauge = root.find(
        (n: any) => n.props?.testID === `agent-health-gauge-${node.agent.id}`,
      );
      await h.TestRenderer.act(async () => {
        gauge.props.onPress();
      });
      assertNoOverflow("DenseAgentRow(metrics expanded)", renderer.toJSON(), width);
    }
  });
});
