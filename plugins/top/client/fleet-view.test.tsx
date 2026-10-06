import { describe, expect, it, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { HostThemeProvider } from "./host-ui";
import { FleetView } from "./multi-host-view";

/**
 * The mobile host bundle does not supply `useHosts` / `getPaseoClient`; only
 * `@getPaseo/plugin/client`'s type surface declares them, and the app's client
 * bundle loader fills them in (desktop). On a host that does not, the named
 * imports bind `undefined`. `useFleetPolling` used to call `useHosts()`
 * unconditionally, so the whole Fleet tab crashed with a `TypeError` instead of
 * degrading. `FleetView` must render an unavailable state and not throw.
 */
vi.mock("@getPaseo/plugin/client", () => ({
  useHosts: undefined,
  getPaseoClient: undefined,
}));

// The presentation leaf is not what this regression is about; the real one
// renders a host `Icon`, which this bare test host does not provide. Stub it so
// the assertion is about `FleetView`'s branch, not the icon mock.
vi.mock("./host-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./host-ui")>();
  return {
    ...actual,
    HostEmptyState: (props: { title?: string; description?: string }) =>
      React.createElement("mock-empty-state", props),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIGHT = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#d4d4d8",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#2563eb",
    accentForeground: "#ffffff",
    statusSuccess: "#16a34a",
    statusWarning: "#ca8a04",
    statusDanger: "#dc2626",
  },
} as const;

describe("FleetView on a host without multi-host primitives (#1043)", () => {
  it("renders the unavailable state instead of throwing", () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    expect(() => {
      act(() => {
        renderer = TestRenderer.create(
          <HostThemeProvider theme={LIGHT}>
            <FleetView />
          </HostThemeProvider>,
        );
      });
    }).not.toThrow();
    const text = JSON.stringify(renderer.toJSON());
    expect(text).toMatch(/Multi-host fleet unavailable/);
    expect(text).toMatch(/desktop/i);
  });
});
