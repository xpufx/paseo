import { describe, expect, it } from "vitest";
import { resolveTypography } from "../client/theme/tokens.js";

describe("theme typography", () => {
  it("provides a coherent semantic scale", () => {
    const scale = resolveTypography({ compact: false, platform: "web" }, "comfortable");

    expect(scale.title.fontSize).toBeGreaterThan(scale.heading.fontSize);
    expect(scale.heading.fontSize).toBeGreaterThan(scale.body.fontSize);
    expect(scale.body.lineHeight).toBeGreaterThan(scale.body.fontSize);
    expect(scale.label.fontWeight).toBe("600");
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
});
