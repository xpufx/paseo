import React, { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider.js";
import { resolveSpacing, type SpacingValue } from "../theme/tokens.js";

export interface StackProps {
  children?: ReactNode;
  /** Gap between children: a spacing token or raw px. Defaults to the theme gap. */
  gap?: SpacingValue;
  align?: ViewStyle["alignItems"];
  justify?: ViewStyle["justifyContent"];
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Vertical flexbox stack with theme-derived gap. The deliberate column default,
 * named so it composes visually alongside {@link Row}.
 */
export function Stack({ children, gap, align, justify, style, testID }: StackProps) {
  const { padding } = usePluginTheme();

  return (
    <View
      testID={testID}
      style={[
        { flexDirection: "column", gap: resolveSpacing(gap, padding.gap) },
        align !== undefined && { alignItems: align },
        justify !== undefined && { justifyContent: justify },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Explicit vertical-stack alias; identical to {@link Stack}. */
export const VStack = Stack;
