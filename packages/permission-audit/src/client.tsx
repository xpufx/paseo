import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useRpcQuery } from "paseo-plugin-helper/core";
import type {
  PluginTheme,
  ResponsiveLayout,
  StatusVariant,
  ThemeColors,
} from "paseo-plugin-helper/shared";
import {
  isToolCallEntry,
  permissionAuditQuery,
  type AuditRecord,
  type PermissionAuditEntry,
  type PermissionDecision,
  type PermissionQueryFilter,
  type ToolCallAuditEntry,
  type ToolCallOutcome,
} from "./shared.js";
import {
  filterAuditEntries,
  formatAuditTime,
  summarizeAuditInput,
  type AuditTypeFilter,
  type DecisionFilter,
} from "./filter.js";

export type {
  AuditRecord,
  AuditTypeFilter,
  DecisionFilter,
  PermissionAuditEntry,
  PermissionDecision,
  PermissionQueryFilter,
  ToolCallAuditEntry,
  ToolCallOutcome,
};
export { permissionAuditQuery, filterAuditEntries, formatAuditTime, summarizeAuditInput };
export type PermissionAuditVariant = "page" | "compact";

export interface UsePermissionAuditOptions {
  limit?: number;
  refreshIntervalMs?: number;
  enabled?: boolean;
}

export function usePermissionAudit(
  filter: Omit<PermissionQueryFilter, "limit"> & { limit?: number } = {},
  options: UsePermissionAuditOptions = {},
) {
  const { limit = 100, refreshIntervalMs = 5000, enabled = true } = options;
  const query = useRpcQuery(
    permissionAuditQuery,
    { ...filter, limit },
    { refetchInterval: refreshIntervalMs, enabled },
  );
  return query;
}

export interface PermissionAuditViewProps {
  agentId?: string;
  variant?: PermissionAuditVariant;
  showFilters?: boolean;
  limit?: number;
  refreshIntervalMs?: number;
  /**
   * Host theme for this surface. The host passes it through the surface
   * registration props; when present the view provides it to the local
   * composition below. When absent (tests, standalone rendering) the local
   * components fall back to a neutral palette.
   */
  theme?: PluginTheme;
  /** Host layout descriptor for this surface. */
  layout?: ResponsiveLayout;
}

const DECISION_FILTERS: DecisionFilter[] = ["all", "pending", "allow", "deny"];
const TYPE_FILTERS: AuditTypeFilter[] = ["all", "permission", "tool_call"];

/**
 * Neutral fallback palette so the view still renders outside a host surface
 * (tests, previews). Static literal — never scraped from the DOM.
 */
const FALLBACK_COLORS: ThemeColors = {
  surface0: "#18181b",
  surface1: "#27272a",
  surface2: "#3f3f46",
  border: "#3f3f46",
  foreground: "#fafafa",
  foregroundMuted: "#a1a1aa",
  accent: "#3b82f6",
  accentForeground: "#ffffff",
  statusSuccess: "#22c55e",
  statusWarning: "#eab308",
  statusDanger: "#ef4444",
};

const ColorsContext = createContext<ThemeColors>(FALLBACK_COLORS);

/** Provides the host theme colors to the local composition below. */
export function PermissionAuditThemeProvider({
  theme,
  children,
}: {
  theme: PluginTheme;
  children: ReactNode;
}) {
  return <ColorsContext.Provider value={theme.colors}>{children}</ColorsContext.Provider>;
}

/** Reads the host theme colors for this surface. */
export function usePermissionAuditColors(): ThemeColors {
  return useContext(ColorsContext);
}

function statusColor(colors: ThemeColors, variant: StatusVariant): string {
  switch (variant) {
    case "success":
      return colors.statusSuccess;
    case "warning":
      return colors.statusWarning;
    case "danger":
      return colors.statusDanger;
    case "accent":
    case "info":
      return colors.accent;
    default:
      return colors.foregroundMuted;
  }
}

