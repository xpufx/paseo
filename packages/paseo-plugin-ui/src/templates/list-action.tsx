import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  HostActionBar,
  HostButton,
  HostCard,
  HostEmptyState,
  HostRow,
  HostScroll,
  HostSectionHeader,
  HostStack,
  useHostLayout,
  useHostTheme,
} from "../index.js";

export interface ListActionHeaderAction {
  id: string;
  label: string;
  icon?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void | Promise<void>;
}

export interface ListActionPageTemplateProps<T> {
  /** Page or section title. */
  title: string;
  /** Subtitle or status summary text. */
  subtitle?: ReactNode;
  /** Icon shown next to the title (Lucide icon name). */
  icon?: string;
  /** Optional badge or pill rendered beside the title. */
  badge?: ReactNode;
  /** Global action buttons in the header row (e.g. Refresh, Update All). */
  headerActions?: readonly ListActionHeaderAction[];
  /** Search or filter control slot beneath the header. */
  filterSlot?: ReactNode;
  /** Top banner or progress bar slot (e.g. HostProgressBar, error banners). */
  bannerSlot?: ReactNode;
  /** Data items for the list. */
  data: readonly T[];
  /** Key extractor for list items. */
  keyExtractor: (item: T, index: number) => string;
  /** Render function for each item card. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Title and description for empty state when data is empty. */
  emptyState?: {
    title: string;
    description?: string;
    icon?: string;
  };
  /** Whether data is currently loading on initial fetch. */
  isLoading?: boolean;
  /** Optional supplemental sections rendered after the list (e.g. orphans, audit logs). */
  footerSlot?: ReactNode;
  /** Container style overrides. */
  style?: StyleProp<ViewStyle>;
  /** Content container style overrides for the scroll view. */
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * Standard whole-page template for collection views with global actions,
 * search filters, and card lists. Enforces responsive mobile reflow and
 * single scroll ownership.
 */
export function ListActionPageTemplate<T>({
  title,
  subtitle,
  icon,
  badge,
  headerActions = [],
  filterSlot,
  bannerSlot,
  data,
  keyExtractor,
  renderItem,
  emptyState = {
    title: "No items found",
    description: "There are no entries to display.",
    icon: "Inbox",
  },
  isLoading = false,
  footerSlot,
  style,
  contentContainerStyle,
}: ListActionPageTemplateProps<T>) {
  const { colors } = useHostTheme();
  const layout = useHostLayout();
  const isCompact = layout.compact || layout.platform === "ios" || layout.platform === "android";

  return (
    <View style={[{ flex: 1, minHeight: 0, width: "100%" }, style]}>
      <HostScroll
        contentContainerStyle={[
          {
            flexGrow: 1,
            width: "100%",
            gap: isCompact ? 10 : 14,
            paddingHorizontal: isCompact ? 12 : 16,
            paddingTop: isCompact ? 10 : 16,
            paddingBottom: isCompact ? 24 : 32,
          },
          contentContainerStyle,
        ]}
      >
        {/* Header Block */}
        <View
          style={{
            flexDirection: isCompact && headerActions.length > 2 ? "column" : "row",
            alignItems: isCompact && headerActions.length > 2 ? "flex-start" : "center",
            justifyContent: "space-between",
            gap: 8,
            width: "100%",
          }}
        >
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <HostRow align="center" gap={8}>
              {icon ? (
                <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 16 }}>{/* Host Icon rendering slot */}</Text>
                </View>
              ) : null}
              <Text
                numberOfLines={1}
                style={{
                  fontSize: isCompact ? 15 : 18,
                  fontWeight: "700",
                  color: colors.foreground,
                  letterSpacing: -0.2,
                }}
              >
                {title}
              </Text>
              {badge}
            </HostRow>
            {subtitle ? (
              typeof subtitle === "string" ? (
                <Text style={{ fontSize: 12, color: colors.foregroundMuted }}>{subtitle}</Text>
              ) : (
                subtitle
              )
            ) : null}
          </View>

          {headerActions.length > 0 ? (
            <HostActionBar align="end" gap={6}>
              {headerActions.map((action) => (
                <HostButton
                  key={action.id}
                  label={action.label}
                  icon={action.icon}
                  variant={action.variant ?? "secondary"}
                  size={isCompact ? "sm" : "md"}
                  loading={action.loading}
                  disabled={action.disabled}
                  onPress={action.onPress}
                />
              ))}
            </HostActionBar>
          ) : null}
        </View>

        {/* Filter / Search Bar Slot */}
        {filterSlot ? <View style={{ width: "100%" }}>{filterSlot}</View> : null}

        {/* Banner / Progress Slot */}
        {bannerSlot ? <View style={{ width: "100%" }}>{bannerSlot}</View> : null}

        {/* Main Content Area */}
        {isLoading && data.length === 0 ? (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : data.length === 0 ? (
          <HostEmptyState
            icon={emptyState.icon ?? "Inbox"}
            title={emptyState.title}
            description={emptyState.description}
          />
        ) : (
          <View style={{ gap: isCompact ? 8 : 12, width: "100%" }}>
            {data.map((item, index) => (
              <React.Fragment key={keyExtractor(item, index)}>
                {renderItem(item, index)}
              </React.Fragment>
            ))}
          </View>
        )}

        {/* Footer / Supplemental Sections */}
        {footerSlot ? <View style={{ width: "100%", marginTop: 8 }}>{footerSlot}</View> : null}
      </HostScroll>
    </View>
  );
}
