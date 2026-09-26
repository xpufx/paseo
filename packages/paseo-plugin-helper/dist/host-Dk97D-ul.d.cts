import { ComponentType, ReactNode, ForwardRefExoticComponent, RefAttributes, Ref, ReactElement } from 'react';
import { ScrollViewProps, ScrollView, FlatListProps, FlatList, TextInputProps, TextInput } from 'react-native';
import { PluginComposerPillContribution, PluginButtonRegistration } from '@getpaseo/plugin/client';

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
interface HostThemeColors {
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
interface HostTheme {
    colors: HostThemeColors;
}
interface HostLayout {
    compact: boolean;
    platform: "ios" | "android" | "web";
    width?: number;
    height?: number;
}
interface HostIconProps {
    name: string;
    size?: number;
    color?: string;
}
type HostIcon = ComponentType<HostIconProps>;
interface HostModalContentProps {
    children: ReactNode;
    scrollable?: boolean;
}
interface HostModalProps {
    title: string;
    icon?: ReactNode;
    open: boolean;
    onOpenChange(open: boolean): void;
    children: ReactNode;
}
type HostModal = ComponentType<HostModalProps> & {
    Content: ComponentType<HostModalContentProps>;
};
interface HostToast {
    show?: (message: string, options?: any) => void;
    copied?: (label?: string) => void;
    error?: (message: string) => void;
}
type HostUseToast = () => HostToast;
interface HostRpcContract {
    name: string;
}
type HostUseRpc = (contract: any) => (input: any) => Promise<any>;
interface HostAgentRef {
    id: string;
    workspaceId?: string | null;
}
type HostAgentUpdate = {
    kind: "remove";
    agentId: string;
} | {
    kind: string;
    agent: HostAgentRef;
};
interface HostAgentsApi {
    subscribe(cb: (update: HostAgentUpdate) => void): () => void;
    list(): Promise<{
        entries: Array<{
            agent: HostAgentRef;
        }>;
    }>;
}
type PluginCleanup = () => void;
type HostCopyText = (text: string) => Promise<void>;
type HostScrollView = ForwardRefExoticComponent<ScrollViewProps & RefAttributes<ScrollView>>;
type HostFlatList = <ItemT>(props: FlatListProps<ItemT> & {
    ref?: Ref<FlatList<ItemT>>;
}) => ReactElement;
type HostTextInput = ForwardRefExoticComponent<TextInputProps & RefAttributes<TextInput>>;
interface ClientHostDeps {
    Icon: HostIcon;
    Modal: HostModal;
    useRpc: HostUseRpc;
    useToast: HostUseToast;
    copyText?: HostCopyText;
    ScrollView?: HostScrollView;
    FlatList?: HostFlatList;
    TextInput?: HostTextInput;
}
declare function initClientHelpers(host: ClientHostDeps): void;
declare function getClientHost(): ClientHostDeps;
declare function getOptionalClientHost(): ClientHostDeps | undefined;
/**
 * Single precedence rule for scrollable surfaces: the host-injected
 * ScrollView (sheet-aware on Paseo v0.8, cooperates with bottom-sheet
 * gestures) wins whenever the plugin supplied one to initClientHelpers;
 * otherwise plain React Native ScrollView (pre-0.8 fallback, where the
 * caller avoids nesting inside host scrollers itself).
 */
declare function selectHostScrollView(host: Pick<ClientHostDeps, "ScrollView"> | undefined, fallback: HostScrollView): HostScrollView;
interface HostPillProps {
    agentId: string;
    workspaceId: string;
    theme: HostTheme;
    layout: HostLayout;
    host: {
        id: string;
        label: string;
    };
}
interface HostWorkspacePanelProps {
    context: "workspace";
    workspaceId: string;
    theme: HostTheme;
    layout: HostLayout;
    host: {
        id: string;
        label: string;
    };
}
interface HostAgentPanelProps {
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
interface HostSurfaceProps {
    theme: HostTheme;
    layout: HostLayout;
    host: {
        id: string;
        label: string;
    };
}
interface ComposerPillRegistrar {
    addComposerPill(contribution: PluginComposerPillContribution): PluginButtonRegistration;
    paseo: {
        agents: HostAgentsApi;
    };
}
declare function isClientHostInitialized(): boolean;

export { type HostScrollView as A, type HostTextInput as B, type ClientHostDeps as C, type HostAgentRef as H, type PluginCleanup as P, type HostAgentUpdate as a, type HostAgentsApi as b, type HostCopyText as c, type HostLayout as d, type HostRpcContract as e, type HostTheme as f, type HostThemeColors as g, type HostToast as h, type HostUseRpc as i, type HostUseToast as j, getClientHost as k, getOptionalClientHost as l, initClientHelpers as m, isClientHostInitialized as n, type HostSurfaceProps as o, type HostPillProps as p, type ComposerPillRegistrar as q, type HostAgentPanelProps as r, selectHostScrollView as s, type HostWorkspacePanelProps as t, type HostIconProps as u, type HostFlatList as v, type HostIcon as w, type HostModal as x, type HostModalContentProps as y, type HostModalProps as z };
