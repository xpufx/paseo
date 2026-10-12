/**
 * Presentation layer for `plugins/x-comms`.
 *
 * Every interactive/scrolling primitive (buttons, tabs, toggles, code blocks,
 * modal bodies, ...) now comes from the shared `@xpufx/paseo-plugin-ui` kit
 * (xpufx-org/paseo#1268), following the top (#1259) and mcp-tools (#1255)
 * migrations. The previous bespoke Pressable/ScrollView composition and its
 * conformance exemptions are gone.
 *
 * What remains local is x-comms-specific glue with no raw RN interaction:
 * `usePluginTheme` (static spacing/typography scale over the kit theme),
 * `cardRecipe` (timeline card style recipe) and `ModalContent` (a fluid body
 * for x-comms' own host `<Modal>`).
 */

import React, { useMemo, type ReactNode } from "react";
import { View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { Modal } from "@getpaseo/plugin/client/react-native";
import {
  FALLBACK_COLORS,
  useHostTheme,
  type HostSurfaceVariant,
  type StatusVariant,
  type ThemeColors,
} from "@xpufx/paseo-plugin-ui";

export {
  HostAboutSection as AboutSection,
  HostActionBar as ActionBar,
  HostBadge as Badge,
  HostButton as Button,
  HostCard as Card,
  HostCardHeader as CardHeader,
  HostCodeBlock as CodeBlock,
  HostCollapsible as Collapsible,
  HostEmptyState as EmptyState,
  HostFormRow as FormRow,
  HostInlineButton as InlineButton,
  HostKeyValue as KeyValue,
  HostKeyValueGroup as KeyValueGroup,
  HostModalBody as ModalBody,
  HostRow as Row,
  HostSectionHeader as SectionHeader,
  HostStatusDot as StatusDot,
  HostTabs as Tabs,
  HostTextInput as TextInput,
  HostThemeProvider,
  HostToggle as Toggle,
  useHostTheme,
} from "@xpufx/paseo-plugin-ui";

export type {
  HostAboutSectionProps as AboutSectionProps,
  HostActionBarProps as ActionBarProps,
  HostBadgeProps as BadgeProps,
  HostBadgeSize as BadgeSize,
  HostBadgeStyle as BadgeStyle,
  HostButtonProps as ButtonProps,
  HostButtonSize as ButtonSize,
  HostButtonVariant as ButtonVariant,
  HostCardHeaderProps as CardHeaderProps,
  HostCardProps as CardProps,
  HostCodeBlockProps as CodeBlockProps,
  HostCollapsibleProps as CollapsibleProps,
  HostEmptyStateProps as EmptyStateProps,
  HostFormRowProps as FormRowProps,
  HostInlineButtonProps as InlineButtonProps,
  HostKeyValueGroupProps as KeyValueGroupProps,
  HostKeyValueProps as KeyValueProps,
  HostKeyValueTruncateMode as KeyValueTruncateMode,
  HostModalBodyProps as ModalBodyProps,
  HostRowProps as RowProps,
  HostSectionHeaderProps as SectionHeaderProps,
  HostStatusDotProps as StatusDotProps,
  HostTabItem as TabItem,
  HostTabsProps as TabsProps,
  HostTextInputProps as TextInputProps,
  HostToggleProps as ToggleProps,
} from "@xpufx/paseo-plugin-ui";

// --- theme -----------------------------------------------------------------

interface TypographyToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: "400" | "500" | "600" | "700";
}

const TYPOGRAPHY: Record<
  "title" | "heading" | "body" | "bodyStrong" | "bodySmall" | "caption" | "label",
  TypographyToken
> = {
  title: { fontSize: 16, lineHeight: 22, fontWeight: "600" },
  heading: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  body: { fontSize: 13, lineHeight: 19, fontWeight: "400" },
  bodyStrong: { fontSize: 13, lineHeight: 19, fontWeight: "600" },
  bodySmall: { fontSize: 12, lineHeight: 16, fontWeight: "400" },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: "400" },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
};

const RESOLVE_RADIUS: Record<"xs" | "sm" | "md" | "lg" | "pill", number> = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  pill: 9999,
};

export type SurfaceStyle = HostSurfaceVariant;

