import { ZodType } from 'zod';
import { S as SettingsContract } from '../settings-CP1gv9q3.js';
import { SpawnOptions } from 'node:child_process';
import { C as CustomPillDefinition, d as CustomPillState } from '../custom-pills-C98QP7Cg.js';
import '../rpc-D27pph91.js';

interface PluginStorageOptions<T> {
    defaultData?: T;
    /**
     * Base directory override. When provided, storage is located at path.join(baseDir, pluginId).
     * When omitted, defaults to path.join(os.homedir(), ".paseo", namespace ?? "plugin-data/xpufx", pluginId).
     */
    baseDir?: string;
    /**
     * Namespace directory under ~/.paseo. Defaults to "plugin-data/xpufx".
     */
    namespace?: string;
    /**
     * Optional Zod schema to validate and parse data on read/write, automatically applying defaults.
     */
    schema?: ZodType<T>;
}
interface StorageStats {
    path: string;
    fileCount: number;
    totalBytes: number;
    lastModified: Date | null;
}
declare const DEFAULT_NAMESPACE_README = "# Paseo Plugins Storage (xpufx)\n\nThis directory is managed by `paseo-plugin-helper` to store persistent settings, cached metrics, and state for plugins.\n- Safe to inspect or backup.\n- Avoid editing files manually while the Paseo daemon is active.\n";
/**
 * Scoped, atomic filesystem-backed document storage for Paseo daemon plugins.
 * Automatically handles directory creation, atomic temporary file swaps,
 * schema validation, default state fallback, and isolated namespace auditing.
 * State lives under ~/.paseo/plugin-data/xpufx/<pluginId>/ by default.
 */
declare class PluginStorage<T extends Record<string, any>> {
    readonly pluginId: string;
    readonly filename: string;
    readonly pluginDir: string;
    readonly filePath: string;
    readonly namespaceDir: string | null;
    readonly defaultData?: T;
    readonly schema?: ZodType<T>;
    constructor(pluginId: string, filename?: string, options?: PluginStorageOptions<T>);
    private ensureDir;
    private getDefault;
    private parseData;
    /**
     * Checks if the backing state file exists.
     */
    exists(): boolean;
    /**
     * Reads data synchronously. If file does not exist, returns defaultData.
     */
    read(): T;
    /**
     * Reads data asynchronously.
     */
    readAsync(): Promise<T>;
    /**
     * Writes data atomically using a temporary file and atomic rename.
     */
    write(data: T): void;
    /**
     * Writes data atomically using async filesystem operations.
     */
    writeAsync(data: T): Promise<void>;
    /**
     * Updates state synchronously using an updater function.
     */
    update(updater: (prev: T) => T): T;
    /**
     * Updates state asynchronously using an updater function.
     */
    updateAsync(updater: (prev: T) => Promise<T> | T): Promise<T>;
    /**
     * Removes the state file if it exists.
     */
    reset(): void;
    /**
     * Audits storage consumption, returning path, fileCount, totalBytes, and lastModified.
     */
    getStorageStats(): Promise<StorageStats>;
    /**
     * Alias for getStorageStats()
     */
    getStats(): Promise<StorageStats>;
}

/**
 * Structural server context interface satisfied by both Paseo v0.7 PluginContext
 * and Paseo v0.8 PluginServerContext.
 */
interface HandleableServerContext {
    handle(contract: any, handler: (input?: any) => any): any;
}
interface RegisterSettingsRpcOptions<TSettings> {
    /**
     * Optional callback invoked whenever settings are updated.
     */
    onUpdate?: (newSettings: TSettings, prevSettings: TSettings) => void | Promise<void>;
    /**
     * Optional callback invoked whenever settings are reset.
     */
    onReset?: (defaultSettings: TSettings, prevSettings: TSettings) => void | Promise<void>;
}
/**
 * Registers RPC handlers on the daemon PluginContext/PluginServerContext for a SettingsContract.
 * Connects get, update, and reset RPCs directly to atomic PluginStorage persistence.
 * Works with both Paseo v0.7 and Paseo v0.8.
 */
