import React, { useRef, type ComponentType, type ReactNode, type Ref } from "react";
import {
  RefreshControl,
  ScrollView as FallbackScrollView,
  StyleSheet,
  View,
  type ScrollView as ScrollViewInstance,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { getOptionalClientHost, selectHostScrollView, type HostScrollView } from "../host.js";
import { usePluginTheme } from "../theme/provider.js";

export interface ModalBodyProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  extraBottomInset?: number;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  stickToEnd?: boolean;
  scrollRef?: Ref<ScrollViewInstance>;
}

/**
 * Mobile-safe scrollable body for Paseo <Modal.Content>.
 * Automatically calculates responsive bottom padding so controls are not cut off
 * by mobile home bars or virtual keyboards.
 * Supports pull-to-refresh on mobile via `refreshing` and `onRefresh`.
 * Uses the host ScrollView from initClientHelpers when supplied (sheet-gesture
 * integrated on Paseo v0.8), otherwise plain React Native ScrollView.
 * Pass `stickToEnd` for conversation-style views that track new content, or
 * `scrollRef` for imperative scrolling.
 */
export function ModalBody({
  children,
  style,
  contentContainerStyle,
  extraBottomInset = 0,
  refreshing = false,
  onRefresh,
  stickToEnd = false,
  scrollRef,
}: ModalBodyProps) {
  const { isCompact, padding, colors } = usePluginTheme();
  const hostScrollView = getOptionalClientHost()?.ScrollView;
  const ResolvedScrollView = selectHostScrollView(
    getOptionalClientHost(),
    FallbackScrollView as unknown as HostScrollView,
  );
  const innerRef = useRef<ScrollViewInstance>(null);

  const setRefs = (node: ScrollViewInstance | null) => {
    (innerRef as { current: ScrollViewInstance | null }).current = node;
    if (typeof scrollRef === "function") {
      scrollRef(node);
    } else if (scrollRef) {
      (scrollRef as { current: ScrollViewInstance | null }).current = node;
    }
  };

  // On mobile/compact, we reserve generous bottom padding to clear navigation bars
  const bottomPadding = (isCompact ? 48 : 20) + extraBottomInset;

  const refreshControl = onRefresh ? (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={colors.accent}
      colors={[colors.accent]}
    />
  ) : undefined;

  // Compact without an injected host scroller keeps the legacy plain View:
  // on pre-0.8 hosts the sheet already scrolls, and a nested RN ScrollView
  // would fight it. With a host scroller present, use it: it cooperates
  // with sheet gestures by design.
  if (isCompact && !hostScrollView) {
    return (
      <View
        style={[
          styles.content,
          {
            backgroundColor: colors.surface0,
            paddingHorizontal: padding.horizontal,
            paddingTop: padding.vertical,
            paddingBottom: bottomPadding,
            gap: padding.gap,
          },
          style,
          contentContainerStyle,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <ResolvedScrollView
      ref={setRefs}
      style={[{ backgroundColor: colors.surface0 }, styles.container, style]}
      nestedScrollEnabled={true}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
      refreshControl={refreshControl}
      onContentSizeChange={
        stickToEnd ? () => innerRef.current?.scrollToEnd({ animated: true }) : undefined
      }
      contentContainerStyle={[
        styles.content,
        {
          paddingHorizontal: padding.horizontal,
          paddingTop: padding.vertical,
          paddingBottom: bottomPadding,
          gap: padding.gap,
        },
        contentContainerStyle,
      ]}
    >
      {children}
    </ResolvedScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: "100%",
  },
  content: {
    flexGrow: 1,
    width: "100%",
    maxWidth: "100%",
  },
});
