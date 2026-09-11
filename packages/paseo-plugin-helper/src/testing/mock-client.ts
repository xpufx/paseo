import type { ComponentType } from "react";
import type {
  ComposerPillRegistrar,
  ComposerPillContribution,
  HostAgentRef,
  HostAgentUpdate,
  HostSurfaceProps,
  PluginCleanup,
} from "../client/host.js";

export interface MockAgent extends HostAgentRef {
  [key: string]: any;
}

export interface MockSettingsScreenContribution {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<HostSurfaceProps>;
}

export interface MockClientContext {
  registeredPills: ComposerPillContribution[];
  registeredSurfaces: Array<{ id: string; Component: ComponentType<HostSurfaceProps> }>;
  registeredSettingsScreens: MockSettingsScreenContribution[];
  addComposerPill(contribution: ComposerPillContribution): PluginCleanup;
  openPanel(id: string, options?: unknown): void;
  rpc(contract: { name: string }, input: unknown): Promise<unknown>;
  openSurface(id: string): void;
  openSettings(id: string): void;
  addSettingsScreen(contribution: MockSettingsScreenContribution): PluginCleanup;
  addSurface(id: string, component: unknown): PluginCleanup;
  addSidebarItem(contribution: unknown): PluginCleanup;
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
      list(): Promise<{ entries: Array<{ agent: MockAgent }> }>;
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
 * v0.7 and v0.8 client contexts without importing any SDK module.
 */
export function createMockClientContext(): MockClientContext {
  const registeredPills: ComposerPillContribution[] = [];
  const registeredSurfaces: Array<{ id: string; Component: ComponentType<HostSurfaceProps> }> = [];
  const registeredSettingsScreens: MockSettingsScreenContribution[] = [];
  const agentSubscribers = new Set<(update: HostAgentUpdate) => void>();
  const agents = new Map<string, MockAgent>();

  const mock: MockClientContext = {
    registeredPills,
    registeredSurfaces,
    registeredSettingsScreens,

    addComposerPill(contribution: ComposerPillContribution): PluginCleanup {
      registeredPills.push(contribution);
      return () => {
        const index = registeredPills.indexOf(contribution);
        if (index >= 0) registeredPills.splice(index, 1);
      };
    },

    openPanel: () => {},

    rpc: async () => ({} as any),

    openSurface: () => {},

    openSettings: () => {},

    addSettingsScreen(contribution: MockSettingsScreenContribution): PluginCleanup {
      registeredSettingsScreens.push(contribution);
      return () => {
        const index = registeredSettingsScreens.indexOf(contribution);
        if (index >= 0) registeredSettingsScreens.splice(index, 1);
      };
    },
    addSurface: () => noopCleanup,
    addSidebarItem: () => noopCleanup,
    addWorkspacePanel: () => noopCleanup,
    addCommandCenterItem: () => noopCleanup,
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
        list: async () => ({
          entries: Array.from(agents.values()).map((agent) => ({ agent })),
        }),
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
