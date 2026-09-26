import React, { useCallback, useState, type ReactNode } from "react";
import {
  Pressable,
  type AccessibilityRole,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { usePluginTheme } from "../theme/provider.js";

export interface InteractiveRowProps {
  /** Arbitrary row content — status dots, badges, text, metric readouts. */
  children?: ReactNode;
  /**
   * Press handler. Receives the raw event so callers can control propagation
   * (e.g. a nested status light calling `event.stopPropagation()`).
   */
  onPress?: (event: GestureResponderEvent) => void;
  /** Native / RN-web tooltip text attached to the hit area. */
  title?: string;
  disabled?: boolean;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  /** Base layout style, merged before the interaction layers. */
  style?: StyleProp<ViewStyle>;
  /** Extra style layered only while hovered (and not disabled). */
  hoverStyle?: StyleProp<ViewStyle>;
  /** Apply a subtle theme accent tint while hovered. Default: false. */
  hoverTint?: boolean;
  /** Accent opacity used by `hoverTint`. Default: 0.05. */
  hoverTintOpacity?: number;
  /** Opacity while pressed. Default: 0.7. */
  pressedOpacity?: number;
  /** Opacity while hovered but not pressed. Defaults to `opacity`. */
  hoveredOpacity?: number;
  /** Opacity at rest. Default: 1. */
  opacity?: number;
  /** Opacity when disabled. Default: 0.45. */
  disabledOpacity?: number;
  /** Expanded touch target beyond the visual bounds. */
  hitSlop?: number;
  /** Notified whenever the hover state flips, for callers that tint their own children. */
  onHoverChange?: (hovered: boolean) => void;
}

/**
 * Hover-aware, pressable row container for dense interactive content (#580).
 *
 * Owns the interaction concerns a labeled `Button` cannot: a hover state (with
 * optional accent tint), an RN-web `title` tooltip, pressed opacity, a pointer
 * cursor, and an `onPress` that forwards the event for `stopPropagation`.
 * Content is arbitrary, so a status dot, badges, and metric readouts compose
 * inside without wrapping each in its own control.
 */
export function InteractiveRow({
  children,
  onPress,
  title,
  disabled = false,
  accessibilityRole,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
  hoverStyle,
  hoverTint = false,
  hoverTintOpacity = 0.05,
  pressedOpacity = 0.7,
  hoveredOpacity,
  opacity = 1,
  disabledOpacity = 0.45,
  hitSlop,
  onHoverChange,
}: InteractiveRowProps) {
  const { colors, alpha } = usePluginTheme();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const handleMouseEnter = useCallback(() => {
    if (disabled) return;
    setHovered(true);
    onHoverChange?.(true);
  }, [disabled, onHoverChange]);

  const handleMouseLeave = useCallback(() => {
    setHovered(false);
    onHoverChange?.(false);
  }, [onHoverChange]);

  // `title` is an RN-web DOM passthrough absent from the native prop types, and
  // `onMouseEnter`/`onMouseLeave` are the RN-web hover hooks the dense rows
  // already relied on; attach both via an untyped spread to keep the runtime
  // semantics identical to the hand-rolled rows (#580).
  const webProps = {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    ...(title ? { title } : {}),
  } as any;

  const interactive = hovered && !disabled;
  const hoverBackground = interactive && hoverTint
    ? { backgroundColor: alpha(colors.accent, hoverTintOpacity) }
    : null;
  const restingOpacity = interactive ? (hoveredOpacity ?? opacity) : opacity;

  return (
    <Pressable
      {...webProps}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityRole={accessibilityRole ?? (onPress ? "button" : undefined)}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      testID={testID}
      hitSlop={hitSlop}
      style={[
        { cursor: onPress && !disabled ? "pointer" : "auto" },
        // A pressable wraps arbitrary content (titles, badges, metric readouts)
        // and must never widen its parent: Yoga defaults `flexShrink` to 0, so
        // without a shrink budget a long label forces the whole row past the
        // viewport. Declared before `style` so callers can still override.
        { flexShrink: 1, maxWidth: "100%" },
        style,
        hoverBackground,
        interactive ? hoverStyle : null,
        {
          opacity: disabled
            ? disabledOpacity
            : pressed
              ? pressedOpacity
              : restingOpacity,
        },
      ]}
    >
      {children}
    </Pressable>
  );
}
