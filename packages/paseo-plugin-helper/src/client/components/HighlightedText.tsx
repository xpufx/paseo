import React, { useMemo } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { splitHighlightParts } from "../../shared/highlight.js";
import { usePluginTheme } from "../theme/provider.js";

export interface HighlightedTextProps {
  /** Source text rendered as-is when no query is active. */
  text: string;
  /**
   * Active search query; matched case-insensitively and never as a regex. When
   * the literal query is absent the query's tokens are highlighted, so a fuzzy
   * result still reads.
   */
  query: string;
  style?: StyleProp<TextStyle>;
  /**
   * Overrides the matched-run style. Defaults to the theme accent background
   * with `accentForeground` text so a match reads as selected.
   */
  highlightStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  selectable?: boolean;
  /**
   * When true, a query with no literal or token hit marks the whole text, so a
   * fuzzy search result still reads as matched. Use it on the primary label
   * (row/detail title) rather than every small field.
   */
  fuzzyFallback?: boolean;
}

/**
 * `<Text>` that paints every case-insensitive occurrence of `query` with the
 * accent background/foreground. The query is matched literally, so user input
 * is never evaluated as a regular expression. When the literal query is absent
 * the splitter highlights the query's tokens; `fuzzyFallback` additionally
 * marks the whole text when even a token misses, so a fuzzy result is not left
 * silently unmarked. Renders the plain text when the query is empty or absent.
 */
export function HighlightedText({
  text,
  query,
  style,
  highlightStyle,
  numberOfLines,
  selectable,
  fuzzyFallback = false,
}: HighlightedTextProps) {
  const { colors } = usePluginTheme();
  const parts = useMemo(
    () => splitHighlightParts(text, query, { fallbackToWholeField: fuzzyFallback }),
    [text, query, fuzzyFallback],
  );
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
