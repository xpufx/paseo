import React, { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  getClientHost,
  type ComposerPillRegistrar,
  type ComposerPillRegistration,
  type HostLayout,
  type HostPillProps,
  type HostTheme,
  type PluginCleanup,
} from "./host.js";
import { PluginThemeProvider } from "./theme/provider.js";
import { useResponsive } from "./theme/useResponsive.js";
import type { VisualFlair } from "./theme/flair.js";

export interface RenderPillProps<TPayload = any> extends HostPillProps {
  isOpen: boolean;
  open: (payload?: TPayload) => void;
  close: () => void;
  toggle: (payload?: TPayload) => void;
}

export interface RenderModalProps<TPayload = any> extends HostPillProps {
  close: () => void;
  payload?: TPayload;
}

export interface PillLiveContext {
  agentId: string;
  workspaceId: string;
}

let probeSequence = 0;

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
   * (when `layout.compact` is true). Defaults to `title`.
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
   * Optional compact Lucide icon name shown when in compact mode. Defaults to `icon`.\
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
   * Optional custom badge text shown inside the default pill (e.g. "LIVE", "3").
   */
  badgeText?: string;

  /**
   * Optional compact badge text shown inside the default pill in compact mode. Defaults to `badgeText`.
   */
  compactBadgeText?: string;

  /**
   * Optional callback to resolve default payload when the outer host pill is clicked.
   * Receives agentId and workspaceId.
   */
  resolveDefaultPayload?: (context: { agentId: string; workspaceId: string }) => TPayload | undefined;

  /**
   * Custom pill body renderer if you want to replace the default pill layout.
   * Receives `isOpen`, `open`, `close`, and `toggle` along with standard pill props.
   */
  renderPill?: (props: RenderPillProps<TPayload>) => ReactNode;

  /**
    * Resolves the live pill label on button-shaped hosts (Paseo 0.8+), where the
    * pill body is host-rendered from a static `label` string and `renderPill`
    * never mounts. Called once at registration and then every
    * `refreshIntervalMs`. Keep it cheap and synchronous when possible; async
    * resolvers are awaited. Returning `undefined` leaves the current label.
    * Cycle modes can advance rotation state on each call.
    */
  resolveLabel?: (context: PillLiveContext) => string | undefined | Promise<string | undefined>;

  /**
    * Poll interval for `resolveLabel` on button-shaped hosts. Defaults to 5000ms
    * when `resolveLabel` is set. Set to 0 to resolve once at registration.
    * Ignored on legacy hosts (their `renderPill` re-renders via React state).
    */
  refreshIntervalMs?: number;

  /**
    * Renders the content inside the controlled modal.
   * Automatically wrapped with PluginThemeProvider and supplied with a `close()` helper and optional payload.
    * On button-shaped hosts (Paseo 0.8+) the modal is replaced by an anchored
    * popover rendering this same content at the host surface width (expect a
    * narrow column, not a wide modal); keep content vertically stacked and
    * reflowing. `open`/`toggle` from `renderPill` cannot drive host-owned
    * popovers, so live pill text comes from `resolveLabel` instead.
   */
  renderModal: (props: RenderModalProps<TPayload>) => ReactNode;

  /**
   * Called when a pill cannot be registered on the current host (for example
   * a host API mismatch). Reporting instead of throwing keeps the rest of the
   * plugin client alive; render the message in your own panel to make it visible.
   */
  onError?: (info: { agentId: string; workspaceId: string; error: Error }) => void;
}

/**
 * Registers an agent-scoped composer pill and modal lifecycle.
 * Manages agent subscription events, unmount cleanup, and pill-to-modal activation.
 *
 * Works against both host generations: legacy `{Component, onPress}` pills
 * (Paseo 0.7 and beta apps) and `button`-descriptor pills (Paseo 0.8+), detected
 * once per call with a throwaway probe registration that is removed immediately.
 */
