import type { ComponentType } from "react";
import type {
  ComposerPillRegistrar,
  HostAgentRef,
  HostAgentUpdate,
  HostSurfaceProps,
  PluginCleanup,
} from "../core/host.js";
import type {
  PluginButtonRegistration,
  PluginComposerPillContribution,
} from "@getpaseo/plugin/client";
import type { CommandCenterItemContribution } from "../core/command-center.js";

export interface MockAgent extends HostAgentRef {
  [key: string]: any;
}

export interface MockSettingsScreenContribution {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<HostSurfaceProps>;
}

export interface MockScreenContribution {
  id: string;
  title: string | ((params: any) => string);
  Component: ComponentType<HostSurfaceProps>;
}

export interface MockSidebarHeaderItemContribution {
  id: string;
  title: string;
  icon: string;
  screen?: string;
  [key: string]: any;
}

export interface MockClientContext {
  registeredPills: PluginComposerPillContribution[];
  registeredSurfaces: Array<{ id: string; Component: ComponentType<HostSurfaceProps> }>;
  registeredScreens: MockScreenContribution[];
  registeredSidebarHeaderItems: MockSidebarHeaderItemContribution[];
  registeredSidebarItems: any[];
  registeredSettingsScreens: MockSettingsScreenContribution[];
  registeredCommandCenterItems: CommandCenterItemContribution[];
  openedSurfaces: string[];
  openedScreens: Array<{ screenId: string; params?: Record<string, string> }>;
  addComposerPill(contribution: PluginComposerPillContribution): PluginButtonRegistration;
  openPanel(id: string, options?: unknown): void;
  rpc(contract: { name: string }, input: unknown): Promise<unknown>;
  openSurface(id: string): void;
  openScreen(target: string | { screenId: string; params?: Record<string, string> }): void;
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
        entries: Array<{ agent: MockAgent }>;
        subscription?: {
          subscribe(observer: {
            snapshot?(snapshot: { entries: Array<{ agent: MockAgent }> }): void;
            update?(message: { type: string; payload: HostAgentUpdate }): void;
          }): () => void;
        };
      }>;
      ref(id: string): unknown;
      create(options: unknown): Promise<unknown>;
      subscribe(cb: (update: HostAgentUpdate) => void): () => void;
    };
  };
  simulateAgentAdded: (agent: Partial<MockAgent> & { id: string; workspaceId: string }) => void;
  simulateAgentRemoved: (agentId: string) => void;
}

const noopCleanup: PluginCleanup = () => {};

/**
 * Creates a fully functional mock client context for testing client plugin
 * contributions. Implements the same structural shapes as the real Paseo
 * client context without importing any SDK module at runtime.
 */
