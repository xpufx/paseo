import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { HostThemeProvider } from "paseo-plugin-helper/lifecycle";
import { colorsOutsidePalette } from "paseo-plugin-ui-testing";
import { HostBadge, HostButton, HostCard, HostProgressBar, HostStatusDot } from "./host-ui";

vi.mock("react-native", () => {
  const stub = (name: string) => {
    const Component = (props: Record<string, unknown>) =>
      React.createElement(name, props, (props?.children as React.ReactNode) ?? null);
    Object.defineProperty(Component, "name", { value: name });
    return Component;
  };
  return {
    View: stub("View"),
    Text: stub("Text"),
    Pressable: stub("Pressable"),
    TouchableOpacity: stub("TouchableOpacity"),
    ScrollView: stub("ScrollView"),
    TextInput: stub("TextInput"),
    ActivityIndicator: stub("ActivityIndicator"),
    Image: stub("Image"),
    StyleSheet: { create: <T,>(styles: T): T => styles, flatten: (style: unknown) => style, hairlineWidth: 1, compose: (a: unknown, b: unknown) => [a, b] },
    Platform: { OS: "web", select: <T,>(options: { web?: T; default?: T } & Record<string, T>): T | undefined => options.web ?? options.default },
    Appearance: { getColorScheme: () => "dark" as const, addChangeListener: () => ({ remove: () => {} }) },
    useColorScheme: () => "dark" as const,
    Dimensions: { get: () => ({ width: 1400, height: 900, scale: 1, fontScale: 1 }) },
    useWindowDimensions: () => ({ width: 1400, height: 900, scale: 1, fontScale: 1 }),
    Linking: { openURL: async () => {}, canOpenURL: async () => true },
    Animated: { Value: class { constructor(public value: number) {} setValue() {} interpolate() { return {}; } }, View: stub("AnimatedView"), Text: stub("AnimatedText"), loop: (a: unknown) => a, sequence: () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {}, reset: () => {} }), timing: () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {}, reset: () => {} }), spring: () => ({ start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {}, reset: () => {} }) },
    Easing: { linear: (v: number) => v, ease: (v: number) => v, inOut: (v: unknown) => v },
  };
});

vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
  ScrollView: (props: Record<string, unknown>) =>
    React.createElement("mock-scroll-view", props, (props.children as React.ReactNode) ?? null),
  TextInput: (props: Record<string, unknown>) => React.createElement("mock-text-input", props, null),
  copyText: async () => {},
  useToast: () => ({ show: () => {}, error: () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Sentinel host theme; any painted color that is not one of these is a raw
 * literal. T7 was the `props.theme.colors.statusX || "#ef4444"` family.
 */
const SENTINEL_THEME = {
  colors: {
    surface0: "#010101",
    surface1: "#020202",
    surface2: "#030303",
    border: "#040404",
    foreground: "#050505",
    foregroundMuted: "#060606",
    accent: "#070707",
    accentForeground: "#080808",
    statusSuccess: "#090909",
    statusWarning: "#0a0a0a",
    statusDanger: "#0b0b0b",
  },
} as const;

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

describe("plugin-updates host-ui palette guard (T7)", () => {
  it("paints status badges, buttons, and progress only from the host palette", () => {
    const renderer = render(
      <HostThemeProvider theme={SENTINEL_THEME as never}>
        <HostCard>
          <HostBadge label="error" variant="danger" styleVariant="solid" />
          <HostBadge label="update" variant="warning" />
          <HostBadge label="fresh" variant="success" />
          <HostStatusDot variant="danger" />
          <HostProgressBar value={0.5} />
          <HostButton label="Primary" variant="primary" onPress={() => {}} />
          <HostButton label="Danger" variant="danger" onPress={() => {}} />
        </HostCard>
      </HostThemeProvider>,
    );
    const outside = colorsOutsidePalette(renderer.toJSON(), Object.values(SENTINEL_THEME.colors));
    expect(outside.map((use) => `${use.property}=${use.value}`)).toEqual([]);
    renderer.unmount();
  });
});
