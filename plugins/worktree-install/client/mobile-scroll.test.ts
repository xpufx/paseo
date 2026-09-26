import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  installHostStubs,
  loadViews,
  renderInSkin,
  scrollContainers,
  React,
  type RenderedSurface,
  type ScrollContainer,
} from "./testing/host.js";
import { DARK_THEME, TICKETS, surfaceCases, type SurfaceCase } from "./testing/fixtures.js";
import { contentHeightFloor, heightClamps } from "./testing/scroll-measure.js";
import { resolveStyle } from "./testing/flex-measure.js";

/**
 * Vertical reachability guard (#684).
 *
 * #688 closed the horizontal half: nothing spills sideways at any phone width.
 * The other half was still open, and it is the half an operator actually hits.
 * A plugin surface is a full host page and the host wraps no part of it in a
 * scroller, so every view here was a `flex: 1` box inside a `flex: 1` box
 * inside the surface: content taller than the pane was not scrollable, it was
 * gone. The roster below the fold, the queues below the fold, the board below
 * the fold. Nothing in the suite could see it, because the host stand-in
 * rendered `ScrollView` as a passthrough and every tree was therefore a tree in
 * which nothing scrolled.
 *
 * So the harness models a scroller now — a viewport box and a content box, as
 * React Native has — and this file makes scroll ownership a checked property:
 *
 *   1. each surface root owns exactly one scroll container, and it encloses the
 *      list that outgrows the pane;
 *   2. no surface ends up with two, which is the nested-scroll trap that made
 *      the x-comms family unusable on a phone;
 *   3. the container is bounded by the pane it is given, so overflow becomes a
 *      scroll range rather than content that escapes the surface;
 *   4. nothing inside the container clips on its own, which would put the
 *      defect back underneath a scroller that looks like a fix.
 *
 * The height a surface demands is *reported* per run, not asserted: the measure
 * is a lower bound and the shared fixture is a small sample, so a number pinned
 * from it would describe the fixture rather than the surface. See
 * `testing/scroll-measure.ts` and the last test here.
 *
 * `ticket-detail` deliberately owns none, and the table below says why. It is
 * not a viewport root in either of its two forms: as the embedded pane it is a
 * column of the tickets view, which owns the scroller, and as the modal it is
 * the host's own `Modal.Content scrollable`, reached through a portal rather
 * than through the surface. A scroller in there would be a scroll inside a
 * scroll, and it would still leave the record unreachable for a reason no test
 * would catch: the two scrollers would fight over the gesture.
 */
const PHONE_WIDTHS = [320, 360, 390, 430];
/** The two-pane breakpoint, where the record renders as a pane and not a modal. */
const TWO_PANE_WIDTH = 900;

/**
 * The pane height these surfaces are asked to fit in: a phone in landscape, or a
 * workspace panel in a split view. Nothing in the surface reads it — the pane is
 * the host's, and the plugin's only job is to be scrollable inside whatever it
 * is — so it is passed for the record and used as the yardstick in the
 * diagnostics below.
 */
const SHORT_VIEWPORT = 480;

/**
 * How many scroll containers each surface may own. The zero is a decision with
 * its reason attached, not a gap: see the file header.
 */
const OWNED_SCROLLERS: Record<string, number> = {
  "fleet-view": 1,
  "queue-view": 1,
  "tickets-view": 1,
  "ticket-detail": 0,
};

/**
 * The list each scroll-owning surface puts under its scroller: the part of it
 * that outgrows a pane, and the part that has to be under the scroller to be
 * reachable at all.
 */
const OUTGROWING_CONTENT: Record<string, string> = {
  "fleet-view": "fleet-projects",
  "queue-view": "queue-list",
  "tickets-view": "ticket-list",
};

function pluginScrollers(tree: unknown): ScrollContainer[] {
  return scrollContainers(tree).filter((container) => !container.hostOwned);
}

function hostScrollers(tree: unknown): ScrollContainer[] {
  return scrollContainers(tree).filter((container) => container.hostOwned);
}

function describeContainers(containers: ScrollContainer[]): string {
  if (containers.length === 0) return "none";
  return containers
    .map((container) => `${container.hostOwned ? "host" : "plugin"}${container.testID ? `:${container.testID}` : ""}`)
    .join(", ");
}

async function renderCase(surface: SurfaceCase, width: number): Promise<RenderedSurface> {
  const rendered = await renderInSkin(surface.element, {
    theme: DARK_THEME,
    layout: { compact: false, platform: "web", width, height: SHORT_VIEWPORT },
  });
  for (const id of surface.press ?? []) rendered.press(id);
  return rendered;
}

before(() => {
  installHostStubs();
});

