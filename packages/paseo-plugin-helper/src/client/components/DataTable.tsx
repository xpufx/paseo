import React, { type ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { usePluginTheme } from "../theme/provider.js";

export interface DataColumn<T> {
  key: string;
  header: string;
  flex?: number;
  width?: number;
  align?: "left" | "center" | "right";
  render: (item: T) => ReactNode;
}

export interface DataTableProps<T> {
  data: T[];
  columns: DataColumn<T>[];
  keyExtractor: (item: T, index: number) => string;
  emptyState?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * Responsive data table that automatically reflows between a traditional table
 * on desktop and structured card list on mobile / compact viewports.
 */
export function DataTable<T>({
  data,
  columns,
  keyExtractor,
  emptyState,
  style,
}: DataTableProps<T>) {
  const { colors, resolveRadius, isCompact } = usePluginTheme();
  const radius = resolveRadius("sm");

  if (!data || data.length === 0) {
    return emptyState ? <View style={style}>{emptyState}</View> : null;
  }

  // Mobile / compact card-list layout
  if (isCompact) {
    return (
      <View style={[styles.compactContainer, style]}>
        {data.map((item, idx) => (
          <View
            key={keyExtractor(item, idx)}
            style={[
              styles.compactCard,
              {
                backgroundColor: colors.surface1,
                borderColor: colors.border,
                borderRadius: radius,
              },
            ]}
          >
            {columns.map((col) => (
              <View key={col.key} style={styles.compactRow}>
                <Text style={[styles.compactHeader, { color: colors.foregroundMuted }]}>
                  {col.header}
                </Text>
                <View style={styles.compactValue}>{col.render(item)}</View>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }

  // Desktop tabular layout
  return (
    <View
      style={[
        styles.table,
        {
          borderColor: colors.border,
          borderRadius: radius,
          backgroundColor: colors.surface0,
        },
        style,
      ]}
    >
      {/* Header Row */}
      <View
        style={[
          styles.headerRow,
          {
            backgroundColor: colors.surface1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        {columns.map((col) => (
          <View
            key={col.key}
            style={[
              styles.cell,
              col.flex !== undefined ? { flex: col.flex } : { flex: 1 },
              col.width !== undefined ? { width: col.width } : undefined,
              col.align === "right"
                ? styles.alignRight
                : col.align === "center"
                ? styles.alignCenter
                : styles.alignLeft,
            ]}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[styles.headerText, { color: colors.foregroundMuted }]}
            >
              {col.header}
            </Text>
          </View>
        ))}
      </View>

      {/* Rows */}
      {data.map((item, idx) => (
        <View
          key={keyExtractor(item, idx)}
          style={[
            styles.row,
            idx < data.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
          ]}
        >
          {columns.map((col) => (
            <View
              key={col.key}
              style={[
                styles.cell,
                col.flex !== undefined ? { flex: col.flex } : { flex: 1 },
                col.width !== undefined ? { width: col.width } : undefined,
                col.align === "right"
                  ? styles.alignRight
                  : col.align === "center"
                  ? styles.alignCenter
                  : styles.alignLeft,
              ]}
            >
              {col.render(item)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  table: {
    borderWidth: 1,
    overflow: "hidden",
  },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  cell: {
    justifyContent: "center",
    // Yoga defaults `flexShrink` to 0, so without this a cell whose content
    // carries a long string (a title, a path) refuses to give up width and
    // squeezes its sibling columns instead of truncating.
    flexShrink: 1,
    maxWidth: "100%",
  },
  alignLeft: {
    alignItems: "flex-start",
  },
  alignCenter: {
    alignItems: "center",
  },
  alignRight: {
    alignItems: "flex-end",
  },
  headerText: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  compactContainer: {
    gap: 8,
  },
  compactCard: {
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  compactRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  compactHeader: {
    fontSize: 12,
    flexShrink: 1,
  },
  compactValue: {
    alignItems: "flex-end",
    // The value side carries the actual data, so it takes the compressible
    // slot and the fixed label beside it keeps its intrinsic width.
    flexShrink: 1,
    maxWidth: "100%",
  },
});
