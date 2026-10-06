import * as React from 'react';
import React__default, { ReactNode, ComponentType } from 'react';
import { g as HostPillProps, c as ComposerPillRegistrar, P as PluginCleanup, a as HostSurfaceProps, r as HostAgentPanelProps, t as HostWorkspacePanelProps, k as HostToast, f as HostLayout } from '../host-BAF48X1U.cjs';
export { F as FALLBACK_COLORS, H as HOST_SHADOW_COLOR, a as HostLayoutProvider, b as HostLayoutProviderProps, c as HostTheme, d as HostThemeProvider, e as HostThemeProviderProps, f as alpha, g as getContrastColor, h as getLuminance, i as getStatusColor, j as getVariantPalette, r as resolveHostColors, u as useHostLayout, k as useHostTheme } from '../host-color-C3yeBsXb.cjs';
import { P as PluginTheme } from '../types-4TBN5lgi.cjs';
import * as pluginClient from '@getpaseo/plugin/client';
import { PluginHostSummary } from '@getpaseo/plugin/client';
import 'react-native';

/**
 * Visual flair vocabulary accepted by the lifecycle registration options.
 *
 * The legacy design system that consumed these presets is gone (#938); the
 * registrars still accept the shape so existing plugin call sites keep
 * type-checking, but the host theme drives every `ui/` adapter.
 */
type RadiusStyle = "sharp" | "rounded" | "pill";
type DensityStyle = "compact" | "comfortable" | "spacious";
type SurfaceStyle = "flat" | "tinted" | "elevated";
type HeadingTransform = "none" | "uppercase";
interface VisualFlair {
    /** Corner radius preset for interactive elements and containers. */
    radius: RadiusStyle;
    /** Spacing and typography density. */
    density: DensityStyle;
    /** Surface background styling for cards, panels, and modal boxes. */
    surfaceStyle: SurfaceStyle;
    /** Optional custom brand accent color. */
    accentColor?: string;
    /** Default border width for cards and bordered elements (default: 1). */
    borderWidth: number;
    /** Text transform for section headers and meta labels. */
    headingTransform: HeadingTransform;
}

interface RenderModalProps<TPayload = any> extends HostPillProps {
    close: () => void;
    payload?: TPayload;
}
interface PillLiveContext {
    agentId: string;
    workspaceId: string;
}
interface PillLivePayload {
    label?: string;
    icon?: string;
}
type PillLabelResolver = (context: PillLiveContext) => string | PillLivePayload | undefined | Promise<string | PillLivePayload | undefined>;
type PillIconResolver = (context: PillLiveContext) => string | undefined | Promise<string | undefined>;
/**
 * Single precedence rule for pill modal scroll ownership (#219), shared by
 * the centered and legacy modal wrappers so they cannot disagree.
 * `true` delegates the scroller to the host `<Modal.Content>`; `false`
 * (default) keeps the legacy bounded dialog for `ModalBody`-based content.
 * Either way the wrapper renders exactly one `<Modal.Content>`.
 */
declare function resolvePillModalScrollable(hostScroll?: boolean): boolean;
interface RegisterComposerPillOptions<TPayload = any> {
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
    onError?: (info: {
        agentId: string;
        workspaceId: string;
        error: Error;
    }) => void;
}
/**
 * Registers an agent-scoped composer pill and modal lifecycle.
 * Manages agent subscription events, unmount cleanup, and pill-to-modal activation.
 */
declare function registerComposerPill<TPayload = any>(client: ComposerPillRegistrar, options: RegisterComposerPillOptions<TPayload>): PluginCleanup;

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
interface SidebarSurfaceRegistrar {
    addSurface(surfaceId: string, Component: ComponentType<HostSurfaceProps>): any;
    addSidebarItem(contribution: any): any;
}
interface RegisterSidebarSurfaceOptions {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostSurfaceProps>;
    flair?: VisualFlair;
    /**
     * Upper bound (px) on the surface's content column, for readability on very
     * wide viewports. `false` opts out entirely, for surfaces that are genuinely
     * canvas-shaped — graph visualisers, wide tables, timeline views — where a
     * centred column would fight the content rather than help it.
     *
     * Defaults to {@link DEFAULT_SIDEBAR_MAX_CONTENT_WIDTH} rather than being
     * per-call opt-in. Ten call sites already pass a `maxContentWidth` to
     * `ModalBody` and ignore it in ten others, so making the cap opt-in would
     * reproduce exactly the inconsistency it is meant to remove — a guard that
     * only fires where someone remembered it.
     */
    maxContentWidth?: number | false;
}
/**
 * Default ceiling for a sidebar surface's content column.
 *
 * A sidebar surface is a full host page, so on a wide monitor it stretches
 * edge to edge and line lengths become unreadable. This is a ceiling, not a
 * target: the column stays fluid below it and is centred above it, exactly as
 * `ModalBody`'s own `maxContentWidth` behaves. 1280 is a common wide-viewport
 * breakpoint rather than a number derived from any plugin's content.
 */
