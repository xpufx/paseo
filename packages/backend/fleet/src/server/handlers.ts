import {
  fleetRosterContract,
  archiveAgentContract,
  archiveInactiveAgentsContract,
  createFrontDeskContract,
  replaceFrontDeskContract,
  addOrchestratorContract,
  replaceOrchestratorContract,
  toggleRepoPauseContract,
  fleetHaltContract,
  fleetResumeContract,
  fleetTeardownContract,
  type FleetRosterInput,
  type ArchiveAgentInput,
  type ArchiveInactiveAgentsInput,
  type CreateFrontDeskInput,
  type AddOrchestratorInput,
  type ToggleRepoPauseInput,
  type FleetHaltInput,
  type FleetTeardownInput,
} from "../shared/schemas.js";
import { readFleetRoster, type ReadFleetOptions } from "./roster.js";
import type { FleetOutput } from "../client/types.js";
import type { WorkspaceProjectMap } from "../shared/classify.js";
import type { WorkspaceRecord, ProjectRecord } from "./workspace.js";

export interface FleetLogger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

const defaultLogger: FleetLogger = {
  info: () => {},
  warn: (msg, ctx) => console.warn(`[fleet:warn] ${msg}`, ctx ?? ""),
  debug: () => {},
};

export interface FleetHandlerOptions extends ReadFleetOptions {
  log?: FleetLogger;
  pausedRepos?: string[];
  repoQueuedHooks?: Record<string, number>;
  workspaceProjectMap?: WorkspaceProjectMap;
  workspacesData?: readonly WorkspaceRecord[];
  projectsData?: readonly ProjectRecord[];

  onArchiveAgent?: (input: ArchiveAgentInput, context?: any) => Promise<{ ok: boolean; error?: string }>;
  onArchiveInactive?: (input: ArchiveInactiveAgentsInput, context?: any) => Promise<{ ok: boolean; archivedCount: number; error?: string }>;
  onCreateFrontDesk?: (input: CreateFrontDeskInput, context?: any) => Promise<{ ok: boolean; agentId?: string; error?: string }>;
  onReplaceFrontDesk?: (input: CreateFrontDeskInput, context?: any) => Promise<{ ok: boolean; agentId?: string; error?: string }>;
  onAddOrchestrator?: (input: AddOrchestratorInput, context?: any) => Promise<{ ok: boolean; agentId?: string; error?: string }>;
  onReplaceOrchestrator?: (input: AddOrchestratorInput, context?: any) => Promise<{ ok: boolean; agentId?: string; error?: string }>;
  onToggleRepoPause?: (input: ToggleRepoPauseInput, context?: any) => Promise<{ ok: boolean; paused: boolean; repo: string; error?: string }>;
  onFleetHalt?: (input: FleetHaltInput, context?: any) => Promise<{ ok: boolean; halted: boolean; error?: string }>;
  onFleetResume?: (input: FleetHaltInput, context?: any) => Promise<{ ok: boolean; resumed: boolean; error?: string }>;
  onFleetTeardown?: (input: FleetTeardownInput, context?: any) => Promise<{ ok: boolean; error?: string }>;
}

export interface HandleableServerContext {
  handle(contract: any, handler: (input: any, context?: any) => Promise<any> | any): void;
  [key: string]: any;
}

export interface FleetHandlers {
  handleFleetRoster(input?: FleetRosterInput, context?: any): Promise<FleetOutput>;
  handleArchiveAgent(input: ArchiveAgentInput, context?: any): Promise<{ ok: boolean; error?: string }>;
  handleArchiveInactive(input?: ArchiveInactiveAgentsInput, context?: any): Promise<{ ok: boolean; archivedCount: number; error?: string }>;
  handleCreateFrontDesk(input?: CreateFrontDeskInput, context?: any): Promise<{ ok: boolean; agentId?: string; error?: string }>;
  handleReplaceFrontDesk(input?: CreateFrontDeskInput, context?: any): Promise<{ ok: boolean; agentId?: string; error?: string }>;
  handleAddOrchestrator(input: AddOrchestratorInput, context?: any): Promise<{ ok: boolean; agentId?: string; error?: string }>;
  handleReplaceOrchestrator(input: AddOrchestratorInput, context?: any): Promise<{ ok: boolean; agentId?: string; error?: string }>;
  handleToggleRepoPause(input: ToggleRepoPauseInput, context?: any): Promise<{ ok: boolean; paused: boolean; repo: string; error?: string }>;
  handleFleetHalt(input?: FleetHaltInput, context?: any): Promise<{ ok: boolean; halted: boolean; error?: string }>;
  handleFleetResume(input?: FleetHaltInput, context?: any): Promise<{ ok: boolean; resumed: boolean; error?: string }>;
  handleFleetTeardown(input?: FleetTeardownInput, context?: any): Promise<{ ok: boolean; error?: string }>;
}