export function createMockClientContext(): MockClientContext {
  const registeredPills: PluginComposerPillContribution[] = [];
  const registeredSurfaces: Array<{ id: string; Component: ComponentType<HostSurfaceProps> }> = [];
  const registeredScreens: MockScreenContribution[] = [];
  const registeredSidebarHeaderItems: MockSidebarHeaderItemContribution[] = [];
  const registeredSidebarItems: any[] = [];
  const registeredSettingsScreens: MockSettingsScreenContribution[] = [];
  const registeredCommandCenterItems: CommandCenterItemContribution[] = [];
  const openedSurfaces: string[] = [];
  const openedScreens: Array<{ screenId: string; params?: Record<string, string> }> = [];
  const agentSubscribers = new Set<(update: HostAgentUpdate) => void>();
  const agents = new Map<string, MockAgent>();

  const mock: MockClientContext = {
    registeredPills,
    registeredSurfaces,
    registeredScreens,
    registeredSidebarHeaderItems,
    registeredSidebarItems,
    registeredSettingsScreens,
    registeredCommandCenterItems,
    openedSurfaces,
    openedScreens,

    addComposerPill(contribution: PluginComposerPillContribution): PluginButtonRegistration {
      registeredPills.push(contribution);
      const remove = () => {
        const index = registeredPills.indexOf(contribution);
        if (index >= 0) registeredPills.splice(index, 1);
      };
      return { update: () => {}, remove };
    },

    openPanel: () => {},

    rpc: async () => ({} as any),

    openSurface: (id: string) => {
      openedSurfaces.push(id);
    },

    openScreen: (target: string | { screenId: string; params?: Record<string, string> }) => {
      if (typeof target === "string") {
        openedScreens.push({ screenId: target });
      } else {
        openedScreens.push(target);
      }
    },

    openSettings: () => {},

    addSettingsScreen(contribution: MockSettingsScreenContribution): PluginCleanup {
      registeredSettingsScreens.push(contribution);
      return () => {
        const index = registeredSettingsScreens.indexOf(contribution);
        if (index >= 0) registeredSettingsScreens.splice(index, 1);
      };
    },
    addSurface: (id: string, component: unknown): PluginCleanup => {
      const entry = { id, Component: component as ComponentType<HostSurfaceProps> };
      registeredSurfaces.push(entry);
      return () => {
        const index = registeredSurfaces.indexOf(entry);
        if (index >= 0) registeredSurfaces.splice(index, 1);
      };
    },
    addScreen: (contribution: MockScreenContribution): PluginCleanup => {
      registeredScreens.push(contribution);
      return () => {
        const index = registeredScreens.indexOf(contribution);
        if (index >= 0) registeredScreens.splice(index, 1);
      };
    },
    addSidebarItem: (contribution: unknown): PluginCleanup => {
      registeredSidebarItems.push(contribution);
      return () => {
        const index = registeredSidebarItems.indexOf(contribution);
        if (index >= 0) registeredSidebarItems.splice(index, 1);
      };
    },
    addSidebarHeaderItem: (contribution: MockSidebarHeaderItemContribution): PluginCleanup => {
      registeredSidebarHeaderItems.push(contribution);
      return () => {
        const index = registeredSidebarHeaderItems.indexOf(contribution);
        if (index >= 0) registeredSidebarHeaderItems.splice(index, 1);
      };
    },
    addWorkspacePanel: () => noopCleanup,
    addCommandCenterItem(contribution: CommandCenterItemContribution): PluginCleanup {
      registeredCommandCenterItems.push(contribution);
      return () => {
        const index = registeredCommandCenterItems.indexOf(contribution);
        if (index >= 0) registeredCommandCenterItems.splice(index, 1);
      };
    },
    addSlashCommand: () => noopCleanup,
    addAttachmentSource: () => noopCleanup,
    addTheme: () => noopCleanup,
    addTimelineTransformer: () => noopCleanup,
    addTimelineRenderer: () => noopCleanup,

    paseo: {
      workspaces: {} as any,
      projects: {} as any,
      providers: {} as any,
      config: {} as any,
      terminals: {} as any,
      agents: {
        list: async (options?: any) => {
          const entries = Array.from(agents.values()).map((agent) => ({ agent }));
          if (options?.subscribe) {
            const subscription = {
              subscribe: (observer: {
                snapshot?(snapshot: { entries: Array<{ agent: MockAgent }> }): void;
                update?(message: { type: string; payload: HostAgentUpdate }): void;
              }) => {
                const unsub = () => {
                  agentSubscribers.delete(listener);
                };
                const listener = (update: HostAgentUpdate) => {
                  observer.update?.({ type: "agent_update", payload: update });
                };
                agentSubscribers.add(listener);
                observer.snapshot?.({ entries });
                return unsub;
              },
            };
            return { entries, subscription };
          }
          return { entries };
        },
        ref: () => ({} as any),
        create: async () => ({} as any),
        subscribe: (cb: (update: HostAgentUpdate) => void) => {
          agentSubscribers.add(cb);
          return () => {
            agentSubscribers.delete(cb);
          };
        },
      },
    },

    simulateAgentAdded(agentData) {
      const snapshot: MockAgent = {
        provider: "mock-provider",
        cwd: "/workspace",
        model: "mock-model",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUserMessageAt: null,
        status: "idle",
        ...agentData,
      } as MockAgent;

      agents.set(snapshot.id, snapshot);
      for (const subscriber of agentSubscribers) {
        subscriber({ kind: "upsert", agent: snapshot });
      }
    },

    simulateAgentRemoved(agentId: string) {
      agents.delete(agentId);
      for (const subscriber of agentSubscribers) {
        subscriber({ kind: "remove", agentId });
      }
    },
  };

  return mock;
}
