import { describe, expect, it } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View } from "react-native";
import { defaultDarkTheme, PluginThemeProvider, usePluginTheme } from "../client/theme/provider.js";
import { resolveTypography } from "../client/theme/tokens.js";
import { COMPACT_FORM_FACTOR_WIDTH } from "../client/theme/responsive.js";
import { defaultFlair } from "../client/theme/flair.js";

interface Probe {
  body: number;
  caption: number;
  width?: number;
  compact: boolean;
}

function TypographyProbe() {
  const { typography, layout, isCompact } = usePluginTheme();
  const snapshot: Probe = {
    body: typography.body.fontSize,
    caption: typography.caption.fontSize,
    width: layout.width,
    compact: isCompact,
  };
  return <Text>{JSON.stringify(snapshot)}</Text>;
}

function renderProvider(layout: {
  compact: boolean;
  platform: "web";
  width?: number;
}) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <PluginThemeProvider theme={defaultDarkTheme} layout={layout}>
        <TypographyProbe />
      </PluginThemeProvider>,
    );
  });
  return renderer;
}

function readProbe(renderer: TestRenderer.ReactTestRenderer): Probe {
  const text = renderer.root.findAllByType(Text as any)[0];
  return JSON.parse(text.props.children as string) as Probe;
}

function measuringWrapper(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(View as any)
    .find((view) => typeof view.props.onLayout === "function")!;
}

const desktop = resolveTypography({ compact: false, platform: "web" }, defaultFlair.density);
const compact = resolveTypography({ compact: true, platform: "web" }, defaultFlair.density);

describe("PluginThemeProvider compact resolution", () => {
  it("derives compact typography from a container width below the threshold", () => {
    const renderer = renderProvider({ compact: false, platform: "web", width: 320 });
    const probe = readProbe(renderer);

    expect(probe.compact).toBe(true);
    expect(probe.width).toBe(320);
    expect(probe.body).toBe(compact.body.fontSize);
    expect(probe.caption).toBe(compact.caption.fontSize);
  });

  it("keeps desktop typography when the container width is above the threshold", () => {
    const renderer = renderProvider({
      compact: false,
      platform: "web",
      width: COMPACT_FORM_FACTOR_WIDTH + 200,
    });
    const probe = readProbe(renderer);

    expect(probe.compact).toBe(false);
    expect(probe.width).toBe(COMPACT_FORM_FACTOR_WIDTH + 200);
    expect(probe.body).toBe(desktop.body.fontSize);
    expect(probe.caption).toBe(desktop.caption.fontSize);
  });

  it("keeps host compact surfaces compact even on a wide container", () => {
    const renderer = renderProvider({ compact: true, platform: "web", width: 1200 });
    const probe = readProbe(renderer);

    expect(probe.compact).toBe(true);
    expect(probe.body).toBe(compact.body.fontSize);
    expect(probe.caption).toBe(compact.caption.fontSize);
  });

  it("steps down when the container is measured locally and width is absent", () => {
    const renderer = renderProvider({ compact: false, platform: "web" });

    const before = readProbe(renderer);
    expect(before.compact).toBe(false);
    expect(before.width).toBeUndefined();
    expect(before.body).toBe(desktop.body.fontSize);

    const wrapper = measuringWrapper(renderer);
    expect(wrapper.props.style).toEqual(expect.objectContaining({ flex: 1 }));

    act(() => {
      wrapper.props.onLayout({ nativeEvent: { layout: { width: 300, height: 200 } } });
    });

    const after = readProbe(renderer);
    expect(after.compact).toBe(true);
    expect(after.width).toBe(300);
    expect(after.body).toBe(compact.body.fontSize);
    expect(after.caption).toBe(compact.caption.fontSize);
  });
});
