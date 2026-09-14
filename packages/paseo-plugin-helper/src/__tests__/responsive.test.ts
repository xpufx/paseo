import { describe, it, expect } from "vitest";
import {
  responsiveSelect,
  isMobilePlatform,
  getTouchTargetMin,
  responsiveValue,
  resolvePadding,
} from "../client/theme/responsive.js";
import type { ResponsiveLayout } from "../shared/types.js";

describe("Universal Responsive System", () => {
  describe("isMobilePlatform", () => {
    it("identifies iOS and Android as mobile", () => {
      expect(isMobilePlatform("ios")).toBe(true);
      expect(isMobilePlatform("android")).toBe(true);
      expect(isMobilePlatform("web")).toBe(false);
    });
  });

  describe("getTouchTargetMin", () => {
    it("enforces 44pt minimum on mobile or compact mode", () => {
      expect(getTouchTargetMin({ compact: true, platform: "web" })).toBe(44);
      expect(getTouchTargetMin({ compact: false, platform: "ios" })).toBe(44);
      expect(getTouchTargetMin({ compact: false, platform: "android" })).toBe(44);
      expect(getTouchTargetMin({ compact: true, platform: "ios" })).toBe(44);
    });

    it("allows 28pt on desktop non-compact mode", () => {
      expect(getTouchTargetMin({ compact: false, platform: "web" })).toBe(28);
    });
  });

  describe("responsiveValue", () => {
    it("picks compact value when layout.compact is true", () => {
      expect(responsiveValue({ compact: true, platform: "web" }, "Desk", "Mini")).toBe("Mini");
      expect(responsiveValue({ compact: false, platform: "web" }, "Desk", "Mini")).toBe("Desk");
    });
  });

  describe("resolvePadding", () => {
    it("returns compact-adapted padding based on flair density", () => {
      const compactLayout: ResponsiveLayout = { compact: true, platform: "web" };
      const wideLayout: ResponsiveLayout = { compact: false, platform: "web" };

      expect(resolvePadding(compactLayout, "compact").horizontal).toBe(10);
      expect(resolvePadding(wideLayout, "compact").horizontal).toBe(12);

      expect(resolvePadding(compactLayout, "comfortable").gap).toBe(8);
      expect(resolvePadding(wideLayout, "comfortable").gap).toBe(12);

      expect(resolvePadding(compactLayout, "spacious").vertical).toBe(14);
      expect(resolvePadding(wideLayout, "spacious").vertical).toBe(20);
    });
  });

  describe("responsiveSelect", () => {
    it("selects desktop value on desktop non-compact layout", () => {
      const layout: ResponsiveLayout = { compact: false, platform: "web" };
      const result = responsiveSelect(layout, {
        desktop: "Desktop View",
        mobile: "Mobile View",
        compact: "Compact View",
      });
      expect(result).toBe("Desktop View");
    });

    it("selects mobile value on mobile OS", () => {
      const layout: ResponsiveLayout = { compact: false, platform: "ios" };
      const result = responsiveSelect(layout, {
        desktop: "Desktop View",
        mobile: "Mobile View",
      });
      expect(result).toBe("Mobile View");
    });

    it("selects compact value on compact desktop layout (narrow split pane)", () => {
      const layout: ResponsiveLayout = { compact: true, platform: "web" };
      const result = responsiveSelect(layout, {
        desktop: "Desktop View",
        mobile: "Mobile View",
        compact: "Compact View",
      });
      expect(result).toBe("Compact View");
    });

    it("prefers specific platform override when provided", () => {
      const layout: ResponsiveLayout = { compact: false, platform: "ios" };
      const result = responsiveSelect(layout, {
        desktop: "Desktop View",
        mobile: "Mobile View",
        platform: { ios: "iOS Native View" },
      });
      expect(result).toBe("iOS Native View");
    });

    it("falls back to desktop if mobile is omitted on mobile platform", () => {
      const layout: ResponsiveLayout = { compact: false, platform: "android" };
      const result = responsiveSelect(layout, {
        desktop: "Fallback View",
      });
      expect(result).toBe("Fallback View");
    });

    it("selects wide value on non-compact layout", () => {
      const layout: ResponsiveLayout = { compact: false, platform: "web" };
      const result = responsiveSelect(layout, {
        wide: "Wide Dashboard",
        compact: "Narrow Drawer",
      });
      expect(result).toBe("Wide Dashboard");
    });

    it("selects compact value on compact layout", () => {
      const layout: ResponsiveLayout = { compact: true, platform: "web" };
      const result = responsiveSelect(layout, {
        wide: "Wide Dashboard",
        compact: "Narrow Drawer",
      });
      expect(result).toBe("Narrow Drawer");
    });

    it("returns undefined when no matching options are provided", () => {
      const layout: ResponsiveLayout = { compact: false, platform: "web" };
      const result = responsiveSelect(layout, {});
      expect(result).toBeUndefined();
    });
  });
});
