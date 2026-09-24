import React from "react";

/**
 * Minimal React Native stub for the top plugin's JSX tests.
 *
 * The real `react-native` entrypoint carries Flow syntax Vite cannot parse, so
 * tests alias it to this module (see `vitest.config.ts`). Host primitives that
 * render to elements keep their `children` so a rendered tree can be flattened
 * back to text; everything is style-agnostic, which is all the render tests
 * need.
 */
function stub(name: string) {
  function RNStub(props: Record<string, unknown>) {
    return React.createElement(name, props, props?.children as React.ReactNode);
  }
  Object.defineProperty(RNStub, "name", { value: `RN${name}` });
  return RNStub;
}

export const View = stub("View");
export const Text = stub("Text");
export const Pressable = stub("Pressable");
export const ScrollView = stub("ScrollView");
export const RefreshControl = stub("RefreshControl");
export const TextInput = stub("TextInput");
export const Image = stub("Image");
export const ActivityIndicator = stub("ActivityIndicator");
export const KeyboardAvoidingView = stub("KeyboardAvoidingView");

export const StyleSheet = {
  create: <T extends Record<string, unknown>>(styles: T): T => styles,
  flatten: (style: unknown) => style,
  hairlineWidth: 1,
  compose: (a: unknown, b: unknown) => [a, b],
  absoluteFillObject: {},
};

export const Platform = {
  OS: "web" as const,
  select: <T,>(options: { web?: T; default?: T } & Record<string, T>): T | undefined =>
    options.web ?? options.default,
};

export const Appearance = {
  getColorScheme: () => "dark" as const,
  addChangeListener: () => ({ remove: () => {} }),
};

export const useColorScheme = () => "dark" as const;

export const Dimensions = {
  get: () => ({ width: 390, height: 844, scale: 3, fontScale: 3 }),
};

export const useWindowDimensions = () => ({ width: 390, height: 844, scale: 3, fontScale: 3 });

export const Linking = {
  openURL: async () => {},
  canOpenURL: async () => true,
};

export const PanResponder = {
  create: () => ({ panHandlers: {} }),
};

const timing = {
  start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }),
  stop: () => {},
  reset: () => {},
};

export const Animated = {
  Value: class {
    constructor(public value: number) {}
    setValue() {}
    interpolate() {
      return {};
    }
  },
  View: stub("AnimatedView"),
  Text: stub("AnimatedText"),
  loop: (anim: unknown) => anim ?? timing,
  sequence: () => timing,
  timing: () => timing,
  spring: () => timing,
};

export const Easing = {
  linear: (v: number) => v,
  ease: (v: number) => v,
};

export default {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  StyleSheet,
  Platform,
  Appearance,
  useColorScheme,
  Dimensions,
  useWindowDimensions,
  Linking,
  PanResponder,
  Animated,
  Easing,
};
