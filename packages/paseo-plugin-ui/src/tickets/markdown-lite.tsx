import React, { useMemo } from "react";
import { Linking, Text, type StyleProp, type ViewStyle } from "react-native";
import { copyText } from "@getpaseo/plugin/client/react-native";
import {
  parseMarkdownLite,
  type MarkdownLiteSpan,
  type MarkdownLiteBlock,
} from "@xpufx/backend-tickets/client";
import {
  HostCodeBlock,
  HostHighlightedText,
  HostRow,
  HostStack,
  useHostTheme,
} from "../index.js";

function renderInlineSpans(
  spans: MarkdownLiteSpan[],
  accent: string,
  keyPrefix: string,
  query: string,
) {
  return spans.map((span, index) => {
    const key = `${keyPrefix}-${index}`;
    if (span.kind === "bold") {
      return (
        <Text key={key} style={{ fontWeight: "700" }}>
          <HostHighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "italic") {
      return (
        <Text key={key} style={{ fontStyle: "italic" }}>
          <HostHighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "code") {
      return (
        <Text
          key={key}
          style={{ fontFamily: "monospace", fontSize: 12, backgroundColor: `${accent}18` }}
        >
          <HostHighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    if (span.kind === "link") {
      return (
        <Text
          key={key}
          style={{ color: accent, textDecorationLine: "underline" }}
          onPress={() => {
            Linking.openURL(span.url).catch(() => {
              copyText(span.url).catch(() => {});
            });
          }}
        >
          <HostHighlightedText text={span.text} query={query} />
        </Text>
      );
    }
    return <HostHighlightedText key={key} text={span.text} query={query} />;
  });
}

export interface HostMarkdownLiteProps {
  body: string;
  query?: string;
  style?: StyleProp<ViewStyle>;
}

export function HostMarkdownLite({ body, query = "", style }: HostMarkdownLiteProps) {
  const { colors } = useHostTheme();
  const blocks = useMemo(() => parseMarkdownLite(body), [body]);

  return (
    <HostStack gap="xs" style={[{ width: "100%" }, style]}>
      {blocks.map((block, index) => {
        if (block.kind === "code") {
          return <HostCodeBlock key={index} code={block.text} language={block.language} />;
        }
        if (block.kind === "heading") {
          const fontSize = block.level === 1 ? 18 : block.level === 2 ? 16 : 14;
          return (
            <Text
              key={index}
              selectable
              style={{
                fontSize,
                fontWeight: "700",
                color: colors.foreground,
                marginTop: 4,
              }}
            >
              {renderInlineSpans(block.spans, colors.accent, `h${index}`, query)}
            </Text>
          );
        }
        if (block.kind === "list") {
          return (
            <HostStack key={index} gap="xxs" style={{ paddingLeft: 4 }}>
              {block.items.map((item, itemIndex) => (
                <HostRow key={itemIndex} align="flex-start" gap="xs">
                  <Text selectable style={{ color: colors.foregroundMuted, fontSize: 13, lineHeight: 18 }}>
                    {block.ordered ? `${itemIndex + 1}.` : "•"}
                  </Text>
                  <Text selectable style={{ color: colors.foreground, flex: 1, fontSize: 13, lineHeight: 18 }}>
                    {renderInlineSpans(item, colors.accent, `li${index}-${itemIndex}`, query)}
                  </Text>
                </HostRow>
              ))}
            </HostStack>
          );
        }
        return (
          <Text
            key={index}
            selectable
            style={{ color: colors.foreground, fontSize: 13, lineHeight: 20 }}
          >
            {renderInlineSpans(block.spans, colors.accent, `p${index}`, query)}
          </Text>
        );
      })}
    </HostStack>
  );
}

export { HostMarkdownLite as MarkdownLite };