describe("worktree-install vertical reachability (#684)", () => {
  it("gives every surface exactly one scroll boundary, and never a second", async () => {
    // The property the fix rests on. Removing a scroller from a view fails here
    // on the missing one; adding one below another fails here on the count.
    const cases = await surfaceCases();
    for (const width of [...PHONE_WIDTHS, TWO_PANE_WIDTH]) {
      for (const surface of cases) {
        const expected = OWNED_SCROLLERS[surface.id];
        assert.ok(
          expected !== undefined,
          `no scroll ownership is recorded for ${surface.id}; a new surface has to say how it scrolls`,
        );
        const rendered = await renderCase(surface, width);
        const owned = pluginScrollers(rendered.tree);
        assert.equal(
          owned.length,
          expected,
          `${surface.id} at ${width}px owns ${owned.length} scroll container(s), ` +
            `expected ${expected}: ${describeContainers(scrollContainers(rendered.tree))}. ` +
            `A surface whose content is taller than its pane is unreachable without one; a second ` +
            `one below it traps the gesture and the content under it is unreachable too.`,
        );
        rendered.unmount();
      }
    }
  });

  it("encloses the content that outgrows the pane", async () => {
    // A scroller in the wrong place scrolls nothing that matters: a surface can
    // hold one and still clip, if the part that is too tall is beside it rather
    // than under it. The deepest list of each surface is the part that is.
    const cases = await surfaceCases();
    for (const [surfaceId, testID] of Object.entries(OUTGROWING_CONTENT)) {
      for (const width of [...PHONE_WIDTHS, TWO_PANE_WIDTH]) {
        const rendered = await renderCase(cases.find((candidate) => candidate.id === surfaceId)!, width);
        const [owned] = pluginScrollers(rendered.tree);
        assert.ok(
          owned && owned.encloses.includes(testID),
          `${surfaceId} at ${width}px scrolls nothing: ${testID} is not inside its scroll ` +
            `container (which encloses ${owned?.encloses.join(", ") || "nothing at all"}). ` +
            `The part that is taller than the pane is the part that has to be under the scroller.`,
        );
        rendered.unmount();
      }
    }
  });

  it("bounds the scroller to its pane, so overflow becomes a scroll range", async () => {
    // `flex: 1, minHeight: 0` is what makes the scroller take the height of the
    // pane and no more. Without them it sizes to its content, the surface grows
    // past the host page instead of scrolling inside it, and the header scrolls
    // away with everything else.
    let checked = 0;
    for (const width of [...PHONE_WIDTHS, TWO_PANE_WIDTH]) {
      for (const surface of await surfaceCases()) {
        const rendered = await renderCase(surface, width);
        for (const owned of pluginScrollers(rendered.tree)) {
          checked += 1;
          const style = resolveStyle(owned.node);
          assert.equal(
            style.flex,
            1,
            `${surface.id} at ${width}px: its scroller must fill the pane it is given (flex: 1), ` +
              `not size itself to its content.`,
          );
          assert.equal(
            style.minHeight,
            0,
            `${surface.id} at ${width}px: its scroller must be allowed to shrink below its ` +
              `content (minHeight: 0), or a short pane clips instead of scrolling.`,
          );
        }
        rendered.unmount();
      }
    }
    assert.ok(checked > 0, "no scroller was checked, so this would pass on a surface that has none");
  });

  it("leaves the modal record to the host's own body scroller", async () => {
    // The other half of the ticket-detail decision. The narrow branch hands the
    // record to `<Modal.Content scrollable>`, which is the host's boundary and
    // sits outside the surface's own — so the record is reachable there without
    // a second plugin scroller, and adding one would be the nested-scroll trap.
    const { TicketDetail } = await loadViews();
    const rendered = await renderInSkin(
      React.createElement(TicketDetail, {
        ticket: TICKETS[0],
        onClose: () => {},
        onDispatch: () => {},
        onOpenExternal: () => {},
      }),
      { theme: DARK_THEME, layout: { compact: false, platform: "web", width: 390, height: SHORT_VIEWPORT } },
    );
    assert.deepEqual(
      pluginScrollers(rendered.tree),
      [],
      "the modal record must not add a scroller of its own: the host body already scrolls it",
    );
    const host = hostScrollers(rendered.tree);
    assert.equal(
      host.length,
      1,
      `the modal record must render inside one host-owned scroll boundary, found ` +
        `${describeContainers(scrollContainers(rendered.tree))}`,
    );
    assert.ok(
      host[0].encloses.includes("ticket-detail-title"),
      "the host-owned body is only useful if the record is inside it, " +
        `it encloses ${host[0].encloses.join(", ") || "nothing"}`,
    );
    rendered.unmount();
  });

  it("clips nothing inside the scroller, and reports the height it demands", async (t) => {
    // A scroller is only the fix if nothing inside it takes a bite out of the
    // overflow. A box that is shorter than its own content is a clip, and it
    // would put #684 back with a scroll container sitting above it — reachable
    // on paper, gone in the hand.
    //
    // The demanded height is reported rather than asserted, on purpose. It is a
    // floor (see `scroll-measure.ts`), it understates wrapped text, and the
    // shared fixture is a deliberately small sample: one liaison, one
    // orchestrator, two workers, two tickets. A sample that small fits a tall
    // pane whatever the layout does, so an assertion against it would measure
    // the fixture rather than the surface. The number is here so a change in
    // the shape of a surface is visible in the run, not to be pinned.
    for (const [surfaceId] of Object.entries(OUTGROWING_CONTENT)) {
      const cases = await surfaceCases();
      for (const width of PHONE_WIDTHS) {
        const rendered = await renderCase(cases.find((candidate) => candidate.id === surfaceId)!, width);
        const clamps = heightClamps(rendered.tree);
        assert.deepEqual(
          clamps,
          [],
          `${surfaceId} at ${width}px clips its own content instead of letting the scroller ` +
            `reach it: ` +
            clamps
              .map(
                (clamp) =>
                  `${clamp.testID ?? "an untagged box"} is ${clamp.declared}px tall and needs ` +
                  `${clamp.needed}px`,
              )
              .join("; "),
        );
        t.diagnostic(
          `${surfaceId} at ${width}px: content height floor ${contentHeightFloor(rendered.tree)}px ` +
            `(a lower bound, and a small sample — see testing/scroll-measure.ts)`,
        );
        rendered.unmount();
      }
    }
  });
});
