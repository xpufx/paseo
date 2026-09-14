import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { getClientHost } from "../host";
import { usePluginTheme } from "../theme/provider";
import { copyToClipboard } from "../utils/clipboard";

export interface CommandBoxProps {
  /** argv array — program is rendered bold, args muted */
  argv?: string[];
  /** Optional override to display a pre-joined string instead of argv */
  command?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  /** Accessibility label override for the copy button */
  copyLabel?: string;
}

export function formatCommandLine(argv: string[]): string {
  return argv.map((arg) => (arg.includes(" ") ? JSON.stringify(arg) : arg)).join(" ");
}

export function CommandBox({
  argv = [],
  command,
  style,
  textStyle,
  copyLabel = "Copy command",
}: CommandBoxProps): React.ReactElement | null {
  const { colors, resolveRadius } = usePluginTheme();
  const { Icon, useToast } = getClientHost();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const fullCommand = command ?? formatCommandLine(argv);
  const [prog, ...rest] = argv;

  const handleCopy = async () => {
    if (!fullCommand) return;
    const ok = await copyToClipboard(fullCommand, {
      toast,
      toastMessage: "Command",
    });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fontFamily = Platform.select({
    ios: "Menlo",
    android: "monospace",
    default: "monospace",
  });

  const radius = resolveRadius("sm");

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface2,
          borderColor: colors.border,
          borderRadius: radius,
        },
        style,
      ]}
    >
      <View style={styles.textContainer}>
        <Text
          style={[
            styles.prompt,
            {
              color: colors.statusWarning,
              fontFamily,
            },
          ]}
        >
          $
        </Text>
        <Text
          selectable
          numberOfLines={2}
          style={[
            styles.commandText,
            {
              color: colors.foreground,
              fontFamily,
            },
            textStyle,
          ]}
        >
          {prog ? (
            <>
              <Text style={styles.bold}>{prog}</Text>
              {rest.length > 0 ? (
                <Text style={{ color: colors.foregroundMuted }}>
                  {" " + rest.map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}
                </Text>
              ) : null}
            </>
          ) : (
            command ?? ""
          )}
        </Text>
      </View>
      <Pressable
        onPress={handleCopy}
        accessibilityRole="button"
        accessibilityLabel={copyLabel}
        hitSlop={8}
        style={({ pressed }) => [
          styles.copyButton,
          {
            backgroundColor: pressed ? colors.surface1 : "transparent",
            borderRadius: Math.max(2, radius - 2),
          },
        ]}
      >
        <Icon
          name={copied ? "Check" : "Copy"}
          size={13}
          color={copied ? colors.statusSuccess : colors.foregroundMuted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  textContainer: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    overflow: "hidden",
    gap: 6,
  },
  prompt: {
    fontWeight: "700",
    fontSize: 12,
  },
  commandText: {
    fontSize: 12,
    flex: 1,
  },
  bold: {
    fontWeight: "700",
  },
  copyButton: {
    padding: 4,
    alignItems: "center",
    justifyContent: "center",
  },
});
