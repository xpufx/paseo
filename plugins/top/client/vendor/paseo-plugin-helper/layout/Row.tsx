import React, { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider";
import { resolveSpacing, type SpacingValue } from "../theme/tokens";

export interface RowProps {
  children?: ReactNode;
  /** Gap between children: a spacing token or raw px. Defaults to the theme gap. */
  gap?: SpacingValue;
  /** Allow children to wrap onto the next line. Default: false. */
  wrap?: boolean;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Horizontal flexbox row with theme-derived gap. A thin vocabulary wrapper so
 * plugins stop hand-rolling `<View style={{ flexDirection: "row", gap }}>`.
 */
export function Row({ children, gap, wrap = false, align, justify, style, testID }: RowProps) {
  const { padding } = usePluginTheme();

  return (
    <View
      testID={testID}
      style={[
        { flexDirection: "row", gap: resolveSpacing(gap, padding.gap) },
        wrap && { flexWrap: "wrap" },
        align !== undefined && { alignItems: align },
        justify !== undefined && { justifyContent: justify },
        style,
      ]}
    >
      {children}
    </View>
  );
}
