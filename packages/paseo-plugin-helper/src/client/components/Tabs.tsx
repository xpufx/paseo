import React, { useEffect, useRef, useState, type ComponentType, type Ref } from "react";
import {
  Pressable,
  ScrollView as FallbackScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ScrollView as ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { getClientHost, selectHostScrollView, type HostScrollView } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";
import {
  FALLBACK_ACCENT_FOREGROUND,
  spacing,
} from "../theme/tokens.js";

export interface TabItem {
  id: string;
  label: string;
  /**
   * Optional abbreviated label for compact viewports in fit mode.
   * e.g. label: "Interactive Controls", shortLabel: "Controls"
   */
  shortLabel?: string;
  icon?: string;
  badge?: string | number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  mode?: "auto" | "fit" | "scroll";
  style?: StyleProp<ViewStyle>;
}

export function Tabs({
  tabs,
  activeTab,
  onTabChange,
  mode = "auto",
  style,
}: TabsProps) {
  const { Icon } = getClientHost();
  const ResolvedScrollView = selectHostScrollView(
    getClientHost(),
    FallbackScrollView as unknown as HostScrollView,
  );
  const { colors, resolveRadius, touchTargetMin, isCompact, alpha } = usePluginTheme();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const tabLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const [viewportWidth, setViewportWidth] = useState<number>(0);

  const radius = resolveRadius("sm");

  // On compact/mobile or with <= 4 tabs, auto mode defaults to full-width fitting track
  const shouldFit = mode === "fit" || (mode === "auto" && (isCompact || tabs.length <= 4));

  // Accurately center the active tab inside the viewport ONLY when activeTab changes
  const prevActiveTab = useRef<string>(activeTab);
  useEffect(() => {
    if (!shouldFit && scrollRef.current && tabLayouts.current[activeTab] && viewportWidth > 0) {
      if (prevActiveTab.current !== activeTab) {
        prevActiveTab.current = activeTab;
        const { x, width } = tabLayouts.current[activeTab];
        const targetX = Math.max(0, x - (viewportWidth - width) / 2);
        scrollRef.current.scrollTo({
          x: targetX,
          animated: true,
        });
      }
    }
  }, [activeTab, shouldFit, viewportWidth]);

  const handleTabLayout = (tabId: string, event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    tabLayouts.current[tabId] = { x, width };
  };

  const handleContainerLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setViewportWidth(width);
  };

  const renderTab = (tab: TabItem) => {
    const isActive = tab.id === activeTab;
    const displayLabel = shouldFit && isCompact && tab.shortLabel ? tab.shortLabel : tab.label;

    return (
      <Pressable
        key={tab.id}
        onPress={() => {
          onTabChange(tab.id);
        }}
        onLayout={(e) => handleTabLayout(tab.id, e)}
        accessibilityRole="tab"
        accessibilityState={{ selected: isActive }}
        style={({ pressed }) => [
          styles.tab,
          shouldFit ? styles.tabFit : styles.tabScroll,
          {
            borderRadius: radius - 2,
            minHeight: Math.max(30, touchTargetMin - 8),
            backgroundColor: isActive
              ? colors.surface2
              : pressed
                ? alpha(colors.surface2, 0.5)
                : "transparent",
            paddingHorizontal: shouldFit
              ? isCompact
                ? (tabs.length > 3 ? spacing.xs : spacing.sm)
                : (tabs.length >= 3 ? spacing.sm : spacing.md)
              : spacing.md,
            paddingVertical: isCompact ? spacing.xs : spacing.sm,
          },
        ]}
      >
        {tab.icon ? (
          <Icon
            name={tab.icon}
            size={isCompact ? 11 : 13}
            color={isActive ? colors.foreground : colors.foregroundMuted}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={[
            styles.tabText,
            {
              color: isActive ? colors.foreground : colors.foregroundMuted,
              fontSize: isCompact ? 11 : 12,
              fontWeight: isActive ? "600" : "500",
            },
          ]}
        >
          {displayLabel}
        </Text>
        {tab.badge !== undefined ? (
          <View
            style={[
              styles.badge,
              {
                backgroundColor: isActive ? colors.accent : alpha(colors.foregroundMuted, 0.2),
              },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                {
                color: isActive
                  ? colors.accentForeground || FALLBACK_ACCENT_FOREGROUND
                  : colors.foregroundMuted,
                },
              ]}
            >
              {tab.badge}
            </Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  // 1. FIT MODE: Closed bounded track frame
  if (shouldFit) {
    return (
      <View
        style={[
          styles.frame,
          {
            backgroundColor: colors.surface1,
            borderRadius: radius,
            borderColor: colors.border,
          },
          style,
        ]}
      >
        <View style={styles.trackFit}>
          {tabs.map((tab) => renderTab(tab))}
        </View>
      </View>
    );
  }

  // 2. SCROLL MODE: Host-gesture horizontal ScrollView
  return (
    <View
      onLayout={handleContainerLayout}
      style={[
        styles.frame,
        {
          backgroundColor: colors.surface1,
          borderRadius: radius,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <ResolvedScrollView
        ref={scrollRef}
        horizontal
        nestedScrollEnabled={true}
        directionalLockEnabled={true}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={!isCompact}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {tabs.map((tab) => renderTab(tab))}
      </ResolvedScrollView>

    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: "100%",
    maxWidth: "100%",
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    justifyContent: "center",
  },
  trackFit: {
    flexDirection: "row",
    flexWrap: "nowrap",
    alignItems: "center",
    width: "100%",
    padding: 3,
    gap: 2,
  },
  scrollView: {
    width: "100%",
    maxWidth: "100%",
  },
  scrollContent: {
    flexDirection: "row",
    alignItems: "center",
    padding: 3,
    gap: 4,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
  },
  tabFit: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  tabScroll: {
    flexShrink: 0,
  },
  tabText: {
    textAlign: "center",
    flexShrink: 1,
    minWidth: 0,
  },
  badge: {
    borderRadius: 9999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
});
