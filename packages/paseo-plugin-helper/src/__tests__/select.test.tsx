import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import * as RN from "react-native";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { resolveTypography } from "../client/theme/tokens.js";
import { Select } from "../client/components/Select.js";

const options = [
  { label: "slash-console", value: "slash-console" },
  { label: "slash.ping", value: "slash.ping" },
  { label: "slash.echo", value: "slash.echo" },
];

const typography = resolveTypography({ compact: false, platform: "web" }, "comfortable");

function installStubs(isCompact = false) {
  initClientHelpers({
    Icon: (props: any) => React.createElement("mock-icon", { name: props.name }),
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
      statusSuccess: "#22c55e",
      statusWarning: "#eab308",
      statusDanger: "#ef4444",
    },
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
    typography,
  } as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
  installStubs(false);
});

function render(el: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function flatStyle(style: any): any[] {
  if (typeof style === "function") style = style({ pressed: false });
  return Array.isArray(style) ? style.flat(Infinity) : [style];
}

function styleValue(style: any, key: string): any {
  return flatStyle(style).find((s) => s && s[key] !== undefined)?.[key];
}

function triggerOf(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAllByType(Pressable)[0];
}

describe("Select", () => {
  it("renders the placeholder when no option matches the value", () => {
    const tree = render(
      <Select value="" options={options} onValueChange={() => {}} placeholder="Pick one" />,
    );

    const text = tree.root.findAllByType(Text)[0];
    expect(text.props.children).toBe("Pick one");
  });

  it("renders the selected option label", () => {
    const tree = render(
      <Select value="slash.ping" options={options} onValueChange={() => {}} />,
    );

    const text = tree.root.findAllByType(Text)[0];
    expect(text.props.children).toBe("slash.ping");
    expect(styleValue(text.props.style, "fontWeight")).toBe("600");
  });

  it("surfaces a free-text value that is not one of the options", () => {
    const tree = render(
      <Select value="custom.rpc" options={options} onValueChange={() => {}} />,
    );

    const text = tree.root.findAllByType(Text)[0];
    expect(text.props.children).toBe("custom.rpc");
  });

  it("stays collapsed until pressed, then selects an option and closes", () => {
    const onValueChange = vi.fn();
    const tree = render(
      <Select value="" options={options} onValueChange={onValueChange} />,
    );

    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);

    act(() => {
      triggerOf(tree).props.onPress();
    });

    const optionPressables = tree.root.findAllByType(Pressable).slice(1);
    expect(optionPressables).toHaveLength(options.length);
    expect(triggerOf(tree).props.accessibilityState.expanded).toBe(true);

    act(() => {
      optionPressables[1].props.onPress();
    });

    expect(onValueChange).toHaveBeenCalledWith("slash.ping");
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  });

  it("bounds the option list so many options scroll instead of overflow", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      label: `option-${i}`,
      value: `value-${i}`,
    }));
    const tree = render(
      <Select value="value-0" options={many} onValueChange={() => {}} />,
    );

    act(() => {
      triggerOf(tree).props.onPress();
    });

    expect(tree.root.findAllByType(Pressable).slice(1)).toHaveLength(40);
    const scrollView = tree.root.findByType(ScrollView);
    expect(styleValue(scrollView.props.style, "maxHeight")).toBe(216);
  });

  it("marks the active option selected for assistive tech", () => {
    const tree = render(
      <Select value="slash.echo" options={options} onValueChange={() => {}} />,
    );

    act(() => {
      triggerOf(tree).props.onPress();
    });

    const optionPressables = tree.root.findAllByType(Pressable).slice(1);
    expect(optionPressables[2].props.accessibilityState.selected).toBe(true);
    expect(optionPressables[0].props.accessibilityState.selected).toBe(false);
  });

  it("uses the shared Badge size scale for the compact sm trigger", () => {
    const md = render(<Select value="" options={options} onValueChange={() => {}} />);
    const mdText = md.root.findAllByType(Text)[0];

    const sm = render(
      <Select value="" options={options} onValueChange={() => {}} size="sm" />,
    );
    const smText = sm.root.findAllByType(Text)[0];

    // Badge sm type is 10/12; md follows the theme caption (11/15 comfortable).
    expect(styleValue(smText.props.style, "fontSize")).toBe(10);
    expect(styleValue(smText.props.style, "lineHeight")).toBe(12);
    expect(styleValue(mdText.props.style, "fontSize")).toBe(11);
    expect(styleValue(mdText.props.style, "lineHeight")).toBe(15);
  });

  it("does not open while disabled and exposes the disabled state", () => {
    const tree = render(
      <Select value="" options={options} onValueChange={() => {}} disabled />,
    );

    const trigger = triggerOf(tree);
    expect(trigger.props.disabled).toBe(true);
    expect(trigger.props.accessibilityState.disabled).toBe(true);
    act(() => {
      trigger.props.onPress();
    });
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  });

  it("disables the trigger when there are no options", () => {
    const tree = render(<Select value="" options={[]} onValueChange={() => {}} />);
    expect(triggerOf(tree).props.disabled).toBe(true);
  });

  it("keeps the closed trigger container out of any local stacking context (#484)", () => {
    const tree = render(<Select value="" options={options} onValueChange={() => {}} />);

    const container = tree.root.findAllByType(View)[0];
    // No `position: relative`/`zIndex`: the menu lives in the root portal, so
    // the trigger container must never create a local stacking context that
    // leaks above later siblings.
    expect(styleValue(container.props.style, "position")).toBeUndefined();
    expect(styleValue(container.props.style, "zIndex")).toBeUndefined();
  });

  it("renders the open menu inside a transparent Modal overlay portal (#520)", () => {
    const tree = render(<Select value="" options={options} onValueChange={() => {}} />);

    expect(tree.root.findAllByType(Modal)).toHaveLength(0);

    act(() => {
      triggerOf(tree).props.onPress();
    });

    const modal = tree.root.findByType(Modal);
    expect(modal.props.transparent).toBe(true);
    expect(modal.props.visible).toBe(true);

    // The menu is never an in-flow child of the trigger container: it is not
    // inside the first View (the container), and it is absolutely positioned.
    // The backdrop also uses absoluteFill, so select the bordered menu box.
    const optionList = tree.root.findAllByType(View).find((node) =>
      flatStyle(node.props.style).some((s) => s && s.position === "absolute" && s.borderWidth === 1),
    );
    expect(optionList).toBeTruthy();
    expect(styleValue(optionList!.props.style, "position")).toBe("absolute");
    // Anchored to the measured trigger box (fallback coords 0/0/0/0 + xs gap).
    expect(styleValue(optionList!.props.style, "top")).toBe(4);
    expect(styleValue(optionList!.props.style, "left")).toBe(0);
    expect(styleValue(optionList!.props.style, "minWidth")).toBe(0);
  });

  it("dismisses the open menu from the full-screen backdrop (#520)", () => {
    const tree = render(<Select value="" options={options} onValueChange={() => {}} />);

    act(() => {
      triggerOf(tree).props.onPress();
    });

    const backdrop = tree.root.findByType(TouchableWithoutFeedback);
    expect(backdrop.props.onPress).toBeTypeOf("function");

    act(() => {
      backdrop.props.onPress();
    });

    expect(tree.root.findAllByType(Modal)).toHaveLength(0);
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  });

  it("anchors the menu to the measured window coordinates (#520)", () => {
    const { hostMeasureState } = RN as any;
    hostMeasureState.coords = [24, 120, 200, 34];
    hostMeasureState.calls = 0;

    const tree = render(<Select value="" options={options} onValueChange={() => {}} />);

    act(() => {
      triggerOf(tree).props.onPress();
    });

    expect(hostMeasureState.calls).toBeGreaterThan(0);

    const optionList = tree.root.findAllByType(View).find((node) =>
      flatStyle(node.props.style).some((s) => s && s.position === "absolute" && s.borderWidth === 1),
    );
    const style = optionList!.props.style;
    // top = y + height + spacing.xs(4); left/minWidth from the trigger box.
    expect(styleValue(style, "top")).toBe(120 + 34 + 4);
    expect(styleValue(style, "left")).toBe(24);
    expect(styleValue(style, "minWidth")).toBe(200);
  });
});
