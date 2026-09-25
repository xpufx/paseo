import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFleetHarness } from "./testing/fleet-harness.js";
import {
  agentsPayload,
  agentsPayloadNoFrontDesk,
  installPayloads,
} from "./testing/fleet-fixtures.js";
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

/**
 * Routine fleet states, each rendered in full. The hero draws different content
 * depending on whether a front desk is seated, and the two states fail
 * differently, so both are swept.
 */
const FLEET_STATES: [string, () => Record<string, unknown>][] = [
  ["front-desk-seated", agentsPayload],
  ["front-desk-ended", agentsPayloadNoFrontDesk],
];

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

/**
 * Accumulates overflow findings across a whole sweep instead of asserting on the
 * first one. A guard that aborts on the first failing cell hides every other
 * width, and the width profile is the evidence: 430px passing while 320px fails
 * is what distinguishes a bounded string from a `minWidth` floor.
 */
class OverflowSweep {
  private readonly results: { label: string; width: number; findings: OverflowFinding[] }[] = [];

  collect(label: string, tree: unknown, width: number): void {
    this.results.push({
      label,
      width,
      findings: findHorizontalOverflows(tree, width).filter(
        (f) => f.excess > GLYPH_ESTIMATE_BAND_PX,
      ),
    });
  }

  /** Asserts the sweep clean, reporting every offending cell at once. */
  assertClean(): void {
    const total = this.results.reduce((acc, r) => acc + r.findings.length, 0);
    if (total === 0) return;
    const byWidth = PHONE_WIDTHS.map((w) => {
      const n = this.results
        .filter((r) => r.width === w)
        .reduce((acc, r) => acc + r.findings.length, 0);
      return `${w}px=${n}`;
    }).join("  ");
    assert.equal(
      total,
      0,
      this.results
        .filter((r) => r.findings.length > 0)
        .map((r) => formatFindings(`${r.label} at ${r.width}px`, r.findings))
        .join("\n") +
        `\nfindings per width: ${byWidth}  (total ${total})\n` +
          `A row whose children cannot shrink past the viewport overlaps its sibling. ` +
          `Give the text a numberOfLines/flexShrink budget (Badge/Button now do this ` +
          `by default) and drop any minWidth that floors the shrink.`,
    );
  }
}

describe("uppidi-fleet mobile layout (#621)", () => {
  it("lays out every surface tab without horizontal overflow at phone widths", async () => {
    const h = await getFleetHarness();
    const sweep = new OverflowSweep();

    // Both routine fleet states, because the hero renders different content in
    // each: seated front desk, and front desk session ended. The second is the
    // operator's line.
    for (const [label, fleet] of FLEET_STATES) {
      installPayloads(h.payloads, fleet());
      for (const width of PHONE_WIDTHS) {
        for (let tab = 0; tab < TABS.length; tab += 1) {
          const { tree } = await h.renderPanelAtWidth(width, tab);
          sweep.collect(`UppidiFleetPanel[${TABS[tab]}] ${label}`, tree, width);
        }
      }
    }

    sweep.assertClean();
  });

  it("lays out the agent tree standalone at phone widths", async () => {
    const h = await getFleetHarness();
    installPayloads(h.payloads);
    const sweep = new OverflowSweep();

    for (const width of PHONE_WIDTHS) {
      const tree = await h.render(
        h.React.createElement(h.UppidiFleetTreeView, {
          agentsData: h.payloads["uppidi-fleet.agents"],
        }),
      );
      sweep.collect("UppidiFleetTreeView", tree, width);
    }

    sweep.assertClean();
  });

  it("lays out a dense agent row with its worst-case chips at phone widths", async () => {
    const h = await getFleetHarness();
    installPayloads(h.payloads);
    const fleet = h.payloads["uppidi-fleet.agents"] as any;
    // Every row the live fleet renders, at the depth it nests to.
    const rows = [...fleet.tree.flatMap((n: any) => n.children), ...fleet.tree];

    const sweep = new OverflowSweep();
    for (const width of PHONE_WIDTHS) {
      for (const node of rows) {
        const tree = await h.render(
          h.React.createElement(h.DenseAgentRow, {
            node,
            orchestrators: fleet.orchestrators,
            colors: {},
            typography: {},
            onArchiveAgent: async () => {},
          }),
        );
        sweep.collect(`DenseAgentRow(${node.agent.shortId})`, tree, width);
      }
    }

    sweep.assertClean();
  });

  it("survives the full tree-indent range at phone widths", async () => {
    // `DenseAgentRow` indents its content by `(depth - 1) * 16`, capped at 64px
    // (indentPadding). A nested row therefore gets 64px less width than a
    // top-level one, and any `minWidth` floor on the row's left cluster is
    // measured against that reduced box, not against the viewport. The fleet
    // nests three levels today, so the shallow depths alone cannot show whether
    // such a floor binds — this sweeps the whole range, past where the cap sits.
    const h = await getFleetHarness();
    installPayloads(h.payloads);
    const fleet = h.payloads["uppidi-fleet.agents"] as any;
    const node = fleet.tree[0];

    const sweep = new OverflowSweep();
    for (const width of PHONE_WIDTHS) {
      for (let depth = 1; depth <= 6; depth += 1) {
        const tree = await h.render(
          h.React.createElement(h.DenseAgentRow, {
            node,
            depth,
            colors: {},
            typography: {},
            onArchiveAgent: async () => {},
          }),
        );
        sweep.collect(`DenseAgentRow(${node.agent.shortId}) depth=${depth}`, tree, width);
      }
    }

    sweep.assertClean();
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
    const sweep = new OverflowSweep();

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
      sweep.collect("DenseAgentRow(metrics expanded)", renderer.toJSON(), width);
    }

    sweep.assertClean();
  });
});
