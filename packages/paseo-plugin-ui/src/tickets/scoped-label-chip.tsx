import React from "react";
import { Platform, Pressable, Text, type StyleProp, type ViewStyle, View } from "react-native";
import { scopeOfLabel } from "@xpufx/backend-tickets/client";
import { useHostTheme } from "../theme-context.js";

/**
 * Scoped label chip rendered as a GitLab-style two-tone pill.
 *
 * A scoped label (e.g. `state/wip`, `priority/high`) is split at the slash
 * into a scope prefix and value suffix. The chip renders `[ prefix | value ]`
 * with visually distinct background tones between the two halves, matching
 * GitLab's scoped label design.
 *
 * Non-scoped labels (plain strings without `/`) fall through to a standard
 * single-color badge — but this component itself only handles scoped labels;
 * callers should check `isScopedLabel()` before using it.
 */

/** Palette of scope-prefixed background tints keyed by scope name. */
const SCOPE_TINTS: Record<string, { bg: string; border: string }> = {
  state: { bg: "#4c7bf530", border: "#4c7bf5" },
  priority: { bg: "#f5a62330", border: "#f5a623" },
  kind: { bg: "#7c3aed30", border: "#7c3aed" },
  attention: { bg: "#06b6d430", border: "#06b6d4" },
  review: { bg: "#f9731630", border: "#f97316" },
  spec: { bg: "#05966930", border: "#059669" },
  size: { bg: "#8b5cf630", border: "#8b5cf6" },
  target: { bg: "#ec489930", border: "#ec4899" },
};

/** Default tint when the scope has no explicit entry. */
const DEFAULT_TINT = { bg: "#6b728030", border: "#6b7280" };

/** True when `label` contains a valid scope prefix followed by a value. */
export function isScopedLabel(label: string): boolean {
  const slashIndex = label.indexOf("/");
  if (slashIndex <= 0 || slashIndex + 1 >= label.length) return false;
  const scope = label.slice(0, slashIndex);
  return /^[A-Za-z0-9_.-]+$/.test(scope);
}

interface ScopedLabelChipProps {
  label: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function HostScopedLabelChip({
  label,
  onPress,
  style,
}: ScopedLabelChipProps) {
  const { colors } = useHostTheme();
  const slashIndex = label.indexOf("/");
  const prefix = label.slice(0, slashIndex);
  const suffix = label.slice(slashIndex + 1);
  const tint = SCOPE_TINTS[prefix.toLowerCase()] ?? DEFAULT_TINT;

  const handlePress = (): void => {
    if (onPress) onPress();
  };

  const isWeb = Platform.OS === "web";

  if (isWeb) {
    const webStyle: Record<string, any> = {
      display: "inline-flex",
      alignItems: "center",
      borderRadius: 999,
      overflow: "hidden",
      border: `1px solid ${tint.border}`,
      ...(onPress ? { cursor: "pointer" } : {}),
    };

    return (
      <div
        {...(onPress
          ? {
              role: "button",
              tabIndex: 0,
              "aria-label": label,
              onClick: handlePress,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handlePress();
                }
              },
            }
          : { "aria-label": label })}
        data-testid={`kanban-scoped-label-chip-${label}`}
        style={{ ...webStyle, ...(style as Record<string, any>) }}
      >
        {/* Scope prefix band */}
        <span
          style={{
            backgroundColor: tint.bg,
            color: tint.border,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: "16px",
            whiteSpace: "nowrap",
          }}
        >
          {prefix}
        </span>
        {/* Separator bar */}
        <span
          style={{
            backgroundColor: tint.border,
            width: 1,
            minWidth: 1,
          }}
        />
        {/* Value suffix band */}
        <span
          style={{
            backgroundColor: `${tint.bg}cc`,
            color: tint.border,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: "16px",
            whiteSpace: "nowrap",
          }}
        >
          {suffix}
        </span>
      </div>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[
        { flexDirection: "row", alignItems: "center", borderRadius: 999, overflow: "hidden", borderWidth: 1, borderColor: tint.border },
        ...(Array.isArray(style) ? style : [style]),
      ]}
    >
      {/* Scope prefix band */}
      <Text
        style={{
          backgroundColor: tint.bg,
          color: tint.border,
          paddingHorizontal: 8,
          paddingVertical: 2,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 16,
        }}
      >
        {prefix}
      </Text>
      {/* Separator bar */}
      <View
        style={{
          backgroundColor: tint.border,
          width: 1,
          minWidth: 1,
        }}
      />
      {/* Value suffix band */}
      <Text
        style={{
          backgroundColor: `${tint.bg}cc`,
          color: tint.border,
          paddingHorizontal: 8,
          paddingVertical: 2,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 16,
        }}
      >
        {suffix}
      </Text>
    </Pressable>
  );
}

export { HostScopedLabelChip as ScopedLabelChip };