export function createFleetHandlers(options?: FleetHandlerOptions): FleetHandlers {
  const log = options?.log || defaultLogger;

  return {
    async handleFleetRoster(input, context): Promise<FleetOutput> {
      try {
        const mergedOptions = {
          ...options,
          enrolledRepos: input?.enrolledRepos ?? options?.enrolledRepos,
          mutedRepos: input?.mutedRepos ?? options?.mutedRepos,
          pausedRepos: input?.pausedRepos ?? options?.pausedRepos,
        };
        return await readFleetRoster(context, mergedOptions);
      } catch (err) {
        log.warn("handleFleetRoster failed", { error: String(err) });
        return {
          ok: false,
          registryAuthoritative: false,
          roleDivergences: [],
          frontDesk: [],
          orchestrators: [],
          workers: [],
          tree: [],
          enrolledRepos: [],
          pausedRepos: [],
          mutedRepos: [],
          repoQueuedHooks: {},
          totalCount: 0,
          runningCount: 0,
          idleCount: 0,
          errorCount: 0,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async handleArchiveAgent(input, context) {
      if (options?.onArchiveAgent) return options.onArchiveAgent(input, context);
      return { ok: false, error: "archive-agent handler not implemented" };
    },

    async handleArchiveInactive(input = {}, context) {
      if (options?.onArchiveInactive) return options.onArchiveInactive(input, context);
      return { ok: false, archivedCount: 0, error: "archive-inactive handler not implemented" };
    },

    async handleCreateFrontDesk(input = {}, context) {
      if (options?.onCreateFrontDesk) return options.onCreateFrontDesk(input, context);
      return { ok: false, error: "create-front-desk handler not implemented" };
    },

    async handleReplaceFrontDesk(input = {}, context) {
      if (options?.onReplaceFrontDesk) return options.onReplaceFrontDesk(input, context);
      return { ok: false, error: "replace-front-desk handler not implemented" };
    },

    async handleAddOrchestrator(input, context) {
      if (options?.onAddOrchestrator) return options.onAddOrchestrator(input, context);
      return { ok: false, error: "add-orchestrator handler not implemented" };
    },

    async handleReplaceOrchestrator(input, context) {
      if (options?.onReplaceOrchestrator) return options.onReplaceOrchestrator(input, context);
      return { ok: false, error: "replace-orchestrator handler not implemented" };
    },

    async handleToggleRepoPause(input, context) {
      if (options?.onToggleRepoPause) return options.onToggleRepoPause(input, context);
      return { ok: false, paused: false, repo: input.repo, error: "toggle-repo-pause handler not implemented" };
    },

    async handleFleetHalt(input = {}, context) {
      if (options?.onFleetHalt) return options.onFleetHalt(input, context);
      return { ok: false, halted: false, error: "fleet-halt handler not implemented" };
    },

    async handleFleetResume(input = {}, context) {
      if (options?.onFleetResume) return options.onFleetResume(input, context);
      return { ok: false, resumed: false, error: "fleet-resume handler not implemented" };
    },

    async handleFleetTeardown(input = {}, context) {
      if (options?.onFleetTeardown) return options.onFleetTeardown(input, context);
      return { ok: false, error: "fleet-teardown handler not implemented" };
    },
  };
}

export function registerFleetHandlers(
  server: HandleableServerContext,
  options?: FleetHandlerOptions,
): FleetHandlers {
  const handlers = createFleetHandlers(options);

  // Core canonical fleet query RPC
  server.handle(fleetRosterContract, (input: any, ctx: any) => handlers.handleFleetRoster(input, ctx || server));

  // Mutation and control RPCs
  server.handle(archiveAgentContract, (input: any, ctx: any) => handlers.handleArchiveAgent(input, ctx || server));
  server.handle(archiveInactiveAgentsContract, (input: any, ctx: any) => handlers.handleArchiveInactive(input, ctx || server));
  server.handle(createFrontDeskContract, (input: any, ctx: any) => handlers.handleCreateFrontDesk(input, ctx || server));
  server.handle(replaceFrontDeskContract, (input: any, ctx: any) => handlers.handleReplaceFrontDesk(input, ctx || server));
  server.handle(addOrchestratorContract, (input: any, ctx: any) => handlers.handleAddOrchestrator(input, ctx || server));
  server.handle(replaceOrchestratorContract, (input: any, ctx: any) => handlers.handleReplaceOrchestrator(input, ctx || server));
  server.handle(toggleRepoPauseContract, (input: any, ctx: any) => handlers.handleToggleRepoPause(input, ctx || server));
  server.handle(fleetHaltContract, (input: any, ctx: any) => handlers.handleFleetHalt(input, ctx || server));
  server.handle(fleetResumeContract, (input: any, ctx: any) => handlers.handleFleetResume(input, ctx || server));
  server.handle(fleetTeardownContract, (input: any, ctx: any) => handlers.handleFleetTeardown(input, ctx || server));

  return handlers;
}
