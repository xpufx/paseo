import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { resolveTypography } from "../client/theme/tokens.js";
import { Card, CardHeader } from "../client/components/Card.js";
import { Badge } from "../client/components/Badge.js";

const colors: any = {
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

function installStubs(isCompact: boolean) {
  initClientHelpers({
    Icon: (props: any) => React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors,
    fonts: {} as any,
    layout: { compact: isCompact, platform: "web" } as any,
    flair: { headingTransform: "none" },
    isCompact,
    isMobile: false,
    touchTargetMin: 36,
    alpha: (c: string, _o: number) => c,
    getContrastColor: () => "#fff",
    getStatusColor: () => "#fff",
    getVariantPalette: () => ({ bg: "#000", text: "#fff", border: "#333" }),
    resolveRadius: () => 8,
    padding: { horizontal: 12, vertical: 8, gap: 8 },
    typography: resolveTypography({ compact: isCompact, platform: "web" }, "compact"),
  } as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

function render(el: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function flatten(style: unknown): Record<string, any> {
  if (Array.isArray(style)) return Object.assign({}, ...style.flat(Infinity) as any[]);
  if (style && typeof style === "object") return style as Record<string, any>;
  return {};
}

/** Find the first View whose flattened style satisfies `predicate`. */
function findView(
  root: TestRenderer.ReactTestRenderer,
  label: string,
  predicate: (style: Record<string, any>) => boolean,
): TestRenderer.ReactTestInstance {
  const found = root.root
    .findAllByType(View as any)
    .find((v) => predicate(flatten(v.props.style)));
  if (!found) throw new Error(`no View matched ${label}`);
  return found;
}

const isHeaderContainer = (s: Record<string, any>) => s.width === "100%" && s.marginBottom !== undefined;
const isHeaderLeft = (s: Record<string, any>) =>
  s.flexDirection === "row" && s.gap === 8 && s.flexShrink !== undefined;
const isHeaderRight = (s: Record<string, any>) => s.flexDirection === "row" && s.gap === 6;

function renderHeader(isCompact: boolean) {
  installStubs(isCompact);
  return render(
    <Card variant="elevated">
      <Card.Header
        icon="Terminal"
        title="/slash-review"
        subtitle="Send a code-review prompt for the current diff"
        badge={<Badge label="Shipped" variant="neutral" />}
        action={<Text>act</Text>}
      />
    </Card>,
  );
}

describe("CardHeader compact stacking (#202)", () => {
  it("stacks title above actions on a compact surface", () => {
    const r = renderHeader(true);
    const style = flatten(findView(r, "header container", isHeaderContainer).props.style);
    expect(style.flexDirection).toBe("column");
    expect(style.alignItems).toBe("stretch");
    expect(style.flexWrap).toBe("nowrap");
  });

  it("releases the title block from flex:1 (basis 0) so it wraps by word", () => {
    const r = renderHeader(true);
    const style = flatten(findView(r, "header left", isHeaderLeft).props.style);
    expect(style.flexGrow).toBe(0);
    expect(style.flexShrink).toBe(0);
    expect(style.flexBasis).toBe("auto");
    expect(style.width).toBe("100%");
    expect(style.minWidth).toBe(0);
  });

  it("lets the action row wrap instead of overflowing the card", () => {
    const r = renderHeader(true);
    const style = flatten(findView(r, "header right", isHeaderRight).props.style);
    expect(style.flexWrap).toBe("wrap");
    expect(style.flexShrink).toBe(1);
    expect(style.minWidth).toBe(0);
  });

  it("keeps the single-line title/actions row on a non-compact surface", () => {
    const r = renderHeader(false);
    const containerStyle = flatten(
      findView(r, "header container", isHeaderContainer).props.style,
    );
    expect(containerStyle.flexDirection).toBe("row");
    expect(containerStyle.flexWrap).toBe("wrap");

    const left = flatten(findView(r, "header left", isHeaderLeft).props.style);
    expect(left.flexGrow).toBe(1);
    expect(left.flexBasis).toBe(0);
    expect(left.minWidth).toBe(0);

    const right = flatten(findView(r, "header right", isHeaderRight).props.style);
    // The compact-only wrap override must not leak onto desktop.
    expect(right.flexWrap).toBeUndefined();
    expect(right.flexShrink).toBe(0);
  });

  it("still renders title, subtitle, badge and action", () => {
    const r = renderHeader(true);
    expect(r.root.findByType(CardHeader)).toBeDefined();
    expect(r.root.findAllByType(Text).length).toBeGreaterThanOrEqual(2);
    expect(r.root.findByType(Badge)).toBeDefined();
  });
});