export interface XCommsTheme {
  colors: ThemeColors;
  alpha: (color: string, opacity: number) => string;
  getStatusColor: (variant: StatusVariant) => string;
  getVariantPalette: (variant: StatusVariant) => { bg: string; text: string; border: string };
  resolveRadius: (size?: "xs" | "sm" | "md" | "lg" | "pill") => number;
  isCompact: boolean;
  isMobile: boolean;
  touchTargetMin: number;
  padding: { horizontal: number; vertical: number; gap: number };
  typography: typeof TYPOGRAPHY;
  flair: { surfaceStyle: SurfaceStyle; borderWidth: number; headingTransform: "none" | "uppercase" };
}

/**
 * x-comms surfaces read colors from the kit `HostThemeProvider` (mounted with
 * the host `theme` prop at each surface entry) and pin their own static
 * spacing/typography scale.
 */
export function usePluginTheme(): XCommsTheme {
  const host = useHostTheme();
  return useMemo(
    () => ({
      colors: host.colors,
      alpha: host.alpha,
      getStatusColor: host.getStatusColor,
      getVariantPalette: host.getVariantPalette,
      resolveRadius: (size = "md") => RESOLVE_RADIUS[size],
      isCompact: false,
      isMobile: false,
      touchTargetMin: 40,
      padding: { horizontal: 12, vertical: 10, gap: 12 },
      typography: TYPOGRAPHY,
      flair: { surfaceStyle: "flat", borderWidth: 1, headingTransform: "none" },
    }),
    [host],
  );
}

// --- recipes ---------------------------------------------------------------

export interface CardRecipeOptions {
  variant?: SurfaceStyle;
  noPadding?: boolean;
  radius?: number;
  borderWidth?: number;
  compact?: boolean;
}

export interface CardRecipeResult extends ViewStyle {
  card: ViewStyle;
  header: ViewStyle;
  headerTitle: TextStyle;
  headerSubtitle: TextStyle;
}

type ThemeInput = ThemeColors | { colors: ThemeColors } | undefined;

function resolveRecipeColors(input: ThemeInput): ThemeColors {
  if (input && "colors" in input && input.colors) return input.colors;
  if (input && "surface0" in input) return input as ThemeColors;
  return FALLBACK_COLORS;
}

/** Local card style recipe for timeline content. */
export function cardRecipe(themeInput?: ThemeInput, optionsOrVariant?: CardRecipeOptions | SurfaceStyle): CardRecipeResult {
  const colors = resolveRecipeColors(themeInput);
  const options: CardRecipeOptions =
    typeof optionsOrVariant === "string" ? { variant: optionsOrVariant } : optionsOrVariant ?? {};
  const variant = options.variant ?? "flat";
  const compact = Boolean(options.compact);
  const radius = options.radius ?? (compact ? 6 : 8);
  const borderWidth = options.borderWidth ?? 1;

  let bg = colors.surface0;
  let border = colors.border;
  if (variant === "tinted") {
    bg = colors.accent + "0a";
    border = colors.accent + "33";
  } else if (variant === "elevated") {
    bg = colors.surface1;
  }

  const baseCard: ViewStyle = {
    backgroundColor: bg,
    borderColor: border,
    borderWidth,
    borderRadius: radius,
    paddingHorizontal: options.noPadding ? 0 : compact ? 8 : 12,
    paddingVertical: options.noPadding ? 0 : compact ? 6 : 10,
    width: "100%",
    overflow: "hidden",
  };
  return Object.assign({ ...baseCard }, {
    card: { ...baseCard },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: compact ? 4 : 8,
      width: "100%",
      marginBottom: compact ? 4 : 8,
    } as ViewStyle,
    headerTitle: { color: colors.foreground, fontSize: compact ? 13 : 14, fontWeight: "600", lineHeight: compact ? 18 : 20 } as TextStyle,
    headerSubtitle: { color: colors.foregroundMuted, fontSize: compact ? 10 : 11, lineHeight: compact ? 14 : 15, fontWeight: "400" } as TextStyle,
  });
}

// --- modal -----------------------------------------------------------------

export interface ModalContentProps {
  children: ReactNode;
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

/**
 * Fluid content for x-comms' OWN host `<Modal>`. Delegates scroll ownership
 * to the host `<Modal.Content>` so sheet gestures and safe areas keep working;
 * no second scroller is added.
 */
export function ModalContent({ children, scrollable = true, style, contentContainerStyle }: ModalContentProps) {
  return (
    <Modal.Content scrollable={scrollable}>
      <View style={[{ width: "100%" }, style, contentContainerStyle]}>{children}</View>
    </Modal.Content>
  );
}
