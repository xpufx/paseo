export type RadiusStyle = "sharp" | "rounded" | "pill";
export type DensityStyle = "compact" | "comfortable" | "spacious";
export type SurfaceStyle = "flat" | "tinted" | "elevated";
export type HeadingTransform = "none" | "uppercase";

export interface VisualFlair {
  /**
   * Corner radius preset for interactive elements and containers.
   * - "sharp": 2-3px (terminal / technical flair)
   * - "rounded": 6-8px (default Paseo native flair)
   * - "pill": 9999px (soft / playful flair)
   */
  radius: RadiusStyle;

  /**
   * Spacing and typography density.
   * - "compact": tight padding and smaller fonts
   * - "comfortable": balanced defaults
   * - "spacious": generous breathing room
   */
  density: DensityStyle;

  /**
   * Surface background styling for cards, panels, and modal boxes.
   * - "flat": pure surface0 with border
   * - "tinted": subtle tinted foreground / accent wash
   * - "elevated": uses surface1 / surface2 hierarchy
   */
  surfaceStyle: SurfaceStyle;

  /**
   * Optional custom brand accent color (e.g. "#10b981", "#3b82f6").
   * Overrides Paseo's theme.colors.accent within this plugin.
   */
  accentColor?: string;

  /**
   * Default border width for cards and bordered elements (default: 1).
   */
  borderWidth: number;

  /**
   * Text transform for section headers and meta labels.
   */
  headingTransform: HeadingTransform;
}

export const defaultFlair: VisualFlair = {
  radius: "rounded",
  density: "comfortable",
  surfaceStyle: "flat",
  borderWidth: 1,
  headingTransform: "none",
};

export function resolveRadius(radius: RadiusStyle, size: "xs" | "sm" | "md" | "lg" | "pill" = "md"): number {
  if (size === "pill" || radius === "pill") return 9999;
  if (radius === "sharp") {
    switch (size) {
      case "xs": return 1;
      case "sm": return 2;
      case "md": return 3;
      case "lg": return 4;
    }
  }
  // "rounded"
  switch (size) {
    case "xs": return 4;
    case "sm": return 6;
    case "md": return 8;
    case "lg": return 12;
  }
}
