import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { CustomPillModalContent } from "../client/custom-pills.js";
import type { CustomPillState } from "../shared/custom-pills.js";

const colors: any = {
  surface0: "#18181b",
  surface1: "#27272a",
  surface2: "#3f3f46",
  foreground: "#fafafa",
  foregroundMuted: "#a1a1aa",
  accent: "#3b82f6",
  border: "#3f3f46",
  statusDanger: "#ef4444",
};

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style ?? {}) as Record<string, unknown>;
}

const state: CustomPillState = {
  id: "gpu",
  title: "GPU",
  displayValue: "42%",
  rawValue: "42%",
  status: "neutral",
  lastUpdated: Date.now(),
};

describe("CustomPillModalContent size contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    initClientHelpers({
      Icon: () => null,
      Modal: Object.assign(() => null, { Content: () => null }),
      useRpc: () => async () => ({}),
      useToast: () => ({ show() {}, error() {} }),
    } as any);
    const token = { fontSize: 12, lineHeight: 16, fontWeight: "400" as const };
    vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
      theme: {} as any,
      colors,
      fonts: {} as any,
      layout: { compact: false, platform: "web" } as any,
      flair: { headingTransform: "none", radius: "rounded", density: "comfortable" } as any,
      isCompact: false,
      isMobile: false,
      touchTargetMin: 36,
      alpha: (c: string) => c,
      getContrastColor: () => "#fff",
      getStatusColor: () => "#fff",
      getVariantPalette: () => ({ bg: "#000", text: "#fff", border: "#333" }),
      resolveRadius: () => 8,
      padding: { horizontal: 12, vertical: 8, gap: 8 },
      typography: {
        title: token,
        heading: token,
        body: token,
        bodyStrong: token,
        bodySmall: token,
        caption: token,
        label: token,
      },
    } as any);
  });

  it("fills the host-allocated modal frame instead of sizing to its children", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<CustomPillModalContent state={state} />);
    });
    const root = renderer.root.findAllByType(View)[0];
    const style = flatten(root.props.style);
    expect(style.flex).toBe(1);
    expect(style.minHeight).toBe(0);
    expect(style.width).toBe("100%");
  });
});
