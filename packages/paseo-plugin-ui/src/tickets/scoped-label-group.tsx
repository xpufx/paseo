import React from "react";
import { Text, type StyleProp, type ViewStyle } from "react-native";
import {
  shortLabelName,
  type ForgeLabel,
} from "@xpufx/backend-tickets/client";
import {
  HostButton,
  HostRow,
  HostStack,
} from "../index.js";
import { useHostTheme } from "../theme-context.js";

export interface HostScopedLabelGroupProps {
  title: string;
  labels: readonly ForgeLabel[];
  active: string | null;
  pending?: boolean;
  onSelect: (label: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function HostScopedLabelGroup({
  title,
  labels,
  active,
  pending = false,
  onSelect,
  style,
}: HostScopedLabelGroupProps) {
  const { colors } = useHostTheme();

  return (
    <HostStack gap="xxs" style={[{ marginVertical: 2 }, style]}>
      <Text
        style={{
          color: colors.foregroundMuted,
          fontWeight: "600",
          fontSize: 11,
          lineHeight: 14,
        }}
      >
        {title}
      </Text>
      <HostRow wrap gap="xxs">
        {labels.map((label) => (
          <HostButton
            key={label.name}
            onPress={() => onSelect(label.name)}
            disabled={pending}
            accessibilityLabel={shortLabelName(label.name)}
            size="sm"
            variant={active === label.name ? "primary" : "ghost"}
            label={shortLabelName(label.name)}
          />
        ))}
      </HostRow>
    </HostStack>
  );
}

export { HostScopedLabelGroup as ScopedLabelGroup };
