import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";

export interface CollapsibleProps {
  title: string;
  children: React.ReactNode;
  initiallyExpanded?: boolean;
  isExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  badge?: React.ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}

export function Collapsible({
  title,
  children,
  initiallyExpanded = false,
  isExpanded: controlledExpanded,
  onToggle,
  badge,
  icon,
  style,
}: CollapsibleProps) {
  const { Icon } = getClientHost();
  const { colors, resolveRadius, isCompact, touchTargetMin, alpha } = usePluginTheme();
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const radius = resolveRadius("md");

  const handlePress = () => {
    const next = !isExpanded;
    if (controlledExpanded === undefined) {
      setInternalExpanded(next);
    }
    onToggle?.(next);
  };

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: colors.border,
          borderRadius: radius,
          backgroundColor: colors.surface0,
        },
        style,
      ]}
    >
      <Pressable
        onPress={handlePress}
        style={({ pressed }) => [
          styles.header,
          {
            minHeight: Math.max(touchTargetMin, 36),
            backgroundColor: pressed ? colors.surface1 : colors.surface0,
            borderBottomColor: isExpanded ? alpha(colors.border, 0.6) : "transparent",
            borderBottomWidth: isExpanded ? 1 : 0,
          },
        ]}
      >
        <View style={styles.headerLeft}>
          <Icon
            name={isExpanded ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={colors.foregroundMuted}
          />
          {icon && <Icon name={icon} size={14} color={colors.accent} />}
          <Text
            style={[
              styles.title,
              {
                color: colors.foreground,
                fontSize: isCompact ? 12 : 13,
              },
            ]}
          >
            {title}
          </Text>
        </View>

        {badge && <View style={styles.headerRight}>{badge}</View>}
      </Pressable>

      {isExpanded && <View style={styles.content}>{children}</View>}
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
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    fontWeight: "600",
  },
  content: {
    padding: 12,
  },
});
