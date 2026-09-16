import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
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
    expect(normalizeBeaconMode("pulse")).toBe("pulse");
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

  it("accepts badgeIcon as string and ReactNode", () => {    const withString = React.createElement(AttentionBeacon, {
      mode: "badge",
      badgeIcon: "bell",
      children: null,
    });
    expect(withString.props.badgeIcon).toBe("bell");
    const node = React.createElement("span", null, "!");
    const withNode = React.createElement(AttentionBeacon, {
      mode: "badge",
      badgeIcon: node,
      children: null,
    });
    expect(withNode.props.badgeIcon).toBe(node);
    const without = React.createElement(AttentionBeacon, { mode: "badge", children: null });
    expect(without.props.badgeIcon).toBeUndefined();
  });
});

describe("AttentionBeacon pulse mode", () => {
  function installStubs() {
    initClientHelpers({
      Icon: () => null,
      Modal: Object.assign(() => null, { Content: () => null }),
      useRpc: () => async () => ({}),
      useToast: () => ({}),
    } as any);
    vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({ colors } as any);
  }

  function render(el: React.ReactElement) {
    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(el);
    });
    return renderer!;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("wraps children in an opacity-animated pulse node with no halo", () => {
    installStubs();
    const r = render(
      <AttentionBeacon mode="pulse" testID="beacon">
        <Text>icon</Text>
      </AttentionBeacon>,
    );
    const pulse = r.root.findByProps({ testID: "beacon-pulse" });
    expect(pulse.props.style).toHaveProperty("opacity");
    expect(r.root.findAllByProps({ testID: "beacon-glow" })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: "beacon-halo" })).toHaveLength(0);
    expect(r.root.findAllByProps({ testID: "beacon-badge" })).toHaveLength(0);
    expect(pulse.findByType(Text).props.children).toBe("icon");
  });

  it("renders children inert when inactive", () => {
    installStubs();
    const r = render(
      <AttentionBeacon mode="pulse" active={false} testID="beacon">
        <Text>icon</Text>
      </AttentionBeacon>,
    );
    expect(r.root.findAllByProps({ testID: "beacon-pulse" })).toHaveLength(0);
    expect(r.root.findByType(Text).props.children).toBe("icon");
  });

  it("accepts duration and easing overrides", () => {
    installStubs();
    const easing = (v: number) => v;
    const el = (
      <AttentionBeacon mode="pulse" duration={500} easing={easing} testID="beacon">
        <Text>icon</Text>
      </AttentionBeacon>
    );
    expect(el.props.duration).toBe(500);
    expect(el.props.easing).toBe(easing);
    const r = render(el);
    expect(r.root.findByProps({ testID: "beacon-pulse" })).toBeDefined();
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
