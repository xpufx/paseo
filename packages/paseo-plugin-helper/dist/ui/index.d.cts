import React__default, { ReactNode } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
export { H as HelperSettingsCardProps, a as HelperSettingsField, b as HelperSettingsFieldKind, c as HelperSettingsFieldOverrides, d as HelperSettingsInputProps, e as HelperSettingsRowBaseProps, f as HelperSettingsScreenContribution, g as HelperSettingsScreenRegistrar, h as HelperSettingsSectionProps, i as HelperSettingsSelectComponent, j as HelperSettingsSelectProps, k as HelperSettingsSwitchProps, l as HelperSettingsUiBundle, R as RegisterHelperSettingsScreenOptions, m as contractSchemaToFields, r as registerHelperSettingsScreen } from '../settings-screen-Ds1117n-.cjs';
import '../settings-BNRcFeSP.cjs';
import 'zod';
import '../rpc-D27pph91.cjs';
import '../host-Dk97D-ul.cjs';
import '@getpaseo/plugin/client';

/**
 * Host-delegating modal content for `paseo-plugin-helper/ui`.
 *
 * Contract — ONLY for content rendered directly inside your OWN host
 * `<Modal>` (e.g. x-comms style own-modal surfaces):
 * - Scroll ownership stays with the host: renders the injected host
 *   `<Modal.Content>` with its default `scrollable` behavior and adds NO
 *   helper-owned scroller, so sheet gestures, keyboard avoidance, and
 *   safe-area clearance keep working on compact/mobile and desktop alike.
 * - No width opinions: there is deliberately NO `maxContentWidth` /
 *   `size="large"` prop. The host allocates the dialog frame; this wrapper
 *   fills it fluidly (`width: "100%"`).
 * - No theme scraping: colors come from the host `theme` prop via
 *   `PluginThemeProvider`, never from DOM CSS variables.
 * - NEVER render this inside `registerComposerPill` `renderModal`: the pill
 *   host already provides the one `<Modal.Content>` (or no modal at all on
 *   0.8 popovers), so a nested `<Modal.Content>` violates the host contract
 *   and crashes the plugin. Use `HostModalSection` there instead.
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
/**
 * Fluid inner content for pill-embedded modals (`registerComposerPill`
 * `renderModal`).
 *
 * The pill host already provides the one `<Modal.Content>` (legacy/centered
 * modal paths) or no modal at all (0.8 popover path, where the host owns the
 * outer scroll). This renders a plain fluid `<View>` — no `<Modal.Content>`,
 * no scroller, no width caps — so exactly one `<Modal.Content>` exists and
 * nothing nests. Pair with `hostScroll: true` on the pill registration so
 * the wrapper leaves scrolling to the host; without it the wrapper bounds
 * the dialog (`scrollable={false}`) for legacy `ModalBody` content.
 */
declare function HostModalSection({ children, style, }: {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
}): React__default.JSX.Element;

export { HostModalContent, HostModalSection, HostScroll };
