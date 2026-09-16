import React from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Badge, usePluginTheme } from "paseo-plugin-helper/client";
import { planLabelChip, type ForgeLabel } from "../shared/issues.js";

/**
 * One Forgejo-style label pill. A scoped name (`scope/value`) renders as a
 * two-tone pill: the scope half in a darker shade of the API color, the value
 * half in the base color, both sharing the WCAG contrast text color. A label
 * without a usable color degrades to the helper's neutral theme badge.
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

  if (plan.kind === "neutral") {
    return <Badge variant="neutral" label={plan.label} style={ring} />;
  }

  if (plan.kind === "solid") {
    return (
      <Badge
        variant="neutral"
        styleVariant="solid"
        label={plan.label}
        style={[{ backgroundColor: plan.background, borderColor: plan.background }, ring]}
        textStyle={{ color: plan.textColor }}
      />
    );
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
      <Badge
        variant="neutral"
        styleVariant="solid"
        label={plan.scope}
        style={{
          backgroundColor: plan.scopeBackground,
          borderColor: plan.scopeBackground,
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
          borderRightWidth: 0,
        }}
        textStyle={{ color: plan.textColor }}
      />
      <Badge
        variant="neutral"
        styleVariant="solid"
        label={plan.value}
        style={{
          backgroundColor: plan.valueBackground,
          borderColor: plan.valueBackground,
          borderTopLeftRadius: 0,
          borderBottomLeftRadius: 0,
          borderLeftWidth: 0,
        }}
        textStyle={{ color: plan.textColor }}
      />
    </View>
  );
}
