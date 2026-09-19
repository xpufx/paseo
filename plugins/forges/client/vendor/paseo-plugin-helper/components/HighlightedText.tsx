import React, { useMemo } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { splitHighlightParts } from "../../../../shared/vendor/paseo-plugin-helper/highlight";
import { usePluginTheme } from "../theme/provider";

export interface HighlightedTextProps {
  /** Source text rendered as-is when no query is active. */
  text: string;
  /** Active search query; matched case-insensitively and never as a regex. */
  query: string;
  style?: StyleProp<TextStyle>;
  /**
   * Overrides the matched-run style. Defaults to the theme accent background
   * with `accentForeground` text so a match reads as selected.
   */
  highlightStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
}

/**
 * `<Text>` that paints every case-insensitive occurrence of `query` with the
 * accent background/foreground. The query is matched literally, so user input
 * is never evaluated as a regular expression. Renders the plain text when the
 * query is empty or absent.
 */
export function HighlightedText({
  text,
  query,
  style,
  highlightStyle,
  numberOfLines,
  selectable,
}: HighlightedTextProps) {
  const { colors } = usePluginTheme();
  const parts = useMemo(() => splitHighlightParts(text, query), [text, query]);
  const matchStyle: StyleProp<TextStyle> = [
    { backgroundColor: colors.accent, color: colors.accentForeground },
    highlightStyle,
  ];
  return (
    <Text style={style} numberOfLines={numberOfLines} selectable={selectable}>
      {parts.map((part, index) =>
        part.matched ? (
          <Text key={`m${index}`} style={matchStyle}>
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}
