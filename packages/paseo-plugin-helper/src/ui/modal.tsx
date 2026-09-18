import React, { type ReactNode } from "react";
import {
  ScrollView as FallbackScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  getClientHost,
  getOptionalClientHost,
  selectHostScrollView,
  type HostScrollView,
} from "../client/host.js";

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
export function HostModalContent({
  children,
  style,
  contentContainerStyle,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const { Modal } = getClientHost();
  return (
    <Modal.Content>
      <View style={[styles.fluid, style, contentContainerStyle]}>{children}</View>
    </Modal.Content>
  );
}

/**
 * Explicit single scroll owner for surfaces where the host supplies NO
 * scroller (sidebar surfaces, settings screens). Prefers the injected host
 * ScrollView (sheet-gesture integrated on Paseo v0.8) and falls back to plain
 * React Native ScrollView. Callers own the decision to scroll; this component
 * never nests itself inside another scroller.
 */
export function HostScroll({
  children,
  style,
  contentContainerStyle,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const ResolvedScrollView = selectHostScrollView(
    getOptionalClientHost(),
    FallbackScrollView as unknown as HostScrollView,
  );
  return (
    <ResolvedScrollView style={[styles.fluid, style]} contentContainerStyle={contentContainerStyle}>
      {children}
    </ResolvedScrollView>
  );
}

const styles = StyleSheet.create({
  fluid: {
    width: "100%",
  },
});
