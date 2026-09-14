import { describe, it, expect, afterEach } from "vitest";
import {
  FALLBACK_ACCENT_FOREGROUND,
  elevationForPlatform,
  resolveElevation,
  spacing,
} from "../client/theme/tokens.js";
import {
  PASEO_HOST_CSS_VARIABLES,
  mergeThemeColors,
  readHostThemeVariables,
} from "../client/theme/host-variables.js";
import { defaultDarkTheme } from "../client/theme/provider.js";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["document"];
  delete (globalThis as Record<string, unknown>)["getComputedStyle"];
});

describe("theme tokens", () => {
  it("exposes an ascending spacing scale for the compact step-down rule", () => {
    expect(spacing.xxs).toBe(2);
    expect(spacing.xs).toBe(4);
    expect(spacing.sm).toBe(8);
    expect(spacing.md).toBe(12);
    expect(spacing.lg).toBe(16);
    expect(spacing.xl).toBe(24);
  });

  it("resolves elevation presets with a single shadow color home", () => {
    expect(resolveElevation("none").shadowOpacity).toBe(0);
    expect(resolveElevation("none").elevation).toBe(0);
    const sm = resolveElevation("sm");
    expect(sm.shadowColor).toBe("#000");
    expect(sm.elevation).toBe(1);
    const md = resolveElevation("md");
    expect(md.shadowOpacity).toBeGreaterThan(sm.shadowOpacity);
    expect(md.elevation).toBe(2);
    const lg = resolveElevation("lg");
    expect(lg.shadowRadius).toBeGreaterThan(md.shadowRadius);
    expect(FALLBACK_ACCENT_FOREGROUND).toBe("#ffffff");
  });

  it("keeps native elevation Android-only", () => {
    expect(elevationForPlatform("md", "android").elevation).toBe(2);
    expect(elevationForPlatform("md", "ios").elevation).toBe(0);
    expect(elevationForPlatform("md", "web").elevation).toBe(0);
  });
});

describe("host theme variables", () => {
  it("binds Paseo 0.8 CSS variables to semantic color slots", () => {
    expect(PASEO_HOST_CSS_VARIABLES["--background"]).toBe("surface0");
    expect(PASEO_HOST_CSS_VARIABLES["--foreground"]).toBe("foreground");
    expect(PASEO_HOST_CSS_VARIABLES["--muted"]).toBe("foregroundMuted");
    expect(PASEO_HOST_CSS_VARIABLES["--accent"]).toBe("accent");
    expect(PASEO_HOST_CSS_VARIABLES["--border"]).toBe("border");
  });

  it("returns empty slots outside a DOM runtime", () => {
    const vars = readHostThemeVariables();
    expect(vars.colors).toEqual({});
    expect(vars.fonts).toEqual({});
  });

  it("reads live host variables and strips quoting", () => {
    const values: Record<string, string> = {
      "--background": "#101014",
      "--accent": '"#10b981"',
      "--font-mono": "'JetBrains Mono'",
    };
    (globalThis as Record<string, unknown>)["document"] = { documentElement: {} };
    (globalThis as Record<string, unknown>)["getComputedStyle"] = () => ({
      getPropertyValue: (name: string) => values[name] ?? "",
    });
    const vars = readHostThemeVariables();
    expect(vars.colors.surface0).toBe("#101014");
    expect(vars.colors.accent).toBe("#10b981");
    expect(vars.colors.foreground).toBeUndefined();
    expect(vars.fonts.mono).toBe("JetBrains Mono");
    expect(vars.fonts.sans).toBeUndefined();
  });

  it("merges defaults, host variables, injected theme, and flair accent in order", () => {
    const injected = { ...defaultDarkTheme.colors, accent: "#ff0000" };
    const merged = mergeThemeColors(
      defaultDarkTheme.colors,
      { surface0: "#101014" },
      injected,
      "#00ff00",
    );
    expect(merged.surface0).toBe(injected.surface0);
    expect(merged.accent).toBe("#00ff00");
    expect(merged.foreground).toBe(defaultDarkTheme.colors.foreground);
    const withoutOverride = mergeThemeColors(defaultDarkTheme.colors, {}, injected);
    expect(withoutOverride.accent).toBe("#ff0000");
    const runtimePartial = { ...injected, surface0: undefined } as unknown as typeof injected;
    const fallback = mergeThemeColors(defaultDarkTheme.colors, { surface0: "#101014" }, runtimePartial);
    expect(fallback.surface0).toBe("#101014");
  });
});
