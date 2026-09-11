# Server Module (`paseo-plugin-helper/server`)

The `server` module provides runtime utilities for daemon-side plugin logic. It handles structured logging with auto-banners, system resource metrics, atomic state storage, shell-free process spawning, JSONC parsing, and sensitive credential masking.

---

## 1. Structured Logging: `createPluginLogger`

Creates a structured logger tailored for Paseo plugins.

By default, it automatically emits a **startup banner** containing the plugin's name, version, PID, and runtime info so the plugin log viewer in the Paseo GUI displays identity rather than just `[paseo] Plugin ready`.

### Usage
```ts
import { createPluginLogger } from "paseo-plugin-helper/server";

// Default: displays startup banner on initialization
export const log = createPluginLogger("top", {
  version: "0.1.0",
  // Optional: banner: false, minLevel: "debug", subsystem: "poller"
});

log.info("System poll completed", { cpu: "12.4%", ram: "3.2G" });
log.warn("Memory threshold reached", { used: "92%" });
log.error("Failed to read metrics", error);
```

### Output in Paseo GUI Log Viewer
```text
2026-09-04T13:43:19.590Z stdout
[paseo] Loading plugin

2026-09-04T13:43:19.620Z stdout
[top v0.1.0] Initializing plugin (pid 4016181, node v22.14.0)

2026-09-04T13:43:19.874Z stdout
[paseo] Plugin ready

2026-09-04T13:43:22.100Z stdout
[top v0.1.0] [INFO] System poll completed cpu=12.4% ram=3.2G

2026-09-04T13:43:24.400Z stderr
[top v0.1.0] [WARN] Memory threshold reached used=92%
```

### Features
- **Auto-Banner**: Emits name, version, and process metadata on startup (can be disabled via `{ banner: false }`).
- **Single-Line Formatting**: Key-values format as concise `key=val` pairs so lines don't get fragmented in the GUI.
- **Automatic Secret Scrubbing**: All objects and data are passed through `redactSecrets()` to prevent leaking credentials.
- **Child Loggers**: `const pollerLog = log.child("poller")` creates tagged logs: `[top v0.1.0:poller]`.
- **Stream Routing**: `info` and `debug` output to `stdout`; `warn` and `error` output to `stderr`.

---

## 2. System Host Metrics: `getSystemMetrics` & `CpuSampler`

Utilities for sampling instant CPU percentages, memory, and host details.

```ts
import { getSystemMetrics, CpuSampler } from "paseo-plugin-helper/server";

// Get complete snapshot
const metrics = getSystemMetrics();
console.log(metrics.hostname, metrics.cpu.usagePercent, metrics.memory.usedPercent);

// Or track CPU usage with custom sampling interval:
const sampler = new CpuSampler();
const sample = sampler.sample(); // { usagePercent: 12.5, perCore: [10, 15, 8, 17] }
```

---

## 3. Atomic Storage: `PluginStorage<T>`

`PluginStorage` provides atomic persistence for plugin settings, cache, and state.

Writes are performed by writing to a temporary file (`.tmp`) and executing an atomic filesystem rename, ensuring files are never corrupted by unexpected crashes or system power loss.

```ts
import { PluginStorage } from "paseo-plugin-helper/server";
import { TopSettingsSchema } from "../shared/settings.js";

const storage = new PluginStorage("top", "settings.json", {
  schema: TopSettingsSchema, // Validates disk state and automatically applies defaults!
});

const config = storage.read();
storage.write({ ...config, refreshInterval: 120 });
```

---

## 4. Safe Process Execution: `safeSpawn`

Executes commands directly without invoking a system shell, eliminating shell injection vulnerabilities. Supports buffer limits and timeout escalation (SIGTERM followed by SIGKILL).

```ts
import { safeSpawn } from "paseo-plugin-helper/server";

const result = await safeSpawn("git", ["status", "--porcelain"], {
  cwd: "/path/to/repo",
  timeoutMs: 5000,
});
```

---

## 5. Secret Redaction: `redactSecrets`

