import React, { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider.js";
import { resolveSpacing, type SpacingValue } from "../theme/tokens.js";
import { resolveGridColumns } from "../theme/responsive.js";

export interface GridProps {
  children?: ReactNode;
  /** Maximum column count. Default: 2. */
  columns?: number;
  /**
   * Minimum width a column should keep. When set and the container width is
   * known, the grid uses as many columns as fit (up to `columns`) and wraps
   * down instead of collapsing to one.
   */
  minColumnWidth?: number;
  /** Gap between cells: a spacing token or raw px. Defaults to the theme gap. */
  gap?: SpacingValue;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Width-aware wrapping grid. Cells keep a percentage basis driven by the
 * effective column count, so they reflow across rows rather than stacking
 * one-per-line or collapsing to a single column.
 */
export function Grid({ children, columns = 2, minColumnWidth, gap, style, testID }: GridProps) {
  const { padding, isCompact, layout } = usePluginTheme();
  const resolvedGap = resolveSpacing(gap, padding.gap);
  const effectiveColumns = resolveGridColumns({
    columns,
    minColumnWidth,
    gap: resolvedGap,
    width: layout.width,
    isCompact,
  });

  const cells = React.Children.toArray(children).filter(Boolean);

  return (
    <View testID={testID} style={[styles.container, { gap: resolvedGap }, style]}>
      {cells.map((child, index) => (
        <View
          key={index}
          style={[styles.cell, { flexBasis: `${Math.floor(100 / effectiveColumns) - 2}%` }]}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%",
  },
  cell: {
    flexGrow: 1,
    flexShrink: 1,
  },
});
