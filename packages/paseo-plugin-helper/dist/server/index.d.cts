import { J as PluginLogger } from '../workspace-beacon-BnpIyGZv.cjs';
export { A as AgentCreateInjectionConfig, a as AgentCreateInjectionRequest, b as AgentIdentity, c as AgentIdentityOptions, B as BEACON_COLORS, d as BeaconBlinkHandle, e as BeaconBlinkOptions, f as BeaconClearOptions, g as BeaconClearResult, h as BeaconColor, i as BeaconDaemonClient, j as BeaconLabelState, k as BeaconSetOptions, l as BeaconSetResult, C as CpuCoreMetrics, m as CpuSampler, D as DEFAULT_BEACON_LABEL_PREFIX, n as DEFAULT_NAMESPACE_README, G as GuardedRpcHandler, H as HandleableServerContext, L as ListPluginsOptions, o as LogLevel, p as LoopWatchdogOptions, M as McpConfigPaths, q as McpConfigTarget, r as McpHttpInjectionConfig, s as McpInjectionConfig, t as McpInjectionFilter, u as McpInjectionHookHandler, v as McpInjectionServer, w as McpMutationResult, x as McpServerConfig, y as McpSseInjectionConfig, z as McpStdioInjectionConfig, P as PaseoPluginInfo, E as PeriodicTaskHandle, F as PeriodicTaskOptions, I as PingHostOptions, K as PluginLoggerOptions, N as PluginStatusFilter, O as PluginStorage, Q as PluginStorageOptions, R as RedactOptions, S as RegisterMcpInjectionOptions, T as RegisterSettingsRpcOptions, U as RemoveMcpServerOptions, V as ResolveVersionOptions, W as RpcGuardOptions, X as SafeSpawnOptions, Y as SafeSpawnResult, Z as SharedPluginSettings, _ as SharedPluginSettingsOptions, $ as SharedSettingsListener, a0 as StampVersionOptions, a1 as StorageStats, a2 as SystemMetrics, a3 as UpsertMcpServerOptions, a4 as WorkspaceBeacon, a5 as WorkspaceBeaconOptions, a6 as WorkspaceTitleHandle, a7 as clearPluginCache, a8 as createLoopWatchdog, a9 as createPeriodicTask, aa as createPluginLogger, ab as createSettingsHandlers, ac as createSharedPluginSettings, ad as createWorkspaceBeacon, ae as expandPath, af as findAvailablePort, ag as getAgentIdentity, ah as getMcpServer, ai as getPluginInfo, aj as getSystemMetrics, ak as guardRpcHandler, al as isDevelopmentEnv, am as isPluginEnabled, an as isPluginInstalled, ao as isPluginRunning, ap as isPortOpen, aq as isProductionEnv, ar as listPlugins, as as normalizeBeaconColor, at as parseJsonc, au as pingHost, av as redactSecrets, aw as registerMcpInjection, ax as registerSettingsRpc, ay as removeMcpServer, az as resolveBeaconLabelName, aA as resolveDefaultMinLevel, aB as resolveMinLevelFromEnv, aC as resolvePluginVersion, aD as safeExec, aE as safeSpawn, aF as stampVersion, aG as stripJsonComments, aH as tryParseJsonc, aI as upsertMcpServer } from '../workspace-beacon-BnpIyGZv.cjs';
import { C as CustomPillDefinition, d as CustomPillState } from '../custom-pills-C98QP7Cg.cjs';
import 'zod';
import '../settings-BNRcFeSP.cjs';
import '../rpc-D27pph91.cjs';
import 'node:child_process';

/**
 * Discovers and validates all custom pill configuration files (.json / .jsonc)
 * from a directory (e.g. ~/.paseo/top/pills or ~/.paseo/custom-pills).
 */
declare function discoverCustomPillConfigs(dirPath: string, logger?: PluginLogger): Promise<CustomPillDefinition[]>;
interface CustomPillPollerOptions {
    /**
     * Initial list of custom pill definitions.
     */
    pills?: CustomPillDefinition[];
    /**
     * Optional directory to discover .json / .jsonc configs from.
     */
    configDir?: string;
    /**
     * Custom environment variables passed to all executed commands
     * (e.g. PASEO_AGENT_ID, PASEO_WORKSPACE_ID).
     */
    env?: Record<string, string>;
    /**
     * Working directory for executed commands. Defaults to process.cwd().
     */
    cwd?: string;
    /**
     * Optional structured logger.
     */
    logger?: PluginLogger;
    /**
     * Callback fired whenever any custom pill state changes.
     */
    onUpdate?: (states: CustomPillState[]) => void;
}
/**
 * Managed server poller for user-defined declarative custom metric pills.
 * Periodically executes shell commands, computes statuses via thresholds,
 * and maintains reactive live state.
 */
declare class CustomPillPoller {
    private pills;
    private states;
    private timers;
    private inFlight;
    private running;
    private options;
    constructor(options?: CustomPillPollerOptions);
    /**
     * Starts the polling loops for all configured custom pills.
     */
    start(): Promise<void>;
    /**
     * Manually triggers an immediate execution of a single custom pill.
     */
    pollPill(pillId: string): Promise<CustomPillState | undefined>;
    /**
     * Executes the on-demand drilldown command configured in pill.modal.command.
     */
    runModalCommand(pillId: string): Promise<{
        output?: string;
        error?: string;
    }>;
    /**
     * Updates or reconciles the list of pill definitions dynamically.
     */
    updatePills(newPills: CustomPillDefinition[]): void;
    /**
     * Returns live state for a single custom pill.
     */
    getState(pillId: string): CustomPillState | undefined;
    /**
     * Returns live states for all custom pills.
     */
    getAllStates(): CustomPillState[];
    /**
     * Stops all active polling loops and clears resources.
     */
    stop(): void;
    private schedulePill;
    private notifyUpdate;
}

export { CustomPillPoller, type CustomPillPollerOptions, PluginLogger, discoverCustomPillConfigs };
