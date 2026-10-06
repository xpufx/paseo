import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { HostThemeProvider } from "paseo-plugin-helper/lifecycle";
import { colorsOutsidePalette } from "paseo-plugin-ui-testing";
import { Badge, Button, Card, TextInput } from "./host-ui";

// The real `react-native` entrypoint carries Flow syntax Vite cannot parse.
// Mirror the helper's own tests and alias it to a stub.
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
    Image: stub("Image"),
    ActivityIndicator: stub("ActivityIndicator"),
    StyleSheet: { create: <T,>(styles: T): T => styles, flatten: (style: unknown) => style, hairlineWidth: 1, compose: (a: unknown, b: unknown) => [a, b] },
    Platform: { OS: "web", select: <T,>(options: { web?: T; default?: T } & Record<string, T>): T | undefined => options.web ?? options.default },
    Appearance: { getColorScheme: () => "dark" as const, addChangeListener: () => ({ remove: () => {} }) },
    useColorScheme: () => "dark" as const,
    Dimensions: { get: () => ({ width: 1400, height: 900, scale: 1, fontScale: 1 }) },
    useWindowDimensions: () => ({ width: 1400, height: 900, scale: 1, fontScale: 1 }),
    Linking: { openURL: async () => {}, canOpenURL: async () => true },
    RefreshControl: stub("RefreshControl"),
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
 * A sentinel host theme. Every token is a value that appears nowhere in the
 * shipped code, so any color the tree paints that is not one of these is a raw
 * literal that ignored the host `theme` prop (Class B). T6 was a solid-badge
 * `#ffffff` fallback.
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

describe("forges host-ui palette guard (T6)", () => {
  it("paints badges and buttons only from the supplied host palette", () => {
    const renderer = render(
      <HostThemeProvider theme={SENTINEL_THEME as never}>
        <Card>
          <Badge label="open" variant="success" styleVariant="solid" />
          <Badge label="warn" variant="warning" styleVariant="outline" />
          <Badge label="danger" variant="danger" />
          <Button label="Primary" variant="primary" onPress={() => {}} />
          <Button label="Danger" variant="danger" onPress={() => {}} />
          <TextInput value="abc" onChangeText={() => {}} />
        </Card>
      </HostThemeProvider>,
    );
    const outside = colorsOutsidePalette(renderer.toJSON(), Object.values(SENTINEL_THEME.colors));
    expect(outside.map((use) => `${use.property}=${use.value}`)).toEqual([]);
    renderer.unmount();
  });
});