export function registerComposerPill<TPayload = any>(
  client: ComposerPillRegistrar,
  options: RegisterComposerPillOptions<TPayload>,
): PluginCleanup {
  const { Icon, Modal } = getClientHost();
  const openers = new Map<string, (payload?: TPayload) => void>();
  const pills = new Map<string, { dispose: () => void; timer?: ReturnType<typeof setInterval> }>();
  let detectedShape: "button" | "legacy" | null = null;

  function PillPopoverContent(props: {
    agentId: string;
    workspaceId: string;
    theme: HostTheme;
    layout: HostLayout;
    host?: { id: string; label: string };
    close: () => void;
  }) {
    const pillProps: HostPillProps = {
      agentId: props.agentId,
      workspaceId: props.workspaceId,
      theme: props.theme,
      layout: props.layout,
      host: props.host ?? { id: "", label: "" },
    };
    return (
      <PluginThemeProvider theme={props.theme} layout={props.layout} flair={options.flair}>
        <View style={styles.popoverContainer}>
          {options.renderModal({ ...pillProps, close: props.close })}
        </View>
      </PluginThemeProvider>
    );
  }

  function PillHost(props: HostPillProps) {
    const [open, setOpen] = useState(false);
    const [payload, setPayload] = useState<TPayload | undefined>(undefined);

    useEffect(() => {
      openers.set(props.agentId, (incomingPayload?: TPayload) => {
        setPayload(incomingPayload);
        setOpen(true);
      });
      return () => {
        openers.delete(props.agentId);
      };
    }, [props.agentId]);

    const effectiveModalTitle = options.modalTitle ?? options.title;

    const modalIconElement = useMemo(() => {
      if (React.isValidElement(options.modalIcon)) {
        return options.modalIcon;
      }
      const iconName =
        typeof options.modalIcon === "string" ? options.modalIcon : options.icon;
      if (iconName) {
        return <Icon name={iconName} size={16} color={props.theme.colors.foreground} />;
      }
      return undefined;
    }, [options.modalIcon, options.icon, props.theme.colors.foreground]);

    const renderPillProps: RenderPillProps<TPayload> = {
      ...props,
      isOpen: open,
      open: (customPayload?: TPayload) => {
        setPayload(customPayload);
        setOpen(true);
      },
      close: () => setOpen(false),
      toggle: (customPayload?: TPayload) => {
        setPayload(customPayload);
        setOpen((prev) => !prev);
      },
    };

    return (
      <PluginThemeProvider theme={props.theme} layout={props.layout} flair={options.flair}>
        {options.renderPill ? (
          options.renderPill(renderPillProps)
        ) : (
          <DefaultPillBody
            title={options.title}
            compactTitle={options.compactTitle}
            icon={options.icon}
            compactIcon={options.compactIcon}
            badgeText={options.badgeText}
            compactBadgeText={options.compactBadgeText}
            theme={props.theme}
          />
        )}

        <Modal
          title={effectiveModalTitle}
          icon={modalIconElement}
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) {
              setPayload(undefined);
            }
          }}
        >
          <Modal.Content>
            {open ? (
              <PluginThemeProvider theme={props.theme} layout={props.layout} flair={options.flair}>
                {options.renderModal({
                  ...props,
                  close: () => setOpen(false),
                  payload,
                })}
              </PluginThemeProvider>
            ) : null}
          </Modal.Content>

        </Modal>
      </PluginThemeProvider>
    );
  }

  function toCleanup(registration: ComposerPillRegistration): PluginCleanup {
    if (typeof registration === "function") return registration;
    return () => registration.remove();
  }

  function reportError(agentId: string, workspaceId: string, error: unknown): void {
    pills.set(agentId, {
      dispose: () => {},
    });
    options.onError?.({
      agentId,
      workspaceId,
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }

  function resolveAndPushLabel(
    agentId: string,
    workspaceId: string,
    registration: ComposerPillRegistration,
  ): void {
    if (typeof registration === "function") return;
    if (!options.resolveLabel) return;
    Promise.resolve()
      .then(() => options.resolveLabel!({ agentId, workspaceId }))
      .then((label) => {
        if (label !== undefined && pills.has(agentId)) {
          registration.update({ label });
        }
      })
      .catch((error) => {
        options.onError?.({
          agentId,
          workspaceId,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
  }

  function detectShape(agentId: string, workspaceId: string): "button" | "legacy" {
    probeSequence += 1;
    const probeId = `php-probe-${probeSequence}`;
    try {
      const registration = client.addComposerPill({
        id: probeId,
        workspaceId,
        agentId,
        button: {
          title: "probe",
          icon: "Activity",
          behavior: {
            kind: "action",
            onPress() {},
          },
        },
      });
      toCleanup(registration)();
      return "button";
    } catch {
      return "legacy";
    }
  }

  function addPill(agentId: string, workspaceId: string) {
    if (pills.has(agentId)) return;
    try {
      if (!detectedShape) {
        detectedShape = detectShape(agentId, workspaceId);
      }
      if (detectedShape === "button") {
        const registration = client.addComposerPill({
          id: options.id,
          workspaceId,
          agentId,
          button: {
            title: options.title,
            icon: options.icon ?? "Activity",
            label: options.title,
            behavior: {
              kind: "popover",
              Content: PillPopoverContent as ComponentType<any>,
            },
          },
        });
        const entry: { dispose: () => void; timer?: ReturnType<typeof setInterval> } = {
          dispose: toCleanup(registration),
        };
        pills.set(agentId, entry);
        if (options.resolveLabel && typeof registration !== "function") {
          resolveAndPushLabel(agentId, workspaceId, registration);
          const intervalMs = options.refreshIntervalMs ?? 5000;
          if (intervalMs > 0) {
            entry.timer = setInterval(() => {
              resolveAndPushLabel(agentId, workspaceId, registration);
            }, intervalMs);
          }
        }
        return;
      }
      const cleanup = client.addComposerPill({
        id: options.id,
        title: options.title,
        workspaceId,
        agentId,
        Component: PillHost,
        onPress() {
          const opener = openers.get(agentId);
          if (opener) {
            const defaultPayload = options.resolveDefaultPayload?.({ agentId, workspaceId });
            opener(defaultPayload);
          }
        },
      });
      pills.set(agentId, { dispose: toCleanup(cleanup) });
    } catch (error) {
      reportError(agentId, workspaceId, error);
    }
  }

  function removePill(agentId: string) {
    const entry = pills.get(agentId);
    if (entry?.timer) clearInterval(entry.timer);
    entry?.dispose();
    pills.delete(agentId);
    openers.delete(agentId);
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
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
      for (const { agent } of result.entries) {
        if (agent.workspaceId) addPill(agent.id, agent.workspaceId);
      }
    })
    .catch(() => {});

  return () => {
    unsubscribe();
    for (const entry of pills.values()) {
      if (entry.timer) clearInterval(entry.timer);
      entry.dispose();
    }
    pills.clear();
    openers.clear();
  };
}

interface DefaultPillBodyProps {
  title: string;
  compactTitle?: string;
  icon?: string;
  compactIcon?: string;
  badgeText?: string;
  compactBadgeText?: string;
  theme: HostPillProps["theme"];
}

function DefaultPillBody({
  title,
  compactTitle,
  icon,
  compactIcon,
  badgeText,
  compactBadgeText,
  theme,
}: DefaultPillBodyProps) {
  const { Icon } = getClientHost();
  const { isCompact } = useResponsive();

  const effectiveTitle = isCompact && compactTitle ? compactTitle : title;
  const effectiveIcon = isCompact && compactIcon ? compactIcon : icon;
  const effectiveBadge =
    isCompact && compactBadgeText !== undefined ? compactBadgeText : badgeText;

  return (
    <View style={styles.pillContainer}>
      {effectiveIcon && <Icon name={effectiveIcon} size={13} color={theme.colors.foreground} />}
      {effectiveTitle ? (
        <Text style={[styles.title, { color: theme.colors.foreground }]}>{effectiveTitle}</Text>
      ) : null}
      {effectiveBadge && (
        <View style={[styles.badge, { backgroundColor: theme.colors.surface1 }]}>
          <Text style={[styles.badgeText, { color: theme.colors.foregroundMuted }]}>
            {effectiveBadge}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  popoverContainer: {
    width: "100%",
  },
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  title: {
    fontSize: 12,
    fontWeight: "500",
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
});