declare function registerSettingsRpc<TSettings extends Record<string, any>>(context: HandleableServerContext, contract: SettingsContract<TSettings>, storage: PluginStorage<TSettings>, options?: RegisterSettingsRpcOptions<TSettings>): void;
/**
 * Creates individual RPC handler functions (get, update, reset) for a SettingsContract.
 * Useful when registering handlers in root index.ts via plugin.handle() so that
 * Paseo's AST-based client compiler can cleanly strip all server registrations.
 */
declare function createSettingsHandlers<TSettings extends Record<string, any>>(contract: SettingsContract<TSettings>, storage: PluginStorage<TSettings>, options?: RegisterSettingsRpcOptions<TSettings>): {
    get: () => Promise<TSettings>;
    update: (input: unknown) => Promise<TSettings>;
    reset: () => Promise<TSettings>;
};

interface SharedPluginSettingsOptions<TSettings extends Record<string, any>> {
    suite: string;
    filename?: string;
    schema: ZodType<TSettings> & {
        partial?: () => ZodType<Partial<TSettings>>;
    };
    defaultData?: Partial<TSettings>;
    contract?: SettingsContract<TSettings>;
    contractName?: string;
    description?: string;
    namespace?: string;
    baseDir?: string;
    watchDebounceMs?: number;
}
type SharedSettingsListener<TSettings> = (settings: TSettings) => void;
interface SharedPluginSettings<TSettings extends Record<string, any>> {
    readonly suite: string;
    readonly contract: SettingsContract<TSettings>;
    readonly storage: PluginStorage<TSettings>;
    readonly filePath: string;
    get(): Promise<TSettings>;
    update(patch: Partial<TSettings>): Promise<TSettings>;
    reset(): Promise<TSettings>;
    read(): TSettings;
    reload(): TSettings;
    subscribe(listener: SharedSettingsListener<TSettings>): () => void;
    watch(listener: SharedSettingsListener<TSettings>): () => void;
    register(context: HandleableServerContext, options?: RegisterSettingsRpcOptions<TSettings>): void;
    createHandlers(options?: RegisterSettingsRpcOptions<TSettings>): {
        get: () => Promise<TSettings>;
        update: (input: unknown) => Promise<TSettings>;
        reset: () => Promise<TSettings>;
    };
    dispose(): void;
}
/**
 * Creates a suite-scoped settings store shared across independent sibling plugins.
 * Every plugin in the suite points at the same file
 * (`~/.paseo/plugin-data/xpufx/<suite>/<filename>`) through an atomic PluginStorage,
 * so an update written by Plugin A is immediately readable by Plugin B.
 */
declare function createSharedPluginSettings<TSettings extends Record<string, any>>(options: SharedPluginSettingsOptions<TSettings>): SharedPluginSettings<TSettings>;

/**
 * Strips single-line and multi-line comments and trailing commas from a JSONC string
 * without altering strings or URLs.
 */
declare function stripJsonComments(text: string): string;
/**
 * Safely parses a JSONC (JSON with comments and trailing commas) string.
 */
declare function parseJsonc<T = unknown>(text: string): T;
/**
 * Safely parses a JSONC string without throwing errors.
 * Returns the provided fallback value if parsing fails.
 */
declare function tryParseJsonc<T>(text: string, fallback: T): T;

interface RedactOptions {
    mask?: string;
    customSensitiveKeys?: string[];
    preserveLength?: boolean;
}
/**
 * Deeply redacts sensitive keys and values in an object or primitive before logging or sending over RPC.
 */
declare function redactSecrets<T>(target: T, options?: RedactOptions): T;

interface SafeSpawnOptions extends SpawnOptions {
    timeoutMs?: number;
    maxBuffer?: number;
}
interface SafeSpawnResult {
    stdout: string;
    stderr: string;
    code: number | null;
    signal: NodeJS.Signals | null;
    durationMs: number;
}
/**
 * Spawns a process safely with timeout management, stdout/stderr capture,
 * and clean process group termination without shell vulnerabilities.
 */
declare function safeSpawn(command: string, args?: string[], options?: SafeSpawnOptions): Promise<SafeSpawnResult>;
/**
 * Executes a shell command line string with timeout protection, stdout/stderr capture,
 * and clean process termination.
 */
declare function safeExec(command: string, options?: SafeSpawnOptions): Promise<SafeSpawnResult>;

