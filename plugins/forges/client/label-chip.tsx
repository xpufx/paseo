import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Badge, usePluginTheme } from "./vendor/paseo-plugin-helper/index";
import { planLabelChip, type ForgeLabel, type LabelChipHalf } from "../shared/issues.js";

/** Inner corners join the halves; the scope's right border becomes the divider. */
function halfEdgeStyle(side: "scope" | "value"): ViewStyle {
  return side === "scope"
    ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 }
    : { borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeftWidth: 0 };
}

function ChipHalf({
  half,
  side,
  ring,
}: {
  half: LabelChipHalf;
  side?: "scope" | "value";
  ring?: StyleProp<ViewStyle>;
}) {
  const filled = Boolean(half.background && half.textColor);
  const fillStyle: ViewStyle = filled
    ? { backgroundColor: half.background, borderColor: half.background }
    : {};
  return (
    <Badge
      variant="neutral"
      styleVariant={filled ? "solid" : "tinted"}
      size="sm"
      label={half.text}
      style={[side ? halfEdgeStyle(side) : undefined, fillStyle, ring]}
      textStyle={filled ? { color: half.textColor } : undefined}
    />
  );
}

/**
 * One Forgejo-style label pill. A scoped name (`scope/value`) always renders as
 * two segments — the scope in a darker shade of the API color, the value in the
 * base color — and never as the raw slash form; without a usable color both
 * segments fall back to the neutral theme chip, still split. Every label
 * surface routes through this component.
 */
export function LabelChip({
  label,
  selected = false,
}: {
  label: ForgeLabel;
  selected?: boolean;
}) {
  const { colors, resolveRadius } = usePluginTheme();
  const ring: StyleProp<ViewStyle> = selected
    ? { borderColor: colors.accent, borderWidth: 2 }
    : undefined;
  const plan = planLabelChip(label);
  if (plan.kind === "single") {
    return <ChipHalf half={plan.half} ring={ring} />;
  }
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignSelf: "flex-start",
          borderRadius: resolveRadius("pill"),
        },
        ring,
      ]}
    >
      <ChipHalf half={plan.scope} side="scope" />
      <ChipHalf half={plan.value} side="value" />
    </View>
  );
}

/** Wrapping row the label lists share; a caller only supplies layout deltas. */
const CHIP_LIST_STYLE: ViewStyle = { flexDirection: "row", flexWrap: "wrap", gap: 4 };

/**
 * The single render path for a list of labels. Surfaces supply only layout, so
 * no site maps its own chips and colors always flow through `planLabelChip`.
 */
export function LabelChipList({
  labels,
  style,
}: {
  labels: readonly ForgeLabel[];
  style?: StyleProp<ViewStyle>;
}) {
  if (labels.length === 0) return null;
  return (
    <View style={[CHIP_LIST_STYLE, style]}>
      {labels.map((label) => (
        <LabelChip key={label.name} label={label} />
      ))}
    </View>
  );
}
