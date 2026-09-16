import React, { type ReactNode } from "react";
import { useResponsive, type UseResponsiveResult } from "../theme/useResponsive.js";

export interface ResponsiveProps {
  /**
   * Content to render on desktop / wide viewports.
   */
  desktop?: ReactNode;
  /**
   * Content to render on mobile platforms ('ios' | 'android').
   */
  mobile?: ReactNode;
  /**
   * Content to render when in compact mode (narrow trackbar, mobile bottom sheet, or split view).
   */
  compact?: ReactNode;
  /**
   * Content to render when in wide mode (not compact).
   */
  wide?: ReactNode;
  /**
   * Render function taking `UseResponsiveResult` or children.
   */
  children?: ReactNode | ((responsive: UseResponsiveResult) => ReactNode);
}

/**
 * Declarative component for rendering different UI elements across desktop, mobile, and compact layouts.
 *
 * @example
 * ```tsx
 * <Responsive
 *   desktop={<DataTable columns={["ID", "Name", "Status", "Latency"]} data={items} />}
 *   mobile={<DataTable columns={["Name", "Status"]} data={items} />}
 * />
 * ```
 */
export function Responsive({ desktop, mobile, compact, wide, children }: ResponsiveProps) {
  const responsive = useResponsive();

  if (typeof children === "function") {
    return <>{children(responsive)}</>;
  }

  const selected = responsive.select<ReactNode>({
    desktop,
    mobile,
    compact,
    wide,
  });

  return <>{selected ?? children ?? null}</>;
}
