import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Platform } from "react-native";
import { HostMetricGauge, HostThemeProvider } from "./host-ui";

vi.mock("@getPaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIGHT = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#d4d4d8",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#16a34a",
    statusWarning: "#ca8a04",
    statusDanger: "#dc2626",
  },
} as const;

/** The top RN stub pins `OS: "web"`; the gauge reads it at render time. */
const mutablePlatform = Platform as unknown as { OS: string };

function flattenStyle(style: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const visit = (value: unknown): void => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value === "object") Object.assign(out, value);
  };
  visit(style);
  return out;
}

function renderGauge(value: number) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <HostThemeProvider theme={LIGHT}>
        <HostMetricGauge value={value} />
      </HostThemeProvider>,
    );
  });
  return renderer;
}

function findByTestID(renderer: TestRenderer.ReactTestRenderer, testID: string) {
  // The composite `GaugeArc` also carries `testID`; only the styled host node
  // is the ring whose border colors and rotation are under test.
  return renderer.root.findAll(
    (node) => node.props?.testID === testID && node.props?.style !== undefined,
  );
}

/** The rotation angle the arc ring was given, as a number of degrees. */
function rotationOf(renderer: TestRenderer.ReactTestRenderer, testID: string): number {
  const [ring] = findByTestID(renderer, testID);
  expect(ring, `no arc ring carries testID=${testID}`).toBeDefined();
  const transform = flattenStyle(ring!.props.style).transform as
    | Array<{ rotate?: string }>
    | undefined;
  const rotate = transform?.find((entry) => typeof entry?.rotate === "string")?.rotate;
  expect(rotate, `${testID} must carry a rotate transform`).toBeTruthy();
  return Number.parseFloat(rotate!);
}

afterEach(() => {
  mutablePlatform.OS = "web";
});

/**
 * Regression for xpufx-org/paseo#1010 (native half): `HostMetricGauge`'s
 * non-web branch drew a full track ring plus a FILLED inner circle tinted by the
 * value. On a phone that reads as a solid disc — it encodes magnitude as
 * opacity, not as an arc — while the web branch correctly paints a
 * `conic-gradient` sweep. The native branch must draw a proportional ring arc
 * without `react-native-svg`, and the web branch must keep its gradient.
 */
describe("HostMetricGauge native arc (#1010)", () => {
  it("keeps the web conic-gradient path", () => {
    mutablePlatform.OS = "web";
    const renderer = renderGauge(30);
    const backgrounds = renderer.root
      .findAll((node) => typeof node.props?.style !== "undefined")
      .map((node) => flattenStyle(node.props.style))
      .map((style) => style.background ?? style.backgroundImage)
      .filter((value): value is string => typeof value === "string");
    expect(backgrounds.some((value) => value.includes("conic-gradient"))).toBe(true);
  });

  it("draws an arc ring for native and never a filled value disc", () => {
    mutablePlatform.OS = "ios";
    const renderer = renderGauge(30);

    // The defect: an inner disc filled with the value color. After the fix the
    // value is carried by border arcs, and nothing paints that color as a fill.
    const filledWithValue = renderer.root
      .findAll((node) => typeof node.props?.style !== "undefined")
      .map((node) => flattenStyle(node.props.style))
      .filter((style) => style.backgroundColor === LIGHT.colors.statusSuccess);
    expect(filledWithValue, "the gauge must not paint the value as a solid disc").toEqual([]);

    const [ring] = findByTestID(renderer, "gauge-arc-right");
    const style = flattenStyle(ring?.props.style);
    expect(style.borderTopColor).toBe(LIGHT.colors.statusSuccess);
    expect(style.borderRightColor).toBe(LIGHT.colors.statusSuccess);
    expect(style.borderColor).toBe("transparent");
  });

  it("sweeps the native arc in proportion to the value", () => {
    mutablePlatform.OS = "ios";

    // 30% -> 108deg sweep -> one half-arc, rotated so the visible sweep is 0..108.
    const thirty = renderGauge(30);
    expect(findByTestID(thirty, "gauge-arc-left")).toHaveLength(0);
    expect(rotationOf(thirty, "gauge-arc-right")).toBeCloseTo(108 - 135, 5);

    // 75% -> 270deg sweep -> both half-arcs, right fixed at the full half.
    const seventyFive = renderGauge(75);
    expect(rotationOf(seventyFive, "gauge-arc-right")).toBeCloseTo(45, 5);
    expect(rotationOf(seventyFive, "gauge-arc-left")).toBeCloseTo(270 - 135, 5);

    // 100% -> both halves at their full extent.
    const full = renderGauge(100);
    expect(rotationOf(full, "gauge-arc-right")).toBeCloseTo(45, 5);
    expect(rotationOf(full, "gauge-arc-left")).toBeCloseTo(225, 5);
  });

  it("renders no arc at zero and keeps the track", () => {
    mutablePlatform.OS = "ios";
    const renderer = renderGauge(0);
    expect(findByTestID(renderer, "gauge-arc-right")).toHaveLength(0);
    expect(findByTestID(renderer, "gauge-arc-left")).toHaveLength(0);
    const [track] = findByTestID(renderer, "gauge-track");
    expect(track).toBeDefined();
    expect(flattenStyle(track!.props.style).borderColor).toBe(LIGHT.colors.surface2);
  });
});
