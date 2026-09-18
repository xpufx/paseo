import React, { useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView as FallbackScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";
import { copyToClipboard } from "../utils/clipboard.js";

export interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  maxHeight?: number;
  copyable?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function CodeBlock({
  code,
  language,
  title,
  maxHeight = 320,
  copyable = true,
  style,
  textStyle,
}: CodeBlockProps) {
  const { Icon, useToast } = getClientHost();
  // Inner snippet scrollers are NEVER the host sheet scroller: the host
  // ScrollView is a sheet-gesture pan controller, so using it horizontally or
  // nested inside the host sheet collapses to height 0 / crashes the gesture
  // handler (#219). Plain React Native ScrollViews own this bounded box.
  const { colors, resolveRadius, isCompact, touchTargetMin, alpha } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const radius = resolveRadius("md");

  const handleCopy = async () => {
    const ok = await copyToClipboard(code, {
      toast,
      toastMessage: title || "Code",
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fontFamily = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  });

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface0,
          borderColor: colors.border,
          borderRadius: radius,
        },
        style,
      ]}
    >
      {(title || language || copyable) && (
        <View
          style={[
            styles.header,
            {
              borderBottomColor: alpha(colors.border, 0.7),
            },
          ]}
        >
          <View style={styles.headerLeft}>
            {title ? (
              <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            ) : language ? (
              <Text style={[styles.language, { color: colors.foregroundMuted }]}>
                {language.toUpperCase()}
              </Text>
            ) : null}
          </View>
          {copyable && (
            <Pressable
              onPress={handleCopy}
              hitSlop={Math.max(0, (touchTargetMin - 28) / 2)}
              style={({ pressed }) => [
                styles.copyButton,
                {
                  backgroundColor: pressed ? colors.surface2 : colors.surface1,
                  borderColor: colors.border,
                  borderRadius: radius - 2,
                },
              ]}
            >
              <Icon
                name={copied ? "Check" : "Copy"}
                size={12}
                color={copied ? colors.statusSuccess : colors.foregroundMuted}
              />
              <Text
                style={[
                  styles.copyText,
                  { color: copied ? colors.statusSuccess : colors.foregroundMuted },
                ]}
              >
                {copied ? "Copied!" : "Copy"}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      <FallbackScrollView
        nestedScrollEnabled
        style={{ maxHeight }}
        contentContainerStyle={styles.scrollContent}
      >
        <FallbackScrollView horizontal showsHorizontalScrollIndicator>
          <Text
            selectable
            style={[
              styles.codeText,
              {
                color: colors.foreground,
                fontFamily,
                fontSize: isCompact ? 11 : 12,
              },
              textStyle,
            ]}
          >
            {code}
          </Text>
        </FallbackScrollView>
      </FallbackScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
  },
  language: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  copyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  copyText: {
    fontSize: 11,
    fontWeight: "500",
  },
  scrollContent: {
    padding: 10,
  },
  codeText: {
    lineHeight: 18,
  },
});
