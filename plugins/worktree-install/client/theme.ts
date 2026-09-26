/**
 * Two palettes, one switch.
 *
 * The brief's entire theming requirement is "light vs dark", so that is
 * literally all this module does: pick one of two literals based on the
 * luminance of whatever background the host resolved, and let the views
 * reference the result. No scale, no token tiers, no third mode.
 */

export type Scheme = "dark" | "light";

export interface Palette {
  scheme: Scheme;
  /** Page background. */
  canvas: string;
  /** Panel background, one step off the canvas. */
  panel: string;
  /** Raised panel: hover cards, selected rows, open detail panes. */
  raised: string;
  /** Hairlines and dividers. */
  rule: string;
  /** A heavier rule for the focused/selected row. */
  ruleStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentText: string;
  ok: string;
  warn: string;
  critical: string;
  /** Translucent wash for a tone-tinted chip or banner. */
  wash: (tone: Tone, strength?: number) => string;
  /** Monospace stack for ids, branches, paths, and command lines. */
  mono: string;
}

export type Tone = "ok" | "warn" | "critical" | "accent" | "muted";

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const match = hex.trim().replace(/^#/, "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return 0;
  let body = match[1]!;
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  const r = Number.parseInt(body.slice(0, 2), 16);
  const g = Number.parseInt(body.slice(2, 4), 16);
  const b = Number.parseInt(body.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const DARK: Palette = {
  scheme: "dark",
  canvas: "#0d0f12",
  panel: "#14171c",
  raised: "#1c2028",
  rule: "#272c35",
  ruleStrong: "#3a4250",
  text: "#e8ebf0",
  textDim: "#98a1b0",
  textFaint: "#6b7382",
  accent: "#5aa2ff",
  accentText: "#05070a",
  ok: "#43d18b",
  warn: "#f2b544",
  critical: "#ff6a6a",
  mono: MONO,
  wash: (tone, strength = 0.16) => washOnDark(tone, strength),
};

const LIGHT: Palette = {
  scheme: "light",
  canvas: "#f6f7f9",
  panel: "#ffffff",
  raised: "#f0f2f5",
  rule: "#e0e4ea",
  ruleStrong: "#c3cad4",
  text: "#12161c",
  textDim: "#5a6472",
  textFaint: "#8a93a1",
  accent: "#1f6feb",
  accentText: "#ffffff",
  ok: "#128a4f",
  warn: "#a56a00",
  critical: "#c62828",
  mono: MONO,
  wash: (tone, strength = 0.12) => washOnLight(tone, strength),
};

function toneHex(palette: Palette, tone: Tone): string {
  switch (tone) {
    case "ok":
      return palette.ok;
    case "warn":
      return palette.warn;
    case "critical":
      return palette.critical;
    case "accent":
      return palette.accent;
    case "muted":
      return palette.textFaint;
  }
}

function washOnDark(tone: Tone, strength: number): string {
  const hex = toneHex(DARK, tone);
  return `${hex}${Math.round(Math.max(0, Math.min(1, strength)) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

function washOnLight(tone: Tone, strength: number): string {
  const hex = toneHex(LIGHT, tone);
  return `${hex}${Math.round(Math.max(0, Math.min(1, strength)) * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

export const PALETTES: Record<Scheme, Palette> = { dark: DARK, light: LIGHT };

/**
 * Picks light or dark from the host-resolved background. The host always hands
 * us a concrete colour, so luminance is more reliable than looking for an
 * `Appearance` string that may not have propagated yet.
 */
export function schemeFromBackground(background: string | undefined | null): Scheme {
  if (!background) return "dark";
  return luminance(background) > 0.45 ? "light" : "dark";
}

export function paletteFor(background: string | undefined | null): Palette {
  return PALETTES[schemeFromBackground(background)];
}
