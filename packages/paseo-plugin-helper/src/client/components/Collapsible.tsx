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
import type { SurfaceStyle } from "../theme/flair.js";
import type { ThemeColors } from "../../shared/types.js";

export interface CollapsibleProps {
  title?: string | React.ReactNode;
  subtitle?: string | React.ReactNode;
  children: React.ReactNode;
  initiallyExpanded?: boolean;
  isExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
  badge?: React.ReactNode;
  headerRight?: React.ReactNode;
  summary?: React.ReactNode;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  variant?: SurfaceStyle;
}

export function resolveCollapsibleChevron(expanded: boolean): string {
  return expanded ? "ChevronDown" : "ChevronRight";
}

/**
 * Container background for a Collapsible, honoring the same `SurfaceStyle`
 * contract as `Card`:
 * - "flat" (default): surface0, the normal page surface.
 * - "elevated": surface1, so the card visibly lifts off the page.
 * - "tinted": a faint accent wash.
 *
 * Before this existed, `variant="elevated"` only changed the border radius and
 * the container stayed `surface0` — so a card placed on an already-`surface0`
 * timeline read as a bleeding shaded band with no elevation (#208).
 */
export function resolveCollapsibleSurface(
  colors: ThemeColors,
  alpha: (color: string, opacity: number) => string,
  variant: SurfaceStyle = "flat",
): { backgroundColor: string; borderColor: string } {
  switch (variant) {
    case "elevated":
      return { backgroundColor: colors.surface1, borderColor: colors.border };
    case "tinted":
      return {
        backgroundColor: alpha(colors.accent, 0.04),
        borderColor: alpha(colors.accent, 0.2),
      };
    case "flat":
    default:
      return { backgroundColor: colors.surface0, borderColor: colors.border };
  }
}

/**
 * Header stripe background. Kept for backwards compatibility; prefer
 * {@link resolveCollapsibleSurface} for the container and use this only for the
 * pressed/unpressed header delta.
 */
export function resolveCollapsibleHeaderBackground(
  colors: ThemeColors,
  pressed: boolean,
): string {
  return pressed ? colors.surface1 : colors.surface0;
}

function renderTitle(title: string | React.ReactNode, titleStyle: object) {
  if (typeof title === "string" || title === undefined) {
    return title ? <Text style={titleStyle}>{title}</Text> : null;
  }
  return <View style={styles.titleSlot}>{title}</View>;
}

function renderSubtitle(subtitle: string | React.ReactNode, subtitleStyle: object) {
  if (typeof subtitle === "string") {
    return <Text style={subtitleStyle}>{subtitle}</Text>;
  }
  return subtitle ?? null;
}

export function Collapsible({
  title,
  subtitle,
  children,
  initiallyExpanded = false,
  isExpanded: controlledExpanded,
  onToggle,
  badge,
  headerRight,
  summary,
  icon,
  style,
  headerStyle,
  contentStyle,
  variant,
}: CollapsibleProps) {
  const { Icon } = getClientHost();
  const { colors, resolveRadius, isCompact, touchTargetMin, alpha } = usePluginTheme();
  const [internalExpanded, setInternalExpanded] = useState(initiallyExpanded);

  const isExpanded = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const radius = resolveRadius(variant === "elevated" ? "lg" : "md");
  const surface = resolveCollapsibleSurface(colors, alpha, variant);

  const handlePress = () => {
    const next = !isExpanded;
    if (controlledExpanded === undefined) {
      setInternalExpanded(next);
    }
    onToggle?.(next);
  };

  const titleStyle = {
    color: colors.foreground,
    fontSize: isCompact ? 12 : 13,
  };
  const subtitleStyle = {
    color: colors.foregroundMuted,
    fontSize: isCompact ? 11 : 12,
  };

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: surface.borderColor,
          borderRadius: radius,
          backgroundColor: surface.backgroundColor,
        },
        style,
      ]}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        style={({ pressed }) => [
          styles.header,
          {
            minHeight: Math.max(touchTargetMin, 36),
            // Transparent by default: the container already carries the surface
            // color. Painting the header with an opaque surface color is what
            // made the first line read as a shaded band (#208). Only the
            // pressed state tints, as interaction feedback.
            backgroundColor: pressed ? alpha(colors.foreground, 0.06) : "transparent",
            cursor: "pointer" as never,
          },
          headerStyle,
        ]}
      >
        <View style={styles.headerLeft}>
          <View
            style={[
              styles.chevronBadge,
              {
                backgroundColor: alpha(colors.accent, 0.12),
                borderColor: alpha(colors.accent, 0.25),
              },
            ]}
          >
            <Icon
              name={resolveCollapsibleChevron(isExpanded)}
              size={14}
              color={colors.foregroundMuted}
            />
          </View>
          {icon && <Icon name={icon} size={14} color={colors.accent} />}
          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              {renderTitle(title, [styles.title, titleStyle])}
              {badge && <View style={styles.badgeSlot}>{badge}</View>}
            </View>
            {subtitle ? (
              <View style={styles.subtitleSlot}>
                {renderSubtitle(subtitle, [styles.subtitle, subtitleStyle])}
              </View>
            ) : null}
            {summary ? <View style={styles.summarySlot}>{summary}</View> : null}
          </View>
        </View>

        {(headerRight || summary === undefined) && (
          <View style={styles.headerRight}>{headerRight}</View>
        )}
      </Pressable>

      {isExpanded && (
        <View
          style={[
            styles.content,
            { borderTopColor: colors.border, borderTopWidth: 1 },
            contentStyle,
          ]}
        >
          {children}
        </View>
      )}
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
    flex: 1,
  },
  chevronBadge: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  titleSlot: {
    flexDirection: "row",
    alignItems: "center",
  },
  badgeSlot: {
    flexDirection: "row",
    alignItems: "center",
  },
  subtitleSlot: {
    marginTop: 2,
  },
  summarySlot: {
    marginTop: 4,
    flexDirection: "row",
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
  },
  title: {
    fontWeight: "600",
  },
  subtitle: {
    fontWeight: "400",
  },
  content: {
    padding: 12,
  },
});
