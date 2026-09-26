import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import {
  getClientHost,
  type ComposerPillRegistrar,
  type HostLayout,
  type HostPillProps,
  type HostTheme,
  type PluginCleanup,
} from "./host";
import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
} from "@getpaseo/plugin/client";
import { PluginThemeProvider } from "./theme/provider";
import type { VisualFlair } from "./theme/flair";
import { ModalBodyScrollOwnerContext } from "./layout/ModalBody";
import { reportSuppressed } from "../../../shared/vendor/paseo-plugin-helper/suppressed";

export interface RenderModalProps<TPayload = any> extends HostPillProps {
  close: () => void;
  payload?: TPayload;
}

export interface PillLiveContext {
  agentId: string;
  workspaceId: string;
}

export interface PillLivePayload {
  label?: string;
  icon?: string;
}

export type PillLabelResolver = (
  context: PillLiveContext,
) =>
  | string
  | PillLivePayload
  | undefined
  | Promise<string | PillLivePayload | undefined>;

export type PillIconResolver = (
  context: PillLiveContext,
) => string | undefined | Promise<string | undefined>;

/**
 * Single precedence rule for pill modal scroll ownership (#219), shared by
 * the centered and legacy modal wrappers so they cannot disagree.
 * `true` delegates the scroller to the host `<Modal.Content>`; `false`
 * (default) keeps the legacy bounded dialog for `ModalBody`-based content.
 * Either way the wrapper renders exactly one `<Modal.Content>`.
 */
export function resolvePillModalScrollable(hostScroll?: boolean): boolean {
  return hostScroll === true;
}

const NOOP_SUBSCRIBE = (): (() => void) => () => {};

export interface RegisterComposerPillOptions<TPayload = any> {
  /**
   * Unique ID for the pill (e.g. "paseo-top", "mcp-monitor").
   */
  id: string;

  /**
   * Title shown in the composer trackbar (keep concise, e.g. "top", "CPU 12%").
   */
  title: string;

  /**
   * Optional compact title shown in the composer trackbar when screen or track is narrow/mobile
   * (when `layout.compact` is true). Defaults to `title`.\
   */
  compactTitle?: string;

  /**
   * Optional custom title shown in the modal header (defaults to `title`).
   * Useful when the modal needs a full descriptive title (e.g. "Host System Resources").
   */
  modalTitle?: string;

  /**
   * Lucide icon name for the pill (e.g. "Cpu", "Server", "MessageSquare").
   */
  icon?: string;

  /**
   * Optional compact Lucide icon name shown when in compact mode. Defaults to `icon`.
   */
  compactIcon?: string;

  /**
   * Optional custom icon for the modal header. Can be a Lucide icon name string or a JSX element.
   * If omitted, falls back to `icon`.
   */
  modalIcon?: string | ReactNode;

  /**
   * Optional visual flair preset or overrides for the plugin's theme.
   */
  flair?: Partial<VisualFlair>;

  /**
   * Resolves the live pill label (and optionally icon). The host renders the
   * pill body itself, so this is the only channel for live pill text. Called
   * once at registration and then every `refreshIntervalMs`. Keep it cheap and
   * synchronous when possible; async resolvers are awaited. Returning
   * `undefined` leaves the current label/icon.
   * Can return a plain string (label) or an object `{ label?: string; icon?: string }`.
   * Cycle modes can advance rotation state on each call.
   */
  resolveLabel?: PillLabelResolver;

  /**
   * Optional standalone resolver for the pill icon. Evaluated alongside
   * `resolveLabel` on each tick.
   */
  resolveIcon?: PillIconResolver;

  /**
   * Poll interval for `resolveLabel`. Defaults to 5000ms
   * when `resolveLabel` or `resolveIcon` is set. Set to 0 to resolve once at registration.
   */
  refreshIntervalMs?: number;

