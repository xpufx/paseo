import React from "react";
import { Text } from "react-native";
import { Badge } from "./vendor/paseo-plugin-helper/index";

/** Shared label for the cross-repo marker, so every surface reads the same. */
export const FOREIGN_LINK_LABEL = "foreign";

/** Accessible description of the marker for pressable link rows. */
export const FOREIGN_LINK_HINT = "Points at a different forge repo";

/** Compact `foreign` badge for a link row laid out with flexbox. */
export function ForeignLinkBadge() {
  return (
    <Badge
      variant="warning"
      styleVariant="outline"
      icon="Globe"
      label={FOREIGN_LINK_LABEL}
    />
  );
}

/**
 * Inline `foreign` marker for a link rendered inside a <Text> (markdown
 * spans). Purely additive: the link keeps its own navigation handler.
 */
export function ForeignInlineMark({ color }: { color: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: "700", color }}>
      {` ${FOREIGN_LINK_LABEL}`}
    </Text>
  );
}
