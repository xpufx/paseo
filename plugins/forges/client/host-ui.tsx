import React from "react";
import { Image, Platform, type ImageStyle, type StyleProp } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  forgeMarkSource,
  resolveForgeMark,
  type ForgeMarkInput,
} from "paseo-plugin-helper/shared";
import {
  HostActionBar as ActionBar,
  type HostActionBarProps as ActionBarProps,
  HostBadge as Badge,
  type HostBadgeProps as BadgeProps,
  type HostBadgeSize as BadgeSize,
  type HostBadgeStyle as BadgeStyle,
  HostButton as Button,
  type HostButtonProps as ButtonProps,
  type HostButtonSize as ButtonSize,
  type HostButtonVariant as ButtonVariant,
  HostCard as Card,
  type HostCardProps as CardProps,
  HostCardHeader as CardHeader,
  type HostCardHeaderProps as CardHeaderProps,
  type HostSurfaceVariant as SurfaceVariant,
  HostCodeBlock as CodeBlock,
  type HostCodeBlockProps as CodeBlockProps,
  HostCollapsible as Collapsible,
  type HostCollapsibleProps as CollapsibleProps,
  HostCommandBox as CommandBox,
  type HostCommandBoxProps as CommandBoxProps,
  HostCopyButton as CopyButton,
  type HostCopyButtonProps as CopyButtonProps,
  HostEmptyState as EmptyState,
  type HostEmptyStateProps as EmptyStateProps,
  HostFormRow as FormRow,
  type HostFormRowProps as FormRowProps,
  HostHighlightedText as HighlightedText,
  type HostHighlightedTextProps as HighlightedTextProps,
  HostInlineButton as InlineButton,
  type HostInlineButtonProps as InlineButtonProps,
  HostKeyValue as KeyValue,
  type HostKeyValueProps as KeyValueProps,
  HostKeyValueGroup as KeyValueGroup,
  type HostKeyValueGroupProps as KeyValueGroupProps,
  HostModalBody,
  type HostModalBodyProps,
  HostScroll,
  type HostScrollProps,
  HostSearchInput as SearchInput,
  type HostSearchInputProps as SearchInputProps,
  type HostTabItem as TabItem,
  HostTabs as Tabs,
  type HostTabsProps as TabsProps,
  HostTextInput as TextInput,
  type HostTextInputProps as TextInputProps,
  HostThemeProvider,
  HostToggle as Toggle,
  type HostToggleProps as ToggleProps,
  type ScrollViewInstance,
  useHostTheme,
} from "@xpufx/paseo-plugin-ui";

export {
  ActionBar,
  type ActionBarProps,
  Badge,
  type BadgeProps,
  type BadgeSize,
  type BadgeStyle,
  Button,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
  Card,
  type CardProps,
  CardHeader,
  type CardHeaderProps,
  type SurfaceVariant,
  CodeBlock,
  type CodeBlockProps,
  Collapsible,
  type CollapsibleProps,
  CommandBox,
  type CommandBoxProps,
  CopyButton,
  type CopyButtonProps,
  EmptyState,
  type EmptyStateProps,
  FormRow,
  type FormRowProps,
  HighlightedText,
  type HighlightedTextProps,
  HostModalBody,
  type HostModalBodyProps,
  HostScroll,
  type HostScrollProps,
  HostThemeProvider,
  InlineButton,
  type InlineButtonProps,
  KeyValue,
  type KeyValueProps,
  KeyValueGroup,
  type KeyValueGroupProps,
  type ScrollViewInstance,
  SearchInput,
  type SearchInputProps,
  type TabItem,
  Tabs,
  type TabsProps,
  TextInput,
  type TextInputProps,
  Toggle,
  type ToggleProps,
  useHostTheme,
};

// --- forge mark ------------------------------------------------------------

export interface ForgeIconProps extends ForgeMarkInput {
  size?: number;
  color?: string;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}

/** Host-resolved forge brand mark, over the shared resolver. */
export function ForgeIcon({
  host,
  kind,
  size = 16,
  color,
  style,
  accessibilityLabel,
}: ForgeIconProps) {
  const { colors } = useHostTheme();
  const markColor = color ?? colors.foreground;
  const mark = resolveForgeMark({ host, kind });
  const source =
    mark.custom && Platform.OS === "web" ? forgeMarkSource(mark.kind, markColor) : null;
  if (!source) {
    return <Icon name={mark.lucideName} size={size} color={markColor} />;
  }
  return (
    <Image
      accessibilityLabel={accessibilityLabel ?? mark.label}
      accessibilityRole="image"
      accessible
      source={source}
      style={[{ width: size, height: size }, style as StyleProp<ImageStyle>]}
    />
  );
}
