import type {
  ComponentType,
  ForwardRefExoticComponent,
  ReactElement,
  ReactNode,
  Ref,
  RefAttributes,
} from "react";
import type {
  FlatList as RNFlatList,
  FlatListProps,
  ScrollView as RNScrollView,
  ScrollViewProps,
  TextInput as RNTextInput,
  TextInputProps,
} from "react-native";
import type {
  PluginButtonRegistration,
  PluginComposerPillContribution,
} from "@getpaseo/plugin/client";

/**
 * Structural host types for Paseo client integration.
 *
 * These interfaces describe the shapes `paseo-plugin-helper/client` needs
 * from the Paseo host app: the runtime dependencies the plugin injects once
 * in its client entry — the host theme, the layout, the icon/Modal primitives,
 * the agents feed — so they can be supplied from any entry point.
 *
 * The composer pill is the exception: the host owns that contribution's shape,
 * so it is imported from the Paseo SDK rather than restated here. A restated
 * copy is what let a pre-0.9 `{Component, onPress}` pill through the type
 * system (#666).
 */

export interface HostThemeColors {
  surface0: string;
  surface1: string;
  surface2: string;
  border: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  accentForeground: string;
  statusSuccess: string;
  statusWarning: string;
  statusDanger: string;
}

export interface HostTheme {
  colors: HostThemeColors;
}

export interface HostLayout {
  compact: boolean;
  platform: "ios" | "android" | "web";
  width?: number;
  height?: number;
}

export interface HostIconProps {
  name: string;
  size?: number;
  color?: string;
}

export type HostIcon = ComponentType<HostIconProps>;

export interface HostModalContentProps {
  children: ReactNode;
  scrollable?: boolean;
}

export interface HostModalProps {
  title: string;
  icon?: ReactNode;
  open: boolean;
  onOpenChange(open: boolean): void;
  children: ReactNode;
}

export type HostModal = ComponentType<HostModalProps> & {
  Content: ComponentType<HostModalContentProps>;
};

export interface HostToast {
  show?: (message: string, options?: any) => void;
  copied?: (label?: string) => void;
  error?: (message: string) => void;
}

export type HostUseToast = () => HostToast;

export interface HostRpcContract {
  name: string;
}

// Takes `any` contract deliberately: both SDK generations type their own
// contract shapes, and structural acceptance in both directions only holds
// for `any`. Call sites in useRpcQuery/usePluginSettings keep full typing
// through their own generics.
export type HostUseRpc = (contract: any) => (input: any) => Promise<any>;

export interface HostAgentRef {
  id: string;
  workspaceId?: string | null;
}

export type HostAgentUpdate =
  | { kind: "remove"; agentId: string }
  | { kind: string; agent: HostAgentRef };

export interface HostAgentsApi {
  subscribe(cb: (update: HostAgentUpdate) => void): () => void;
  list(): Promise<{ entries: Array<{ agent: HostAgentRef }> }>;
}

export type PluginCleanup = () => void;

export type HostCopyText = (text: string) => Promise<void>;

export type HostScrollView = ForwardRefExoticComponent<
  ScrollViewProps & RefAttributes<RNScrollView>
>;

export type HostFlatList = <ItemT>(
  props: FlatListProps<ItemT> & { ref?: Ref<RNFlatList<ItemT>> },
) => ReactElement;

export type HostTextInput = ForwardRefExoticComponent<
  TextInputProps & RefAttributes<RNTextInput>
>;

export interface ClientHostDeps {
  Icon: HostIcon;
  Modal: HostModal;
  useRpc: HostUseRpc;
  useToast: HostUseToast;
  copyText?: HostCopyText;
  ScrollView?: HostScrollView;
  FlatList?: HostFlatList;
  TextInput?: HostTextInput;
}

let deps: ClientHostDeps | undefined;

export function initClientHelpers(host: ClientHostDeps): void {
  deps = host;
}

export function getClientHost(): ClientHostDeps {
  if (!deps) {
    throw new Error(
      "paseo-plugin-helper/client used before initClientHelpers(). " +
        "Call initClientHelpers({ Icon, Modal, useRpc, useToast }) in the plugin client entry.",
    );
  }
  return deps;
}

export function getOptionalClientHost(): ClientHostDeps | undefined {
  return deps;
}

/**
 * Single precedence rule for scrollable surfaces: the host-injected
 * ScrollView (sheet-aware on Paseo v0.8, cooperates with bottom-sheet
 * gestures) wins whenever the plugin supplied one to initClientHelpers;
 * otherwise plain React Native ScrollView (pre-0.8 fallback, where the
 * caller avoids nesting inside host scrollers itself).
 */
export function selectHostScrollView(
  host: Pick<ClientHostDeps, "ScrollView"> | undefined,
  fallback: HostScrollView,
): HostScrollView {
  return host?.ScrollView ?? fallback;
}

export interface HostPillProps {
  agentId: string;
  workspaceId: string;
  theme: HostTheme;
  layout: HostLayout;
  host: {
    id: string;
    label: string;
  };
}

export interface HostWorkspacePanelProps {
  context: "workspace";
  workspaceId: string;
  theme: HostTheme;
  layout: HostLayout;
  host: {
    id: string;
    label: string;
  };
}

export interface HostAgentPanelProps {
  context: "agent";
  workspaceId: string;
  agentId: string;
  theme: HostTheme;
  layout: HostLayout;
  host: {
    id: string;
    label: string;
  };
}

export interface HostSurfaceProps {
  theme: HostTheme;
  layout: HostLayout;
  host: {
    id: string;
    label: string;
  };
}

export interface ComposerPillRegistrar {
  addComposerPill(contribution: PluginComposerPillContribution): PluginButtonRegistration;
  paseo: {
    agents: HostAgentsApi;
  };
}

export function isClientHostInitialized(): boolean {
  return deps !== undefined;
}
