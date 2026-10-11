/**
 * Re-export the shared UI composition package for `plugins/slash`
 * (xpufx-org/paseo#976, #1218, #1233).
 *
 * All host-delegating cards, buttons, badges, inputs, form rows, action bars,
 * tabs, collapsibles, and theme providers come directly from `@xpufx/paseo-plugin-ui`.
 */

export {
  HostActionBar,
  HostBadge,
  HostButton,
  HostCard,
  HostCardHeader,
  HostCollapsible,
  HostEmptyState,
  HostFormRow,
  HostRow,
  HostScroll,
  HostSectionHeader,
  HostSelect,
  HostStack,
  HostTabs,
  HostTextInput,
  HostThemeProvider,
  HostToggle,
  useHostLayout,
  useHostTheme,
} from "@xpufx/paseo-plugin-ui";

export type {
  HostActionBarProps,
  HostBadgeProps,
  HostBadgeStyle,
  HostButtonProps,
  HostButtonSize,
  HostButtonVariant,
  HostCardHeaderProps,
  HostCardProps,
  HostCollapsibleProps,
  HostEmptyStateProps,
  HostFormRowProps,
  HostRowProps,
  HostScrollProps,
  HostSectionHeaderProps,
  HostSelectOption,
  HostSelectProps,
  HostStackProps,
  HostSurfaceVariant,
  HostTabItem,
  HostTabsProps,
  HostTextInputProps,
  HostThemeProviderProps,
  HostToggleProps,
  PluginTheme,
  ThemeColors,
} from "@xpufx/paseo-plugin-ui";

/** Static spacing scale shared by the console layout. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;
