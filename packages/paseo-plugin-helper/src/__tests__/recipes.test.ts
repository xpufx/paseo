import { describe, expect, it } from "vitest";
import {
  badgeRecipe,
  buttonRecipe,
  cardRecipe,
  inputRecipe,
  resolveThemeColors,
  tabItemRecipe,
  tabStripRecipe,
} from "../client/styles/recipes.js";
import { defaultDarkTheme, defaultLightTheme } from "../client/theme/provider.js";
import type { PluginTheme, ThemeColors } from "../shared/types.js";

const customTheme: PluginTheme = {
  colors: {
    surface0: "#101010",
    surface1: "#202020",
    surface2: "#303030",
    border: "#404040",
    foreground: "#ffffff",
    foregroundMuted: "#888888",
    accent: "#ff5500",
    accentForeground: "#ffffff",
    statusSuccess: "#00ff00",
    statusWarning: "#ffff00",
    statusDanger: "#ff0000",
  },
};

describe("Style Recipes", () => {
  describe("resolveThemeColors", () => {
    it("falls back to defaultDarkTheme when undefined", () => {
      const colors = resolveThemeColors(undefined);
      expect(colors).toEqual(defaultDarkTheme.colors);
    });

    it("resolves from PluginTheme object with colors property", () => {
      const colors = resolveThemeColors(customTheme);
      expect(colors.accent).toBe("#ff5500");
    });

    it("resolves from raw ThemeColors object", () => {
      const rawColors: ThemeColors = defaultLightTheme.colors;
      const colors = resolveThemeColors(rawColors);
      expect(colors).toEqual(defaultLightTheme.colors);
    });
  });

  describe("inputRecipe", () => {
    it("generates default input styles", () => {
      const recipe = inputRecipe(customTheme);
      expect(recipe.backgroundColor).toBe("#101010");
      expect(recipe.borderColor).toBe("#404040");
      expect(recipe.color).toBe("#ffffff");
      expect(recipe.fontSize).toBe(14);
      expect(recipe.borderWidth).toBe(1);
      expect(recipe.borderRadius).toBe(8);
      expect(recipe.input).toBeDefined();
      expect(recipe.container).toBeDefined();
      expect(recipe.label).toBeDefined();
      expect(recipe.hint).toBeDefined();
    });

    it("applies accent border color when focused", () => {
      const recipe = inputRecipe(customTheme, { focused: true });
      expect(recipe.borderColor).toBe("#ff5500");
    });

    it("applies danger color when in error state", () => {
      const recipe = inputRecipe(customTheme, { error: true });
      expect(recipe.borderColor).toBe("#ff0000");
      expect(recipe.label.color).toBe("#ff0000");
      expect(recipe.hint.color).toBe("#ff0000");
    });

    it("handles multiline and mono options", () => {
      const recipe = inputRecipe(customTheme, { multiline: true, mono: true });
      expect(recipe.minHeight).toBe(64);
      expect(recipe.fontFamily).toBe("monospace");
    });

    it("handles compact and size variations", () => {
      const sm = inputRecipe(customTheme, { size: "sm" });
      expect(sm.fontSize).toBe(12);
      expect(sm.minHeight).toBe(30);

      const lg = inputRecipe(customTheme, { size: "lg" });
      expect(lg.fontSize).toBe(15);
      expect(lg.minHeight).toBe(42);

      const compact = inputRecipe(customTheme, { compact: true });
      expect(compact.fontSize).toBe(13);
      expect(compact.minHeight).toBe(32);
    });
  });

  describe("cardRecipe", () => {
    it("generates default flat card styles", () => {
      const recipe = cardRecipe(customTheme);
      expect(recipe.backgroundColor).toBe("#101010");
      expect(recipe.borderColor).toBe("#404040");
      expect(recipe.borderWidth).toBe(1);
      expect(recipe.borderRadius).toBe(8);
      expect(recipe.paddingHorizontal).toBe(12);
      expect(recipe.headerTitle.color).toBe("#ffffff");
      expect(recipe.headerSubtitle.color).toBe("#888888");
    });

    it("generates elevated card variant with surface1 background", () => {
      const recipe = cardRecipe(customTheme, { variant: "elevated" });
      expect(recipe.backgroundColor).toBe("#202020");
      expect(recipe.borderColor).toBe("#404040");
    });

    it("generates tinted card variant with accent-tinted background", () => {
      const recipe = cardRecipe(customTheme, "tinted");
      expect(recipe.backgroundColor).toContain("#ff5500");
    });

    it("supports noPadding option", () => {
      const recipe = cardRecipe(customTheme, { noPadding: true });
      expect(recipe.paddingHorizontal).toBe(0);
      expect(recipe.paddingVertical).toBe(0);
    });
  });

  describe("buttonRecipe", () => {
    it("generates secondary button styles by default", () => {
      const recipe = buttonRecipe(customTheme);
      expect(recipe.backgroundColor).toBe("#202020");
      expect(recipe.text.color).toBe("#ffffff");
    });

    it("generates primary button styles with accent background", () => {
      const recipe = buttonRecipe(customTheme, { variant: "primary" });
      expect(recipe.backgroundColor).toBe("#ff5500");
      expect(recipe.text.color).toBe("#ffffff");
    });

    it("generates danger button styles", () => {
      const recipe = buttonRecipe(customTheme, "danger");
      expect(recipe.text.color).toBe("#ff0000");
      expect(recipe.borderColor).toContain("#ff0000");
    });

    it("generates ghost button styles", () => {
      const recipe = buttonRecipe(customTheme, "ghost");
      expect(recipe.backgroundColor).toBe("transparent");
      expect(recipe.text.color).toBe("#888888");
    });

    it("handles pressed and disabled states", () => {
      const pressed = buttonRecipe(customTheme, { variant: "primary", pressed: true });
      expect(pressed.backgroundColor).toContain("#ff5500");

      const disabled = buttonRecipe(customTheme, { disabled: true });
      expect(disabled.opacity).toBe(0.45);
    });

    it("handles sizes", () => {
      const sm = buttonRecipe(customTheme, { size: "sm" });
      expect(sm.text.fontSize).toBe(12);
      expect(sm.minHeight).toBe(28);

      const lg = buttonRecipe(customTheme, { size: "lg" });
      expect(lg.text.fontSize).toBe(15);
      expect(lg.minHeight).toBe(42);
    });
  });

  describe("tabStripRecipe & tabItemRecipe", () => {
    it("generates tab strip frame and track styles", () => {
      const strip = tabStripRecipe(customTheme);
      expect(strip.backgroundColor).toBe("#202020");
      expect(strip.borderColor).toBe("#404040");
      expect(strip.track.flexDirection).toBe("row");
    });

    it("generates active and inactive tab item styles", () => {
      const inactive = tabItemRecipe(customTheme, false);
      expect(inactive.backgroundColor).toBe("transparent");
      expect(inactive.text.color).toBe("#888888");

      const active = tabItemRecipe(customTheme, true);
      expect(active.backgroundColor).toBe("#303030");
      expect(active.text.color).toBe("#ffffff");
      expect(active.badge.backgroundColor).toBe("#ff5500");
    });
  });

  describe("badgeRecipe", () => {
    it("generates tinted badge styles by default", () => {
      const badge = badgeRecipe(customTheme, "success");
      expect(badge.text.color).toBe("#00ff00");
      expect(badge.backgroundColor).toContain("#00ff00");
      expect(badge.borderRadius).toBe(9999);
      expect(badge.dot.backgroundColor).toBe("#00ff00");
    });

    it("generates solid and outline badge styles", () => {
      const solid = badgeRecipe(customTheme, { variant: "danger", styleVariant: "solid" });
      expect(solid.backgroundColor).toBe("#ff0000");
      expect(solid.borderWidth).toBe(1);

      const outline = badgeRecipe(customTheme, { variant: "warning", styleVariant: "outline" });
      expect(outline.backgroundColor).toBe("transparent");
      expect(outline.text.color).toBe("#ffff00");
    });

    it("handles sm and md badge sizes", () => {
      const sm = badgeRecipe(customTheme, { size: "sm" });
      expect(sm.text.fontSize).toBe(10);
      expect(sm.paddingVertical).toBe(1);

      const md = badgeRecipe(customTheme, { size: "md" });
      expect(md.text.fontSize).toBe(11);
      expect(md.paddingVertical).toBe(2);
    });
  });

  describe("Hardening & Ergonomics (#349 Review)", () => {
    it("serializes without circular references (JSON.stringify safe)", () => {
      const input = inputRecipe(defaultDarkTheme);
      const card = cardRecipe(defaultDarkTheme);
      const button = buttonRecipe(defaultDarkTheme);
      const tabStrip = tabStripRecipe(defaultDarkTheme);
      const tabItem = tabItemRecipe(defaultDarkTheme, true);
      const badge = badgeRecipe(defaultDarkTheme);

      expect(() => JSON.stringify(input)).not.toThrow();
      expect(() => JSON.stringify(card)).not.toThrow();
      expect(() => JSON.stringify(button)).not.toThrow();
      expect(() => JSON.stringify(tabStrip)).not.toThrow();
      expect(() => JSON.stringify(tabItem)).not.toThrow();
      expect(() => JSON.stringify(badge)).not.toThrow();
    });

    it("ensures readable contrast for solid warning badges", () => {
      const badge = badgeRecipe(defaultDarkTheme, { styleVariant: "solid", variant: "warning" });
      // Bright statusWarning (#eab308) solid background must get dark foreground text for WCAG AA compliance
      expect(badge.text.color).toBe(defaultDarkTheme.colors.foreground);
    });

    it("supports compact option on cardRecipe", () => {
      const standard = cardRecipe(defaultDarkTheme);
      const compact = cardRecipe(defaultDarkTheme, { compact: true });
      expect(compact.paddingHorizontal).toBeLessThan(Number(standard.paddingHorizontal));
      expect(compact.paddingVertical).toBeLessThan(Number(standard.paddingVertical));
      expect(compact.borderRadius).toBe(6);
    });

    it("exposes placeholderColor on inputRecipe", () => {
      const input = inputRecipe(defaultDarkTheme);
      expect((input as any).placeholderColor).toBe(defaultDarkTheme.colors.foregroundMuted);
    });
  });
});
