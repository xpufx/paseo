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
import { getClientHost } from "../host";
import { usePluginTheme } from "../theme/provider";
import { resolveGridColumns } from "../theme/responsive";
import { spacing } from "../theme/tokens";
import { copyToClipboard } from "../utils/clipboard";
import {
  truncate,
  truncateMiddle,
  truncatePath,
  TruncatePathOptions,
} from "../../../../shared/vendor/paseo-plugin-helper/formatters";

export type KeyValueTruncateMode = "end" | "middle" | "path";

export interface KeyValueProps {
  label: string;
  value: string | number | null | undefined;
  subValue?: string;
  mono?: boolean;
  copyable?: boolean;
  /** Truncate long value: "middle" (UUIDs/hashes), "path" (filepaths), or "end" (standard) */
  truncate?: boolean | KeyValueTruncateMode;
  /** Maximum length before truncation applies. Default: 32 */
  truncateMaxLength?: number;
  /** Custom options when truncate="path" */
  truncatePathOptions?: TruncatePathOptions;
  /**
   * "stacked" (default) keeps the existing label-above-value layout.
   * "inline" renders label and value on one line, with the value truncating
   * middle so the row stays a single text line.
   */
  layout?: "stacked" | "inline";
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
  truncate: truncateProp = false,
  truncateMaxLength = 32,
  truncatePathOptions,
  layout = "stacked",
  stackOnCompact = true,
  style,
  labelStyle,
  valueStyle,
}: KeyValueProps) {
  const { Icon, useToast } = getClientHost();
  const { colors, flair, isCompact, touchTargetMin, fonts, typography } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const rawString = value === null || value === undefined ? "" : String(value);

  let displayValue = rawString || "-";
  if (truncateProp && rawString.length > truncateMaxLength) {
    const mode: KeyValueTruncateMode =
      typeof truncateProp === "string" ? truncateProp : "middle";
    switch (mode) {
      case "path":
        displayValue = truncatePath(rawString, truncateMaxLength, truncatePathOptions);
        break;
      case "end":
        displayValue = truncate(rawString, truncateMaxLength);
        break;
      case "middle":
      default:
        displayValue = truncateMiddle(rawString, truncateMaxLength);
        break;
    }
  }

  const handleCopy = async () => {
    if (!copyable || !rawString) return;
    const ok = await copyToClipboard(rawString, {
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

  if (layout === "inline") {
    return (
      <View
        style={[
          styles.container,
          styles.inlineContainer,
          { paddingVertical: isCompact ? spacing.xs : spacing.sm },
          style,
        ]}
      >
        <Text
          style={[
            styles.inlineLabel,
            {
              color: colors.foregroundMuted,
              ...typography.label,
              textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none",
            },
            labelStyle,
          ]}
        >
          {label}
        </Text>

        <Text
          selectable
          numberOfLines={1}
          ellipsizeMode="middle"
          style={[
            styles.inlineValueText,
            {
              color: colors.foreground,
              ...typography.bodySmall,
              fontFamily,
            },
            valueStyle,
          ]}
        >
          {displayValue}
        </Text>

        {subValue ? (
          <Text
            selectable
            numberOfLines={1}
            style={[
              styles.inlineSubValue,
              {
                color: colors.foregroundMuted,
                ...typography.caption,
              },
            ]}
          >
            {subValue}
          </Text>
        ) : null}

        {copyButton}
      </View>
    );
  }

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
                ...typography.label,
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
              ...typography.bodySmall,
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
                ...typography.caption,
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
            ...typography.label,
            textTransform: flair.headingTransform === "uppercase" ? "uppercase" : "none",
          },
          labelStyle,
        ]}
      >
        {label}
      </Text>

      <View style={styles.rowValueWrapper}>
        <View style={styles.rowValueLine}>
          <Text
            selectable
            style={[
              styles.rowValueText,
              {
                color: colors.foreground,
                ...typography.bodySmall,
                fontFamily,
              },
              valueStyle,
            ]}
          >
            {displayValue}
          </Text>

          {copyButton}
        </View>

        {subValue ? (
          <Text
            style={[
              styles.subValue,
              {
                color: colors.foregroundMuted,
                ...typography.caption,
              },
            ]}
          >
            {subValue}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export interface KeyValueGroupProps {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  gap?: number;
  /**
   * How a compact surface treats the column count.
   * - "compact" (default): collapse to a single column on a compact surface —
   *   the historical behavior.
   * - "never": keep the requested column count on a compact surface.
   */
  collapse?: "compact" | "never";
  /**
   * Minimum width a column should keep. When set and the container width is
   * known, the effective column count is capped so each column stays at least
   * this wide, wrapping to fewer columns rather than collapsing to one.
   * `columns` remains the upper bound.
   */
  minColumnWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export function KeyValueGroup({
  children,
  columns = 2,
  gap = spacing.md,
  collapse = "compact",
  minColumnWidth,
  style,
}: KeyValueGroupProps) {
  const { isCompact, layout } = usePluginTheme();
  const effectiveColumns = resolveGridColumns({
    columns,
    gap,
    width: layout.width,
    minColumnWidth,
    collapse,
    isCompact,
  });

  const childArray = React.Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.groupContainer, { gap }, style]}>
      {childArray.map((child, index) => (
        <View
          key={index}
          style={{
            flexGrow: 1,
            flexShrink: 1,
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
    alignItems: "flex-start",
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
    width: "100%",
  },
  inlineContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minWidth: 0,
  },
  inlineLabel: {
    flexShrink: 0,
  },
  inlineValueText: {
    flexShrink: 1,
    minWidth: 0,
  },
  inlineSubValue: {
    flexShrink: 0,
  },
  rowValueWrapper: {
    flexDirection: "column",
    alignItems: "flex-end",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  rowValueLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
  },
  rowValueText: {
    flexShrink: 1,
    minWidth: 0,
    textAlign: "right",
  },
  groupContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%",
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
  },
  subValue: {
    flexShrink: 1,
    minWidth: 0,
  },
  copyBtn: {
    padding: 3,
    alignItems: "center",
    justifyContent: "center",
  },
});