interface CpuCoreMetrics {
    model: string;
    speed: number;
    usagePercent: number;
}
interface SystemMetrics {
    hostname: string;
    platform: NodeJS.Platform;
    arch: string;
    uptimeSeconds: number;
    cpu: {
        model: string;
        cores: number;
        usagePercent: number;
        loadAverage: [number, number, number];
    };
    memory: {
        totalBytes: number;
        freeBytes: number;
        usedBytes: number;
        usedPercent: number;
    };
}
/**
 * Samples CPU ticks and calculates delta usage percentage over time.
 */
declare class CpuSampler {
    private lastSample;
    constructor();
    private getTicks;
    /**
     * Computes the CPU usage delta since the previous sample (or between two samples).
     * Returns average usage percentage (0 - 100) and per-core breakdown.
     */
    sample(): {
        usagePercent: number;
        perCore: number[];
    };
}
/**
 * Returns instant system resources and metrics (CPU, RAM, load averages, uptime).
 */
declare function getSystemMetrics(sampler?: CpuSampler): SystemMetrics;

type LogLevel = "debug" | "info" | "warn" | "error";
/**
 * Resolves the minimum log level from the environment. Precedence:
 * `PASEO_PLUGIN_LOG_LEVEL` > `PASEO_LOG_LEVEL` > `PASEO_DEBUG=1` (debug).
 * Returns undefined when nothing is set so callers can apply their default.
 */
declare function resolveMinLevelFromEnv(env?: NodeJS.ProcessEnv): LogLevel | undefined;
/**
 * True when running in production. Retained for callers that need a
 * production check; note the default log level no longer keys off this.
 */
declare function isProductionEnv(env?: NodeJS.ProcessEnv): boolean;
/**
 * True only when `NODE_ENV` is explicitly a development value
 * (`development`/`dev`). Unset, empty, `production`, and anything else
 * (e.g. `test`) all count as quiet, so a shipped plugin defaults to info
 * without any env var set.
 */
declare function isDevelopmentEnv(env?: NodeJS.ProcessEnv): boolean;
/**
 * Default rule (documented for operators):
 * explicit `PASEO_PLUGIN_LOG_LEVEL`/`PASEO_LOG_LEVEL`/`PASEO_DEBUG` always wins;
 * otherwise quiet (`info`) — including when no env var is set at all, so a
 * shipped plugin never emits debug logs by default. Debug only when `NODE_ENV`
 * is explicitly a development value (`development`/`dev`).
 */
declare function resolveDefaultMinLevel(env?: NodeJS.ProcessEnv): LogLevel;
interface PluginLoggerOptions {
    /**
     * Version of the plugin.
     * If omitted, automatically resolves from `package.json` (augmented by git tag/hash).
     */
    version?: string;
    /**
     * Whether to emit a formatted startup banner on initialization.
     * Defaults to `true`.
     */
    banner?: boolean;
    /**
     * Subsystem or module tag within the plugin (e.g. "poller", "mcp-client").
     */
    subsystem?: string;
    /**
     * Minimum log level to print. Defaults to resolveDefaultMinLevel():
     * info unless NODE_ENV is explicitly development (or an explicit level is set).
     */
    minLevel?: LogLevel;
    /**
     * Optional custom metadata key-values to include in the startup banner.
     */
    meta?: Record<string, string | number | boolean>;
}
interface PluginLogger {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    /** Surfaces a caught/suppressed error at debug level so it reaches the plugin log. */
    suppressed(context: string, error: unknown): void;
    child(subsystemOrOptions: string | Partial<PluginLoggerOptions>): PluginLogger;
}
/**
 * Creates a structured logger for Paseo plugins.
 * By default, displays the plugin name and version in startup logs and tags each line
 * for Paseo's log stream without fragmented multi-line JSON.
 *
 * If `options.version` is omitted, it automatically resolves the version from `package.json`
 * augmented with git metadata.
 */
declare function createPluginLogger(pluginId: string, options?: PluginLoggerOptions): PluginLogger;

interface ResolveVersionOptions {
    /**
     * Root directory of the plugin (defaults to `process.cwd()`).
     */
    cwd?: string;
    /**
     * Whether to augment development versions with git commit short hash
     * (e.g. "0.1.0-dev.bfe901a" if not an exact tag).
     * Defaults to `true`.
     */
    includeGit?: boolean;
    /**
     * Fallback string if neither package.json nor git metadata can be found.
     * Defaults to "0.0.0".
     */
    fallback?: string;
}
/**
 * Resolves the plugin version from `package.json`, augmented by Git tag / commit hash.
 *
 * Precedence:
 * 1. Exact Git tag on current commit (e.g. "v0.1.2" or "0.1.2")
 * 2. `package.json` version (augmented with "-dev.hash" if in git and not on an exact release tag)
 * 3. Git commit short hash fallback (e.g. "dev-bfe901a")
 * 4. Fallback string (defaults to "0.0.0")
 */
