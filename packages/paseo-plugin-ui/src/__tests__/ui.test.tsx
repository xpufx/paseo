import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  HostButton,
  HostModalSection,
  HostScroll,
  HostThemeProvider,
  HostVital,
  type ThemeColors,
} from "../index.js";

// The package imports these directly from the host SDK entry, so stub them
// instead of initializing the helper host (the package must not depend on it).
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  ScrollView: "ScrollView",
  copyText: async () => {},
  useToast: () => ({ show: () => {}, error: () => {} }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST_COLORS: ThemeColors = {
  surface0: "#010101",
  surface1: "#020202",
  surface2: "#030303",
  border: "#040404",
  foreground: "#f1f1f1",
  foregroundMuted: "#a1a1a1",
  accent: "#0a0aff",
  accentForeground: "#ffffff",
  statusSuccess: "#00ff00",
  statusWarning: "#ffaa00",
  statusDanger: "#ff0000",
};

function render(element: React.ReactElement): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flattenStyle));
  }
  return (style as Record<string, unknown>) ?? {};
}

function resolvedStyle(node: TestRenderer.ReactTestInstance): Record<string, unknown> {
  const style = node.props.style as unknown;
  const value = typeof style === "function" ? style({ pressed: false }) : style;
  return flattenStyle(value);
}

describe("@xpufx/paseo-plugin-ui invariants", () => {
  it("HostModalSection fills the host frame so a single HostScroll owns the scroll (xpufx-org/paseo#975, #1049)", () => {
    const renderer = render(
      <HostModalSection>
        <HostScroll>
          <span>body</span>
        </HostScroll>
      </HostModalSection>,
    );

    const section = renderer.root.findAllByType("View")[0];
    const sectionStyle = resolvedStyle(section);
    expect(sectionStyle.flex).toBe(1);
    expect(sectionStyle.minHeight).toBe(0);

    expect(renderer.root.findAllByType("ScrollView")).toHaveLength(1);
  });

  it("draws button colors from the host theme supplied by HostThemeProvider", () => {
    const renderer = render(
      <HostThemeProvider theme={{ colors: HOST_COLORS }}>
        <HostButton label="Save" variant="primary" />
      </HostThemeProvider>,
    );

    const pressable = renderer.root.findByType("Pressable");
    expect(resolvedStyle(pressable).backgroundColor).toBe(HOST_COLORS.accent);
  });

  it("falls back to a static palette when no host theme is provided", () => {
    expect(() => render(<HostButton label="Save" />)).not.toThrow();
  });

  it("caps HostVital chips so wrapping rows stay multi-per-line (xpufx-org/paseo#1010)", () => {
    const renderer = render(<HostVital color="#fff">12%</HostVital>);
    const vital = renderer.root.findAllByType("View")[0];
    const style = resolvedStyle(vital);
    expect(style.maxWidth).toBe(110);
    expect(style.flexGrow).toBe(1);
    expect(style.width).toBeUndefined();
  });
});
