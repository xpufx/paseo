import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { initClientHelpers } from "paseo-plugin-helper/client";
import {
  AskItem,
  buildSelectionPayload,
  isAskAnswered,
  recommendedOption,
  type AskSelectionPayload,
} from "./ask";

// The real `react-native` entrypoint carries Flow syntax Vite cannot parse.
// The helper's own tests alias it to a stub; mirroring that here with `vi.mock`
// keeps this plugin free of a root-level vitest config (v0.8 layout).
vi.mock("react-native", () => {
  const stub = (name: string) => {
    const Component = (props: Record<string, unknown>) =>
      React.createElement(name, props, (props?.children as React.ReactNode) ?? null);
    Object.defineProperty(Component, "name", { value: name });
    return Component;
  };
  const timing = { start: (cb?: (r: { finished: boolean }) => void) => cb?.({ finished: true }), stop: () => {}, reset: () => {} };
  return {
    View: stub("View"),
    Text: stub("Text"),
    Pressable: stub("Pressable"),
    ScrollView: stub("ScrollView"),
    TextInput: stub("TextInput"),
    Image: stub("Image"),
    StyleSheet: { create: <T,>(styles: T): T => styles, flatten: (style: unknown) => style, hairlineWidth: 1, compose: (a: unknown, b: unknown) => [a, b] },
    Platform: { OS: "web", select: <T,>(options: { web?: T; default?: T } & Record<string, T>): T | undefined => options.web ?? options.default },
    Appearance: { getColorScheme: () => "dark" as const, addChangeListener: () => ({ remove: () => {} }) },
    useColorScheme: () => "dark" as const,
    Dimensions: { get: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }) },
    useWindowDimensions: () => ({ width: 800, height: 600, scale: 1, fontScale: 1 }),
    Linking: { openURL: async () => {}, canOpenURL: async () => true },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    Animated: { Value: class { constructor(public value: number) {} setValue() {} interpolate() { return {}; } }, View: stub("AnimatedView"), Text: stub("AnimatedText"), loop: (a: unknown) => a, sequence: () => timing, timing: () => timing, spring: () => timing },
    Easing: { linear: (v: number) => v, ease: (v: number) => v, inOut: (v: unknown) => v },
    ActivityIndicator: stub("ActivityIndicator"),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function installStubs() {
  initClientHelpers({
    Icon: (props: { name?: string }) => React.createElement("mock-icon", { name: props.name }),
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({ show: () => {}, error: () => {} }),
  } as unknown as Parameters<typeof initClientHelpers>[0]);
}

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

/** Flatten the rendered tree to its concatenated text content. */
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "children" in node) {
    return textOf((node as { children?: unknown }).children);
  }
  return "";
}

function press(renderer: TestRenderer.ReactTestRenderer, label: string) {
  const button = renderer.root.findAll(
    (node) => typeof node.props.accessibilityLabel === "string" && node.props.accessibilityLabel.includes(label),
  )[0];
  if (!button) throw new Error(`no pressable matching ${label}`);
  act(() => {
    button.props.onPress?.();
  });
}

const options = [
  { id: "0", label: "Envelope v5" },
  { id: "1", label: "Peer-RPC seen-id LRU" },
  { id: "2", label: "Daemon messageId dedup" },
];

beforeEach(() => {
  installStubs();
});

describe("buildSelectionPayload", () => {
  it("returns the verbatim label and 0-based index for single-select", () => {
    expect(buildSelectionPayload({ options, multiSelect: false }, ["1"], "")).toEqual({
      payload: { selection: "Peer-RPC seen-id LRU", selectionIdx: 1 },
    });
  });

  it("treats a lone write-in as the answer", () => {
    expect(buildSelectionPayload({ options, multiSelect: false }, [], "  do it manually ")).toEqual({
      payload: { selection: "do it manually", writeIn: true },
    });
  });

  it("errors until a choice or write-in exists", () => {
    const result = buildSelectionPayload({ options, multiSelect: false }, [], "   ");
    expect(result.error).toBe("Choose an option or write an answer.");
  });

  it("joins multi-select labels with a comma", () => {
    expect(buildSelectionPayload({ options, multiSelect: true }, ["0", "2"], "")).toEqual({
      payload: { selection: "Envelope v5, Daemon messageId dedup" },
    });
  });

  it("allows a multi-select write-in with no boxes ticked", () => {
    expect(buildSelectionPayload({ options, multiSelect: true }, [], "other")).toEqual({
      payload: { selection: "other", writeIn: true },
    });
  });

  it("rejects a multi-select submit with nothing picked or written", () => {
    expect(buildSelectionPayload({ options, multiSelect: true }, [], "").error).toBe(
      "Pick at least one option.",
    );
  });

  it("rejects a stale option id that is no longer offered", () => {
    expect(buildSelectionPayload({ options, multiSelect: false }, ["99"], "").error).toBe(
      "Selected option is no longer available.",
    );
  });
});

