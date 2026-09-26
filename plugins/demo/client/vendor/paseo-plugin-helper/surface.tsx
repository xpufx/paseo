import React, { type ComponentType } from "react";
import { View } from "react-native";
import type { HostSurfaceProps as PluginSurfaceProps } from "./host";
import { PluginThemeProvider } from "./theme/provider";
import { ModalBodyScrollOwnerContext } from "./layout/ModalBody";
import type { VisualFlair } from "./theme/flair";

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
export interface SidebarSurfaceRegistrar {
  addSurface(surfaceId: string, Component: ComponentType<PluginSurfaceProps>): any;
  addSidebarItem(contribution: any): any;
}

export interface RegisterSidebarSurfaceOptions {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<PluginSurfaceProps>;
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
export const DEFAULT_SIDEBAR_MAX_CONTENT_WIDTH = 1280;

/**
 * Caps a surface's content column without dictating its width.
 *
 * `width: "100%"` keeps the column fluid *below* the cap, so a narrow window
 * behaves exactly as it did before this existed. `alignSelf: "center"` only
 * has an effect once the column is capped, and it is the same mechanism
 * `ModalBody` uses — see the comment at ModalBody.tsx:173 for why auto side
 * margins are preferred there and why this is safe here: outside a ScrollView
 * content container there is nothing to stop the column stretching.
 */
const SurfaceContentColumn = ({
  maxContentWidth,
  children,
}: {
  maxContentWidth: number;
  children: React.ReactNode;
}) => (
  <View style={{ width: "100%", maxWidth: maxContentWidth, alignSelf: "center", flex: 1 }}>
    {children}
  </View>
);

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
export function registerSidebarSurface(
  plugin: SidebarSurfaceRegistrar,
  options: RegisterSidebarSurfaceOptions,
): () => void {
  const {
    id,
    title,
    icon,
    Component,
    flair,
    maxContentWidth = DEFAULT_SIDEBAR_MAX_CONTENT_WIDTH,
  } = options;

  const WrappedComponent: ComponentType<PluginSurfaceProps> = (props) => (
    <PluginThemeProvider theme={props.theme} layout={props.layout} flair={flair}>
      <ModalBodyScrollOwnerContext.Provider value="required">
        {maxContentWidth === false ? (
          <Component {...props} />
        ) : (
          <SurfaceContentColumn maxContentWidth={maxContentWidth}>
            <Component {...props} />
          </SurfaceContentColumn>
        )}
      </ModalBodyScrollOwnerContext.Provider>
    </PluginThemeProvider>
  );

  const surfaceRegistration = plugin.addSurface(id, WrappedComponent);
  const itemRegistration = plugin.addSidebarItem({
    id,
    title,
    icon,
    surface: id,
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // Host registrations expose `remove()`; tolerate hosts that return a bare
    // function or nothing so cleanup never throws.
    for (const registration of [itemRegistration, surfaceRegistration]) {
      if (!registration) continue;
      if (typeof registration === "function") {
        (registration as () => void)();
      } else if (typeof registration.remove === "function") {
        registration.remove();
      }
    }
  };
}
