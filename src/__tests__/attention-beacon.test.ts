import { describe, it, expect } from "vitest";
import {
  AttentionBeacon,
  normalizeBeaconMode,
  resolveBeaconToneColor,
} from "../client/components/AttentionBeacon.js";
import { resolveButtonAttentionMode, resolveButtonAttentionTone } from "../client/components/Button.js";
import type { ThemeColors } from "../shared/types.js";

const colors: ThemeColors = {
  surface0: "#18181b",
  surface1: "#27272a",
  surface2: "#3f3f46",
  border: "#3f3f46",
  foreground: "#fafafa",
  foregroundMuted: "#a1a1aa",
  accent: "#3b82f6",
  accentForeground: "#ffffff",
  statusSuccess: "#22c55e",
  statusWarning: "#eab308",
  statusDanger: "#ef4444",
};

describe("AttentionBeacon", () => {
  it("is exported as a component", () => {
    expect(typeof AttentionBeacon).toBe("function");
  });

  it("normalizes ring alias to radar and defaults to radar", () => {
    expect(normalizeBeaconMode("ring")).toBe("radar");
    expect(normalizeBeaconMode("radar")).toBe("radar");
    expect(normalizeBeaconMode(undefined)).toBe("radar");
    expect(normalizeBeaconMode("glow")).toBe("glow");
    expect(normalizeBeaconMode("badge")).toBe("badge");
    expect(normalizeBeaconMode("bounce")).toBe("bounce");
  });

  it("resolves tone colors from theme tokens", () => {
    expect(resolveBeaconToneColor(colors, "warning")).toBe(colors.statusWarning);
    expect(resolveBeaconToneColor(colors, "accent")).toBe(colors.accent);
    expect(resolveBeaconToneColor(colors, "danger")).toBe(colors.statusDanger);
    expect(resolveBeaconToneColor(colors)).toBe(colors.statusWarning);
  });

  it("prefers explicit color override", () => {
    expect(resolveBeaconToneColor(colors, "warning", "#123456")).toBe("#123456");
  });
});

describe("Button attention prop", () => {
  it("maps boolean and mode strings to beacon modes", () => {
    expect(resolveButtonAttentionMode(undefined)).toBeNull();
    expect(resolveButtonAttentionMode(false)).toBeNull();
    expect(resolveButtonAttentionMode(true)).toBe("radar");
    expect(resolveButtonAttentionMode("radar")).toBe("radar");
    expect(resolveButtonAttentionMode("glow")).toBe("glow");
    expect(resolveButtonAttentionMode("bounce")).toBe("bounce");
  });

  it("derives beacon tone from button variant", () => {
    expect(resolveButtonAttentionTone("danger")).toBe("danger");
    expect(resolveButtonAttentionTone("primary")).toBe("accent");
    expect(resolveButtonAttentionTone("secondary")).toBe("warning");
    expect(resolveButtonAttentionTone("ghost")).toBe("warning");
  });
});