describe("recommendedOption", () => {
  it("maps the daemon's 1-based index to an option", () => {
    expect(recommendedOption({ options, recommendedIndex: 2 })?.label).toBe("Peer-RPC seen-id LRU");
  });

  it("treats 0 (the wire's 'none') as no recommendation", () => {
    expect(recommendedOption({ options, recommendedIndex: 0 })).toBeUndefined();
    expect(recommendedOption({ options })).toBeUndefined();
  });
});

describe("isAskAnswered", () => {
  it("only counts a non-empty selection", () => {
    expect(isAskAnswered({ selection: "Envelope v5" })).toBe(true);
    expect(isAskAnswered({ selection: "" })).toBe(false);
    expect(isAskAnswered({})).toBe(false);
  });
});

describe("AskItem", () => {
  it("submits a single-select answer on the first option tap", () => {
    const submitted: AskSelectionPayload[] = [];
    const renderer = render(
      <AskItem
        item={{ id: "ask1", question: "Which?", options, expiresIn: 60 }}
        onSubmit={(payload) => submitted.push(payload)}
      />,
    );
    press(renderer, "Option Envelope v5");
    expect(submitted).toEqual([{ selection: "Envelope v5", selectionIdx: 0 }]);
  });

  it("awaits an explicit submit when a write-in is allowed", () => {
    const submitted: AskSelectionPayload[] = [];
    const renderer = render(
      <AskItem
        item={{ id: "ask1", question: "Which?", options, allowWriteIn: true, expiresIn: 60 }}
        onSubmit={(payload) => submitted.push(payload)}
      />,
    );
    press(renderer, "Option Peer-RPC seen-id LRU");
    expect(submitted).toHaveLength(0);

    press(renderer, "Submit answer");
    expect(submitted).toEqual([{ selection: "Peer-RPC seen-id LRU", selectionIdx: 1 }]);
  });

  it("toggles checkboxes in multi-select and submits the joined answer", () => {
    const submitted: AskSelectionPayload[] = [];
    const renderer = render(
      <AskItem
        item={{ id: "ask1", question: "Which?", options, multiSelect: true, expiresIn: 60 }}
        onSubmit={(payload) => submitted.push(payload)}
      />,
    );
    press(renderer, "Option Envelope v5");
    press(renderer, "Option Daemon messageId dedup");
    press(renderer, "Submit answer");
    expect(submitted).toEqual([{ selection: "Envelope v5, Daemon messageId dedup" }]);
  });

  it("shows the chosen verdict and no options once answered", () => {
    const renderer = render(
      <AskItem
        item={{ id: "ask1", question: "Which?", options, selection: "Envelope v5", expiresIn: 60 }}
        onSubmit={() => {}}
      />,
    );
    const text = textOf(renderer.toJSON());
    expect(text).toContain("Chosen: Envelope v5");
    expect(text).not.toContain("Peer-RPC seen-id LRU");
  });

  it("blocks submission when the daemon lacks a selection op", () => {
    const renderer = render(
      <AskItem
        item={{ id: "ask1", question: "Which?", options, expiresIn: 60 }}
        selectSupported={false}
        onSubmit={() => {}}
      />,
    );
    expect(textOf(renderer.toJSON())).toContain("does not advertise a selection op");
  });

  it("surfaces an error string from the submit path", () => {
    const renderer = render(
      <AskItem
        item={{ id: "ask1", question: "Which?", options, expiresIn: 60 }}
        errorText="2fadod does not support selection yet."
        onSubmit={() => {}}
      />,
    );
    expect(textOf(renderer.toJSON())).toContain("2fadod does not support selection yet.");
  });
});
