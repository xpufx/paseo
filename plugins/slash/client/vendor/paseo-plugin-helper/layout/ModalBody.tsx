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

export type ModalBodySize = "default" | "large";

export interface ModalBodyProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  header?: ReactNode;
  headerStyle?: StyleProp<ViewStyle>;
  /**
   * Host dialog size preset. "default" (default) is fully fluid inside the
   * host-allocated dialog. "large" opts into the helper's documented wide
   * extent on desktop so data-dense modals/surfaces get room, and is ignored on
   * mobile (the bottom sheet is already full-bleed) and inside composer
   * popovers (the host owns that narrow viewport). Use this instead of adding a
   * per-plugin width/minWidth literal; the host still owns the final size.
   */
  size?: ModalBodySize;
  /**
   * Optional upper bound (px) on the content column width. On large viewports
   * the host still allocates a wide dialog, but the body's content column stays
   * readable instead of stretching edge-to-edge: `width: "100%"` keeps it fluid
   * below the cap and `alignSelf: "center"` centers the capped column. Undefined
   * (default) preserves the fully fluid body. This does not dictate the dialog
   * frame; widen the frame with `size` when dense content genuinely needs room.
   */
  maxContentWidth?: number;
  /**
   * "scroll" (default): header renders INSIDE the helper-owned compact/mobile
   * ScrollView and moves with content. "pinned": header renders above that
   * compact/mobile scroller; on desktop the host remains the scroll owner.
   */
  headerMode?: "pinned" | "scroll";
  /**
   * Scroll ownership override. "auto" (default) renders the helper-owned
   * scroller only on compact/mobile surfaces and defers to the host elsewhere.
   * "always" makes the helper the scroll owner on every surface; use it when
   * the host supplies no scroller because the content view is bounded
   * (`ModalContent` passes it for `<Modal.Content scrollable={false}>`).
   */
  scrollMode?: "auto" | "always";
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

/**
 * Scroll-ownership signal for `ModalBody`.
 *
 * - `"helper"` — the default; `ModalBody` decides from the surface
 *   (compact/mobile) and `scrollMode`.
 * - `"host"` — an ancestor host view already provides the one scroller
 *   (0.8 composer popovers). `ModalBody` renders plain content.
 * - `"required"` — the ancestor has NO host scroller and the content is
 *   host-sized, so `ModalBody` MUST own the scroll on every surface. Set by
 *   `registerSidebarSurface` (a plugin surface is a full host page whose body
 *   is not wrapped in a host scroller) and by `ModalContent`.
 *
 * Adding the `"required"` member is additive: the existing two values keep
 * their meaning and the default stays `"helper"`.
 */
export type ModalBodyScrollOwner = "helper" | "host" | "required" | "popover";

export const ModalBodyScrollOwnerContext = createContext<ModalBodyScrollOwner>("helper");

// The single documented home for the large dialog preset. Prefer
// `ModalBody size="large"` over adding a per-plugin width/minWidth literal.
const LARGE_DIALOG_MIN_WIDTH = 640;

