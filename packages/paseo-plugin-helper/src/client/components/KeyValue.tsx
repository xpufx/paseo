import React, { useState, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";
import { spacing } from "../theme/tokens.js";
import { copyToClipboard } from "../utils/clipboard.js";

export interface KeyValueProps {
  label: string;
  value: string | number | null | undefined;
  subValue?: string;
  mono?: boolean;
  copyable?: boolean;
  stackOnCompact?: boolean;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  valueStyle?: StyleProp<TextStyle>;
}

export function KeyValue({
  label,
  value,
  subValue,
  mono = false,
  copyable = false,
  stackOnCompact = true,
  style,
  labelStyle,
  valueStyle,
}: KeyValueProps) {
  const { Icon, useToast } = getClientHost();
  const { colors, flair, isCompact, touchTargetMin, fonts } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const displayValue = value === null || value === undefined ? "-" : String(value);

  const handleCopy = async () => {
    if (!copyable || !value) return;
    const ok = await copyToClipboard(String(value), {
      toast,
      toastMessage: label,
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fontFamily = mono
    ? fonts.mono ?? Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" })
    : undefined;

  const shouldStack = stackOnCompact && isCompact;

  const copyButton = copyable && value ? (
    <Pressable
      onPress={handleCopy}
      hitSlop={Math.max(8, (touchTargetMin - 20) / 2)}
      style={styles.copyBtn}
      accessibilityRole="button"
      accessibilityLabel={`Copy ${label}`}
    >
      <Icon
        name={copied ? "Check" : "Copy"}
        size={isCompact ? 12 : 13}
        color={copied ? colors.statusSuccess : colors.foregroundMuted}
      />
    </Pressable>
  ) : null;

  if (shouldStack) {
    return (
      <View
        style={[
          styles.container,
          styles.stackedContainer,
          { paddingVertical: isCompact ? spacing.xs : spacing.sm },
          style,
        ]}
      >
        <View style={styles.stackedHeaderRow}>
          <Text
            style={[
              styles.label,
              {
                color: colors.foregroundMuted,
                fontSize: 11,
                textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none",
              },
              labelStyle,
            ]}
          >
            {label}
          </Text>
          {copyButton}
        </View>

        <Text
          selectable
          style={[
            styles.stackedValueText,
            {
              color: colors.foreground,
              fontSize: 13,
              lineHeight: 19,
              fontFamily,
            },
            valueStyle,
          ]}
        >
          {displayValue}
        </Text>

        {subValue ? (
          <Text
            style={[
              styles.subValue,
              {
                color: colors.foregroundMuted,
                fontSize: 11,
                lineHeight: 15,
              },
            ]}
          >
            {subValue}
          </Text>
        ) : null}
      </View>
    );
  }

  // Horizontal layout for Desktop / Wide screens
  return (
    <View
      style={[
        styles.container,
        styles.rowContainer,
        { paddingVertical: isCompact ? spacing.xs : spacing.sm },
        style,
      ]}
    >
      <Text
        style={[
          styles.label,
          {
            color: colors.foregroundMuted,
            fontSize: 12,
            textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none",
          },
          labelStyle,
        ]}
      >
        {label}
      </Text>

      <View style={styles.rowValueWrapper}>
        <Text
          selectable
          style={[
            styles.rowValueText,
            {
              color: colors.foreground,
              fontSize: 13,
              fontFamily,
            },
            valueStyle,
          ]}
        >
          {displayValue}
        </Text>

        {subValue && (
          <Text style={[styles.subValue, { color: colors.foregroundMuted, fontSize: 11 }]}>
            {subValue}
          </Text>
        )}

        {copyButton}
      </View>
    </View>
  );
}

export interface KeyValueGroupProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}

export function KeyValueGroup({
  children,
  columns = 2,
  gap = spacing.md,
  style,
}: KeyValueGroupProps) {
  const { isCompact } = usePluginTheme();
  const effectiveColumns = isCompact ? 1 : columns;

  const childArray = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.groupContainer, { gap }, style]}>
      {childArray.map((child, index) => (
        <View
          key={index}
          style={{
            flexGrow: 1,
            flexShrink: 0,
            flexBasis: `${Math.floor(100 / effectiveColumns) - 2}%`,
          }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  rowContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  stackedContainer: {
    flexDirection: "column",
    gap: 3,
    width: "100%",
  },
  stackedHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  stackedValueText: {
    fontWeight: "600",
    width: "100%",
  },
  rowValueWrapper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexShrink: 1,
    gap: 6,
  },
  rowValueText: {
    fontWeight: "600",
    flexShrink: 1,
  },
  groupContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%",
  },
  label: {
    fontWeight: "500",
  },
  subValue: {
    fontWeight: "400",
  },
  copyBtn: {
    padding: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