Deeply traverses objects, arrays, and strings to redact credentials before writing to logs or sending data over RPC channels.

- Automatically redacts sensitive object keys (`token`, `apiKey`, `password`, `secret`, `authorization`, etc.).
- Keeps first 3 and last 3 characters for long tokens (`sk-...345`).

---

## 6. JSONC Parser: `parseJsonc`, `tryParseJsonc`, & `stripJsonComments`

Resilient parser that removes single-line (`//`) and multi-line (`/* */`) comments and trailing commas from JSON.

```ts
import { parseJsonc, tryParseJsonc } from "paseo-plugin-helper/server";

// Throws on syntax errors
const config = parseJsonc<{ port: number }>("{ // custom port\n \"port\": 8080,\n}");

// Non-throwing parser with fallback
const safeConfig = tryParseJsonc(rawInput, { port: 3000 });
```

---

## 7. Version Resolution & Stamping: `resolvePluginVersion` & `stampVersion`

Automatically extracts the plugin's version using `package.json` as the source of truth, augmented with Git tags and commit hashes.

### Server Runtime Resolution
```ts
import { resolvePluginVersion, createPluginLogger } from "paseo-plugin-helper/server";

// Reads package.json, checks for git release tag, or adds "+shortHash" for dev
const version = resolvePluginVersion(); // e.g. "0.1.0" or "0.1.0+bfe901a"

// Note: createPluginLogger automatically calls resolvePluginVersion if options.version is omitted!
export const log = createPluginLogger("top");
```

### Build-Time Stamping for Client Code (React Native / Hermes)
Because client code runs in Hermes and cannot access `node:fs` or `process.cwd()`, use `stampVersion` during your build step:

```ts
// scripts/version.mjs or build step
import { stampVersion } from "paseo-plugin-helper/server";

stampVersion({ targetFile: "./src/version.ts" });
```
This generates:
```ts
// Auto-generated by paseo-plugin-helper. Do not edit.
export const PLUGIN_VERSION = "0.1.0";
```
Now both `pill.client.tsx` and server handlers can import `PLUGIN_VERSION` directly.

---

## 8. Network Utilities: `isPortOpen`, `findAvailablePort`, `pingHost`

Utilities for testing daemon service reachability or finding open TCP ports for child processes.

```ts
import { isPortOpen, findAvailablePort, pingHost } from "paseo-plugin-helper/server";

// Find an available port to bind an internal daemon service
const port = await findAvailablePort(3000);

// Check if a port is responding
const open = await isPortOpen(8080, "127.0.0.1");

// Ping host
const reachable = await pingHost("127.0.0.1", port, { timeoutMs: 1000 });
```

---

## 9. Background Tasks: `createPeriodicTask`

Resilient background loop for plugin daemons with exponential backoff on consecutive failures and safe teardown.

```ts
import { createPeriodicTask } from "paseo-plugin-helper/server";

const metricsWorker = createPeriodicTask({
  intervalMs: 5000,
  runImmediately: true,
  task: async () => {
    await collectMetrics();
  },
  onError: (err, failureCount) => {
    log.warn(`Metrics polling failed (attempt ${failureCount}):`, err);
  },
});

// Teardown during plugin shutdown
export function deactivate() {
  metricsWorker.stop();
}
```

---

## 10. Settings RPC Registration: `registerSettingsRpc`

Wires atomic file persistence and typed `get`, `update`, and `reset` RPC handlers to Paseo's daemon `PluginContext` in one line:

```ts
import { registerSettingsRpc, PluginStorage } from "paseo-plugin-helper/server";
import { topSettingsContract } from "../shared/settings.js";

export default function activate(context: PluginContext) {
  const storage = new PluginStorage("top", "settings.json", {
    schema: topSettingsContract.schema,
  });

  registerSettingsRpc(context, topSettingsContract, storage, {
    onUpdate: (newSettings, prev) => {
      log.info("Settings updated", newSettings);
    },
    onReset: (defaults) => {
      log.info("Settings reset to defaults");
    },
  });
}
```

