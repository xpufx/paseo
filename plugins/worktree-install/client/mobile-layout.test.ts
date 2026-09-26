import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { installHostStubs, readSkin, renderInSkin } from "./testing/host.js";
import { DARK_THEME, surfaceCases } from "./testing/fixtures.js";
import { findHorizontalOverflows, type OverflowFinding } from "./testing/flex-measure.js";

/**
 * Mobile layout guard (#684).
 *
 * The operator reported "disaster on mobile" against this surface with no
 * symptom and no platform attached, so the ticket asked two questions: which
 * client, and what "disaster" looks like. Neither is answerable from the
 * repository. What *is* answerable is the contradiction the triage found in the
 * skin, and this file makes both halves of it a checked property:
 *
 *   1. The mobile signal follows the width the host reports, not the platform
 *      the runtime claims. A 390px browser window is a phone-shaped layout
 *      whatever is drawing it.
 *   2. The four surfaces are measured at phone widths, so the layout profile is
 *      a pinned table rather than an unremarked accident.
 *
 * The widths are the phone-class sweep `uppidi-fleet` established in #621:
 * 320 the narrowest common phone, 360 the Android default, 390 the iPhone
 * default, 430 the largest phone still in circulation. 620 is the narrow
 * breakpoint itself, 900 the two-pane one, and 1400 the desktop the surface
 * was designed at.
 */
const PHONE_WIDTHS = [320, 360, 390, 430];
const WIDER_WIDTHS = [620, 900, 1400];

/**
 * Glyph metrics in `measureText` are estimated, so a finding this small could be
 * estimation noise. The real defects measured 35–179px, so a narrow band keeps
 * the guard from being brittle without letting a genuine overlap through.
 */
const GLYPH_ESTIMATE_BAND_PX = 6;

/**
 * The measured overflow profile at each phone width, as the largest excess any
 * single container showed, keyed by surface. These are open defects, not an
 * accepted outcome, and they are not fixed here: every one of them is a row that
 * refuses to wrap (`fleet-stats` is a nine-child non-wrapping cluster that
 * demands 499px), and deciding what that row should look like on a phone is a
 * visual call #684 explicitly cannot make without the operator's screen. See
 * the report on the issue.
 *
 * The table is pinned rather than asserted empty so that the profile is
 * *visible*: a new overflow, a worse one, and a silently fixed one all fail this
 * test. Removing a row is the deliberate, reviewable act of closing a defect.
 */
const PHONE_OVERFLOW: Record<number, Record<string, number>> = {
  320: { "fleet-view": 179, "tickets-view": 75, "queue-view": 43, "ticket-detail": 76 },
  360: { "fleet-view": 139, "tickets-view": 35, "queue-view": 0, "ticket-detail": 36 },
  390: { "fleet-view": 109, "tickets-view": 0, "queue-view": 0, "ticket-detail": 0 },
  430: { "fleet-view": 69, "tickets-view": 0, "queue-view": 0, "ticket-detail": 0 },
};

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

/** The largest overflow a surface showed, ignoring estimation noise. */
function worstOverflow(findings: OverflowFinding[]): number {
  return findings
    .filter((f) => f.excess > GLYPH_ESTIMATE_BAND_PX)
    .reduce((worst, f) => Math.max(worst, f.excess), 0);
}

before(() => {
  installHostStubs();
});

