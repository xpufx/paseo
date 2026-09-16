import type { DensityStyle } from "./flair.js";
import type { PlatformType, ResponsiveLayout } from "../../shared/types.js";

/**
 * Container width (px) at or below which a surface steps down to the compact
 * scale. Mirrors the host's `COMPACT_FORM_FACTOR_WIDTH` so plugin typography
 * in narrow popovers matches full-screen mobile surfaces.
 */
export const COMPACT_FORM_FACTOR_WIDTH = 500;

/**
 * Resolves compact mode from the actual container width when it is known,
 * falling back to the host's viewport-derived `compact` flag otherwise.
 *
 * A host-declared compact surface stays compact at any width; a known width at
 * or below {@link COMPACT_FORM_FACTOR_WIDTH} forces compact even when the host
 * viewport is wide (e.g. a narrow header-button popover on desktop).
 */
export function resolveEffectiveCompact(
  layout: ResponsiveLayout,
  widthOverride?: number,
): boolean {
  const width = widthOverride ?? layout.width;
  if (typeof width === "number" && width > 0) {
    return width <= COMPACT_FORM_FACTOR_WIDTH || Boolean(layout.compact);
  }
  return Boolean(layout.compact);
}

/**
 * Checks if the current platform is mobile (iOS or Android).
 */
export function isMobilePlatform(platform: PlatformType): boolean {
  return platform === "ios" || platform === "android";
}

/**
 * Returns the recommended minimum interactive touch target size (in pt/px).
 * Ensures compliance with Apple HIG and Android Material guidelines (min 44pt).
 */
export function getTouchTargetMin(layout: ResponsiveLayout): number {
  return resolveEffectiveCompact(layout) || isMobilePlatform(layout.platform) ? 44 : 28;
}

/**
 * Selects a value based on compact/mobile vs desktop screen constraints.
 */
export function responsiveValue<T>(layout: ResponsiveLayout, desktopVal: T, compactVal: T): T {
  return resolveEffectiveCompact(layout) ? compactVal : desktopVal;
}

/**
 * Calculates adaptive padding based on compact mode and density preset.
 */
export function resolvePadding(
  layout: ResponsiveLayout,
  density: DensityStyle,
): { horizontal: number; vertical: number; gap: number } {
  const isCompact = resolveEffectiveCompact(layout);

  switch (density) {
    case "compact":
      return {
        horizontal: isCompact ? 10 : 12,
        vertical: isCompact ? 6 : 8,
        gap: isCompact ? 6 : 8,
      };
    case "spacious":
      return {
        horizontal: isCompact ? 16 : 24,
        vertical: isCompact ? 14 : 20,
        gap: isCompact ? 12 : 16,
      };
    case "comfortable":
    default:
      return {
        horizontal: isCompact ? 12 : 16,
        vertical: isCompact ? 10 : 14,
        gap: isCompact ? 8 : 12,
      };
  }
}

export interface ResponsiveSelectOptions<T> {
  /**
   * Default fallback value, used on desktop/wide viewports if no more specific option matches.
   */
  desktop?: T;
  /**
   * Value to use on mobile platforms ('ios' | 'android').
   */
  mobile?: T;
  /**
   * Value to use when in compact mode (layout.compact === true), such as on mobile or narrow split panes.
   */
  compact?: T;
  /**
   * Value to use when not in compact mode (layout.compact === false).
   */
  wide?: T;
  /**
   * Platform-specific overrides ('web', 'desktop', 'ios', 'android', 'macos', 'windows', 'linux').
   */
  platform?: Partial<Record<PlatformType, T>>;
}

/**
 * Selects a value based on responsive criteria with priority:
 * 1. Platform-specific override (`options.platform?.[platform]`)
 * 2. Mobile platform match (`options.mobile` if mobile OS)
 * 3. Compact mode match (`options.compact` if layout.compact)
 * 4. Wide mode match (`options.wide` if !layout.compact)
 * 5. Desktop / Default (`options.desktop`)
 */
export function responsiveSelect<T>(
  layout: ResponsiveLayout,
  options: ResponsiveSelectOptions<T>,
): T | undefined {
  const isMobile = isMobilePlatform(layout.platform);
  const isCompact = resolveEffectiveCompact(layout);

  // 1. Specific platform override
  if (options.platform && layout.platform in options.platform) {
    const val = options.platform[layout.platform];
    if (val !== undefined) return val;
  }

  // 2. Mobile platform match
  if (isMobile && options.mobile !== undefined) {
    return options.mobile;
  }

  // 3. Compact layout match
  if (isCompact && options.compact !== undefined) {
    return options.compact;
  }

  // 4. Wide (non-compact) layout match
  if (!isCompact && options.wide !== undefined) {
    return options.wide;
  }

  // 5. Desktop fallback
  if (options.desktop !== undefined) {
    return options.desktop;
  }

  // 6. Secondary fallbacks
  if (options.wide !== undefined) return options.wide;
  if (options.compact !== undefined) return options.compact;
  if (options.mobile !== undefined) return options.mobile;

  return undefined;
}

