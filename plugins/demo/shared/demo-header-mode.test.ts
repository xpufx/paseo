import { describe, expect, it } from "vitest";
import {
  DemoSettingsSchema,
  resolveDemoHeaderMode,
} from "./demo.js";

describe("Demo navigation scroll ownership", () => {
  it("keeps dropdown as the default with tabs as an option", () => {
    expect(DemoSettingsSchema.parse({}).navigationStyle).toBe("dropdown");
    expect(
      DemoSettingsSchema.parse({ navigationStyle: "tabs" }).navigationStyle,
    ).toBe("tabs");
    expect(
      DemoSettingsSchema.parse({ navigationStyle: "dropdown" }).navigationStyle,
    ).toBe("dropdown");
    expect(() =>
      DemoSettingsSchema.parse({ navigationStyle: "bogus" }),
    ).toThrow();
  });

  it("scrolls the in-flow dropdown with content instead of pinning it", () => {
    expect(resolveDemoHeaderMode("dropdown")).toBe("scroll");
  });

  it("keeps the compact tabs navbar pinned above the scroller", () => {
    expect(resolveDemoHeaderMode("tabs")).toBe("pinned");
  });
});
