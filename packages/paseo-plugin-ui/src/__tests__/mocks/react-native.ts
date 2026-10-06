import React from "react";

function stub(name: string) {
  function RNStub(props: any) {
    return React.createElement(name, props, props?.children);
  }
  Object.defineProperty(RNStub, "name", { value: `RN${name}` });
  return RNStub;
}

// Overlay/portal primitives carry refs and imperative handles (e.g.
// `measureInWindow`), so they forward refs to the host node. A node-like
// object is exposed when the test renderer has no host instance, letting
// components guard on `measureInWindow` availability.
function refStub(name: string, handle?: Record<string, unknown>) {
  const RNRefStub = React.forwardRef<any, any>((props, ref) => {
    React.useImperativeHandle(ref, () => handle ?? {}, []);
    return React.createElement(name, props, props?.children);
  });
  Object.defineProperty(RNRefStub, "name", { value: `RN${name}` });
  return RNRefStub;
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

// Tests can rewrite `hostMeasureState.coords` to exercise real anchoring math
// and inspect `calls` to assert the trigger was measured.
export const hostMeasureState = {
  coords: [0, 0, 0, 0] as [number, number, number, number],
  calls: 0,
};

const hostNodeHandle = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => {
    hostMeasureState.calls += 1;
    const [x, y, width, height] = hostMeasureState.coords;
    callback(x, y, width, height);
  },
  measure: (callback: (...args: number[]) => void) => callback(0, 0, 0, 0, 0, 0),
};

export const View = refStub("View", hostNodeHandle);
export const Text = stub("Text");
export const Pressable = refStub("Pressable", hostNodeHandle);
export const ScrollView = stub("ScrollView");
export const TextInput = stub("TextInput");
export const Image = stub("Image");
export const TouchableWithoutFeedback = refStub("TouchableWithoutFeedback");
export const Modal = refStub("Modal");
export const FlatList = stub("FlatList");
export const ActivityIndicator = stub("ActivityIndicator");

const absoluteFillObject = { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 };

export const StyleSheet = {
  create: <T extends Record<string, any>>(styles: T): T => styles,
  flatten: (style: any) => style,
  hairlineWidth: 1,
  compose: (a: any, b: any) => [a, b],
  absoluteFill: absoluteFillObject,
  absoluteFillObject,
};

export const Platform = {
  OS: "web",
  select: <T,>(options: { web?: T; default?: T } & Record<string, T>): T | undefined =>
    options.web ?? options.default,
};

export const Appearance = {
  getColorScheme: () => "dark" as const,
  addChangeListener: (cb: (arg: {colorScheme: string}) => void) => {
    // Immediately invoke with current scheme
    cb({colorScheme: "dark"});
    return { remove: () => {} };
  },
};

export const useColorScheme = () => Appearance.getColorScheme?.();

export const Dimensions = {
  get: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }),
};

export const useWindowDimensions = () => ({ width: 800, height: 600, scale: 1, fontScale: 1 });

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
  TouchableWithoutFeedback,
  Modal,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Appearance,
  Dimensions,
  useWindowDimensions,
  Linking,
  PanResponder,
  Animated,
  Easing,
};