declare const DEFAULT_SIDEBAR_MAX_CONTENT_WIDTH = 1280;
/**
 * Registers a sidebar icon and corresponding full-page surface in a single call,
 * automatically injecting `<PluginThemeProvider>` with custom visual flair.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 *
 * A sidebar surface is a full host page: Paseo routes to it directly and does
 * NOT wrap the surface body in a host scroller (unlike `<Modal.Content>`, which
 * bounds the dialog and supplies the outer scroll). Any `ModalBody` in the
 * subtree would therefore pick the plain, non-scrolling branch on a
 * non-compact desktop and clip overflowing content — the recurring
 * "plugin page does not scroll" bug. Marking the subtree with the
 * `"required"` scroll-owner context makes every `ModalBody` inside own the
 * scroll on every surface, so plugins inherit working scroll with no
 * per-plugin workaround.
 *
 * Returns an idempotent disposer that removes both the surface and the sidebar
 * item, matching every other helper `add*` registration. Existing callers that
 * ignore the return value are unaffected.
 */
declare function registerSidebarSurface(plugin: SidebarSurfaceRegistrar, options: RegisterSidebarSurfaceOptions): () => void;

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
interface WorkspacePanelRegistrar {
    addWorkspacePanel(contribution: any): any;
}
interface RegisterWorkspacePanelOptions {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostWorkspacePanelProps>;
    flair?: VisualFlair;
    /** Host locations in which the panel should be available. */
    locations?: string[];
}
interface RegisterAgentPanelOptions {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostAgentPanelProps>;
    flair?: VisualFlair;
}
/**
 * Registers a workspace-scoped panel with automatic `<PluginThemeProvider>` injection.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
declare function registerWorkspacePanel(plugin: WorkspacePanelRegistrar, options: RegisterWorkspacePanelOptions): () => void;
/**
 * Registers an agent-scoped panel with automatic `<PluginThemeProvider>` injection.
 * Works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
declare function registerAgentPanel(plugin: WorkspacePanelRegistrar, options: RegisterAgentPanelOptions): void;

interface CopyToClipboardOptions {
    toast?: HostToast;
    toastMessage?: string;
}
type ClipboardTier = "navigator" | "host" | "rnAsync" | "rnSync" | "execCommand";
interface ClipboardEnvironment {
    hasNavigatorClipboard: boolean;
    hasHostCopyText: boolean;
    hasRnClipboard: boolean;
    hasRnSetStringAsync: boolean;
    isDom: boolean;
}
/**
 * Deterministic tier order for an explicit copy.
 *
 * Web's `navigator.clipboard.writeText` is the only API that rejects when the
 * clipboard did not change, so it leads. The synchronous
 * `react-native-web` `Clipboard.setString` reports success even when its
 * `document.execCommand("copy")` fails, which leaves the previous clipboard
 * item in place while the UI claims success (xpufx-org/paseo#278); it is only
 * usable off-DOM (native), where it is the real platform clipboard. The same
 * applies to any `setStringAsync` whose DOM fallback is that unverified
 * `execCommand`. In a DOM the checked `execCommand` fallback is preferred to
 * those unverifiable paths.
 */
declare function clipboardTierOrder(env: ClipboardEnvironment): ClipboardTier[];
/**
 * Robust cross-platform clipboard copy helper for Paseo plugins.
 * Works seamlessly across React Native (mobile), web, and desktop.
 *
 * Tier order comes from `clipboardTierOrder`; every tier reports failure
 * honestly so a denied or blocked write never leaves the previous clipboard
 * item behind under a fake success.
 */
declare function copyToClipboard(text: string, options?: CopyToClipboardOptions): Promise<boolean>;

type HapticFeedbackType = "light" | "medium" | "heavy" | "success" | "warning" | "error";
/**
 * Cross-platform haptic feedback helper for Paseo plugins.
 * Supports web vibration API and graceful fallback when vibration is unavailable.
 */
declare function triggerHaptic(type?: HapticFeedbackType): boolean;