declare function resolvePluginVersion(options?: ResolveVersionOptions): string;
interface StampVersionOptions extends ResolveVersionOptions {
    /**
     * Destination TypeScript / JavaScript file path.
     * Defaults to "./version.ts" or "./src/version.ts".
     */
    targetFile?: string;
}
/**
 * Build-time utility to stamp the resolved version into a TypeScript file (e.g. `version.ts`),
 * allowing client code (React Native) to import `PLUGIN_VERSION` directly without
 * needing `node:fs` or `process.cwd()` at runtime.
 */
declare function stampVersion(options?: StampVersionOptions): {
    version: string;
    targetFile: string;
    updated: boolean;
};

interface PingHostOptions {
    timeoutMs?: number;
}
/**
 * Checks whether a TCP port is currently open and accepting connections on a host.
 */
declare function isPortOpen(port: number, host?: string, options?: PingHostOptions): Promise<boolean>;
/**
 * Finds an available TCP port starting from startPort.
 * Tries up to maxAttempts ports.
 */
declare function findAvailablePort(startPort?: number, maxAttempts?: number, host?: string): Promise<number>;
/**
 * Pings a host and port via TCP to verify connectivity.
 */
declare function pingHost(host: string, port: number, options?: PingHostOptions): Promise<boolean>;

interface PeriodicTaskOptions {
    intervalMs: number;
    task: () => Promise<void> | void;
    onError?: (err: unknown, failureCount: number) => void;
    runImmediately?: boolean;
    maxBackoffMs?: number;
    /**
     * Logger for suppressed failures. Defaults to a level-gated
     * `periodic-task` logger so debug lines stay silent unless debug is enabled.
     */
    logger?: PluginLogger;
}
interface PeriodicTaskHandle {
    stop: () => void;
    isRunning: () => boolean;
    triggerNow: () => Promise<void>;
}
/**
 * Creates a resilient periodic background task loop for Paseo plugin daemons.
 * Implements exponential backoff on consecutive failures and safe teardown hooks.
 */
declare function createPeriodicTask(options: PeriodicTaskOptions): PeriodicTaskHandle;

interface McpServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    disabled?: boolean;
    autoApprove?: string[];
    [key: string]: unknown;
}
interface McpConfigTarget {
    /**
     * Absolute or relative path to the configuration file.
     * Supports '~' expansion (e.g. "~/.claude.json").
     */
    path: string;
    /**
     * The top-level key under which MCP servers are defined.
     * Defaults to "mcpServers".
     */
    key?: string;
    /**
     * If true, creates a timestamped backup file before modifying an existing file.
     */
    backup?: boolean;
}
interface UpsertMcpServerOptions {
    /**
     * Target config file path or McpConfigTarget descriptor.
     */
    target: string | McpConfigTarget;
    /**
     * Unique name of the MCP server entry (e.g. "paseo-gateway", "top", "x-comms").
     */
    serverName: string;
    /**
     * MCP server configuration object (command, args, env, etc.).
     */
    config: McpServerConfig;
    /**
     * Override backup option. If true, creates a backup before modifying.
     */
    backup?: boolean;
}
interface RemoveMcpServerOptions {
    /**
     * Target config file path or McpConfigTarget descriptor.
     */
    target: string | McpConfigTarget;
    /**
     * Name of the MCP server entry to remove.
     */
    serverName: string;
    /**
     * Override backup option. If true, creates a backup before removing.
     */
    backup?: boolean;
}
interface McpMutationResult {
    filePath: string;
    serverName: string;
    changed: boolean;
    action: "created" | "updated" | "unchanged" | "removed" | "not_found";
    backupPath?: string;
}
/**
 * Standard known MCP configuration paths across major developer tools and agent runners.
 * Note: These are pure path resolvers with zero filesystem scanning or heuristics.
 */
