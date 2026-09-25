import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPluginLogger } from "paseo-plugin-helper/server";
import type {
  DaemonInstallResult,
  DaemonLogEntry,
  DaemonStartResult,
  DaemonStatus,
  DaemonStopResult,
} from "../shared/companion";

const log = createPluginLogger("twofado", { banner: false, subsystem: "companion" });

const SUPERVISOR_SCRIPT = "daemon-supervisor.mjs";
const INSTALL_SCRIPT = "install-companion.mjs";

/** Plugin ids this plugin may be installed under (config id first, npm name last). */
const SELF_PLUGIN_IDS = ["twofado", "paseo-twofado", "paseo-twofado-plugin"];

/**
 * A structural view of the ported `scripts/daemon-supervisor.mjs` module. The
 * script is plain JS with no type declarations, so the server declares only the
 * surface it actually calls.
 */
interface SupervisorModule {
  DaemonSupervisor: new (options?: { rootDir?: string; socketPath?: string }) => SupervisorInstance;
}

interface SupervisorInstance {
  start(options?: {
    socketPath?: string;
    binPath?: string;
    stateDir?: string;
    runDir?: string;
    conf?: string;
  }): Promise<DaemonStartResult>;
  stop(timeoutMs?: number): Promise<DaemonStopResult>;
  restart(options?: { socketPath?: string }): Promise<DaemonStartResult>;
  status(socketPath?: string): Promise<DaemonStatus>;
  getLogs(limit?: number): DaemonLogEntry[];
}

interface InstallModule {
  installCompanion(options?: { force?: boolean; binDir?: string }): Promise<{
    binPath: string;
    status: string;
    version: string;
  }>;
}

export interface CompanionControllerOptions {
  /** Explicit plugin root used in tests; skips filesystem discovery. */
  rootDir?: string;
  /** Managed binary dir (plugin storage); preferred for install and resolve. */
  binDir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export interface CompanionController {
  status(input?: { socketPath?: string }): Promise<DaemonStatus>;
  start(input?: { socketPath?: string }): Promise<DaemonStartResult>;
  stop(): Promise<DaemonStopResult>;
  restart(input?: { socketPath?: string }): Promise<DaemonStartResult>;
  logs(input?: { limit?: number }): Promise<{ entries: DaemonLogEntry[] }>;
  install(input?: { force?: boolean }): Promise<DaemonInstallResult>;
  shutdown(): Promise<void>;
  /** Test seam: the root the controller resolved for the companion scripts. */
  rootDir(): string | null;
}

function overrideCandidates(env: NodeJS.ProcessEnv): string[] {
  const raw = env.TWOFADO_PLUGIN_ROOT?.trim();
  if (!raw) return [];
  return [isAbsolute(raw) ? raw : join(process.cwd(), raw)];
}

/**
 * Directories the daemon records for installed plugins, this plugin's own ids
 * first so a sibling install can never shadow it.
 */
function configCandidates(home: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(home, ".paseo", "config.json"), "utf8"));
  } catch {
    return [];
  }
  const plugins = (parsed as { plugins?: unknown })?.plugins;
  if (!plugins || typeof plugins !== "object") return [];

  const preferred: string[] = [];
  const rest: string[] = [];
  for (const [id, entry] of Object.entries(plugins as Record<string, unknown>)) {
    const dir = (entry as { path?: unknown })?.path;
    if (typeof dir !== "string" || !dir.trim()) continue;
    (SELF_PLUGIN_IDS.includes(id) ? preferred : rest).push(dir);
  }
  return [...preferred, ...rest];
}

/**
 * Managed-install layout: `~/.paseo/plugins/<pluginId>/<uuid>/checkout`.
 */
function managedCandidates(home: string): string[] {
  const out: string[] = [];
  for (const pluginId of SELF_PLUGIN_IDS) {
    const base = join(home, ".paseo", "plugins", pluginId);
    if (!existsSync(base)) continue;
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      out.push(join(base, entry.name, "checkout"));
    }
  }
  return out;
}

/**
 * `import.meta.url` works only when the server runs unbundled; Paseo bundles and
 * inlines plugin server code, so this is usually empty (kept for tsx/tests).
 */
function moduleCandidates(): string[] {
  try {
    const url = (import.meta as unknown as { url?: string })?.url;
    if (!url) return [];
    const here = dirname(fileURLToPath(url));
    return [here, join(here, "..")];
  } catch {
    return [];
  }
}

/**
 * Ordered candidate plugin roots. The companion scripts live under
 * `<root>/scripts`, so a candidate only counts when that script is present.
 */
export function pluginRootCandidates(
  options: CompanionControllerOptions = {},
): string[] {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  return [
    ...overrideCandidates(env),
    ...configCandidates(home),
    ...managedCandidates(home),
    ...moduleCandidates(),
    process.cwd(),
    join(process.cwd(), ".."),
  ];
}

