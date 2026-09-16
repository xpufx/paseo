import { describe, expect, it } from "vitest";
import { resolveTypography } from "../client/theme/tokens.js";
import { COMPACT_FORM_FACTOR_WIDTH } from "../client/theme/responsive.js";

describe("theme typography", () => {
  it("provides a coherent semantic scale", () => {
    const scale = resolveTypography({ compact: false, platform: "web" }, "comfortable");

    expect(scale.title.fontSize).toBeGreaterThan(scale.heading.fontSize);
    expect(scale.heading.fontSize).toBeGreaterThan(scale.body.fontSize);
    expect(scale.body.lineHeight).toBeGreaterThan(scale.body.fontSize);
    expect(scale.label.fontWeight).toBe("600");
  });

  it("derives bodySmall from label so a value never outranks its label", () => {
    const scale = resolveTypography({ compact: false, platform: "web" }, "comfortable");

    expect(scale.bodySmall.fontSize).toBe(scale.label.fontSize);
    expect(scale.bodySmall.lineHeight).toBe(scale.label.lineHeight);
    expect(scale.bodySmall.fontWeight).toBe("400");
    expect(scale.label.fontSize).toBeGreaterThanOrEqual(scale.bodySmall.fontSize);
    expect(scale.bodySmall.fontSize).toBeGreaterThan(scale.caption.fontSize);
    expect(scale.bodySmall.fontSize).toBeLessThan(scale.body.fontSize);
  });

  it("steps bodySmall down with compact layout and density", () => {
    const regular = resolveTypography({ compact: false, platform: "web" }, "comfortable");
    const compact = resolveTypography({ compact: true, platform: "web" }, "comfortable");
    const dense = resolveTypography({ compact: false, platform: "web" }, "compact");

    expect(compact.bodySmall.fontSize).toBeLessThan(regular.bodySmall.fontSize);
    expect(dense.bodySmall.fontSize).toBeLessThan(regular.bodySmall.fontSize);
    expect(compact.bodySmall.fontSize).toBe(compact.label.fontSize);
  });

  it("steps down compact layouts without making captions unreadable", () => {
    const regular = resolveTypography({ compact: false, platform: "web" }, "comfortable");
    const compact = resolveTypography({ compact: true, platform: "web" }, "comfortable");

    expect(compact.body.fontSize).toBeLessThan(regular.body.fontSize);
    expect(compact.caption.fontSize).toBeGreaterThanOrEqual(10);
  });

  it("keeps card headers on the shared heading and caption styles", () => {
    const scale = resolveTypography({ compact: false, platform: "web" }, "comfortable");

    expect(scale.heading.fontWeight).toBe("600");
    expect(scale.caption.lineHeight).toBeGreaterThan(scale.caption.fontSize);
  });

  it("steps down when a container width at or below the compact threshold is known", () => {
    const wide = resolveTypography({ compact: false, platform: "web", width: 900 }, "comfortable");
    const narrow = resolveTypography(
      { compact: false, platform: "web", width: COMPACT_FORM_FACTOR_WIDTH },
      "comfortable",
    );

    expect(narrow.body.fontSize).toBeLessThan(wide.body.fontSize);
    expect(narrow.caption.fontSize).toBeLessThan(wide.caption.fontSize);
    expect(narrow.caption.fontSize).toBeGreaterThanOrEqual(10);
  });

  it("stays non-compact when the known container width is above the threshold", () => {
    const scale = resolveTypography(
      { compact: false, platform: "web", width: COMPACT_FORM_FACTOR_WIDTH + 1 },
      "comfortable",
    );
    const wide = resolveTypography({ compact: false, platform: "web" }, "comfortable");

    expect(scale.body.fontSize).toBe(wide.body.fontSize);
    expect(scale.caption.fontSize).toBe(wide.caption.fontSize);
  });

  it("keeps host compact surfaces compact even when the reported width is wide", () => {
    const forced = resolveTypography({ compact: true, platform: "web", width: 900 }, "comfortable");
    const compact = resolveTypography({ compact: true, platform: "web" }, "comfortable");

    expect(forced.body.fontSize).toBe(compact.body.fontSize);
    expect(forced.caption.fontSize).toBe(compact.caption.fontSize);
  });
});