  /**
   * Fixed width, in pixels, for the anchored popover on non-compact hosts.
   *
   * Without it the popover is sized from its content, so any content that
   * reflows (a measured table, a responsive group, a gauge that settles) can
   * resize the surface under the pointer. Pinning the width makes the frame the
   * authority and lets the content overflow into its own scroll/clip instead.
   *
   * Ignored on compact hosts, where the same content renders in a full-bleed
   * bottom sheet. Clamped to the window width so a fixed width cannot overflow
   * a narrow viewport.
   */
  popoverWidth?: number;

  /**
   * Renders the content inside the pill's surface.
   * The host owns the surface: with the default `"popover"` presentation it
   * anchors this output to the pill at the host surface width (expect a
   * narrow column, not a wide modal; keep content vertically stacked and
   * reflowing), and with `"centered"` it renders it from the pill's icon.
   * Live pill text therefore comes from `resolveLabel`, not from this renderer.
   *
   * Never render a host `<Modal.Content>` here — use `HostModalSection` from
   * `paseo-plugin-helper/ui` for fluid content. (`HostModalContent` is only
   * for plugins that open their OWN host `<Modal>`.)
   */
  renderModal?: (props: RenderModalProps<TPayload>) => ReactNode;

  /**
   * Host-owned scroll for the centered modal path (#219).
   * - `false` (default): the wrapper renders
   *   `<Modal.Content scrollable={false}>` (bounded dialog) and
   *   `ModalBody`-based content owns the one scroller.
   * - `true`: the wrapper renders `<Modal.Content scrollable={true}>` so the
   *   host scrolls, and `renderModal` must provide fluid content with NO
   *   nested `<Modal.Content>` or scroller (`HostModalSection`).
   * Exactly one `<Modal.Content>` is rendered in both modes. The popover
   * path is unaffected (plain host-owned container either way).
   */
  hostScroll?: boolean;

  /**
   * Makes the pill an action button instead of a tethered popover: pressing it
   * calls this and the host never mounts a popover. Use it to open a plugin
   * surface (`openSurface(id)`), which the host renders outside the composer —
   * an agent-stream re-render of the composer then cannot remount it. Ignored
   * when unset, in which case `renderModal` renders the popover.
   */
  onPress?: () => void | Promise<void>;

  /**
   * How an open pill presents.
   * - `"popover"` (default): the host anchors `renderModal` to the pill. The
   *   host may remount that subtree on every composer re-render, which can tear
   *   an open popover down.
   * - `"centered"`: the host `Modal` is rendered from the pill's always-mounted
   *   icon and toggled by the pill press, so the surface is not a child of the
   *   composer popover and a composer re-render does not unmount it.
   */
  presentation?: "popover" | "centered";

  /**
   * Called when a pill cannot be registered on the current host. Reporting
   * instead of throwing keeps the rest of the plugin client alive; render the
   * message in your own panel to make it visible.
   */
  onError?: (info: { agentId: string; workspaceId: string; error: Error }) => void;
}

/**
 * Registers an agent-scoped composer pill and modal lifecycle.
 * Manages agent subscription events, unmount cleanup, and pill-to-modal activation.
 */