describe("worktree-install mobile layout (#684)", () => {
  it("resolves the mobile signal from the width, not the platform", async () => {
    // The pinned defect. `platform: "web"` at a phone width used to answer
    // `isMobile: false` and 28pt targets, because both were derived from the
    // platform alone while `narrow` and `wide` were derived from the width. Any
    // one of these four assertions fails if the signal goes back to the
    // platform, which is the point of the file.
    for (const width of PHONE_WIDTHS) {
      const skin = await readSkin({ platform: "web", width });
      assert.equal(
        skin.isMobile,
        true,
        `a ${width}px web viewport is a phone-shaped layout; isMobile:false at ${width}px ` +
          `is the #684 defect. A narrow browser window is narrow whatever runtime draws it.`,
      );
      assert.equal(
        skin.touchTarget,
        44,
        `touchTarget must follow the same resolution as isMobile: 28pt at ${width}px is the ` +
          `desktop value, and these two signals are not allowed to disagree.`,
      );
      // The three signals now agree: narrow, and not wide.
      assert.equal(skin.narrow, true, `${width}px is below the narrow breakpoint`);
      assert.equal(skin.wide, false, `${width}px is below the two-pane breakpoint`);
    }
  });

  it("keeps native platforms mobile at any width, not only narrow ones", async () => {
    // Platform stays an additional way in: a device the host names ios/android
    // is mobile whatever width it reports, which is what the pre-#684 code did
    // correctly and must keep doing.
    for (const platform of ["ios", "android"] as const) {
      for (const width of [...PHONE_WIDTHS, 1400]) {
        const skin = await readSkin({ platform, width });
        assert.equal(skin.isMobile, true, `${platform} at ${width}px must be mobile`);
        assert.equal(skin.touchTarget, 44, `${platform} at ${width}px must get 44pt targets`);
      }
    }
  });

  it("leaves the desktop signal exactly as it was", async () => {
    // Every one of these is a no-op at desktop, and each is a value the change
    // could have moved. A width-derived signal that also fired above the
    // narrow breakpoint would fail here first.
    for (const width of [621, 900, 1024, 1280, 1400, 2560]) {
      const skin = await readSkin({ platform: "web", width });
      assert.equal(skin.isMobile, false, `a ${width}px web viewport is not a phone`);
      assert.equal(skin.touchTarget, 28, `a ${width}px web viewport keeps the 28pt target`);
      assert.equal(skin.narrow, false, `${width}px is above the narrow breakpoint`);
      assert.equal(skin.wide, width >= 900, `${width}px wide-ness is unchanged`);
    }
  });

  it("keeps the 1024px fallback on the desktop answer", async () => {
    // A host that reports no width gets 1024, which is desktop on every signal.
    // Pinned because the fallback is load-bearing for a surface mounted before
    // the host has measured anything, and because a width-derived mobile signal
    // is exactly where that fallback could have quietly become a phone.
    for (const reported of [undefined, 0, -1, Number.NaN]) {
      const skin = await readSkin({ platform: "web", width: reported });
      assert.equal(skin.isMobile, false, `no usable width must not read as mobile (${reported})`);
      assert.equal(skin.touchTarget, 28, `no usable width must keep 28pt targets (${reported})`);
      assert.equal(skin.narrow, false, `no usable width must not read as narrow (${reported})`);
      assert.equal(skin.wide, true, `no usable width still splits into two panes (${reported})`);
    }
  });

  it("lays out every surface without horizontal overflow at or above the narrow breakpoint", async () => {
    // Above the breakpoint the surfaces are clean today, and this is what keeps
    // them that way: a new `minWidth` floor, a new unbounded chip, or a new row
    // that refuses to shrink fails here.
    for (const width of WIDER_WIDTHS) {
      for (const surface of await surfaceCases()) {
        const rendered = await renderInSkin(surface.element, {
          theme: DARK_THEME,
          layout: { compact: false, platform: "web", width },
        });
        for (const id of surface.press ?? []) rendered.press(id);
        const findings = findHorizontalOverflows(rendered.tree, width).filter(
          (f) => f.excess > GLYPH_ESTIMATE_BAND_PX,
        );
        assert.deepEqual(
          findings,
          [],
          formatFindings(`${surface.id} at ${width}px`, findings),
        );
        rendered.unmount();
      }
    }
  });

  it("does not overflow worse than the measured profile at phone widths", async () => {
    // The counterpart to the assertion above, for the widths where the surfaces
    // are known to overflow. Pinning the measurement rather than omitting the
    // check means the defect stays tracked: a wider overflow, a new one, or a
    // fixed one all fail, and the fix is a reviewed edit to the table.
    for (const width of PHONE_WIDTHS) {
      const expected = PHONE_OVERFLOW[width];
      for (const surface of await surfaceCases()) {
        const rendered = await renderInSkin(surface.element, {
          theme: DARK_THEME,
          layout: { compact: false, platform: "web", width },
        });
        for (const id of surface.press ?? []) rendered.press(id);
        const findings = findHorizontalOverflows(rendered.tree, width);
        const measured = worstOverflow(findings);
        const known = expected[surface.id];
        assert.equal(
          measured,
          known,
          `${surface.id} at ${width}px overflows by ${measured}px, the pinned profile says ` +
            `${known}px. If this got worse, that is a regression. If it got better, the row ` +
            `for ${width}px in PHONE_OVERFLOW is now wrong and closing it is a one-line edit ` +
            `— do it in the same commit, so the table keeps describing reality.` +
            (findings.length ? `\n${formatFindings(`${surface.id} at ${width}px`, findings)}` : ""),
        );
        rendered.unmount();
      }
    }
  });
});