---

## 11. Agent MCP Configuration Writer: `upsertMcpServer` & `removeMcpServer`

Safely injects and removes MCP server configurations for standalone agent CLIs and tools (Claude Desktop, Claude Code, OpenCode, Cursor, Gemini, Pi) without risk of corrupting user configuration files.

### Why Use This Instead of `fs.writeFileSync`
1. **Namespaced Idempotency**: Performs deep equality comparisons on existing server entries. If identical, no write occurs, preventing file-watcher churn in running agent runners.
2. **JSONC Safe**: Preserves files containing comments and trailing commas using `parseJsonc`.
3. **Atomic Writes**: Writes to a process-unique temporary file before POSIX atomic renaming, preventing half-written files during crashes.
4. **Optional Automated Backups**: Creates a timestamped `.bak` copy before modifying existing files.
5. **Clean Teardown**: Provides `removeMcpServer` so uninstalled or deactivated plugins leave zero orphan server entries.

### Usage
```ts
import {
  upsertMcpServer,
  removeMcpServer,
  getMcpServer,
  McpConfigPaths,
} from "paseo-plugin-helper/server";

// 1. Upsert into Claude Code global config (~/.claude.json)
const result = upsertMcpServer({
  target: McpConfigPaths.claudeCode(),
  serverName: "paseo-gateway",
  config: {
    command: "node",
    args: ["/path/to/gateway.js"],
    env: { PORT: "4280" },
  },
  backup: true, // Creates ~/.claude.json.bak.<timestamp>
});

if (result.changed) {
  console.log(`MCP server ${result.action}: ${result.filePath}`);
} else {
  console.log("MCP configuration already matches, no disk write performed");
}

// 2. Query active configuration
const active = getMcpServer(McpConfigPaths.claudeCode(), "paseo-gateway");

// 3. Remove on plugin deactivation or uninstall
removeMcpServer({
  target: McpConfigPaths.claudeCode(),
  serverName: "paseo-gateway",
});
```

### Preset Paths (`McpConfigPaths`)
- `McpConfigPaths.claudeDesktop()`: Resolves macOS (`~/Library/Application Support/Claude`), Windows (`%APPDATA%/Claude`), and Linux (`~/.config/Claude`).
- `McpConfigPaths.claudeCode()`: `~/.claude.json`
- `McpConfigPaths.openCode()`: `~/.config/opencode/opencode.json`
- `McpConfigPaths.cursor()`: `~/.cursor/mcp.json`
- `McpConfigPaths.gemini()`: `~/.gemini/config/mcp_config.json`
- `McpConfigPaths.pi()`: `~/.pi/config.json`

Custom targets can also be specified directly:
```ts
upsertMcpServer({
  target: {
    path: "/custom/path/to/config.json",
    key: "mcpServers", // or "mcp-servers"
  },
  serverName: "x-comms",
  config: { command: "x-comms" },
});
```

---

## 12. Plugin Query & Lifecycle Helpers: `listPlugins`, `isPluginRunning`, `getPluginInfo`

Provides cross-plugin awareness and lifecycle discovery without fragile filesystem probes.

Queries Paseo's live plugin list via `paseo plugin ls --json` with fallback to `~/.paseo/config.json`. Includes built-in TTL caching (default 5 seconds) to prevent command churn during frequent polling.

### Usage
```ts
import {
  listPlugins,
  getPluginInfo,
  isPluginInstalled,
  isPluginEnabled,
  isPluginRunning,
  clearPluginCache,
} from "paseo-plugin-helper/server";

// 1. Check if a dependency or companion plugin is running
const mcpRunning = await isPluginRunning("mcp-tools");
if (mcpRunning) {
  // Safe to read shared PluginStorage state or call cross-plugin RPC
}

// 2. Check if installed (e.g. to dim a toggle in settings when missing)
const mcpInstalled = await isPluginInstalled("mcp-tools");

// 3. List plugins with optional status filter ("all" | "enabled" | "disabled" | "running" | "failed")
const runningPlugins = await listPlugins({ filter: "running" });

// 4. Inspect full plugin metadata
const info = await getPluginInfo("top");
// {
//   id: "top",
//   status: "running",
//   enabled: true,
//   path: "/home/user/code/paseo-top",
//   source: "directory",
//   error?: string
// }

// 5. Force refresh cache immediately
clearPluginCache();
// or pass forceRefresh option:
const fresh = await listPlugins({ forceRefresh: true });
```

