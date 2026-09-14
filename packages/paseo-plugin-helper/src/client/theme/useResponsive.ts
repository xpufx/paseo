import { usePluginTheme } from "./provider.js";
import {
  responsiveSelect,
  type ResponsiveSelectOptions,
} from "./responsive.js";
import type { PlatformType } from "../../shared/types.js";

export interface UseResponsiveResult {
  /**
   * Whether the container or viewport is in compact mode (narrow trackbar, mobile screen, or split-pane).
   */
  isCompact: boolean;
  /**
   * Whether the current OS platform is mobile ('ios' | 'android').
   */
  isMobile: boolean;
  /**
   * The platform identifier ('web' | 'desktop' | 'ios' | 'android' | 'macos' | 'windows' | 'linux').
   */
  platform: PlatformType;
  /**
   * Container width if reported by Paseo's layout.
   */
  width?: number;
  /**
   * Container height if reported by Paseo's layout.
   */
  height?: number;
  /**
   * Recommended minimum interactive touch target (44pt on mobile/compact, 28pt on desktop).
   */
  touchTargetMin: number;
  /**
   * Helper function to select a value based on the current responsive environment.
   */
  select: <T>(options: ResponsiveSelectOptions<T>) => T | undefined;
}

/**
 * Universal hook for responsive plugin UI across composer pills, modals, panels, and surfaces.
 * Automatically adapts based on Paseo's layout context (compact mode, mobile OS, touch targets).
 */
export function useResponsive(): UseResponsiveResult {
  const { layout, isCompact, isMobile, touchTargetMin } = usePluginTheme();

  return {
    isCompact,
    isMobile,
    platform: layout.platform,
    width: layout.width,
    height: layout.height,
    touchTargetMin,
    select: <T>(options: ResponsiveSelectOptions<T>): T | undefined => {
      return responsiveSelect(layout, options);
    },
  };
}