/** Absolute path of a companion script, or null when no candidate has it. */
export function resolveCompanionScript(
  name: string,
  options: CompanionControllerOptions = {},
): string | null {
  if (options.rootDir) {
    const direct = join(options.rootDir, "scripts", name);
    return existsSync(direct) ? direct : null;
  }
  for (const root of pluginRootCandidates(options)) {
    const candidate = join(root, "scripts", name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function loadModule<T>(name: string, options: CompanionControllerOptions): Promise<T> {
  const script = resolveCompanionScript(name, options);
  if (!script) {
    throw new Error(
      `could not locate companion script ${name}; set TWOFADO_PLUGIN_ROOT to the plugin checkout`,
    );
  }
  // Computed URL: Paseo's esbuild pass leaves this dynamic import untouched, so
  // the .mjs is evaluated by Node from disk instead of being inlined.
  return (await import(pathToFileURL(script).href)) as T;
}

function defaultSocketPath(env: NodeJS.ProcessEnv, options: CompanionControllerOptions = {}): string {
  const configured = env.TWOFADO_SOCKET?.trim();
  if (configured) return configured;
  if (options.binDir) return join(dirname(options.binDir), "run", "2fado.sock");
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim();
  if (runtimeDir) return join(runtimeDir, "2fado", "2fado.sock");
  return "/tmp/2fado.sock";
}

function pickSocketPath(input: string | undefined, env: NodeJS.ProcessEnv, options: CompanionControllerOptions): string {
  return input?.trim() || defaultSocketPath(env, options);
}

/**
 * Server-side controller that owns the single in-process `DaemonSupervisor`
 * instance and exposes daemon lifecycle/acquisition over RPC.
 *
 * Socket-first: `status`/`start` adopt an already-serving daemon (systemd or
 * standalone) as `managed: "external"` and never kill it; only a child this
 * process spawned is stopped on `stop`/`shutdown`.
 */
export function createCompanionController(
  options: CompanionControllerOptions = {},
): CompanionController {
  let supervisor: SupervisorInstance | null = null;
  let resolvedRoot: string | null = options.rootDir ?? null;

  async function getSupervisor(): Promise<SupervisorInstance> {
    if (supervisor) return supervisor;
    const module = await loadModule<SupervisorModule>(SUPERVISOR_SCRIPT, options);
    const script = resolveCompanionScript(SUPERVISOR_SCRIPT, options);
    resolvedRoot = script ? dirname(dirname(script)) : null;
    supervisor = new module.DaemonSupervisor({
      rootDir: resolvedRoot ?? undefined,
      binDir: options.binDir,
      socketPath: options.env?.TWOFADO_SOCKET,
    });
    log.info("companion supervisor initialized", { rootDir: resolvedRoot });
    return supervisor;
  }

  return {
    async status(input) {
      try {
        const sup = await getSupervisor();
        return await sup.status(input?.socketPath);
      } catch (err) {
        log.warn("daemon status probe failed", { error: err });
        return {
          state: "offline",
          managed: "none",
          socketPath: pickSocketPath(input?.socketPath, options.env ?? process.env, options),
        };
      }
    },
    async start(input) {
      const socketPath = pickSocketPath(input?.socketPath, options.env ?? process.env, options);
      try {
        const sup = await getSupervisor();
        return await sup.start({ socketPath: input?.socketPath });
      } catch (err) {
        log.warn("daemon start failed", { error: err });
        return {
          success: false,
          socketPath,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async stop() {
      if (!supervisor) return { stopped: true, alreadyStopped: true };
      try {
        return await supervisor.stop();
      } catch (err) {
        log.warn("daemon stop failed", { error: err });
        return { stopped: false };
      }
    },
    async restart(input) {
      const socketPath = pickSocketPath(input?.socketPath, options.env ?? process.env, options);
      try {
        const sup = await getSupervisor();
        return await sup.restart({ socketPath: input?.socketPath });
      } catch (err) {
        log.warn("daemon restart failed", { error: err });
        return {
          success: false,
          socketPath,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async logs(input) {
      if (!supervisor) return { entries: [] };
      return { entries: supervisor.getLogs(input?.limit) };
    },
    async install(input) {
      try {
        const module = await loadModule<InstallModule>(INSTALL_SCRIPT, options);
        const result = await module.installCompanion({ force: input?.force, binDir: options.binDir });
        return { success: true, ...result };
      } catch (err) {
        log.warn("companion install failed", { error: err });
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    async shutdown() {
      if (!supervisor) return;
      try {
        await supervisor.stop();
      } catch (err) {
        log.warn("companion shutdown stop failed", { error: err });
      }
    },
    rootDir() {
      return resolvedRoot;
    },
  };
}
