import React from "react";
import { Badge } from "paseo-plugin-helper/client";
import {
  labelTextColor,
  normalizeLabelColor,
  type ForgeLabel,
} from "../shared/issues.js";

/**
 * One Forgejo-style label pill: the API color is the background and the text
 * color is picked by contrast. A label without a usable color degrades to the
 * helper's neutral theme badge.
 */
export function LabelChip({ label }: { label: ForgeLabel }) {
  const background = normalizeLabelColor(label.color);
  if (!background) return <Badge variant="neutral" label={label.name} />;
  const textColor = labelTextColor(label.color);
  return (
    <Badge
      variant="neutral"
      styleVariant="solid"
      label={label.name}
      style={{ backgroundColor: background, borderColor: background }}
      textStyle={textColor ? { color: textColor } : undefined}
    />
  );
}
