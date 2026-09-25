import { describe, expect, it, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Pressable, Text, View } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { resolveTypography } from "../client/theme/tokens.js";
import { Badge } from "../client/components/Badge.js";
import { Button } from "../client/components/Button.js";
import { InlineButton } from "../client/components/InlineButton.js";
import { SectionHeader } from "../client/components/SectionHeader.js";
import { InteractiveRow } from "../client/components/InteractiveRow.js";
import { DataTable } from "../client/components/DataTable.js";

/**
 * Narrow-viewport layout contract for the shared UI primitives (#621).
 *
 * React Native's Yoga — unlike CSS — defaults `flexShrink` to 0, so a flex
 * item keeps its full content width. A primitive that renders a caller-supplied
 * string (a chip label, a button label, a section title) and declares no shrink
 * budget and no `numberOfLines` therefore insists on its intrinsic width: it
 * pushes its row past the viewport, and in a row with `overflow: "visible"` it
 * paints over the sibling group instead of clipping.
 *
 * These assertions are the class-level fix. A plugin that renders a long path,
 * sha, id, or URL through any of these primitives gets truncation for free, and
 * a regression in a primitive fails here rather than in a user's phone.
 */

/** Long enough to exceed any phone viewport, and shaped like real fleet data. */
const LONG_LABEL =
  "/home/xpufx/.paseo/worktrees/2h0dw6vb/fix-621-fleet-mobile-overlap";

const typography = resolveTypography({ compact: false, platform: "web" }, "comfortable");

beforeEach(() => {
  vi.restoreAllMocks();
  initClientHelpers({
    Icon: (props: any) => React.createElement("mock-icon", { name: props?.name }),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors: {
      surface0: "#18181b",
      surface1: "#27272a",
      surface2: "#3f3f46",
      border: "#3f3f46",
      foreground: "#fafafa",
      foregroundMuted: "#a1a1aa",
      accent: "#3b82f6",
      accentForeground: "#ffffff",
    },
    fonts: {} as any,
    layout: { compact: false, platform: "web" } as any,
    flair: { headingTransform: "none" },
    isCompact: false,
    isMobile: false,
    touchTargetMin: 28,
    alpha: (c: string) => c,
    getContrastColor: () => "#fff",
    getStatusColor: () => "#fff",
    getVariantPalette: () => ({ bg: "#000", text: "#fff", border: "#333" }),
    resolveRadius: () => 8,
    padding: { horizontal: 12, vertical: 8, gap: 8 },
    typography,
  } as any);
});

function render(el: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function styleValue(style: any, key: string): any {
  // `Pressable` takes `style` as a callback of the interaction state; the
  // resting style is the one that governs layout width.
  const resolved = typeof style === "function" ? style({ pressed: false }) : style;
  const flat = (Array.isArray(resolved) ? resolved.flat(Infinity) : [resolved]).filter(Boolean);
  // Later entries win, matching RN style composition.
  for (let i = flat.length - 1; i >= 0; i -= 1) {
    if (flat[i]?.[key] !== undefined) return flat[i][key];
  }
  return undefined;
}

/**
 * Yoga shrinks an item when `flexShrink > 0` or when `flex`/`flexBasis`
 * resolve to a non-zero shrink. `flex: 1` expands to `1 1 0%`.
 */
function shrinkBudget(style: any): number {
  const explicit = styleValue(style, "flexShrink");
  if (typeof explicit === "number") return explicit;
  const flex = styleValue(style, "flex");
  if (typeof flex === "number") return flex === 0 ? 0 : 1;
  if (typeof flex === "string" && flex !== "none") {
    const parts = flex.trim().split(/\s+/);
    if (parts.length >= 2 && !isNaN(Number(parts[1]))) return Number(parts[1]);
    return 1;
  }
  return 0;
}

/**
 * Asserts a primitive honours the contract: its outer box can give up width,
 * and its label truncates so the truncation is actually reachable.
 */
function assertNarrowViewportContract(
  name: string,
  el: React.ReactElement,
  findText: (r: TestRenderer.ReactTestRenderer) => TestRenderer.ReactTestInstance,
  findBox: (r: TestRenderer.ReactTestRenderer) => TestRenderer.ReactTestInstance,
) {
  it(`${name} yields width instead of overflowing a narrow viewport`, () => {
    const renderer = render(el);
    const box = findBox(renderer);
    const text = findText(renderer);

    expect(
      shrinkBudget(box.props.style),
      `${name}: outer box needs a flexShrink budget (Yoga defaults it to 0)`,
    ).toBeGreaterThan(0);

    expect(
      shrinkBudget(text.props.style),
      `${name}: label Text needs a flexShrink budget or numberOfLines cannot engage`,
    ).toBeGreaterThan(0);

    expect(
      Number(text.props.numberOfLines ?? 0),
      `${name}: label Text needs numberOfLines so a long value truncates`,
    ).toBeGreaterThanOrEqual(1);
  });
}

const firstText = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(Text as any)[0];
const firstView = (r: TestRenderer.ReactTestRenderer) => r.root.findAllByType(View as any)[0];
// Button-like primitives render a `Pressable` box rather than a `View`.
const firstPressable = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Pressable as any)[0];