declare const McpConfigPaths: {
    /**
     * Claude Desktop configuration path per operating system:
     * - macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
     * - Windows: %APPDATA%/Claude/claude_desktop_config.json
     * - Linux: ~/.config/Claude/claude_desktop_config.json
     */
    claudeDesktop(): string;
    /**
     * Claude Code CLI global configuration: ~/.claude.json
     */
    claudeCode(): string;
    /**
     * OpenCode configuration path: ~/.config/opencode/opencode.json
     */
    openCode(): string;
    /**
     * Cursor editor MCP configuration: ~/.cursor/mcp.json
     */
    cursor(): string;
    /**
     * Gemini / Antigravity CLI configuration: ~/.gemini/config/mcp_config.json
     */
    gemini(): string;
    /**
     * Pi CLI agent configuration: ~/.pi/config.json
     */
    pi(): string;
};
/**
 * Expands '~' to the user's home directory.
 */
declare function expandPath(targetPath: string): string;
/**
 * Retrieves an MCP server definition from a config file.
 * Returns null if the file, key, or server does not exist.
 */
declare function getMcpServer(target: string | McpConfigTarget, serverName: string): McpServerConfig | null;
/**
 * Upserts an MCP server definition into an agent or tool configuration file.
 *
 * Guarantees:
 * 1. Namespaced idempotency: If the server configuration already exists and matches,
 *    no write occurs, preventing file watcher thrashing.
 * 2. JSONC safe: Reads files containing comments or trailing commas without crashing.
 * 3. Atomic writes: Uses temporary files and atomic rename to prevent corruption.
 * 4. Optional backups: Can create a timestamped backup before modifying existing files.
 */
declare function upsertMcpServer(options: UpsertMcpServerOptions): McpMutationResult;
/**
 * Removes an MCP server definition from a config file.
 *
 * Guarantees:
 * 1. Safe no-op: If the file or server does not exist, no write occurs.
 * 2. Atomic writes: Cleanly removes the key and updates the file atomically.
 * 3. Optional backups: Can create a timestamped backup before removal.
 */
declare function removeMcpServer(options: RemoveMcpServerOptions): McpMutationResult;

interface McpStdioInjectionConfig {
    type: "stdio";
    command: string;
    args?: string[];
    env?: Record<string, string>;
    alwaysLoad?: boolean;
}
interface McpHttpInjectionConfig {
    type: "http";
    url: string;
    headers?: Record<string, string>;
    alwaysLoad?: boolean;
}
interface McpSseInjectionConfig {
    type: "sse";
    url: string;
    headers?: Record<string, string>;
    alwaysLoad?: boolean;
}
type McpInjectionConfig = McpStdioInjectionConfig | McpHttpInjectionConfig | McpSseInjectionConfig;
interface AgentCreateInjectionConfig {
    mcpServers?: Record<string, McpInjectionConfig>;
    [key: string]: unknown;
}
interface AgentCreateInjectionRequest {
    config: AgentCreateInjectionConfig;
    env?: Record<string, string>;
    [key: string]: unknown;
}
type McpInjectionFilter = (input: {
    request: AgentCreateInjectionRequest;
}) => boolean;
type McpInjectionHookHandler = (input: {
    request: AgentCreateInjectionRequest;
}, context?: unknown) => AgentCreateInjectionRequest | void | Promise<AgentCreateInjectionRequest | void>;
interface McpInjectionServer {
    before(name: string, handler: (input: {
        request: any;
    }, context?: any) => any): () => void;
}
interface RegisterMcpInjectionOptions {
    serverName: string;
    config: McpInjectionConfig;
    filter?: McpInjectionFilter;
}
declare function registerMcpInjection(server: McpInjectionServer, options: RegisterMcpInjectionOptions): () => void;

interface PaseoPluginInfo {
    id: string;
    path: string;
    enabled: boolean;
    status: "running" | "disabled" | "failed" | string;
    source?: "directory" | "git" | string;
    remote?: string;
    ref?: string;
    commit?: string;
    error?: string;
}
type PluginStatusFilter = "all" | "enabled" | "disabled" | "running" | "failed";
interface ListPluginsOptions {
    /** Filter results by status or enablement. Defaults to "all". */
    filter?: PluginStatusFilter;
    /** In-memory TTL cache duration in milliseconds. Defaults to 5000ms. */
    cacheTtlMs?: number;
    /** If true, bypasses the in-memory cache and queries the daemon fresh. */
    forceRefresh?: boolean;
}
/**
 * Clears the in-memory plugin list cache.
 */