---

## 13. Declarative Custom Metric Pills: `CustomPillPoller` & `discoverCustomPillConfigs`

Enables plugins (like `paseo-top`) to run user-defined commands, shell scripts, or metrics and expose them as pills in Paseo's composer trackbar without needing fragile dynamic code bundling.

### Configuration Format (`.json` or `.jsonc`)
Users drop configuration files in `~/.paseo/top/pills/*.json` (or any custom directory):

```jsonc
{
  "id": "gpu-util",
  "title": "GPU",
  "icon": "Flame",
  "command": "nvidia-smi --format=csv,noheader,nounits --query-gpu=utilization.gpu",
  "suffix": "%",
  "intervalMs": 3000,
  "thresholds": {
    "warning": 70,
    "danger": 90
  },
  "modal": {
    "title": "NVIDIA GPU Diagnostics",
    "command": "nvidia-smi"
  }
}
```

### Usage
```ts
import {
  CustomPillPoller,
  discoverCustomPillConfigs,
} from "paseo-plugin-helper/server";

// 1. Discover configs from a directory
const configs = await discoverCustomPillConfigs("~/.paseo/top/pills");

// 2. Start managed poller
const poller = new CustomPillPoller({
  pills: configs,
  env: {
    PASEO_AGENT_ID: agentId,
    PASEO_WORKSPACE_ID: workspaceId,
  },
  onUpdate: (states) => {
    // Publish states over RPC or update internal cache
  },
});

await poller.start();

// 3. Query state or run modal drilldown command on demand
const state = poller.getState("gpu-util");
const drilldown = await poller.runModalCommand("gpu-util");
```

### `sourceFile` provenance (injected, not authored)
`discoverCustomPillConfigs` injects `sourceFile` (the absolute config file path)
into each discovered definition, and `CustomPillPoller` carries it through into
every `CustomPillState` (including error states). Do not author `sourceFile` in
config files; it is overwritten at discovery time. It is intended for display
only, such as a "defined in ..." hint in a drilldown modal.

## 14. Agent MCP Injection: `registerMcpInjection`

Merges a plugin MCP server entry into every new agent config via
`server.before("agent.create", ...)`. The hook returns a new request object
with the entry merged over `request.config.mcpServers`, so the user's own
servers are preserved. The incoming request is never mutated. The remover
returned by `server.before` is returned directly for cleanup.

The server argument is structural and only needs `before(name, cb)`. No SDK
imports appear in the implementation or its types. Config value shapes mirror
the protocol `AgentSessionConfig` entries: stdio (`type: "stdio"`, command,
args, env), HTTP (`type: "http"`, url, headers), or SSE (`type: "sse"`, url,
headers).

Omit `filter` to inject into every new agent. Provide `filter` to scope by
provider or anything else on the request. The target provider must support
MCP servers or creation fails at validation, so exclude providers that
cannot do MCP. Namespacing policy lives with the caller: use a namespaced
server key per daemon (for example `x-comms.<serverId>`) so collisions are
impossible by construction.

```ts
import { registerMcpInjection } from "paseo-plugin-helper/server";

export function activateServer(server) {
  return registerMcpInjection(server, {
    serverName: "x-comms",
    config: {
      type: "stdio",
      command: "paseo-x-comms-mcp",
      args: ["serve"],
      env: { X_COMMS_HOME: process.env.X_COMMS_HOME ?? "" },
    },
    filter: ({ request }) => request.config["provider"] === "claude",
  });
}
```

