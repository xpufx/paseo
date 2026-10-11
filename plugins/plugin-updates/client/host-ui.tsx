/**
 * Re-export the shared UI composition package for `plugins/plugin-updates`
 * (xpufx-org/paseo#976, #1218, #1220).
 *
 * All host-delegating cards, buttons, badges, theme providers and templates
 * come directly from `@xpufx/paseo-plugin-ui`. Local styling is kept to static text
 * metrics only.
 */

export {
  HostBadge,
  HostButton,
  HostCard,
  HostCardHeader,
  HostEmptyState,
  HostKeyValue,
  HostKeyValueGroup,
  HostProgressBar,
  HostRow,
  HostScroll,
  HostSectionHeader,
  HostStack,
  HostStatusDot,
  HostThemeProvider,
  ListActionPageTemplate,
  useHostLayout,
  useHostTheme,
} from "@xpufx/paseo-plugin-ui";

/** Static text metrics for local text styling. */
export const typography = {
  heading: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const },
  body: { fontSize: 13, lineHeight: 19, fontWeight: "400" as const },
  bodyStrong: { fontSize: 13, lineHeight: 19, fontWeight: "600" as const },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: "400" as const },
} as const;

/** Fluid popover padding. */
export const popoverPadding = { horizontal: 12, vertical: 8, gap: 8 } as const;