function AuditBadge({ label, variant }: { label: string; variant: StatusVariant }) {
  const colors = usePermissionAuditColors();
  const color = statusColor(colors, variant);
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function AuditButton({
  label,
  variant = "secondary",
  onPress,
}: {
  label: string;
  variant?: "primary" | "secondary";
  onPress: () => void;
}) {
  const colors = usePermissionAuditColors();
  const primary = variant === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: primary ? colors.accent : colors.surface1,
          borderColor: primary ? colors.accent : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: primary ? colors.accentForeground : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AuditSearchInput({
  value,
  onChangeText,
  placeholder,
  testID,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  const colors = usePermissionAuditColors();
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.foregroundMuted}
      style={[
        styles.searchInput,
        {
          color: colors.foreground,
          borderColor: colors.border,
          backgroundColor: colors.surface1,
        },
      ]}
    />
  );
}

function AuditEmptyState({ title, description }: { title: string; description?: string }) {
  const colors = usePermissionAuditColors();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{title}</Text>
      {description ? (
        <Text style={[styles.emptyDescription, { color: colors.foregroundMuted }]}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}

interface AuditColumn<T> {
  key: string;
  header: string;
  flex?: number;
  width?: number;
  align?: "left" | "center" | "right";
  render: (item: T) => ReactNode;
}

function AuditTable<T>({
  data,
  columns,
  keyExtractor,
  emptyState,
  layout,
}: {
  data: T[];
  columns: AuditColumn<T>[];
  keyExtractor: (item: T, index: number) => string;
  emptyState?: ReactNode;
  layout: ResponsiveLayout;
}) {
  const colors = usePermissionAuditColors();
  const isCompact =
    layout.compact || layout.platform === "ios" || layout.platform === "android";

  if (data.length === 0) {
    return emptyState ? <View>{emptyState}</View> : null;
  }

  if (isCompact) {
    return (
      <View style={{ gap: 8 }}>
        {data.map((item, idx) => (
          <View
            key={keyExtractor(item, idx)}
            style={[styles.compactCard, { backgroundColor: colors.surface1, borderColor: colors.border }]}
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

  return (
    <View
      style={[styles.table, { borderColor: colors.border, backgroundColor: colors.surface0 }]}
    >
      <View
        style={[
          styles.headerRow,
          { backgroundColor: colors.surface1, borderBottomColor: colors.border },
        ]}
      >
        {columns.map((col) => (
          <View key={col.key} style={[styles.cell, cellStyle(col)]}>
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
      {data.map((item, idx) => (
        <View
          key={keyExtractor(item, idx)}
          style={[
            styles.row,
            idx < data.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: 1 },
          ]}
        >
          {columns.map((col) => (
            <View key={col.key} style={[styles.cell, cellStyle(col)]}>
              {col.render(item)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function cellStyle<T>(col: AuditColumn<T>): StyleProp<ViewStyle> {
  return [
    col.flex !== undefined ? { flex: col.flex } : { flex: 1 },
    col.width !== undefined ? { width: col.width } : undefined,
    col.align === "right"
      ? styles.alignRight
      : col.align === "center"
        ? styles.alignCenter
        : styles.alignLeft,
  ];
}

function decisionLabel(value: DecisionFilter): string {
  switch (value) {
    case "pending":
      return "Pending";
    case "allow":
      return "Allowed";
    case "deny":
      return "Denied";
    default:
      return "All";
  }
}

function typeLabel(value: AuditTypeFilter): string {
  switch (value) {
    case "permission":
      return "Permissions";
    case "tool_call":
      return "Tool calls";
    default:
      return "All";
  }
}

function outcomePresentation(record: AuditRecord): { label: string; variant: StatusVariant } {
  if (isToolCallEntry(record)) {
    switch (record.outcome) {
      case "success":
        return { label: "Success", variant: "success" };
      case "failure":
        return { label: "Failed", variant: "danger" };
      default:
        return { label: "Canceled", variant: "warning" };
    }
  }
  switch (record.decision) {
    case "pending":
      return { label: "Pending", variant: "warning" };
    case "allow":
      return { label: "Allowed", variant: "success" };
    default:
      return { label: "Denied", variant: "danger" };
  }
}

/**
 * Permission audit view migrated off the deprecated `client/` + `ui/` layers
 * (paseo#847): the audit table, badges, buttons, search field, and empty state
 * are local composition over `react-native`, so the view owns no helper UI
 * dependency. Scroll ownership stays explicit: the page variant renders a
 * single host `ScrollView`; the compact variant renders no scroller and leaves
 * scrolling to the surrounding host surface.
 */
export function PermissionAuditView({
  agentId,
  variant = "page",
  showFilters = true,
  limit = 100,
  refreshIntervalMs = 5000,
  theme,
  layout,
}: PermissionAuditViewProps) {
  const resolvedLayout = layout ?? { compact: false, platform: "web" as const };
  const content = (
    <PermissionAuditViewContent
      agentId={agentId}
      variant={variant}
      showFilters={showFilters}
      limit={limit}
      refreshIntervalMs={refreshIntervalMs}
      layout={resolvedLayout}
    />
  );
  if (!theme) {
    return content;
  }
  return <PermissionAuditThemeProvider theme={theme}>{content}</PermissionAuditThemeProvider>;
}

function PermissionAuditViewContent({
  agentId,
  variant = "page",
  showFilters = true,
  limit = 100,
  refreshIntervalMs = 5000,
  layout,
}: Omit<PermissionAuditViewProps, "theme"> & { layout: ResponsiveLayout }) {
  const colors = usePermissionAuditColors();
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState<DecisionFilter>("all");
  const [type, setType] = useState<AuditTypeFilter>("all");

  const serverFilter = useMemo(
    () => (agentId ? { agentId } : {}),
    [agentId],
  );
  const { data, isLoading, isError, refetch } = usePermissionAudit(serverFilter, {
    limit,
    refreshIntervalMs,
  });

  const entries = useMemo(() => {
    const all = data?.entries ?? [];
    const scoped = agentId ? all.filter((entry) => entry.agentId === agentId) : all;
    return filterAuditEntries(scoped, decision, search, type);
  }, [data, agentId, decision, search, type]);

  if (isLoading) {
    return (
      <View style={{ padding: 24, alignItems: "center" }}>
        <ActivityIndicator />
        <Text style={{ color: colors.foregroundMuted, marginTop: 8 }}>Loading permission audit log…</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <AuditEmptyState
        title="Audit log unavailable"
        description="Could not load recent permission decisions."
      />
    );
  }

  const filters = showFilters ? (
    <View style={{ gap: 12 }}>
      <AuditSearchInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search tool, agent, outcome, or arguments…"
        testID="permission-audit-search"
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {TYPE_FILTERS.map((value) => (
          <AuditButton
            key={value}
            label={typeLabel(value)}
            variant={type === value ? "primary" : "secondary"}
            onPress={() => setType(value)}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {DECISION_FILTERS.map((value) => (
          <AuditButton
            key={value}
            label={decisionLabel(value)}
            variant={decision === value ? "primary" : "secondary"}
            onPress={() => setDecision(value)}
          />
        ))}
      </View>
    </View>
  ) : null;

  const table = (
    <AuditTable<AuditRecord>
      data={entries}
      layout={layout}
      keyExtractor={(item) => `${isToolCallEntry(item) ? "tool_call" : "permission"}:${item.id}`}
      columns={[
        {
          key: "time",
          header: "Time",
          flex: 2,
          render: (item) => (
            <Text style={{ color: colors.foregroundMuted }}>{formatAuditTime(item.timestamp)}</Text>
          ),
        },
        {
          key: "entry",
          header: "Entry",
          flex: 3,
          render: (item) => (
            <View style={{ gap: 2 }}>
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>{item.name}</Text>
              <Text style={{ color: colors.foregroundMuted }} numberOfLines={1}>
                {isToolCallEntry(item) ? "tool_call" : item.kind} · {item.agentId}
                {item.agentModel ? ` · ${item.agentModel}` : ""}
                {isToolCallEntry(item) && item.turnId ? ` · turn ${item.turnId}` : ""}
              </Text>
              <Text style={{ color: colors.foregroundMuted }} numberOfLines={1}>
                {summarizeAuditInput(item.input)}
              </Text>
            </View>
          ),
        },
        {
          key: "outcome",
          header: "Outcome",
          width: 110,
          align: "right",
          render: (item) => {
            const { label, variant } = outcomePresentation(item);
            return <AuditBadge label={label} variant={variant} />;
          },
        },
      ]}
      emptyState={
        <AuditEmptyState
          title="No audit entries yet"
          description="Permission decisions and tool calls will appear here as agents run."
        />
      }
    />
  );

  if (variant === "compact") {
    return (
      <View style={{ gap: 12 }}>
        {filters}
        {table}
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14, gap: 12 }}>
      {filters}
      {table}
    </ScrollView>
  );
}

const styles = createStyleSheet();

function createStyleSheet() {
  return {
    badge: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      alignSelf: "flex-start" as const,
      borderWidth: 1,
      borderRadius: 9999,
      paddingHorizontal: 8,
      paddingVertical: 2,
      gap: 4,
    },
    badgeDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "600" as const,
    },
    button: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 6,
      minHeight: 32,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    buttonText: {
      fontSize: 12,
      fontWeight: "600" as const,
    },
    searchInput: {
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
      width: "100%" as const,
    },
    empty: {
      alignItems: "center" as const,
      justifyContent: "center" as const,
      gap: 8,
      padding: 24,
    },
    emptyTitle: {
      fontSize: 14,
      fontWeight: "600" as const,
      textAlign: "center" as const,
    },
    emptyDescription: {
      fontSize: 12,
      textAlign: "center" as const,
    },
    compactCard: {
      borderWidth: 1,
      borderRadius: 10,
      padding: 10,
      gap: 6,
    },
    compactRow: {
      flexDirection: "row" as const,
      justifyContent: "space-between" as const,
      gap: 8,
    },
    compactHeader: {
      fontSize: 11,
      flexShrink: 1,
    },
    compactValue: {
      flexShrink: 1,
      minWidth: 0,
    },
    table: {
      borderWidth: 1,
      borderRadius: 10,
      overflow: "hidden" as const,
    },
    headerRow: {
      flexDirection: "row" as const,
      borderBottomWidth: 1,
    },
    row: {
      flexDirection: "row" as const,
    },
    cell: {
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    alignLeft: {
      alignItems: "flex-start" as const,
    },
    alignCenter: {
      alignItems: "center" as const,
    },
    alignRight: {
      alignItems: "flex-end" as const,
    },
    headerText: {
      fontSize: 11,
      fontWeight: "600" as const,
      letterSpacing: 0.3,
      textTransform: "uppercase" as const,
    },
  } satisfies Record<string, ViewStyle | TextStyle>;
}
