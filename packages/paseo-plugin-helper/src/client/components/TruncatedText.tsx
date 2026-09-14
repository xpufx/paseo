import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
  Platform,
} from "react-native";
import { usePluginTheme } from "../theme/index.js";
import { getClientHost } from "../host.js";
import { copyToClipboard } from "../utils/clipboard.js";
import {
  truncate,
  truncateMiddle,
  truncatePath,
  TruncatePathOptions,
} from "../../shared/formatters.js";

export type TruncateMode = "end" | "middle" | "path";

export interface TruncatedTextProps {
  /** The full, raw text string (e.g. UUID, file path, commit SHA, token) */
  text: string;
  /** Maximum length allowed before truncation. Default: 32 */
  maxLength?: number;
  /** Truncation algorithm: "middle" (UUIDs/hashes), "path" (directory paths), or "end" (standard). Default: "middle" */
  mode?: TruncateMode;
  /** Additional path truncation options when mode="path" */
  pathOptions?: TruncatePathOptions;
  /** Whether to render an inline copy button. Default: true */
  copyable?: boolean;
  /** Use monospace font. Default: true */
  mono?: boolean;
  /** Toast message on successful copy. Default: "Copied" */
  toastMessage?: string;
  /** Custom container style */
  style?: StyleProp<ViewStyle>;
  /** Custom text style */
  textStyle?: StyleProp<TextStyle>;
}

/**
 * Renders long strings (paths, UUIDs, hashes) shortened with smart truncation,
 * while preserving the full untruncated string for one-click clipboard copying.
 */
export function TruncatedText({
  text,
  maxLength = 32,
  mode = "middle",
  pathOptions,
  copyable = true,
  mono = true,
  toastMessage = "Copied",
  style,
  textStyle,
}: TruncatedTextProps) {
  const { colors, fonts, isCompact, touchTargetMin } = usePluginTheme();
  const { Icon, useToast } = getClientHost();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (!text) {
    return <Text style={[{ color: colors.foregroundMuted }, textStyle]}>-</Text>;
  }

  let formattedText = text;
  if (text.length > maxLength) {
    switch (mode) {
      case "path":
        formattedText = truncatePath(text, maxLength, pathOptions);
        break;
      case "end":
        formattedText = truncate(text, maxLength);
        break;
      case "middle":
      default:
        formattedText = truncateMiddle(text, maxLength);
        break;
    }
  }

  const handleCopy = async () => {
    if (!copyable || !text) return;
    const ok = await copyToClipboard(text, {
      toast,
      toastMessage,
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fontFamily = mono
    ? fonts.mono ?? Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" })
    : undefined;

  return (
    <View style={[styles.container, style]}>
      <Text
        selectable
        numberOfLines={1}
        ellipsizeMode="clip"
        accessibilityLabel={text}
        style={[
          styles.text,
          {
            color: colors.foreground,
            fontFamily,
          },
          textStyle,
        ]}
      >
        {formattedText}
      </Text>

      {copyable && (
        <Pressable
          onPress={handleCopy}
          hitSlop={Math.max(8, (touchTargetMin - 20) / 2)}
          style={styles.copyBtn}
          accessibilityRole="button"
          accessibilityLabel={`Copy ${text}`}
        >
          <Icon
            name={copied ? "Check" : "Copy"}
            size={isCompact ? 12 : 13}
            color={copied ? colors.statusSuccess : colors.foregroundMuted}
          />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "100%",
    gap: 6,
  },
  text: {
    fontSize: 12,
    lineHeight: 18,
    flexShrink: 1,
  },
  copyBtn: {
    padding: 3,
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
});
