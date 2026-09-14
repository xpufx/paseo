import { describe, it, expect } from "vitest";
import { resolveRadius } from "../client/theme/flair.js";
import { alpha, getLuminance, getContrastColor, getStatusColor } from "../client/theme/color-utils.js";
import { getTouchTargetMin, isMobilePlatform } from "../client/theme/responsive.js";

describe("Theme & Visual Flair", () => {
  it("resolves corner radii according to flair preset", () => {
    expect(resolveRadius("sharp", "md")).toBe(3);
    expect(resolveRadius("rounded", "md")).toBe(8);
    expect(resolveRadius("rounded", "lg")).toBe(12);
    expect(resolveRadius("rounded", "pill")).toBe(9999);
    expect(resolveRadius("pill", "sm")).toBe(9999);
  });

  it("calculates hex alpha transparency cleanly", () => {
    expect(alpha("#ffffff", 0.5)).toBe("#ffffff80");
    expect(alpha("#000000", 1)).toBe("#000000ff");
    expect(alpha("#fff", 0.5)).toBe("#ffffff80");
  });

  it("calculates luminance and picks contrasting text color", () => {
    expect(getLuminance("#ffffff")).toBeGreaterThan(0.9);
    expect(getLuminance("#000000")).toBeLessThan(0.05);

    // Light background -> dark text
    expect(getContrastColor("#ffffff")).toBe("#0f172a");
    // Dark background -> light text
    expect(getContrastColor("#18181b")).toBe("#ffffff");
  });

  it("resolves status colors correctly", () => {
    const colors = {
      surface0: "#000",
      surface1: "#111",
      surface2: "#222",
      border: "#333",
      foreground: "#fff",
      foregroundMuted: "#888",
      accent: "#3b82f6",
      accentForeground: "#fff",
      statusSuccess: "#22c55e",
      statusWarning: "#eab308",
      statusDanger: "#ef4444",
    };

    expect(getStatusColor("success", colors)).toBe("#22c55e");
    expect(getStatusColor("warning", colors)).toBe("#eab308");
    expect(getStatusColor("danger", colors)).toBe("#ef4444");
    expect(getStatusColor("accent", colors)).toBe("#3b82f6");
    expect(getStatusColor("accent", colors, "#10b981")).toBe("#10b981");
  });

  it("enforces touch target sizes on mobile/compact", () => {
    expect(isMobilePlatform("ios")).toBe(true);
    expect(isMobilePlatform("android")).toBe(true);
    expect(isMobilePlatform("web")).toBe(false);

    // Compact or mobile requires min 44pt
    expect(getTouchTargetMin({ compact: true, platform: "web" })).toBe(44);
    expect(getTouchTargetMin({ compact: false, platform: "ios" })).toBe(44);
    expect(getTouchTargetMin({ compact: false, platform: "android" })).toBe(44);

    // Desktop mouse with non-compact pane allows standard 28pt
    expect(getTouchTargetMin({ compact: false, platform: "web" })).toBe(28);
  });
});
