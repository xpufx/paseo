/**
 * Paseo Plugin Helper — UI Kit (`paseo-plugin-helper/ui`).
 *
 * Banner that notifies the user when a plugin bundle was reloaded by the
 * daemon.  Renders a styled row with an ⚡ icon, a warning message, and two
 * buttons (Reload / Dismiss).
 */

import React, { type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useHostTheme } from "./theme";
import { spacing } from "./layout";

export interface PluginReloadBannerProps {
  /** Unique plugin identifier (used for reload tracking). */
  pluginId: string;
  /** Optional callback invoked when the user taps Reload. */
  onReload?: () => void;
  /** Optional custom children to render instead of the default content. */
  children?: ReactNode;
  /** Optional inline style override. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Inline banner shown at the top of a plugin view after the daemon has
 * hot-reloaded the plugin bundle.
 *
 * ```tsx
 * <PluginReloadBanner pluginId="my-plugin" onReload={() => queryClient.invalidateQueries()} />
 * ```
 */
export function PluginReloadBanner({
  pluginId,
  onReload,
  children,
  style,
}: PluginReloadBannerProps) {
  const { colors } = useHostTheme();
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  const handleReload = () => {
    onReload?.();
    // Also trigger a full page reload when running in a browser-like host.
    const win = globalThis as any;
    if (typeof win?.location?.reload === "function") {
      win.location.reload();
    }
  };

  return (
    <View style={[styles.container, style]}>
      <View style={styles.content}>
        <Text style={styles.icon}>⚡</Text>
        <Text style={styles.message}>
          {children ?? "Plugin was reloaded on the daemon. Please refresh to load updated views."}
        </Text>
        <View style={styles.actions}>
          {onReload && (
            <Pressable onPress={handleReload} style={[styles.button, styles.reloadButton]}>
              <Text style={styles.buttonText}>Reload</Text>
            </Pressable>
          )}
          <Pressable onPress={() => setDismissed(true)} style={[styles.button, styles.dismissButton]}>
            <Text style={[styles.buttonText, styles.dismissButtonText]}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(210, 153, 34, 0.12)",
    borderBottomWidth: 1,
    borderBottomColor: "#d29922",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  icon: {
    fontSize: 16,
  },
  message: {
    flex: 1,
    fontSize: 13,
    color: "#d29922",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  button: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 4,
  },
  reloadButton: {
    backgroundColor: "#d29922",
  },
  dismissButton: {
    borderWidth: 1,
    borderColor: "#d29922",
  },
  buttonText: {
    fontSize: 12,
    fontWeight: "600",
  },
  dismissButtonText: {
    color: "#d29922",
  },
});