declare function clearPluginCache(): void;
/**
 * Lists plugins from the Paseo daemon, with optional filtering and TTL caching.
 * Primary mechanism uses 'paseo plugin ls --json', with fallback to ~/.paseo/config.json.
 */
declare function listPlugins(options?: ListPluginsOptions): Promise<PaseoPluginInfo[]>;
/**
 * Retrieves metadata for a specific plugin by ID.
 * Returns null if the plugin is not installed or found.
 */
declare function getPluginInfo(pluginId: string, options?: {
    cacheTtlMs?: number;
    forceRefresh?: boolean;
}): Promise<PaseoPluginInfo | null>;
/**
 * Checks whether a plugin is installed in Paseo.
 */
declare function isPluginInstalled(pluginId: string, options?: {
    cacheTtlMs?: number;
    forceRefresh?: boolean;
}): Promise<boolean>;
/**
 * Checks whether a plugin is installed and marked as enabled in Paseo.
 */
declare function isPluginEnabled(pluginId: string, options?: {
    cacheTtlMs?: number;
    forceRefresh?: boolean;
}): Promise<boolean>;
/**
 * Checks whether a plugin is currently running in the Paseo daemon.
 */
declare function isPluginRunning(pluginId: string, options?: {
    cacheTtlMs?: number;
    forceRefresh?: boolean;
}): Promise<boolean>;

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

interface RpcGuardOptions<T> {
    timeoutMs?: number;
    maxInflight?: number;
    getStale?: () => T | null | undefined;
    onTimeout?: (info: {
        timeoutMs: number;
        inflight: number;
    }) => void;
    onSaturated?: (info: {
        maxInflight: number;
    }) => void;
}
interface GuardedRpcHandler<TInput, TOutput> {
    (input?: TInput): Promise<TOutput>;
    inflight(): number;
}
declare function guardRpcHandler<TInput, TOutput>(handler: (input?: TInput) => Promise<TOutput> | TOutput, options?: RpcGuardOptions<TOutput>): GuardedRpcHandler<TInput, TOutput>;
interface LoopWatchdogOptions {
    thresholdMs?: number;
    intervalMs?: number;
    onLag?: (lagMs: number) => void;
}
declare function createLoopWatchdog(options?: LoopWatchdogOptions): () => void;

interface AgentIdentity {
    id?: string;
    name?: string;
    model?: string;
    provider?: string;
    repo?: string;
    branch?: string;
    envelopeText?: string;
}
interface AgentIdentityOptions {
    timeoutMs?: number;
    envelopeCommand?: string;
}
declare function getAgentIdentity(options?: AgentIdentityOptions): Promise<AgentIdentity | null>;

