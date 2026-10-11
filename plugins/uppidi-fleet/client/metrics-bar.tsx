import React from "react";
import { Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { InteractiveRow, Row } from "./host-ui.js";

export interface MetricsBarChip {
  id: string;
  label: string;
  count: number;
  icon: string;
  /**
   * Theme tone for the icon while the count is positive. Omitted keeps the
   * icon muted at every count.
   */
  tone?: "statusWarning" | "statusSuccess" | "statusDanger" | "accent";
  /** Keep the icon tone even when the count is zero. */
  alwaysToned?: boolean;
  /**
   * Theme tone for the count while it is positive. Omitted keeps the count
   * at the default foreground color.
   */
  countTone?: "statusWarning" | "statusSuccess" | "statusDanger" | "accent";
}

export interface MetricsBarProps {
  chips: MetricsBarChip[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  colors: any;
  typography: any;
  /** Chip ids hidden while their count is zero (e.g. the "failed" critical). */
  hideZeroIds?: readonly string[];
  /** Extra controls rendered after the chips (repo indicator, buttons, search). */
  children?: React.ReactNode;
}

/**
 * Shared metrics bar for the Work Queue and Agents & Fleet surfaces (#645).
 *
 * The operator rejected the first Agents & Fleet state bar for not *looking*
 * like the Work Queue one, so the container fill, border, radius, padding and
 * the icon / muted-label / bold-count chip anatomy live here once. Both
 * surfaces pass their own chips and controls; a test pins the shared values so
 * the two cannot drift apart again.
 */
export function MetricsBar({
  chips,
  selectedId,
  onSelect,
  colors,
  typography,
  hideZeroIds = [],
  children,
}: MetricsBarProps) {
  return (
    <Row
      wrap
      gap="xs"
      align="center"
      style={{
        backgroundColor: colors.surface1,
        paddingHorizontal: 6,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      {chips.map((chip) => {
        if (chip.count === 0 && hideZeroIds.includes(chip.id)) return null;
        const selected = selectedId === chip.id;
        const toned = Boolean(chip.tone) && (chip.count > 0 || chip.alwaysToned);
        const iconColor = toned ? colors[chip.tone!] : colors.foregroundMuted;
        const countColor =
          chip.countTone && chip.count > 0 ? colors[chip.countTone] : colors.foreground;
        return (
          <React.Fragment key={chip.id}>
            <InteractiveRow
              onPress={() => onSelect?.(chip.id)}
              accessibilityRole="button"
              accessibilityLabel={`Filter ${chip.label}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 4,
                backgroundColor: selected ? colors.surface2 : "transparent",
              }}
              pressedOpacity={0.7}
            >
              <Icon name={chip.icon} size={13} color={iconColor} />
              <Text style={{ color: colors.foregroundMuted, ...typography.caption, fontSize: 11 }}>
                {chip.label}:
              </Text>
              <Text style={{ color: countColor, fontWeight: "700", fontSize: 12 }}>
                {chip.count}
              </Text>
            </InteractiveRow>
            <View style={{ width: 1, height: 14, backgroundColor: colors.border }} />
          </React.Fragment>
        );
      })}
      {children}
    </Row>
  );
}
