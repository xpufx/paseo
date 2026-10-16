import { describe, expect, it } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const lightColors = {
  surface0: "#ffffff",
  surface1: "#f3f4f6",
  surface2: "#e5e7eb",
  border: "#d1d5db",
  foreground: "#111827",
  foregroundMuted: "#4b5563",
  accent: "#2563eb",
  accentForeground: "#ffffff",
  statusSuccess: "#15803d",
  statusWarning: "#a16207",
  statusDanger: "#b91c1c",
};

describe("built entry point theme sharing", () => {
  it("passes a host theme from the root entry to a component from ./tickets", async () => {
    const root = await import("../../dist/index.js");
    const tickets = await import("../../dist/tickets/index.js");
    let renderer!: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <root.HostThemeProvider theme={{ colors: lightColors }}>
          <tickets.HostMarkdownLite body="# Light theme" />
        </root.HostThemeProvider>,
      );
    });

    expect(JSON.stringify(renderer.toJSON())).toContain(lightColors.foreground);
  });

  it("preserves ThemeContext identity via Symbol.for('paseo.pluginUiThemeContext')", async () => {
    const symbolKey = Symbol.for("paseo.pluginUiThemeContext");
    const root = await import("../../dist/index.js");

    expect(root.THEME_CONTEXT_KEY).toBe(symbolKey);
    const globalContext = (globalThis as any)[symbolKey];
    expect(globalContext).toBeDefined();
    expect(globalContext.Provider).toBeDefined();
    expect(globalContext.Consumer).toBeDefined();
  });
});
