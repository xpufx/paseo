import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { FormRow } from "../client/layout/FormRow.js";
import { defaultFlair } from "../client/theme/flair.js";

/**
 * Regression for xpufx-org/paseo#213: a settings row with a one-line control
 * must not stack the control under its label (that doubles the row height for
 * no gain). `layout="inline"` keeps label+description left and control right.
 */
function installStubs() {
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors: { foreground: "#fff", foregroundMuted: "#999" } as any,
    fonts: {} as any,
    layout: { compact: false, platform: "web" } as any,
    flair: defaultFlair,
    isCompact: false,
    isMobile: false,
    touchTargetMin: 28,
    alpha: (c: string) => c,
    getContrastColor: () => "#fff",
    getStatusColor: () => "#fff",
    getVariantPalette: () => ({ bg: "#000", text: "#fff", border: "#333" }),
    resolveRadius: () => 8,
    padding: { horizontal: 12, vertical: 8, gap: 8 },
    typography: {
      label: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
      caption: { fontSize: 11, lineHeight: 16 },
    },
  } as any);
}

function flat(style: any): any[] {
  return Array.isArray(style) ? style.flat(Infinity) : [style];
}

function styleValue(style: any, key: string): any {
  return flat(style).find((s) => s && s[key] !== undefined)?.[key];
}

beforeEach(() => vi.restoreAllMocks());

function render(el: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

describe("FormRow layout (#213)", () => {
  it("defaults to stacked: the control sits below the label", () => {
    installStubs();
    const r = render(
      <FormRow label="Enabled" description="In the mesh">
        <Text testID="ctl">on</Text>
      </FormRow>,
    );
    const container = r.root.findAllByType(View as any)[0];
    expect(styleValue(container.props.style, "flexDirection")).toBeUndefined();
  });

  it("inline keeps the control on the same line as the label", () => {
    installStubs();
    const r = render(
      <FormRow layout="inline" label="Enabled" description="In the mesh">
        <Text testID="ctl">on</Text>
      </FormRow>,
    );
    const container = r.root.findAllByType(View as any)[0];
    expect(styleValue(container.props.style, "flexDirection")).toBe("row");
    expect(styleValue(container.props.style, "alignItems")).toBe("center");
  });

  it("inline renders the control inside the right-hand column", () => {
    installStubs();
    const r = render(
      <FormRow layout="inline" label="Health">
        <Text testID="ctl">ok</Text>
      </FormRow>,
    );
    const ctl = r.root.findByProps({ testID: "ctl" });
    const parentStyle = (ctl.parent as any).props.style;
    expect(styleValue(parentStyle, "alignItems")).toBe("flex-end");
  });
});
