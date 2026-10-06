import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { installHostStubs, renderInSkin } from "./testing/host.js";
import { DARK_THEME, surfaceCases, type SurfaceCase } from "./testing/fixtures.js";
import { PALETTES } from "./theme.js";
import { checkInvariants, type GuardReport } from "paseo-plugin-ui-testing";

/**
 * First census of the shared render-level guard (xpufx-org/paseo#1043).
 *
 * The four invariants from `ui-regression-guard.md` are applied to the four
 * `worktree-install` surfaces at a phone width and at the desktop width the
 * surface was designed for. This is the worked example of the harness: no
 * per-plugin layout math, the shared module owns the measurement.
 *
 * The scroll-owner counts are the deliberate table from `mobile-scroll.test.ts`;
 * zero is a decision (the record is the host modal's body) rather than a gap.
 *
 * The expectations below are pinned. All four are clean today; a surface that
 * regresses changes a row here, and re-opening a defect is a reviewed edit to
 * this file rather than an unnoticed drift.
 */

/**
 * The palette this plugin's own theme module declares. worktree-install
 * deliberately composes its UI without the shared kit (it is the #684 proof),
 * so its two palettes are the module-local literals the guard allows; the
 * invariant is that nothing renders a color outside them, not that it uses the
 * host SDK's token names.
 */
const PALETTE = Object.values(PALETTES.dark).filter((value): value is string => typeof value === "string");
const PHONE_WIDTH = 390;
const WIDE_WIDTH = 1400;

const EXPECTED_SCROLL_OWNERS: Record<string, number> = {
  "fleet-view": 1,
  "queue-view": 1,
  "tickets-view": 1,
  "ticket-detail": 0,
};

function describeReport(surface: SurfaceCase, width: number, report: GuardReport): string {
  const parts: string[] = [];
  if (report.containment.length) {
    parts.push(
      `containment: ` +
        report.containment
          .map((f) => `+${f.excess}px ${f.testID ?? f.type} "${f.label}"`)
          .join("; "),
    );
  }
  if (report.colors.length) {
    parts.push(`colors: ${report.colors.map((c) => `${c.property}=${c.value}`).join(", ")}`);
  }
  if (report.truncation.length) {
    parts.push(`truncation: ${report.truncation.map((t) => `"${t.text.slice(0, 40)}"`).join(", ")}`);
  }
  if (report.sheetScrollers.length) {
    parts.push(`sheet-scrollers: ${report.sheetScrollers.map((s) => s.path).join(", ")}`);
  }
  const owners = report.scroll.filter((c) => !c.hostOwned).length;
  parts.push(`scroll-owners: ${owners}`);
  return `${surface.id} at ${width}px: ${parts.join(" | ")}`;
}

before(() => {
  installHostStubs();
});

describe("worktree-install UI-guard census (#1043)", () => {
  for (const width of [PHONE_WIDTH, WIDE_WIDTH]) {
    it(`checks all four invariants at ${width}px`, async (t) => {
      for (const surface of await surfaceCases()) {
        const rendered = await renderInSkin(surface.element, {
          theme: DARK_THEME,
          layout: { compact: width < 620, platform: "web", width },
        });
        for (const id of surface.press ?? []) rendered.press(id);
        const report = checkInvariants(rendered.tree, {
          width,
          palette: PALETTE,
          expectedScrollOwners: EXPECTED_SCROLL_OWNERS[surface.id],
        });
        t.diagnostic(describeReport(surface, width, report));
        assert.equal(
          report.ok,
          true,
          `${surface.id} at ${width}px failed a UI invariant — see the diagnostic line above`,
        );
        rendered.unmount();
      }
    });
  }

  it("names the scroll owner for every surface", async () => {
    for (const surface of await surfaceCases()) {
      assert.ok(
        EXPECTED_SCROLL_OWNERS[surface.id] !== undefined,
        `no scroll ownership recorded for ${surface.id}`,
      );
    }
  });
});
