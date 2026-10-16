import { ComponentType } from 'react';
import { H as HostAgentRef, a as HostSurfaceProps, P as PluginCleanup, b as HostAgentUpdate } from '../host-D31sreow.cjs';
import { PluginComposerPillContribution, PluginButtonRegistration } from '@getpaseo/plugin/client';
import { C as CommandCenterItemContribution } from '../command-center-CWeeXQoh.cjs';
import { P as PluginRpcContract, R as RpcInput, a as RpcOutput } from '../rpc-D27pph91.cjs';
import 'react-native';
import 'zod';

interface MockAgent extends HostAgentRef {
    [key: string]: any;
}
interface MockSettingsScreenContribution {
    id: string;
    title: string;
    icon: string;
    Component: ComponentType<HostSurfaceProps>;
}
interface MockScreenContribution {
    id: string;
    title: string | ((params: any) => string);
    Component: ComponentType<HostSurfaceProps>;
}
interface MockSidebarHeaderItemContribution {
    id: string;
    title: string;
    icon: string;
    screen?: string;
    [key: string]: any;
}
interface MockClientContext {
    registeredPills: PluginComposerPillContribution[];
    registeredSurfaces: Array<{
        id: string;
        Component: ComponentType<HostSurfaceProps>;
    }>;
    registeredScreens: MockScreenContribution[];
    registeredSidebarHeaderItems: MockSidebarHeaderItemContribution[];
    registeredSidebarItems: any[];
    registeredSettingsScreens: MockSettingsScreenContribution[];
    registeredCommandCenterItems: CommandCenterItemContribution[];
    openedSurfaces: string[];
    openedScreens: Array<{
        screenId: string;
        params?: Record<string, string>;
    }>;
    addComposerPill(contribution: PluginComposerPillContribution): PluginButtonRegistration;
    openPanel(id: string, options?: unknown): void;
    rpc(contract: {
        name: string;
    }, input: unknown): Promise<unknown>;
    openSurface(id: string): void;
    openScreen(target: string | {
        screenId: string;
        params?: Record<string, string>;
    }): void;
    openSettings(id: string): void;
    addSettingsScreen(contribution: MockSettingsScreenContribution): PluginCleanup;
    addSurface(id: string, component: unknown): PluginCleanup;
    addScreen(contribution: MockScreenContribution): PluginCleanup;
    addSidebarItem(contribution: unknown): PluginCleanup;
    addSidebarHeaderItem(contribution: MockSidebarHeaderItemContribution): PluginCleanup;
    addWorkspacePanel(contribution: unknown): PluginCleanup;
    addCommandCenterItem(contribution: unknown): PluginCleanup;
    addSlashCommand(contribution: unknown): PluginCleanup;
    addAttachmentSource(contribution: unknown): PluginCleanup;
    addTheme(contribution: unknown): PluginCleanup;
    addTimelineTransformer(contribution: unknown): PluginCleanup;
    addTimelineRenderer(contribution: unknown): PluginCleanup;
    paseo: {
        workspaces: unknown;
        projects: unknown;
        providers: unknown;
        config: unknown;
        terminals: unknown;
        agents: {
            list(options?: any): Promise<{
                entries: Array<{
                    agent: MockAgent;
                }>;
                subscription?: {
                    subscribe(observer: {
                        snapshot?(snapshot: {
                            entries: Array<{
                                agent: MockAgent;
                            }>;
                        }): void;
                        update?(message: {
                            type: string;
                            payload: HostAgentUpdate;
                        }): void;
                    }): () => void;
                };
            }>;
            ref(id: string): unknown;
            create(options: unknown): Promise<unknown>;
            subscribe(cb: (update: HostAgentUpdate) => void): () => void;
        };
    };
    simulateAgentAdded: (agent: Partial<MockAgent> & {
        id: string;
        workspaceId: string;
    }) => void;
    simulateAgentRemoved: (agentId: string) => void;
}
/**
 * Creates a fully functional mock client context for testing client plugin
 * contributions. Implements the same structural shapes as the real Paseo
 * client context without importing any SDK module at runtime.
 */
declare function createMockClientContext(): MockClientContext;

type MockRpcHandler = (input: any, context: any) => Promise<any> | any;
interface MockServerContext {
    handle(contract: {
        name: string;
    }, handler: MockRpcHandler): void;
    registerSettings(definition: unknown): void;
    registerProvider(provider: unknown): void;
    on(name: string, handler: (...args: any[]) => void | Promise<void>): () => void;
    before(name: string, handler: (...args: any[]) => unknown): () => void;
    handlers: Map<string, MockRpcHandler>;
    callRpc: <TContract extends PluginRpcContract<any, any>>(contract: TContract, input: RpcInput<TContract>) => Promise<RpcOutput<TContract>>;
}
/**
 * Creates a mock server context for testing server RPC handlers and plugin
 * contributions. Implements the structural handler shape shared by the Paseo
 * v0.7 and v0.8 server contexts without importing any SDK module.
 */
declare function createMockServerContext(): MockServerContext;

export { type MockAgent, type MockClientContext, type MockRpcHandler, type MockScreenContribution, type MockServerContext, type MockSettingsScreenContribution, type MockSidebarHeaderItemContribution, createMockClientContext, createMockServerContext };
