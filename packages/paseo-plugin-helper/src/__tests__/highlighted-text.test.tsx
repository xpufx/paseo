import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { initClientHelpers } from "../client/host.js";
import * as themeProvider from "../client/theme/provider.js";
import { HighlightedText } from "../client/components/HighlightedText.js";

function installStubs() {
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({}),
    useToast: () => ({}),
  } as any);
  vi.spyOn(themeProvider, "usePluginTheme").mockReturnValue({
    theme: {} as any,
    colors: {
      accent: "#3b82f6",
      accentForeground: "#ffffff",
      foreground: "#fafafa",
    },
    typography: { caption: { fontSize: 11, lineHeight: 15, fontWeight: "400" } },
    resolveRadius: () => 8,
    flair: { headingTransform: "none" },
  } as any);
}

beforeEach(() => {
  vi.restoreAllMocks();
  installStubs();
});

function render(el: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

function styleValue(style: any, key: string): any {
  const flat = Array.isArray(style) ? style.flat(Infinity) : [style];
  return flat.find((s) => s && s[key] !== undefined)?.[key];
}

describe("<HighlightedText>", () => {
  it("paints matched runs with the accent background/foreground", () => {
    const renderer = render(
      React.createElement(HighlightedText, { text: "Fix the Fixer", query: "fix" }),
    );
    const texts = renderer.root.findAllByType(Text as any);
    const matched = texts.filter((t) => styleValue(t.props.style, "backgroundColor") === "#3b82f6");
    expect(matched).toHaveLength(2);
    expect(styleValue(matched[0].props.style, "color")).toBe("#ffffff");
    expect(matched.map((t) => t.props.children)).toEqual(["Fix", "Fix"]);
  });

  it("renders plain text when the query has no literal or token hit", () => {
    const renderer = render(
      React.createElement(HighlightedText, { text: "Fix the Fixer", query: "docs" }),
    );
    const matched = renderer.root
      .findAllByType(Text as any)
      .filter((t) => styleValue(t.props.style, "backgroundColor") === "#3b82f6");
    expect(matched).toHaveLength(0);
  });

  it("falls back to the whole field for a fuzzy query when fuzzyFallback is set", () => {
    const renderer = render(
      React.createElement(HighlightedText, {
        text: "Fix the Fixer",
        query: "docs",
        fuzzyFallback: true,
      }),
    );
    const matched = renderer.root
      .findAllByType(Text as any)
      .filter((t) => styleValue(t.props.style, "backgroundColor") === "#3b82f6");
    expect(matched).toHaveLength(1);
    expect(matched[0].props.children).toBe("Fix the Fixer");
  });

  it("highlights a whole token when the fuzzy query is a prefix of a word", () => {
    const renderer = render(
      React.createElement(HighlightedText, { text: "read the metadata now", query: "meta" }),
    );
    const matched = renderer.root
      .findAllByType(Text as any)
      .filter((t) => styleValue(t.props.style, "backgroundColor") === "#3b82f6");
    expect(matched.map((t) => t.props.children)).toEqual(["meta"]);
  });

  it("strips surrounding quotes so a quoted query paints like its unquoted form", () => {
    const renderer = render(
      React.createElement(HighlightedText, { text: 'read the "metadata" now', query: '"meta"' }),
    );
    const matched = renderer.root
      .findAllByType(Text as any)
      .filter((t) => styleValue(t.props.style, "backgroundColor") === "#3b82f6");
    // The literal `"meta"` (with quotes) is absent, so the token fallback paints
    // `meta` inside `"metadata"` exactly as an unquoted query would.
    expect(matched.map((t) => t.props.children)).toEqual(["meta"]);
  });
});