describe("narrow-viewport layout contract (#621)", () => {
  assertNarrowViewportContract(
    "Badge",
    React.createElement(Badge, { label: LONG_LABEL }),
    firstText,
    firstView,
  );

  assertNarrowViewportContract(
    "Button",
    React.createElement(Button, { label: LONG_LABEL, onPress: () => {} }),
    firstText,
    firstPressable,
  );

  assertNarrowViewportContract(
    "InlineButton",
    React.createElement(InlineButton, { label: LONG_LABEL, onPress: () => {} }),
    firstText,
    firstPressable,
  );

  assertNarrowViewportContract(
    "SectionHeader",
    React.createElement(SectionHeader, { title: LONG_LABEL }),
    firstText,
    firstView,
  );

  it("InteractiveRow yields width so a long label does not widen its parent", () => {
    const renderer = render(
      React.createElement(InteractiveRow, { onPress: () => {} }, "row"),
    );
    const row = firstPressable(renderer);
    expect(shrinkBudget(row.props.style)).toBeGreaterThan(0);
  });

  it("keeps the full label reachable for assistive tech after truncation", () => {
    // A truncated chip must not lose its value: the label stays in the
    // accessibility label even though the visible text is elided.
    const renderer = render(React.createElement(Badge, { label: LONG_LABEL }));
    const text = firstText(renderer);
    expect(text.props.accessibilityLabel).toBe(LONG_LABEL);
  });

  it("DataTable cells may compress so one wide cell cannot squeeze its siblings", () => {
    // The desktop table lays columns out in a non-wrapping `row` with `flex`
    // weights. A cell whose content carries a long string must still be allowed
    // to give up width, otherwise it claims the row and its siblings collapse.
    const renderer = render(
      React.createElement(DataTable as any, {
        data: [{ title: LONG_LABEL }],
        keyExtractor: (row: any) => row.title,
        columns: [
          { key: "title", header: "Issue", flex: 3, render: (row: any) => row.title },
          { key: "status", header: "Status", flex: 1, render: () => "open" },
        ],
      }),
    );
    const cells = renderer.root
      .findAllByType(View as any)
      .filter((node) => shrinkBudget(node.props.style) > 0);
    // Every column cell in the header row and the data row must be shrinkable.
    expect(cells.length).toBeGreaterThanOrEqual(4);
    for (const cell of cells) {
      expect(styleValue(cell.props.style, "maxWidth")).toBe("100%");
    }
  });

  it("DataTable header labels truncate so a long column name cannot widen the row", () => {
    const renderer = render(
      React.createElement(DataTable as any, {
        data: [{ title: LONG_LABEL }],
        keyExtractor: (row: any) => row.title,
        columns: [{ key: "title", header: LONG_LABEL, flex: 1, render: (r: any) => r.title }],
      }),
    );
    const header = renderer.root
      .findAllByType(Text as any)
      .find((node) => node.props.children === LONG_LABEL);
    expect(header).toBeDefined();
    expect(Number(header!.props.numberOfLines ?? 0)).toBeGreaterThanOrEqual(1);
    expect(shrinkBudget(header!.props.style)).toBeGreaterThan(0);
  });
});
