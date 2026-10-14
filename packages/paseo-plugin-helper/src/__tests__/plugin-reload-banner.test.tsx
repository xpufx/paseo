import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text, View, Pressable } from "react-native";
import { bumpPluginLoadCount, usePluginReloadNotice } from "../core/plugin-load-count.js";
import { PluginReloadBanner } from "../ui/plugin-reload-banner.js";
import { HostThemeProvider } from "../ui/theme.js";
import type { PluginTheme } from "../shared/types.js";

const hostTheme: PluginTheme = {
  colors: {
    surface0: "#0d1117",
    surface1: "#161b22",
    surface2: "#30363d",
    border: "#30363d",
    foreground: "#e6edf3",
    foregroundMuted: "#8b949e",
    accent: "#58a6ff",
    accentForeground: "#ffffff",
    statusSuccess: "#3fb950",
    statusWarning: "#d29922",
    statusDanger: "#f85149",
  },
};

function render(el: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(el);
  });
  return renderer;
}

/** Extract all text content from the rendered tree. */
function getAllText(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Text as any)
    .map((n: any) => n.props.children)
    .flat();
}

afterEach(() => {
  // Reset global load count between tests.
  const keys = Object.keys((globalThis as any).__PASEO_PLUGIN_LOAD_COUNT__ || {});
  for (const k of keys) {
    delete (globalThis as any).__PASEO_PLUGIN_LOAD_COUNT__[k];
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Hook tests ----------------------------------------------------------------
// ---------------------------------------------------------------------------

describe("usePluginReloadNotice", () => {
  it("returns isReloaded=false and loadCount=1 on initial load", () => {
    let result!: ReturnType<typeof usePluginReloadNotice>;
    function Probe() {
      result = usePluginReloadNotice("hook-test");
      return <Text>ok</Text>;
    }
    bumpPluginLoadCount("hook-test");
    render(
      <HostThemeProvider theme={hostTheme}>
        <Probe />
      </HostThemeProvider>,
    );
    expect(result.isReloaded).toBe(false);
    expect(result.loadCount).toBe(1);
  });

  it("returns isReloaded=true when the plugin was reloaded", () => {
    let result!: ReturnType<typeof usePluginReloadNotice>;
    function Probe() {
      result = usePluginReloadNotice("hook-reloaded");
      return <Text>ok</Text>;
    }
    bumpPluginLoadCount("hook-reloaded");
    bumpPluginLoadCount("hook-reloaded");
    render(
      <HostThemeProvider theme={hostTheme}>
        <Probe />
      </HostThemeProvider>,
    );
    expect(result.isReloaded).toBe(true);
    expect(result.loadCount).toBe(2);
  });

  it("dismiss toggles isReloaded to false locally", () => {
    let result!: ReturnType<typeof usePluginReloadNotice>;
    function Probe() {
      result = usePluginReloadNotice("hook-dismiss");
      return <Text>ok</Text>;
    }
    bumpPluginLoadCount("hook-dismiss");
    bumpPluginLoadCount("hook-dismiss");
    const renderer = render(
      <HostThemeProvider theme={hostTheme}>
        <Probe />
      </HostThemeProvider>,
    );

    expect(result.isReloaded).toBe(true);

    act(() => {
      result.dismiss();
    });
    // Re-render to pick up state change.
    renderer.update(
      <HostThemeProvider theme={hostTheme}>
        <Probe />
      </HostThemeProvider>,
    );
    expect(result.isReloaded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Banner component tests ----------------------------------------------------
// ---------------------------------------------------------------------------

describe("PluginReloadBanner", () => {
  it("renders with default warning message", () => {
    function Wrapper() {
      return <PluginReloadBanner pluginId="banner-default" />;
    }
    bumpPluginLoadCount("banner-default");
    bumpPluginLoadCount("banner-default");
    const renderer = render(
      <HostThemeProvider theme={hostTheme}>
        <Wrapper />
      </HostThemeProvider>,
    );

    const texts = getAllText(renderer);
    expect(texts.some((t) => t === "⚡")).toBe(true);
    expect(texts.some((t) => t === "Plugin was reloaded on the daemon. Please refresh to load updated views.")).toBe(true);
  });

  it("renders dismiss button", () => {
    function Wrapper() {
      return <PluginReloadBanner pluginId="banner-dismiss" />;
    }
    bumpPluginLoadCount("banner-dismiss");
    bumpPluginLoadCount("banner-dismiss");
    const renderer = render(
      <HostThemeProvider theme={hostTheme}>
        <Wrapper />
      </HostThemeProvider>,
    );

    const pressables = renderer.root.findAllByType(Pressable as any);
    const texts = pressables.flatMap((p: any) => {
      const child = p.props.children;
      if (child && typeof child === "object" && "props" in child) {
        return child.props.children;
      }
      return [];
    });
    expect(texts).toContain("Dismiss");
  });

  it("hides banner after dismiss is pressed", () => {
    function Wrapper() {
      return <PluginReloadBanner pluginId="banner-hide" />;
    }
    bumpPluginLoadCount("banner-hide");
    bumpPluginLoadCount("banner-hide");
    const renderer = render(
      <HostThemeProvider theme={hostTheme}>
        <Wrapper />
      </HostThemeProvider>,
    );

    // Banner should be visible initially.
    expect(renderer.root.findByType(View)).toBeDefined();

    // Find and press the dismiss button.
    const pressables = renderer.root.findAllByType(Pressable as any);
    const dismissBtn = pressables.find((p: any) => {
      const child = p.props.children;
      if (child && typeof child === "object" && "props" in child) {
        return child.props.children === "Dismiss";
      }
      return false;
    });
    expect(dismissBtn).toBeDefined();

    act(() => {
      dismissBtn!.props.onPress!();
    });

    // After dismiss, the banner container should no longer exist (hidden).
    expect(() => renderer.root.findByType(View)).toThrow();
  });

  it("calls onReload callback when reload button is pressed", () => {
    const onReload = vi.fn();

    function Wrapper() {
      return <PluginReloadBanner pluginId="banner-reload" onReload={onReload} />;
    }
    bumpPluginLoadCount("banner-reload");
    bumpPluginLoadCount("banner-reload");
    const renderer = render(
      <HostThemeProvider theme={hostTheme}>
        <Wrapper />
      </HostThemeProvider>,
    );

    const pressables = renderer.root.findAllByType(Pressable as any);
    const reloadBtn = pressables.find((p: any) => {
      const child = p.props.children;
      if (child && typeof child === "object" && "props" in child) {
        return child.props.children === "Reload";
      }
      return false;
    });
    expect(reloadBtn).toBeDefined();

    act(() => {
      reloadBtn!.props.onPress!();
    });

    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("does not show Reload button when onReload is not provided", () => {
    function Wrapper() {
      return <PluginReloadBanner pluginId="banner-no-reload" />;
    }
    bumpPluginLoadCount("banner-no-reload");
    bumpPluginLoadCount("banner-no-reload");
    const renderer = render(
      <HostThemeProvider theme={hostTheme}>
        <Wrapper />
      </HostThemeProvider>,
    );

    const pressables = renderer.root.findAllByType(Pressable as any);
    const hasReload = pressables.some((p: any) => {
      const child = p.props.children;
      if (child && typeof child === "object" && "props" in child) {
        return child.props.children === "Reload";
      }
      return false;
    });
    expect(hasReload).toBe(false);
  });

  it("renders custom children when provided", () => {
    function Wrapper() {
      return (
        <PluginReloadBanner pluginId="banner-custom">
          Custom reload message
        </PluginReloadBanner>
      );
    }
    bumpPluginLoadCount("banner-custom");
    bumpPluginLoadCount("banner-custom");
    const renderer = render(
      <HostThemeProvider theme={hostTheme}>
        <Wrapper />
      </HostThemeProvider>,
    );

    const texts = getAllText(renderer);
    expect(texts).toContain("Custom reload message");
  });

  it("still renders without crashing when plugin is fresh (count === 1)", () => {
    function Wrapper() {
      return <PluginReloadBanner pluginId="banner-fresh" />;
    }
    bumpPluginLoadCount("banner-fresh");
    // Only one bump — not reloaded.
    const renderer = render(
      <HostThemeProvider theme={hostTheme}>
        <Wrapper />
      </HostThemeProvider>,
    );

    // The banner component still mounts and renders without error.
    expect(renderer).toBeDefined();
  });
});
