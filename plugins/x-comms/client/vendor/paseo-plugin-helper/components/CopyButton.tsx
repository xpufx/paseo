import React, { useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host";
import { usePluginTheme } from "../theme/provider";
import { copyToClipboard } from "../utils/clipboard";

export type CopyButtonSize = "sm" | "md";
export type CopyButtonVariant = "ghost" | "secondary";

export interface CopyButtonFeedback {
  icon: string;
  label: string;
}

/**
 * Pure idle/copied visual state, split out so the feedback contract is
 * testable without a renderer or a clipboard. Callers may override the idle
 * `icon`/`label`; the copied state is always the Check/"Copied!" affordance.
 */
export function resolveCopyButtonFeedback(
  copied: boolean,
  options: { icon?: string; label?: string; copiedLabel?: string } = {},
): CopyButtonFeedback {
  const idleIcon = options.icon ?? "Copy";
  const idleLabel = options.label ?? "Copy";
  const copiedLabel = options.copiedLabel ?? "Copied!";
  return copied ? { icon: "Check", label: copiedLabel } : { icon: idleIcon, label: idleLabel };
}

export interface CopyButtonProps {
  /** Literal text to copy. Ignored when `getText` is provided. */
  text?: string;
  /** Lazy/Promise text source, resolved at press time. Takes precedence over `text`. */
  getText?: () => string | Promise<string>;
  /** Idle button label. Defaults to "Copy". */
  label?: string;
  /** Label shown after a successful copy. Defaults to "Copied!". */
  copiedLabel?: string;
  /** Icon name for the idle state. Defaults to "Copy". */
  icon?: string;
  size?: CopyButtonSize;
  variant?: CopyButtonVariant;
  accessibilityLabel?: string;
  /** Forwarded to the clipboard toast (e.g. "timeline card"). */
  toastMessage?: string;
  /** How long the Check/"Copied!" feedback stays up. Defaults to 2000ms. */
  feedbackDurationMs?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

/**
 * Explicit copy affordance for styled/plugin surfaces.
 *
 * Web's selection-copy handler only rebuilds clipboard content for
 * `[data-testid="assistant-message"]` selections, so styled timeline, telemetry,
 * and panel content copies nothing (xpufx-org/paseo#278). This bypasses that
 * gate with the helper's host `copyText` / `copyToClipboard` path and shows
 * Check/"Copied!" feedback, matching CodeBlock's pattern.
 */
export function CopyButton({
  text,
  getText,
  label,
  copiedLabel,
  icon,
  size = "sm",
  variant = "ghost",
  accessibilityLabel,
  toastMessage,
  feedbackDurationMs = 2000,
  disabled = false,
  style,
  textStyle,
}: CopyButtonProps): React.ReactElement | null {
  const { Icon, useToast } = getClientHost();
  const { colors, resolveRadius, touchTargetMin, alpha } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const hasSource = getText !== undefined || text !== undefined;
  if (!hasSource) return null;

  const feedback = resolveCopyButtonFeedback(copied, { icon, label, copiedLabel });
  const iconNode = (
    <Icon
      name={feedback.icon}
      size={size === "sm" ? 12 : 14}
      color={copied ? colors.statusSuccess : colors.foregroundMuted}
    />
  );

  const secondary = variant === "secondary";
  const bg = secondary ? colors.surface1 : "transparent";
  const border = secondary ? colors.border : "transparent";
  const radius = resolveRadius(size === "sm" ? "sm" : "md");

  const handleCopy = async () => {
    if (disabled) return;
    let value: string | undefined;
    try {
      value = getText ? await getText() : text;
    } catch {
      return;
    }
    if (value === undefined || value === null) return;

    const ok = await copyToClipboard(String(value), { toast, toastMessage });
    if (!ok) return;

    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), feedbackDurationMs);
  };

  return (
    <Pressable
      onPress={handleCopy}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label || "Copy"}
      hitSlop={Math.max(0, (touchTargetMin - 28) / 2)}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: pressed && !disabled ? alpha(colors.surface2, secondary ? 1 : 0.7) : bg,
          borderColor: border,
          borderWidth: border !== "transparent" ? 1 : 0,
          borderRadius: radius,
          paddingVertical: size === "sm" ? 3 : 5,
          paddingHorizontal: size === "sm" ? 8 : 10,
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      {iconNode}
      {feedback.label !== "" ? (
        <Text
          style={[
            styles.text,
            {
              fontSize: size === "sm" ? 11 : 12,
              color: copied ? colors.statusSuccess : colors.foregroundMuted,
            },
            textStyle,
          ]}
        >
          {feedback.label}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  text: {
    fontWeight: "500",
  },
});
