import { describe, expect, it } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import type { HostLayout } from "../client/host.js";
import { PluginThemeProvider, defaultDarkTheme } from "../client/theme/provider.js";
import { Row } from "../client/layout/Row.js";
import { Stack, VStack } from "../client/layout/Stack.js";
import { Grid } from "../client/layout/Grid.js";

const compact: HostLayout = { compact: true, platform: "web", width: 300 };
const wide: HostLayout = { compact: false, platform: "web", width: 900 };

function render(layout: HostLayout, el: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <PluginThemeProvider theme={defaultDarkTheme} layout={layout}>
        {el}
      </PluginThemeProvider>,
    );
  });
  return renderer;
}

function flat(style: any): any[] {
  return Array.isArray(style) ? style.flat(Infinity) : [style];
}

function styleValue(style: any, key: string): any {
  return flat(style).find((s) => s && s[key] !== undefined)?.[key];
}

function cellBases(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(View as any)
    .map((v) => styleValue(v.props.style, "flexBasis"))
    .filter((basis): basis is string => typeof basis === "string");
}

describe("Row", () => {
  it("lays children out in a row with the theme gap", () => {
    const r = render(
      compact,
      <Row align="center" justify="space-between">
        <Text>a</Text>
      </Row>,
    );
    const view = r.root.findAllByType(View as any)[0];

    expect(styleValue(view.props.style, "flexDirection")).toBe("row");
    // default density (compact) + compact surface => padding.gap 6
    expect(styleValue(view.props.style, "gap")).toBe(6);
    expect(styleValue(view.props.style, "alignItems")).toBe("center");
    expect(styleValue(view.props.style, "justifyContent")).toBe("space-between");
  });

  it("accepts a spacing token or a raw px gap override", () => {
    const token = render(compact, <Row gap="lg" />).root.findAllByType(View as any)[0];
    expect(styleValue(token.props.style, "gap")).toBe(16);

    const px = render(compact, <Row gap={20} />).root.findAllByType(View as any)[0];
    expect(styleValue(px.props.style, "gap")).toBe(20);
  });

  it("only wraps when asked", () => {
    const plain = render(compact, <Row />).root.findAllByType(View as any)[0];
    expect(styleValue(plain.props.style, "flexWrap")).toBeUndefined();

    const wrapped = render(compact, <Row wrap />).root.findAllByType(View as any)[0];
    expect(styleValue(wrapped.props.style, "flexWrap")).toBe("wrap");
  });
});

describe("Stack", () => {
  it("stacks vertically with the theme gap", () => {
    const r = render(compact, <Stack align="flex-start" />);
    const view = r.root.findAllByType(View as any)[0];

    expect(styleValue(view.props.style, "flexDirection")).toBe("column");
    expect(styleValue(view.props.style, "gap")).toBe(6);
    expect(styleValue(view.props.style, "alignItems")).toBe("flex-start");
  });

  it("exposes VStack as the same vertical primitive", () => {
    const r = render(wide, <VStack gap={4} />);
    const view = r.root.findAllByType(View as any)[0];

    expect(styleValue(view.props.style, "flexDirection")).toBe("column");
    expect(styleValue(view.props.style, "gap")).toBe(4);
  });
});

describe("Grid", () => {
  it("wraps cells across the requested column count", () => {
    const r = render(
      wide,
      <Grid columns={3}>
        <Text>a</Text>
        <Text>b</Text>
        <Text>c</Text>
      </Grid>,
    );
    const container = r.root.findAllByType(View as any)[0];

    expect(styleValue(container.props.style, "flexDirection")).toBe("row");
    expect(styleValue(container.props.style, "flexWrap")).toBe("wrap");

    // floor(100 / 3) - 2
    expect(cellBases(r)).toEqual(["31%", "31%", "31%"]);
  });

  it("does not collapse to one column on a compact surface without minColumnWidth", () => {
    const r = render(
      compact,
      <Grid columns={2}>
        <Text>a</Text>
        <Text>b</Text>
      </Grid>,
    );
    expect(cellBases(r)).toEqual(["48%", "48%"]);
  });

  it("wraps down to as many columns as fit when minColumnWidth is set", () => {
    const narrow = render(
      compact,
      <Grid columns={3} minColumnWidth={200}>
        <Text>a</Text>
        <Text>b</Text>
        <Text>c</Text>
      </Grid>,
    );
    expect(cellBases(narrow)).toEqual(["98%", "98%", "98%"]);

    const roomy = render(
      wide,
      <Grid columns={3} minColumnWidth={200}>
        <Text>a</Text>
        <Text>b</Text>
        <Text>c</Text>
      </Grid>,
    );
    // floor((900 + 12) / (200 + 12)) = 4, capped at 3
    expect(cellBases(roomy)).toEqual(["31%", "31%", "31%"]);
  });
});