/**
 * Mobile-safe scrollable body for Paseo <Modal.Content>.
 *
 * Size contract: a modal takes the host-allocated dialog size and is fluid
 * within it. `ModalBody` fills that allocation (`flex: 1`, `minHeight: 0`,
 * `width: "100%"`) and never lets its children drive the dialog frame, so the
 * modal stays stable while content loads, refreshes, or grows. Do not wrap it
 * in a container that hardcodes `minWidth`/`minHeight`/`width`/`height` or that
 * sizes itself to its children - that reintroduces content-driven resize/redraw.
 * Shrinkable text uses `minWidth: 0` + `flexShrink: 1`, never a fixed dimension.
 *
 * Host behavior differs by platform: on desktop the host owns a bounded dialog
 * and its outer scroll, so `ModalBody` renders plain content and adds no second
 * scroll region. On mobile the host presents a bottom sheet
 * (`AdaptiveModalSheet`) that already owns the viewport and sheet gesture, so
 * `ModalBody` defers to a host-provided scroller (or a plain view) and only adds
 * the safe bottom inset. Plugin code must not guess either size.
 *
 * Scroll ownership: ordinary compact/mobile modal content uses this helper
 * scroller. A 0.8 composer popover is different: Paseo's MenuSurface already
 * supplies the sole outer scroller, and registerComposerPill marks that
 * subtree through ModalBodyScrollOwnerContext so this component renders plain
 * content instead. Pass `scrollMode="always"` when the host content view is
 * bounded and supplies no scroller (`ModalContent` does this), so the helper
 * scrolls on desktop too instead of clipping the bounded dialog.
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
  size = "default",
  maxContentWidth,
  scrollMode = "auto",
  debugTag,
  extraBottomInset = 0,
  refreshing = false,
  onRefresh,
  stickToEnd = false,
  scrollRef,
}: ModalBodyProps) {
  const { isCompact, isMobile, layout, padding, colors } = usePluginTheme();
  const scrollOwner = useContext(ModalBodyScrollOwnerContext);
  const hostOwnsScroll = scrollOwner === "host" || scrollOwner === "popover";
  // "required": an ancestor proved the host supplies no scroller (plugin
  // surface) — own the scroll on every surface, including non-compact desktop.
  const helperOwnsScroll =
    !hostOwnsScroll &&
    (scrollOwner === "required" || scrollMode === "always" || isCompact || isMobile);
  // The large preset is the ONE documented place a plugin can ask for a wide
  // dialog frame. It is a desktop-only content minimum: the mobile sheet is
  // already full-bleed, and a composer popover viewport is host-owned and
  // intentionally narrow, so both ignore the preset.
  const sizeStyle =
    size === "large" && !isMobile && !isCompact && scrollOwner !== "popover"
      ? styles.largeDialog
      : undefined;
  const ResolvedScrollView = selectHostScrollView(
    getOptionalClientHost(),
    FallbackScrollView as unknown as HostScrollView,
  );
  // Optional readability cap on the content column.
  //
  // `width: "100%"` keeps the column fluid up to the cap. Centering must use
  // auto side margins, NOT `alignSelf: "center"`: on a ScrollView content
  // container `alignSelf` stops the column stretching to the viewport, so it
  // sizes to its children instead — a wrapping pill row then grows as wide as
  // its pills and never wraps (reported as "pills row rigid" on x-comms).
  // Auto margins center the column while preserving full-width stretch.
  const columnStyle =
    maxContentWidth !== undefined
      ? ({
          width: "100%",
          maxWidth: maxContentWidth,
          marginLeft: "auto",
          marginRight: "auto",
        } as ViewStyle)
      : undefined;
  const innerRef = useRef<ScrollViewInstance>(null);

  const setRefs = (node: ScrollViewInstance | null) => {
    (innerRef as { current: ScrollViewInstance | null }).current = node;
    if (typeof scrollRef === "function") {
      scrollRef(node);
    } else if (scrollRef) {
      (scrollRef as { current: ScrollViewInstance | null }).current = node;
    }
  };

  // Only real mobile platforms reserve the large bottom inset that clears
  // navigation bars; a compact desktop popover does not need it.
  const bottomPadding = (isMobile ? 48 : 20) + extraBottomInset;

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
      style={[{ backgroundColor: colors.surface0 }, styles.container, sizeStyle, style]}
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
        columnStyle,
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
    <View style={[styles.plainBody, sizeStyle, style]}>
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
          columnStyle,
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
        style={[{ backgroundColor: colors.surface0 }, styles.container, sizeStyle, style]}
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
          columnStyle,
          contentContainerStyle,
        ]}
      >
        <View style={[styles.header, headerStyle]}>{header}</View>
        {children}
      </ResolvedScrollView>
    );
  }

  return (
    <View style={[styles.screen, sizeStyle]}>
      <View style={[styles.header, headerStyle]}>{header}</View>
      {scrollBody}
    </View>
  );
}

const styles = StyleSheet.create({
  // Desktop-only wide extent for `size="large"`. The host still owns the final
  // dialog size; this only asks a content-sizing host for more room.
  largeDialog: {
    minWidth: LARGE_DIALOG_MIN_WIDTH,
  },
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