declare const DEFAULT_BEACON_LABEL_PREFIX = "beacon:";
declare const BEACON_COLORS: readonly ["violet", "sky", "emerald", "orange", "pink", "indigo", "teal", "red", "amber", "blue"];
type BeaconColor = (typeof BEACON_COLORS)[number];
interface BeaconLabelState {
    name: string;
    color?: string;
    titleSuffix?: string;
    title?: string;
    workspaceId?: string;
}
interface BeaconSetOptions extends BeaconLabelState {
    workspaceId: string;
}
interface BeaconBlinkOptions {
    workspaceId?: string;
    a: BeaconLabelState;
    b: BeaconLabelState;
    intervalMs?: number;
    rounds?: number;
    restoreOnDone?: boolean;
}
interface BeaconClearOptions {
    workspaceId?: string;
    name?: string;
    restoreTitle?: boolean;
}
interface WorkspaceTitleHandle {
    setTitle?: (title: string) => unknown;
}
interface BeaconDaemonClient {
    setWorkspaceLabel?: (args: unknown) => unknown;
    updateWorkspaceLabel?: (args: unknown) => unknown;
    removeWorkspaceLabel?: (args: unknown) => unknown;
    [key: string]: unknown;
}
interface WorkspaceBeaconOptions {
    workspaceHandle?: WorkspaceTitleHandle | null;
    daemonClient?: BeaconDaemonClient | null;
    labelPrefix?: string;
    baseTitle?: string;
    logger?: PluginLogger;
}
interface BeaconSetResult {
    labelApplied: boolean;
    titleApplied: boolean;
    labelName?: string;
    title?: string;
}
interface BeaconClearResult {
    labelCleared: boolean;
    titleRestored: boolean;
}
interface BeaconBlinkHandle {
    stop: () => void;
    done: Promise<void>;
}
declare function resolveBeaconLabelName(name: string, prefix?: string): string;
declare function normalizeBeaconColor(color: string | undefined): string | undefined;
declare class WorkspaceBeacon {
    private workspaceHandle?;
    private daemonClient?;
    private labelPrefix;
    private baseTitle?;
    private logger?;
    private originalTitles;
    private blinkTimers;
    constructor(options?: WorkspaceBeaconOptions);
    setOptions(options: Partial<WorkspaceBeaconOptions>): void;
    get activeBlinks(): number;
    set(options: BeaconSetOptions): Promise<BeaconSetResult>;
    blink(options: BeaconBlinkOptions): BeaconBlinkHandle;
    clear(options?: BeaconClearOptions): Promise<BeaconClearResult>;
    stopAll(): void;
    private resolveTitle;
    private applyLabel;
    private detachLabel;
    setOriginalTitle(workspaceId: string, title: string): void;
    hasOriginalTitle(workspaceId: string): boolean;
    getOriginalTitle(workspaceId: string): string | undefined;
    private applyTitle;
    private restoreTitle;
    private stopBlink;
}
declare function createWorkspaceBeacon(options?: WorkspaceBeaconOptions): WorkspaceBeacon;

export { type AgentCreateInjectionConfig, type AgentCreateInjectionRequest, type AgentIdentity, type AgentIdentityOptions, BEACON_COLORS, type BeaconBlinkHandle, type BeaconBlinkOptions, type BeaconClearOptions, type BeaconClearResult, type BeaconColor, type BeaconDaemonClient, type BeaconLabelState, type BeaconSetOptions, type BeaconSetResult, type CpuCoreMetrics, CpuSampler, CustomPillPoller, type CustomPillPollerOptions, DEFAULT_BEACON_LABEL_PREFIX, DEFAULT_NAMESPACE_README, type GuardedRpcHandler, type HandleableServerContext, type ListPluginsOptions, type LogLevel, type LoopWatchdogOptions, McpConfigPaths, type McpConfigTarget, type McpHttpInjectionConfig, type McpInjectionConfig, type McpInjectionFilter, type McpInjectionHookHandler, type McpInjectionServer, type McpMutationResult, type McpServerConfig, type McpSseInjectionConfig, type McpStdioInjectionConfig, type PaseoPluginInfo, type PeriodicTaskHandle, type PeriodicTaskOptions, type PingHostOptions, type PluginLogger, type PluginLoggerOptions, type PluginStatusFilter, PluginStorage, type PluginStorageOptions, type RedactOptions, type RegisterMcpInjectionOptions, type RegisterSettingsRpcOptions, type RemoveMcpServerOptions, type ResolveVersionOptions, type RpcGuardOptions, type SafeSpawnOptions, type SafeSpawnResult, type SharedPluginSettings, type SharedPluginSettingsOptions, type SharedSettingsListener, type StampVersionOptions, type StorageStats, type SystemMetrics, type UpsertMcpServerOptions, WorkspaceBeacon, type WorkspaceBeaconOptions, type WorkspaceTitleHandle, clearPluginCache, createLoopWatchdog, createPeriodicTask, createPluginLogger, createSettingsHandlers, createSharedPluginSettings, createWorkspaceBeacon, discoverCustomPillConfigs, expandPath, findAvailablePort, getAgentIdentity, getMcpServer, getPluginInfo, getSystemMetrics, guardRpcHandler, isDevelopmentEnv, isPluginEnabled, isPluginInstalled, isPluginRunning, isPortOpen, isProductionEnv, listPlugins, normalizeBeaconColor, parseJsonc, pingHost, redactSecrets, registerMcpInjection, registerSettingsRpc, removeMcpServer, resolveBeaconLabelName, resolveDefaultMinLevel, resolveMinLevelFromEnv, resolvePluginVersion, safeExec, safeSpawn, stampVersion, stripJsonComments, tryParseJsonc, upsertMcpServer };
