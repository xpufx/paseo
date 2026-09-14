import React from "react";

function stub(name: string) {
  function RNStub(props: any) {
    return React.createElement(name, props, props?.children);
  }
  Object.defineProperty(RNStub, "name", { value: `RN${name}` });
  return RNStub;
}

class AnimatedValue {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  setValue(value: number) {
    this.value = value;
  }
  interpolate(config: any) {
    return { config };
  }
}

const animationStub = {
  start: (cb?: (result: { finished: boolean }) => void) => {
    cb?.({ finished: true });
  },
  stop: () => {},
  reset: () => {},
};

export const View = stub("View");
export const Text = stub("Text");
export const Pressable = stub("Pressable");
export const ScrollView = stub("ScrollView");
export const TextInput = stub("TextInput");
export const Image = stub("Image");

export const StyleSheet = {
  create: <T extends Record<string, any>>(styles: T): T => styles,
  flatten: (style: any) => style,
  hairlineWidth: 1,
  compose: (a: any, b: any) => [a, b],
};

export const Platform = {
  OS: "web",
  select: <T,>(options: { web?: T; default?: T } & Record<string, T>): T | undefined =>
    options.web ?? options.default,
};

export const Appearance = {
  getColorScheme: () => "dark" as const,
};

export const Dimensions = {
  get: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }),
};

export const Linking = {
  openURL: async (_url: string) => {},
  canOpenURL: async (_url: string) => true,
};

export const PanResponder = {
  create: (_config: any) => ({ panHandlers: {} }),
};

export const Animated = {
  Value: AnimatedValue,
  View: stub("AnimatedView"),
  Text: stub("AnimatedText"),
  loop: (anim: any) => anim ?? animationStub,
  sequence: (_anims: any[]) => animationStub,
  timing: (_value: any, _config: any) => animationStub,
  spring: (_value: any, _config: any) => animationStub,
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
  TextInput,
  Image,
  StyleSheet,
  Platform,
  Appearance,
  Dimensions,
  Linking,
  PanResponder,
  Animated,
  Easing,
};
