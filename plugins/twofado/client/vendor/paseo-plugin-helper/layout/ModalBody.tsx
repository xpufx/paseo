import React, {
  createContext,
  useContext,
  useRef,
  type ComponentType,
  type ReactNode,
  type Ref,
} from "react";
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
import { getOptionalClientHost, selectHostScrollView, type HostScrollView } from "../host";
import { usePluginTheme } from "../theme/provider";

export interface ModalBodyProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  header?: ReactNode;
  headerStyle?: StyleProp<ViewStyle>;
  /**
   * "scroll" (default): header renders INSIDE the helper-owned compact/mobile
   * ScrollView and moves with content. "pinned": header renders above that
   * compact/mobile scroller; on desktop the host remains the scroll owner.
   */
  headerMode?: "pinned" | "scroll";
  /**
   * When set, ModalBody logs measured layout values (viewport height,
   * content height) via onLayout/onContentSizeChange under this tag, e.g.
   * `[ModalBody:mcp] viewport=… content=…`. Use on-device to see which
   * container actually scrolls instead of guessing from theory (#110).
   */
  debugTag?: string;
  extraBottomInset?: number;
  refreshing?: boolean;
  onRefresh?: () => void | Promise<void>;
  stickToEnd?: boolean;
  scrollRef?: Ref<ScrollViewInstance>;
}

export const ModalBodyScrollOwnerContext = createContext<"helper" | "host">("helper");

/**
 * Mobile-safe scrollable body for Paseo <Modal.Content>.
 * Scroll ownership: ordinary compact/mobile modal content uses this helper
 * scroller. A 0.8 composer popover is different: Paseo's MenuSurface already
 * supplies the sole outer scroller, and registerComposerPill marks that
 * subtree through ModalBodyScrollOwnerContext so this component renders plain
 * content instead.
 * "pinned" is opt-in. Desktop surfaces retain host-owned scrolling so they do
 * not create a second scrollbar; web hosts pin the header with sticky layout.
 * Automatically calculates responsive bottom padding so controls are not cut off
 * by mobile home bars or virtual keyboards.
 * Supports pull-to-refresh on mobile via `refreshing` and `onRefresh`.
 * Uses the host ScrollView from initClientHelpers when supplied (sheet-gesture
 * integrated on Paseo v0.8), otherwise plain React Native ScrollView.
 * Pass `stickToEnd` for conversation-style views that track new content, or
 * `scrollRef` for imperative scrolling.
 * Pass `header` for a pinned navbar (e.g. <Tabs>): it renders above the
 * scroller in a flex column, so the header stays fixed while the body scrolls.
 * Requires the host <Modal.Content scrollable={false}> so no outer sheet
 * scroller drags the header along.
 */
export function ModalBody({
  children,
  style,
  contentContainerStyle,
  header,
  headerStyle,
  headerMode = "scroll",
  debugTag,
  extraBottomInset = 0,
  refreshing = false,
  onRefresh,
  stickToEnd = false,
  scrollRef,
}: ModalBodyProps) {
  const { isCompact, isMobile, layout, padding, colors } = usePluginTheme();
  const hostOwnsScroll = useContext(ModalBodyScrollOwnerContext) === "host";
  const helperOwnsScroll = !hostOwnsScroll && (isCompact || isMobile);
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

  // Compact without an injected host scroller still scrolls via the plain
  // fallback: the helper pill sets <Modal.Content scrollable={false}>, so no
  // outer sheet scroller fights the inner one.
  const log = debugTag
    ? (kind: string, v: Record<string, unknown>) =>
        // eslint-disable-next-line no-console
        console.log(`[ModalBody:${debugTag}] ${kind}`, JSON.stringify(v))
    : undefined;
  const scrollBody = (
    <ResolvedScrollView
      ref={setRefs}
      style={[{ backgroundColor: colors.surface0 }, styles.container, style]}
      nestedScrollEnabled={true}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={true}
      refreshControl={refreshControl}
      onLayout={
        log
          ? (e: { nativeEvent: { layout: { height: number; width: number } } }) =>
              log("viewport", e.nativeEvent.layout)
          : undefined
      }
      onContentSizeChange={(w: number, h: number) => {
        log?.("content", { width: w, height: h });
        if (stickToEnd) innerRef.current?.scrollToEnd({ animated: true });
      }}
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

  const stickyHeaderStyle =
    headerMode === "pinned" && layout.platform === "web"
      ? ({
          position: "sticky",
          top: 0,
          zIndex: 10,
          backgroundColor: colors.surface0,
        } as unknown as ViewStyle)
      : undefined;
  const plainBody = (
    <View style={[styles.plainBody, style]}>
      {header ? (
        <View style={[styles.header, stickyHeaderStyle, headerStyle]}>{header}</View>
      ) : null}
      <View
        style={[
          styles.plainContent,
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
      </View>
    </View>
  );

  if (!helperOwnsScroll) return plainBody;
  if (!header) return scrollBody;

  // "scroll" keeps the header in the content flow for compact/mobile hosts.
  // "pinned" is handled below with a helper-owned scroller on every platform.
  if (headerMode === "scroll") {
    return (
      <ResolvedScrollView
        ref={setRefs}
        style={[{ backgroundColor: colors.surface0 }, styles.container, style]}
        nestedScrollEnabled={true}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
        refreshControl={refreshControl}
        onLayout={
          log
            ? (e: { nativeEvent: { layout: { height: number; width: number } } }) =>
                log("viewport", e.nativeEvent.layout)
            : undefined
        }
        onContentSizeChange={(w: number, h: number) => {
          log?.("content", { width: w, height: h });
          if (stickToEnd) innerRef.current?.scrollToEnd({ animated: true });
        }}
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
        <View style={[styles.header, headerStyle]}>{header}</View>
        {children}
      </ResolvedScrollView>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, headerStyle]}>{header}</View>
      {scrollBody}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  header: {
    width: "100%",
    flexShrink: 0,
  },
  plainBody: {
    flex: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: "100%",
  },
  plainContent: {
    flexGrow: 1,
    minHeight: 0,
    width: "100%",
    maxWidth: "100%",
  },
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
