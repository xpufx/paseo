import React, { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView as FallbackScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host";
import { usePluginTheme } from "../theme/provider";
import { spacing } from "../theme/tokens";
import type { BadgeSize } from "./Badge";

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  label?: string;
  /** Compact/pill scale shared with {@link Badge}: `"md"` (default) or `"sm"`. */
  size?: BadgeSize;
  placeholder?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

const OPTION_LIST_MAX_HEIGHT = 216;

interface TriggerCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

// When `measureInWindow` is unavailable or never invokes its callback (node
// test renderers, host shims), the menu still opens anchored to a zeroed box
// rather than swallowing the press.
const FALLBACK_COORDS: TriggerCoords = { x: 0, y: 0, width: 0, height: 0 };

/**
 * Compact single-choice picker sized to sit inside a {@link FormRow}. The
 * closed trigger stays one line tall; opening mounts the menu in a root
 * transparent `<Modal>` overlay portal, so a long list never expands the
 * trigger's parent container, is never clipped by an ancestor
 * `overflow: "hidden"` (Card/Tabs/Modal), and always paints above later
 * siblings regardless of local stacking context.
 */
export function Select({
  value,
  options,
  onValueChange,
  label,
  size = "md",
  placeholder = "Select…",
  disabled = false,
  style,
}: SelectProps) {
  const { Icon } = getClientHost();
  // The option list is mounted in the root modal overlay, so it scrolls with
  // a plain React Native ScrollView — never the host sheet-gesture scroller
  // (#219) and never a scroller owned by the trigger's parent.
  const { colors, resolveRadius, typography, isCompact, touchTargetMin, alpha } =
    usePluginTheme();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<TriggerCoords | null>(null);
  const triggerRef = useRef<View>(null);

  const caption = typography?.caption ?? {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "400" as const,
  };
  const fontSize = size === "sm" ? 10 : caption.fontSize;
  const lineHeight = size === "sm" ? 12 : caption.lineHeight;
  const paddingVertical = size === "sm" ? 3 : 6;
  const paddingHorizontal = size === "sm" ? 8 : 10;
  const iconSize = size === "sm" ? 12 : 14;
  const radius = resolveRadius("md");

  // A free-text value (advanced entry) may not be one of the options; surface
  // it on the trigger rather than masking it behind the placeholder.
  const selected = options.find((option) => option.value === value);
  const display = selected?.label ?? (value ? value : placeholder);
  const canOpen = !disabled && options.length > 0;
  const isOpen = open && canOpen;

  const triggerMinHeight = size === "sm" ? 28 : Math.max(34, touchTargetMin);

  const openAt = (next: TriggerCoords) => {
    setCoords(next);
    setOpen(true);
  };

  const handleToggle = () => {
    if (isOpen) {
      setOpen(false);
      return;
    }

    const node = triggerRef.current;
    // A node/shim without `measureInWindow` (node test renderers, stripped
    // host shims) still opens anchored to a zeroed box rather than swallowing
    // the press (#520).
    if (!node || typeof node.measureInWindow !== "function") {
      openAt(FALLBACK_COORDS);
      return;
    }

    node.measureInWindow((x, y, width, height) => {
      openAt({ x, y, width, height });
    });
  };

  return (
    <View style={[styles.container, style]}>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${display}` : display}
        accessibilityState={{ expanded: isOpen, disabled }}
        disabled={!canOpen}
        onPress={handleToggle}
        style={({ pressed }) => [
          styles.trigger,
          {
            minHeight: triggerMinHeight,
            borderRadius: radius,
            borderColor: isOpen ? colors.accent : colors.border,
            backgroundColor:
              disabled || !canOpen
                ? alpha(colors.surface1, 0.5)
                : pressed
                  ? colors.surface2
                  : colors.surface0,
            paddingVertical,
            paddingHorizontal,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.triggerText,
            {
              color: disabled || !canOpen ? colors.foregroundMuted : colors.foreground,
              fontSize,
              lineHeight,
              fontWeight: selected ? "600" : "500",
            },
          ]}
        >
          {display}
        </Text>
        <Icon
          name={isOpen ? "ChevronUp" : "ChevronDown"}
          size={iconSize}
          color={colors.foregroundMuted}
        />
      </Pressable>

      {isOpen && coords ? (
        <Modal
          transparent
          visible={isOpen}
          animationType="none"
          onRequestClose={() => setOpen(false)}
        >
          <TouchableWithoutFeedback
            accessibilityRole="button"
            accessibilityLabel="Dismiss options"
            onPress={() => setOpen(false)}
          >
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <View
            style={[
              styles.overlayList,
              {
                top: coords.y + coords.height + spacing.xs,
                left: coords.x,
                minWidth: coords.width,
                borderRadius: radius,
                borderColor: colors.border,
                backgroundColor: colors.surface0,
              },
            ]}
          >
            <FallbackScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: OPTION_LIST_MAX_HEIGHT }}
            >
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: isSelected }}
                    onPress={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        paddingVertical,
                        paddingHorizontal,
                        backgroundColor: isSelected
                          ? colors.surface2
                          : pressed
                            ? alpha(colors.surface2, 0.5)
                            : "transparent",
                      },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.optionText,
                        {
                          color: isSelected ? colors.foreground : colors.foregroundMuted,
                          fontSize: isCompact ? fontSize : fontSize + 1,
                          lineHeight,
                          fontWeight: isSelected ? "600" : "400",
                        },
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </FallbackScrollView>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
  },
  triggerText: {
    flexShrink: 1,
    minWidth: 0,
  },
  overlayList: {
    position: "absolute",
    borderWidth: 1,
    overflow: "hidden",
    elevation: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  option: {},
  optionText: {
    flexShrink: 1,
    minWidth: 0,
  },
});
