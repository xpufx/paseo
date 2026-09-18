import React__default, { ReactNode } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
export { H as HelperSettingsCardProps, a as HelperSettingsField, b as HelperSettingsFieldKind, c as HelperSettingsFieldOverrides, d as HelperSettingsInputProps, e as HelperSettingsRowBaseProps, f as HelperSettingsScreenContribution, g as HelperSettingsScreenRegistrar, h as HelperSettingsSectionProps, i as HelperSettingsSelectComponent, j as HelperSettingsSelectProps, k as HelperSettingsSwitchProps, l as HelperSettingsUiBundle, R as RegisterHelperSettingsScreenOptions, m as contractSchemaToFields, r as registerHelperSettingsScreen } from '../settings-screen-V3oRvE_U.js';
import '../settings-CP1gv9q3.js';
import 'zod';
import '../rpc-D27pph91.js';
import '../host-DatQ2QJE.js';

/**
 * Host-delegating modal content for `paseo-plugin-helper/ui`.
 *
 * Contract (the opposite of legacy `client/ModalContent`):
 * - Scroll ownership stays with the host: renders the injected host
 *   `<Modal.Content>` with its default `scrollable` behavior and adds NO
 *   helper-owned scroller, so sheet gestures, keyboard avoidance, and
 *   safe-area clearance keep working on compact/mobile and desktop alike.
 * - No width opinions: there is deliberately NO `maxContentWidth` /
 *   `size="large"` prop. The host allocates the dialog frame; this wrapper
 *   fills it fluidly (`width: "100%"`).
 * - No theme scraping: colors come from the host `theme` prop via
 *   `PluginThemeProvider`, never from DOM CSS variables.
 *
 * Use this for modal contexts. For host surfaces that supply NO scroller
 * (sidebar surfaces, settings screens), render the host `ScrollView`
 * explicitly via `HostScroll` below instead.
 */
declare function HostModalContent({ children, style, contentContainerStyle, }: {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
}): React__default.JSX.Element;
/**
 * Explicit single scroll owner for surfaces where the host supplies NO
 * scroller (sidebar surfaces, settings screens). Prefers the injected host
 * ScrollView (sheet-gesture integrated on Paseo v0.8) and falls back to plain
 * React Native ScrollView. Callers own the decision to scroll; this component
 * never nests itself inside another scroller.
 */
declare function HostScroll({ children, style, contentContainerStyle, }: {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
}): React__default.JSX.Element;

export { HostModalContent, HostScroll };
