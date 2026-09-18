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

export { type ComposerPillRegistrationHandle as A, type ComposerPillSdkContribution as B, type ClientHostDeps as C, type HostFlatList as D, type HostIcon as E, type HostModal as F, type HostModalContentProps as G, type HostAgentRef as H, type HostModalProps as I, type HostScrollView as J, type HostTextInput as K, type PluginCleanup as P, type HostAgentUpdate as a, type HostAgentsApi as b, type HostCopyText as c, type HostLayout as d, type HostRpcContract as e, type HostTheme as f, type HostThemeColors as g, type HostToast as h, type HostUseRpc as i, type HostUseToast as j, getClientHost as k, getOptionalClientHost as l, initClientHelpers as m, isClientHostInitialized as n, type HostSurfaceProps as o, type ComposerPillContribution as p, type HostPillProps as q, type ComposerPillRegistrar as r, selectHostScrollView as s, type HostAgentPanelProps as t, type HostWorkspacePanelProps as u, type HostIconProps as v, type ComposerPillButtonContribution as w, type ComposerPillButtonDescriptor as x, type ComposerPillButtonIcon as y, type ComposerPillRegistration as z };