export function registerComposerPill<TPayload = any>(
  client: ComposerPillRegistrar,
  options: RegisterComposerPillOptions<TPayload>,
): PluginCleanup {
  const { Icon, Modal } = getClientHost();
  const pills = new Map<
    string,
    {
      dispose: () => void;
      workspaceId: string;
      registration?: PluginButtonRegistration;
    }
  >();
  const pushedDescriptors = new WeakMap<object, { label?: string; icon?: string }>();
  // A pill can only be resolved while the host actually renders it. The host
  // mounts the pill's custom icon component for every visible composer pill, and
  // that mount is the plugin's only visibility signal: its mount/unmount
  // brackets the pill's on-screen lifetime. Polling every registered agent
  // regardless of that signal ran one ticker per agent in the install, which
  // stampedes the daemon on a host with many agents.
  const visiblePillMounts = new Map<string, number>();
  // Agent ids whose anchored popover is currently mounted. While a popover is
  // open the host re-renders the whole composer on every agent-stream message;
  // rewriting the button entry at the same time makes the host remount the open
  // popover. `mcp-tools` never updates its entry and its popover is stable, so
  // keep the entry static while the popover is up — the label and icon are
  // hidden behind it anyway. Updates resume from the next tick after it closes.
  const openPopoverAgents = new Set<string>();
  const iconValueByAgent = new Map<string, string>();
  const iconListenersByAgent = new Map<string, Set<() => void>>();
  // Open state for `presentation: "centered"`. It lives outside React so the
  // centered Modal, which is rendered from the pill icon, survives any remount
  // of the composer subtree the host might do.
  const centeredOpenAgents = new Set<string>();
  const centeredListenersByAgent = new Map<string, Set<() => void>>();
  let sharedLabelTimer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  function defaultPillIcon(): string {
    if (typeof options.icon === "string") return options.icon;
    if (typeof options.modalIcon === "string") return options.modalIcon;
    return "Activity";
  }

  function readPillIcon(agentId: string): string {
    return iconValueByAgent.get(agentId) ?? defaultPillIcon();
  }

  function subscribePillIcon(agentId: string): (listener: () => void) => () => void {
    return (listener: () => void) => {
      let listeners = iconListenersByAgent.get(agentId);
      if (!listeners) {
        listeners = new Set();
        iconListenersByAgent.set(agentId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners && listeners.size === 0) iconListenersByAgent.delete(agentId);
      };
    };
  }

  function setPillIcon(agentId: string, icon: string): void {
    if (iconValueByAgent.get(agentId) === icon) return;
    iconValueByAgent.set(agentId, icon);
    for (const listener of iconListenersByAgent.get(agentId) ?? []) listener();
  }

  function subscribeCenteredOpen(agentId: string): (listener: () => void) => () => void {
    return (listener: () => void) => {
      let listeners = centeredListenersByAgent.get(agentId);
      if (!listeners) {
        listeners = new Set();
        centeredListenersByAgent.set(agentId, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners && listeners.size === 0) centeredListenersByAgent.delete(agentId);
      };
    };
  }

  function setCenteredOpen(agentId: string, open: boolean): void {
    if (centeredOpenAgents.has(agentId) === open) return;
    if (open) centeredOpenAgents.add(agentId);
    else centeredOpenAgents.delete(agentId);
    for (const listener of centeredListenersByAgent.get(agentId) ?? []) listener();
  }

  function visibleAgentIds(): string[] {
    const ids: string[] = [];
    for (const [agentId, count] of visiblePillMounts) {
      if (count > 0) ids.push(agentId);
    }
    return ids;
  }

  function syncSharedLabelTimer(): void {
    const intervalMs = options.refreshIntervalMs ?? 5000;
    const hasPoller = Boolean(options.resolveLabel || options.resolveIcon);
    const shouldRun =
      hasPoller && intervalMs > 0 && visibleAgentIds().some((agentId) => pills.has(agentId));
    if (!shouldRun) {
      if (sharedLabelTimer) {
        clearInterval(sharedLabelTimer);
        sharedLabelTimer = null;
      }
      return;
    }
    if (sharedLabelTimer) return;
    sharedLabelTimer = setInterval(() => {
      for (const agentId of visibleAgentIds()) {
        const entry = pills.get(agentId);
        if (entry?.registration) resolveAndPushLabel(agentId, entry.workspaceId, entry.registration);
      }
    }, intervalMs);
  }

  function markPillVisible(agentId: string): void {
    visiblePillMounts.set(agentId, (visiblePillMounts.get(agentId) ?? 0) + 1);
    const entry = pills.get(agentId);
    if (entry?.registration) resolveAndPushLabel(agentId, entry.workspaceId, entry.registration);
    syncSharedLabelTimer();
  }

  function markPillHidden(agentId: string): void {
    const next = (visiblePillMounts.get(agentId) ?? 1) - 1;
    if (next > 0) visiblePillMounts.set(agentId, next);
    else visiblePillMounts.delete(agentId);
    syncSharedLabelTimer();
  }

  /**
   * The host-rendered trigger glyph doubles as the pill's visibility probe.
   * Swapping the live icon is routed through `setPillIcon` rather than
   * `registration.update({ icon })`, so the probe component never gets
   * replaced by a plain string and the mount signal survives every icon swap.
   */
  function makePillIcon(agentId: string): ComponentType<PluginButtonIconProps> {
    return function PillVisibilityIcon(props: PluginButtonIconProps) {
      const subscribe = useMemo(() => subscribePillIcon(agentId), [agentId]);
      const name = useSyncExternalStore(
        subscribe,
        () => readPillIcon(agentId),
        () => readPillIcon(agentId),
      );
      const centered = options.presentation === "centered";
      const subscribeCentered = useMemo(
        () => (centered ? subscribeCenteredOpen(agentId) : NOOP_SUBSCRIBE),
        [centered, agentId],
      );
      const centeredOpen = useSyncExternalStore(
        subscribeCentered,
        () => (centered ? centeredOpenAgents.has(agentId) : false),
        () => (centered ? centeredOpenAgents.has(agentId) : false),
      );
      useEffect(() => {
        markPillVisible(agentId);
        return () => markPillHidden(agentId);
        // agentId is fixed per pill; the icon component identity never changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [agentId]);

      const icon = <Icon name={name} size={props.size ?? 14} color={props.color ?? ""} />;
      const { theme, layout } = props;
      if (!centered || !options.renderModal) return icon;

      const modalIconElement = React.isValidElement(options.modalIcon) ? (
        options.modalIcon
      ) : (
        <Icon
          name={
            typeof options.modalIcon === "string" ? options.modalIcon : (options.icon ?? "Activity")
          }
          size={16}
          color={theme.colors.foreground}
        />
      );
      const stopBubbling = (e: any) => {
        if (e && typeof e.stopPropagation === "function") {
          e.stopPropagation();
        }
      };

      const eventBoundaryProps = {
        onClick: stopBubbling,
        onMouseDown: stopBubbling,
        onMouseUp: stopBubbling,
        onPointerDown: stopBubbling,
        onPointerUp: stopBubbling,
        onTouchStart: stopBubbling,
        onTouchEnd: stopBubbling,
        onKeyDown: stopBubbling,
        onKeyUp: stopBubbling,
      };

      return (
        <>
          {icon}
          <View
            onStartShouldSetResponder={() => true}
            onTouchEnd={stopBubbling}
            {...(eventBoundaryProps as any)}
          >
            <Modal
              title={options.modalTitle ?? options.title}
              icon={modalIconElement}
              open={centeredOpen}
              onOpenChange={(nextOpen: boolean) => setCenteredOpen(agentId, nextOpen)}
            >
              <Modal.Content scrollable={resolvePillModalScrollable(options.hostScroll)}>
                {centeredOpen ? (
                  <View
                    onStartShouldSetResponder={() => true}
                    onTouchEnd={stopBubbling}
                    {...(eventBoundaryProps as any)}
                    style={{ flex: 1, minHeight: 0 }}
                  >
                    <PluginThemeProvider theme={theme} layout={layout} flair={options.flair}>
                      <ModalBodyScrollOwnerContext.Provider
                        value={resolvePillModalScrollable(options.hostScroll) ? "host" : "required"}
                      >
                        {options.renderModal({
                          agentId,
                          workspaceId: props.workspaceId,
                          theme,
                          layout,
                          host: props.host ?? { id: "", label: "" },
                          close: () => setCenteredOpen(agentId, false),
                        })}
                      </ModalBodyScrollOwnerContext.Provider>
                    </PluginThemeProvider>
                  </View>
                ) : null}
              </Modal.Content>
            </Modal>
          </View>
        </>
      );
    };
  }

  // Popover scroll ownership: Paseo's MenuSurface/FloatingScrollView or
  // BottomSheetScrollView already owns the viewport. Keep this wrapper plain,
  // unconstrained, and mark the subtree so ModalBody does not add a second
  // ScrollView. Fixed heights or overflow clipping here cut off mobile content.
  function PillPopoverContent(props: {
    agentId: string;
    workspaceId: string;
    theme: HostTheme;
    layout: HostLayout;
    host?: { id: string; label: string };
    close: () => void;
  }) {
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    // The anchored popover is otherwise sized from its content, so reflowing
    // content can move the frame under the pointer. Pin it to an explicit width
    // (clamped to the viewport) and let children overflow into their own
    // scroll/clip. Compact hosts present a full-bleed sheet, so this is skipped.
    const frameWidth =
      !props.layout.compact && options.popoverWidth
        ? Math.max(0, Math.min(options.popoverWidth, windowWidth - 24))
        : undefined;
    // The host remains the scroll owner, but it needs a finite child extent to
    // establish the popover viewport. Do not add overflow clipping or an inner
    // ScrollView here: either would compete with the host's popover/sheet
    // scroller.
    const frameMaxHeight = Math.max(1, Math.min(560, windowHeight * 0.8));
    // Layout effect, not effect: the flag must be set in the same commit the
    // popover mounts, before any label timer can interleave. An effect runs
    // after paint, leaving a window where one tick can still publish and
    // remount the popover.
    useLayoutEffect(() => {
      openPopoverAgents.add(props.agentId);
      return () => {
        openPopoverAgents.delete(props.agentId);
      };
    }, [props.agentId]);
    const pillProps: HostPillProps = {
      agentId: props.agentId,
      workspaceId: props.workspaceId,
      theme: props.theme,
      layout: props.layout,
      host: props.host ?? { id: "", label: "" },
    };
    return (
      <PluginThemeProvider theme={props.theme} layout={props.layout} flair={options.flair}>
        <View
          style={{
            ...styles.popoverContainer,
            maxHeight: frameMaxHeight,
            ...(frameWidth ? { width: frameWidth } : null),
          }}
        >
          <ModalBodyScrollOwnerContext.Provider value="popover">
            {options.renderModal?.({ ...pillProps, close: props.close })}
          </ModalBodyScrollOwnerContext.Provider>
        </View>
      </PluginThemeProvider>
    );
  }

  function toCleanup(registration: PluginButtonRegistration): PluginCleanup {
    return () => registration.remove();
  }

  function reportError(agentId: string, workspaceId: string, error: unknown): void {
    pills.set(agentId, {
      dispose: () => {},
      workspaceId,
    });
    // Surface even when the plugin wired no onError: a swallowed registration
    // failure leaves the pill missing with no trace anywhere.
    reportSuppressed(console, `registerComposerPill registration failed (agent ${agentId})`, error, "warn");
    options.onError?.({
      agentId,
      workspaceId,
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }

  function resolveAndPushLabel(
    agentId: string,
    workspaceId: string,
    registration: PluginButtonRegistration,
  ): void {
    if (!options.resolveLabel && !options.resolveIcon) return;
    const ctx = { agentId, workspaceId };
    Promise.all([
      options.resolveLabel ? Promise.resolve(options.resolveLabel(ctx)) : Promise.resolve(undefined),
      options.resolveIcon ? Promise.resolve(options.resolveIcon(ctx)) : Promise.resolve(undefined),
    ])
      .then(([labelResult, iconResult]) => {
        if (!pills.has(agentId)) return;
        if (openPopoverAgents.has(agentId)) return;
        const patch: { label?: string; icon?: string } = {};
        if (typeof labelResult === "string") {
          patch.label = labelResult;
        } else if (labelResult && typeof labelResult === "object") {
          if (labelResult.label !== undefined) patch.label = labelResult.label;
          if (labelResult.icon !== undefined) patch.icon = labelResult.icon;
        }
        if (iconResult !== undefined) {
          patch.icon = iconResult;
        }
        const previous = pushedDescriptors.get(registration as object) ?? {};
        const labelChanged = patch.label !== undefined && patch.label !== previous.label;
        const iconChanged = patch.icon !== undefined && patch.icon !== previous.icon;
        // Icon updates go through the mount probe, never `button.icon`: replacing
        // the probe with a string would unmount it and lose the visibility signal.
        if (iconChanged) setPillIcon(agentId, patch.icon as string);
        if (labelChanged) registration.update({ label: patch.label });
        if (labelChanged || iconChanged) {
          pushedDescriptors.set(registration as object, {
            label: patch.label ?? previous.label,
            icon: patch.icon ?? previous.icon,
          });
        }
      })
      .catch((error) => {
        // resolveLabel/resolveIcon usually perform an RPC; a rejection here is
        // the pill's live data failing, so it must not vanish when onError is unset.
        reportSuppressed(
          console,
          `registerComposerPill resolveLabel/resolveIcon failed (agent ${agentId})`,
          error,
        );
        options.onError?.({
          agentId,
          workspaceId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }

  function addPill(agentId: string, workspaceId: string) {
    if (disposed || pills.has(agentId)) return;
    try {
      const registration = client.addComposerPill({
        id: options.id,
        workspaceId,
        agentId,
        button: {
          title: options.title,
          // The icon is both the visibility signal and the live-icon renderer.
          icon: makePillIcon(agentId),
          label: options.title,
          behavior: options.onPress
            ? { kind: "action", onPress: () => void options.onPress?.() }
            : options.presentation === "centered"
              ? {
                  kind: "action",
                  onPress: () => setCenteredOpen(agentId, !centeredOpenAgents.has(agentId)),
                }
              : {
                  kind: "popover",
                  Content: PillPopoverContent as ComponentType<PluginButtonContentProps>,
                },
        },
      });
      pills.set(agentId, {
        dispose: toCleanup(registration),
        workspaceId,
        registration,
      });
      // Resolve once so the label is correct even before the icon mounts;
      // ongoing polling is owned by the shared, visibility-gated timer.
      if (options.resolveLabel || options.resolveIcon) {
        resolveAndPushLabel(agentId, workspaceId, registration);
      }
    } catch (error) {
      reportError(agentId, workspaceId, error);
    }
  }

  function removePill(agentId: string) {
    const entry = pills.get(agentId);
    entry?.dispose();
    pills.delete(agentId);
    visiblePillMounts.delete(agentId);
    iconValueByAgent.delete(agentId);
    iconListenersByAgent.delete(agentId);
    syncSharedLabelTimer();
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (disposed) return;
    if ("agentId" in update && update.kind === "remove") {
      removePill(update.agentId);
      return;
    }
    if ("agent" in update) {
      const { id, workspaceId } = update.agent;
      if (workspaceId) addPill(id, workspaceId);
    }
  });

  client.paseo.agents
    .list()
    .then((result) => {
      if (disposed) return;
      for (const { agent } of result.entries) {
        if (agent.workspaceId) addPill(agent.id, agent.workspaceId);
      }
    })
    .catch((error) => {
      // Silently dropping this leaves a plugin with zero pills and no clue why.
      reportSuppressed(console, "registerComposerPill agents.list() failed", error, "warn");
    });

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    if (sharedLabelTimer) {
      clearInterval(sharedLabelTimer);
      sharedLabelTimer = null;
    }
    for (const entry of pills.values()) entry.dispose();
    pills.clear();
    visiblePillMounts.clear();
    iconValueByAgent.clear();
    iconListenersByAgent.clear();
  };
}

const styles = StyleSheet.create({
  popoverContainer: {
    width: "100%",
  },
});