/**
 * Scroll-ownership signal emitted by the lifecycle registration engines.
 *
 * - `"helper"` — the default; the content owns its own scrolling.
 * - `"host"` — an ancestor host view already provides the one scroller
 *   (0.8 composer popovers), so the content renders plain.
 * - `"required"` — the ancestor has NO host scroller and the content is
 *   host-sized, so it MUST own the scroll on every surface. Set by
 *   `registerSidebarSurface` (a plugin surface is a full host page whose body
 *   is not wrapped in a host scroller).
 * - `"popover"` — the host anchored-popover already supplies the sole scroller.
 *
 * The context lives in `lifecycle/` so the registration engines can mark the
 * subtrees they render without importing any UI kit. It survived the removal of
 * the bespoke `ModalBody` reader (#938) as a signal plugins and the host can
 * still consume.
 */
type ModalBodyScrollOwner = "helper" | "host" | "required" | "popover";
declare const ModalBodyScrollOwnerContext: React.Context<ModalBodyScrollOwner>;

/**
 * Presentational seam for the lifecycle registration engines.
 *
 * The bespoke `client/` design system was removed (#938), so no installer
 * remains: `RegistrarThemeScope` mounts only `HostThemeProvider` (the host
 * `theme` prop drives every ui/ adapter). The legacy-provider hook stays for
 * callers that mounted their own theme provider before the removal.
 */
interface RegistrarThemeProps {
    theme: PluginTheme;
    layout?: HostLayout;
    flair?: Partial<VisualFlair>;
    children: ReactNode;
}
type RegistrarLegacyThemeProvider = ComponentType<RegistrarThemeProps>;
/**
 * Installed once by a legacy theme shim. Keeping it out of the `lifecycle/`
 * entry's runtime imports is what lets that entry stay free of any UI kit.
 */
declare function setRegistrarLegacyThemeProvider(provider: RegistrarLegacyThemeProvider | undefined): void;
/** Mounts the host theme (always) and the legacy provider (when installed). */
declare function RegistrarThemeScope({ theme, layout, flair, children }: RegistrarThemeProps): React__default.JSX.Element;

/**
 * The desktop host bundle supplies `useHosts`/`getPaseoClient`; the mobile
 * bundle omits them, so a direct named call throws `useHosts is not a
 * function` and takes the whole surface with it (#1043, #1057-G). These seams
 * reach the primitives through a feature-detected namespace so a surface
 * degrades to "no hosts" instead of crashing the plugin.
 */
/** The host summary shape `useHosts()` returns (the SDK's `PluginHostSummary`). */
type OptionalHostSummary = PluginHostSummary;
/** The borrowed per-host client `getPaseoClient(serverId)` returns. */
type OptionalPaseoClient = ReturnType<typeof pluginClient.getPaseoClient>;
/** True when the running host supplies the multi-host primitives. */
declare function isMultiHostSupported(): boolean;
/**
 * `useHosts()` when the host supplies it, otherwise an empty host list, so a
 * surface that enumerates hosts degrades instead of crashing the bundle.
 */
declare function useOptionalHosts(): readonly PluginHostSummary[];
/** Borrow an online host's API, or `undefined` when the host omits the seam. */
declare function getOptionalPaseoClient(serverId: string): OptionalPaseoClient | undefined;

export { type ClipboardEnvironment, type ClipboardTier, type CopyToClipboardOptions, DEFAULT_SIDEBAR_MAX_CONTENT_WIDTH, type DensityStyle, type HapticFeedbackType, type HeadingTransform, type ModalBodyScrollOwner, ModalBodyScrollOwnerContext, type OptionalHostSummary, type OptionalPaseoClient, type PillIconResolver, type PillLabelResolver, type PillLiveContext, type PillLivePayload, type RadiusStyle, type RegisterAgentPanelOptions, type RegisterComposerPillOptions, type RegisterSidebarSurfaceOptions, type RegisterWorkspacePanelOptions, type RegistrarLegacyThemeProvider, type RegistrarThemeProps, RegistrarThemeScope, type RenderModalProps, type SidebarSurfaceRegistrar, type SurfaceStyle, type VisualFlair, type WorkspacePanelRegistrar, clipboardTierOrder, copyToClipboard, getOptionalPaseoClient, isMultiHostSupported, registerAgentPanel, registerComposerPill, registerSidebarSurface, registerWorkspacePanel, resolvePillModalScrollable, setRegistrarLegacyThemeProvider, triggerHaptic, useOptionalHosts };
