import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const BUNDLED = "paseo-x-comms.bundled.mjs";
const PLAIN = "paseo-x-comms.mjs";

/** Bundled first: it is the self-contained artifact the injector copies. */
function inMcpDir(base: string): string[] {
  return [join(base, "mcp", BUNDLED), join(base, "mcp", PLAIN)];
}

/**
 * Explicit override. Set `PASEO_X_COMMS_MCP_SERVER` when the host layout is
 * unusual (packaged app, moved checkout, a build that vendors the plugin).
 */
function overrideCandidates(): string[] {
  const raw = process.env.PASEO_X_COMMS_MCP_SERVER?.trim();
  return raw ? [isAbsolute(raw) ? raw : join(process.cwd(), raw)] : [];
}

/** Plugin ids this plugin may be installed under. */
const SELF_PLUGIN_IDS = ["x-comms", "paseo-x-comms", "paseo-x-comms-plugin"];

/**
 * Directories the daemon records for installed plugins, with this plugin's own
 * entries first so a sibling install can never shadow it.
 */
function configCandidates(selfDir?: string): string[] {
  const configPath = join(homedir(), ".paseo", "config.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
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
    const isSelf = SELF_PLUGIN_IDS.includes(id) || (selfDir !== undefined && dir === selfDir);
    (isSelf ? preferred : rest).push(dir);
  }
  return [...preferred, ...rest].flatMap(inMcpDir);
}

/**
 * Managed-install layout:
 * `~/.paseo/plugins/<pluginId>/<commit>/checkout/mcp/...`.
 */
function managedCandidates(): string[] {
  const out: string[] = [];
  for (const pluginId of SELF_PLUGIN_IDS) {
    const base = join(homedir(), ".paseo", "plugins", pluginId);
    if (!existsSync(base)) continue;
    let entries;
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      out.push(...inMcpDir(join(base, entry.name, "checkout")));
    }
  }
  return out;
}

/**
 * `import.meta.url` works only when the server is executed unbundled. Paseo
 * bundles and inlines plugin server code, so this is usually empty — kept for
 * tests, `tsx`, and any executor that runs the sources directly.
 */
function moduleCandidates(): string[] {
  try {
    const url = (import.meta as unknown as { url?: string })?.url;
    if (!url) return [];
    const here = dirname(fileURLToPath(url));
    return [...inMcpDir(here), ...inMcpDir(join(here, ".."))];
  } catch {
    return [];
  }
}

/**
 * Working-directory candidates.
 *
 * Paseo does **not** spawn plugin subprocesses from the plugin directory (the
 * daemon inherits its own cwd — observed as `/home/xpufx/.dsh`), so this is a
 * low-priority fallback that helps when a plugin is run directly (tests, tsx).
 */
function cwdCandidates(): string[] {
  const cwd = process.cwd();
  return [...inMcpDir(cwd), ...inMcpDir(join(cwd, ".."))];
}

/**
 * Ordered candidate paths for the bundled MCP server, highest-confidence first.
 *
 * Exported for tests and diagnostics.
 *
 * @param selfDir directory the daemon recorded for THIS plugin, when known.
 */
export function serverCandidates(selfDir?: string): string[] {
  return [
    ...overrideCandidates(),
    ...configCandidates(selfDir),
    ...managedCandidates(),
    ...moduleCandidates(),
    ...cwdCandidates(),
  ];
}

/**
 * Absolute path of the bundled x-comms MCP server.
 *
 * A plugin server is bundled and inlined before it runs, so neither
 * `import.meta.url` nor `process.cwd()` identifies the plugin checkout
 * (xpufx-org/paseo#214). The dependable locator is the install path the daemon
 * records in `~/.paseo/config.json`, with an explicit env override on top and
 * the managed-checkout / module / cwd layouts as fallbacks.
 *
 * @param selfDir directory the daemon recorded for this plugin, when known.
 */
export function serverPath(selfDir?: string): string {
  for (const candidate of serverCandidates(selfDir)) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "could not locate bundled mcp server (mcp/paseo-x-comms.mjs); set PASEO_X_COMMS_MCP_SERVER to the bundled .mjs path",
  );
}
