import { ComponentType, ReactNode, ForwardRefExoticComponent, RefAttributes, Ref, ReactElement } from 'react';
import { ScrollViewProps, ScrollView, FlatListProps, FlatList, TextInputProps, TextInput } from 'react-native';

/**
 * Structural host types for Paseo client integration.
 *
 * These interfaces describe the shapes `paseo-plugin-helper/client` needs
 * from the Paseo host app. They are intentionally decoupled from any
 * Paseo SDK version: this module (and every client module built on
 * it) contains zero Paseo SDK imports, so a single published helper
 * bundle satisfies both the Paseo v0.7 SDK entry points and the Paseo
 * v0.8 runtime-owned entry points.
 *
 * The plugin author provides the real host implementations once, in the
 * client entry, using whichever specifiers match their installed SDK.
 * See docs/client.md for the per-version import paths.
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
interface ComposerPillContribution {
    id: string;
    title: string;
    workspaceId: string;
    agentId: string;
    Component: ComponentType<HostPillProps>;
    onPress(): void | Promise<void>;
}
type ComposerPillButtonIcon = string | ComponentType<any>;
interface ComposerPillButtonDescriptor {
    title: string;
    icon: ComposerPillButtonIcon;
    label?: string;
    visible?: boolean;
    disabled?: boolean;
    behavior: {
        kind: "action";
        onPress(): void | Promise<void>;
    } | {
        kind: "popover";
        Content: ComponentType<any>;
    };
}
interface ComposerPillButtonContribution {
    id: string;
    workspaceId: string;
    agentId: string;
    button: ComposerPillButtonDescriptor;
}
interface ComposerPillSdkContribution {
    id: string;
    workspaceId: string;
    agentId: string;
    button: Record<string, any>;
    [key: string]: any;
}
interface ComposerPillRegistrationHandle {
    update(patch: Record<string, any>): void;
    remove(): void;
}
type ComposerPillRegistration = PluginCleanup | ComposerPillRegistrationHandle;
interface ComposerPillRegistrar {
    addComposerPill(contribution: ComposerPillContribution | ComposerPillButtonContribution | ComposerPillSdkContribution): ComposerPillRegistration;
    paseo: {
        agents: HostAgentsApi;
    };
}
declare function isClientHostInitialized(): boolean;

/**
 * Structural registrar interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginClientContext.
 */
interface CommandCenterItemRegistrar {
    addCommandCenterItem(contribution: any): any;
}
type CommandCenterContext = "global" | "workspace" | "agent";
/**
 * Capabilities the host passes to a command-center item's `onSelect`. Mirrors
 * the subset of `PluginCommandCapabilities` the helper needs; the real host
 * context carries additional fields (paseo, rpc, workspace, agent) that a
 * handler may read off its own typed contribution.
 */
interface CommandCenterCapabilities {
    openSurface(id: string): void;
    openSettings(id: string): void;
}
interface CommandCenterItemContribution {
    id: string;
    title: string;
    icon: string;
    keywords?: readonly string[];
    context: CommandCenterContext;
    onSelect(context: CommandCenterCapabilities): void | Promise<void>;
}
/**
 * Registers a command-center palette item — the entry the host Ctrl+K command
 * center lists. Thin pass-through that keeps plugins on the helper seam and
 * works with both Paseo v0.7 PluginContext and Paseo v0.8 PluginClientContext.
 */
declare function registerCommandCenterItem(plugin: CommandCenterItemRegistrar, contribution: CommandCenterItemContribution): PluginCleanup;

export { type HostModalProps as A, type HostRpcContract as B, type ComposerPillContribution as C, type HostScrollView as D, type HostTextInput as E, type HostTheme as F, type HostThemeColors as G, type HostAgentRef as H, type HostUseRpc as I, type HostUseToast as J, getClientHost as K, getOptionalClientHost as L, initClientHelpers as M, isClientHostInitialized as N, registerCommandCenterItem as O, type PluginCleanup as P, selectHostScrollView as Q, type HostSurfaceProps as a, type CommandCenterItemContribution as b, type HostAgentUpdate as c, type HostLayout as d, type HostPillProps as e, type ComposerPillRegistrar as f, type HostAgentPanelProps as g, type HostWorkspacePanelProps as h, type HostToast as i, type HostIconProps as j, type ClientHostDeps as k, type CommandCenterCapabilities as l, type CommandCenterContext as m, type CommandCenterItemRegistrar as n, type ComposerPillButtonContribution as o, type ComposerPillButtonDescriptor as p, type ComposerPillButtonIcon as q, type ComposerPillRegistration as r, type ComposerPillRegistrationHandle as s, type ComposerPillSdkContribution as t, type HostAgentsApi as u, type HostCopyText as v, type HostFlatList as w, type HostIcon as x, type HostModal as y, type HostModalContentProps as z };
