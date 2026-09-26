import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { AgentCreateInjectionRequest, McpInjectionHookHandler } from "paseo-plugin-helper/server";
import { PluginStorage } from "./server/vendor/paseo-plugin-helper/index";
import { INJECTION_KEY_PREFIX } from "./server/injection.ts";
import { RECIPIENT_INSTRUCTION_MARKER } from "./server/recipient-instructions.ts";

/**
 * The `agent.create` injection is wired into the plugin entrypoint, which is the
 * one thing no other test in this package can see (#689).
 *
 * `injection.test.ts` and `recipient-instructions.test.ts` cover the mechanism
 * thoroughly -- they call `maybeRegisterInjection` directly, against a stub
 * server, and they are right to. The single line that makes the mechanism live
 * in production is the `maybeRegisterInjection(...)` call in `index.server.ts`,
 * and nothing imported that file. Deleting it left every test in this package
 * green while every newborn agent stopped receiving both the `x_comms_*` tools
 * and the recipient instructions, silently: no operator symptom, just a missing
 * capability. Testing the mechanism is not the same as testing the wiring, and
 * the wiring is what #379 actually needed.
 *
 * So the assertion here is deliberately a pair, and deliberately about *both*
 * log lines. A one-sided registration -- the tools without the contract, or the
 * contract without the tools -- reproduces this bug exactly, and a one-sided
 * `assert.ok(handler)` over a single merged transform cannot tell it apart from
 * the working case. Each half is also asserted through what it puts in the
 * request, so the failure names which half went missing.
 *
 * The seam is the daemon's own build, because there is no other one:
 *
 *   - Production never loads a plugin server unbundled. A plugin server is
 *     bundled and inlined before it runs (#214), with the compile flags
 *     `scripts/measure-plugin-bundles.mjs` documents as host parity, so that is
 *     what this test compiles and what it calls.
 *   - It also cannot be imported directly. `index.server.ts` reaches
 *     `handlers.ts` -> `mcp-client.ts` ->
 *     `vendor/paseo-plugin-helper/mcp/ring-buffer.ts`, which uses a TypeScript
 *     parameter property, and `node --test`'s strip-only loader rejects those
 *     with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. That is the same wall
 *     `server/unknown-daemon.test.ts` documents when it explains why a test
 *     could not import a diagnostic out of `handlers.ts`.
 *
 * Nothing here stubs the thing under test: the module loaded below is
 * `index.server.ts` itself, and the only thing replaced is the server context it
 * is handed.
 */

const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = join(PACKAGE_ROOT, "index.server.ts");

/** A daemon id in the sandboxed home, so the injected key has the namespaced
 * production shape instead of falling back to a collision-prone bare name. */
const SERVER_ID = "srv_entrypoint689";
const INJECTION_KEY = `${INJECTION_KEY_PREFIX}${SERVER_ID}`;

const LOG_REGISTERED = (key: string): string =>
  `injection: registering agent.create hooks under key '${key}' (tools + recipient instructions)`;
const LOG_DISABLED = "injection: disabled by settings, skipping agent.create hook";

let scratch: string;
let previousHome: string | undefined;
let contribute: (server: unknown) => () => void;
let prefs: PluginStorage<{ injectionEnabled?: boolean }>;

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "xcomms-entrypoint-"));
  const home = join(scratch, "home");
  mkdirSync(join(home, ".paseo"), { recursive: true });
  writeFileSync(join(home, ".paseo", "server-id"), `${SERVER_ID}\n`);

  // Redirected before the backend is loaded, and redirected at all: every
  // module-level path in the plugin is derived from the home directory at import
  // time (stateDir(), the PluginStorage namespace, the registry migration), so
  // loading the real backend unsandboxed would read the developer's settings and
  // could move their files.
  previousHome = process.env.HOME;
  process.env.HOME = home;

  const outfile = join(scratch, "index.server.cjs");
  await build({
    entryPoints: [ENTRYPOINT],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: "node",
    target: "node20",
    // The SDK specifiers the daemon externalises, verbatim. zod is the single
    // deviation: it is inlined here because this bundle is loaded from a temp
    // directory and zod is the only bare import a server bundle keeps.
    external: [
      "@getpaseo/plugin",
      "@getpaseo/plugin/server",
      "@getpaseo/plugin/server/provider",
      "@getpaseo/plugin/server/acp",
      "@getpaseo/plugin/client",
      "@getpaseo/plugin/client/ui",
      "@getpaseo/plugin/client/react-native",
    ],
    treeShaking: true,
    logLevel: "silent",
    absWorkingDir: PACKAGE_ROOT,
    outfile,
  });
  const require = createRequire(outfile);
  contribute = (require(outfile) as { default: (server: unknown) => () => void }).default;

  // The gate reads this document, so the test writes it through the same class
  // the plugin reads it through rather than hardcoding a path: `handlers.ts`
  // builds its `UI_PREFS_FILE` constant from the state dir, but that constant is
  // only used for the one-time migration and the corrupt-file log line.
  prefs = new PluginStorage<{ injectionEnabled?: boolean }>("paseo-x-comms", "plugin.json", {
    defaultData: {},
  });
});

after(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * The shipped state is no preferences file at all: `resolveInjectionEnabled`
 * treats an absent key as enabled, which is why the #379 fix is live by default
 * and why flipping the toggle is an operator action rather than a config file.
 */
function setInjectionToggle(enabled: boolean): void {
  if (enabled) rmSync(prefs.filePath, { force: true });
  else prefs.write({ injectionEnabled: false });
}

interface Recorded {
  contracts: string[];
  events: string[];
  hooks: { name: string; handler: McpInjectionHookHandler }[];
}

/** Stands in for `PluginServerContext` and records what the entrypoint asks of
 * it. The SDK's own context is not constructible in a unit test, and
 * `plugins/forges/server/registry.test.ts` sets the precedent for recording
 * registrations through it. */
function createStubServer(): { server: unknown; recorded: Recorded } {
  const recorded: Recorded = { contracts: [], events: [], hooks: [] };
  const server = {
    handle(contract: { name: string }): void {
      recorded.contracts.push(contract.name);
    },
    on(event: string): () => void {
      recorded.events.push(event);
      return () => {};
    },
    before(name: string, handler: McpInjectionHookHandler): () => void {
      recorded.hooks.push({ name, handler });
      return () => {
        const idx = recorded.hooks.findIndex((entry) => entry.handler === handler);
        if (idx !== -1) recorded.hooks.splice(idx, 1);
      };
    },
  };
  return { server, recorded };
}

function agentCreateHooks(recorded: Recorded): McpInjectionHookHandler[] {
  return recorded.hooks.filter((entry) => entry.name === "agent.create").map((entry) => entry.handler);
}

interface StartedPlugin {
  recorded: Recorded;
  logs: string[];
  stop: () => void;
}

/**
 * Call the real `contribute` once and keep what it logged, so a skip that only
 * exists in the log cannot pass as a working registration. The teardown is
 * always handed back: a failing assertion must not leave the outbox and defer
 * workers or the configured-hosts watcher running, or the run never exits.
 */
function startPlugin(): StartedPlugin {
  const { server, recorded } = createStubServer();
  const logs: string[] = [];
  const collect = (...args: unknown[]): void => {
    logs.push(args.map(String).join(" "));
  };
  const realLog = console.log;
  const realError = console.error;
  console.log = collect;
  console.error = collect;
  let dispose: (() => void) | undefined;
  try {
    dispose = contribute(server);
  } finally {
    console.log = realLog;
    console.error = realError;
  }
  let stopped = false;
  return {
    recorded,
    logs,
    stop: () => {
      if (stopped) return;
      stopped = true;
      dispose?.();
    },
  };
}

/** Chain the registered handlers the way the daemon's plugin runtime does: each
 * one receives the previous one's output. Both registrations are synchronous,
 * so the chain composes synchronously too. */
function runAgentCreate(
  hooks: McpInjectionHookHandler[],
  request: AgentCreateInjectionRequest,
): AgentCreateInjectionRequest {
  let current = request;
  for (const handler of hooks) {
    const next = handler({ request: current });
    if (next instanceof Promise) throw new Error("the injection hooks must register synchronously");
    if (next) current = next;
  }
  return current;
}

// The helper types every non-MCP config key as unknown; the prompt is the field
// under test, so narrow it once here.
function promptOf(request: AgentCreateInjectionRequest): string {
  return typeof request.config.systemPrompt === "string" ? request.config.systemPrompt : "";
}

function freshRequest(): AgentCreateInjectionRequest {
  return { config: { provider: "opencode", cwd: "/work" } };
}

describe("plugin entrypoint: agent.create injection is registered in production (#689)", () => {
  it("is the shipped backend, so a failure here is never a stub's", (t) => {
    setInjectionToggle(true);
    const plugin = startPlugin();
    t.after(plugin.stop);
    assert.ok(
      plugin.recorded.contracts.includes("registry.read"),
      "the entrypoint must register the shipped RPC contracts",
    );
    assert.ok(
      plugin.recorded.contracts.includes("peer.status"),
      "the entrypoint must register the shipped RPC contracts",
    );
    assert.ok(
      plugin.recorded.events.includes("agent.created"),
      "the entrypoint must subscribe to the local agent lifecycle",
    );
  });

  it("registers the tools hook AND the recipient instructions", (t) => {
    setInjectionToggle(true);
    const plugin = startPlugin();
    t.after(plugin.stop);

    const hooks = agentCreateHooks(plugin.recorded);
    assert.equal(
      hooks.length,
      2,
      "the tools hook and the instructions hook come from the one call in the entrypoint; one of them is not wired",
    );

    // One request carries both halves of the assertion, so a one-sided
    // registration cannot pass: the tools and the contract have to arrive
    // together, on the agent the daemon is about to create.
    const request = freshRequest();
    request.config.mcpServers = { userServer: { type: "http", url: "http://localhost:9000/mcp" } };
    const snapshot = JSON.parse(JSON.stringify(request));
    const result = runAgentCreate(hooks, request);

    const tools = result.config.mcpServers?.[INJECTION_KEY];
    assert.ok(
      tools,
      `the x_comms_* tools hook is not wired: no MCP server registered under '${INJECTION_KEY}'`,
    );
    assert.equal(tools.type, "stdio");
    assert.ok(
      promptOf(result).includes(RECIPIENT_INSTRUCTION_MARKER),
      "an agent that receives the tools must also receive the envelope contract (#379); a tools-only registration is this bug",
    );
    assert.deepEqual(
      result.config.mcpServers?.userServer,
      { type: "http", url: "http://localhost:9000/mcp" },
      "the pair must merge into the agent's own config, not replace it",
    );
    assert.deepEqual(request, snapshot, "the hooks must not mutate the request the daemon handed them");
  });

  it("removes both hooks when the plugin is torn down", (t) => {
    setInjectionToggle(true);
    const plugin = startPlugin();
    t.after(plugin.stop);
    assert.equal(
      agentCreateHooks(plugin.recorded).length,
      2,
      "nothing to tear down if the pair was never registered",
    );

    plugin.stop();
    assert.equal(
      agentCreateHooks(plugin.recorded).length,
      0,
      "teardown must unwind the instructions hook as well as the tools hook",
    );
  });

  it("registers nothing, and says so, when the injection toggle is off", (t) => {
    setInjectionToggle(false);
    const plugin = startPlugin();
    t.after(plugin.stop);

    assert.deepEqual(
      agentCreateHooks(plugin.recorded),
      [],
      "a disabled gate must register no agent.create hook at all",
    );
    assert.ok(
      plugin.logs.some((line) => line.includes(LOG_DISABLED)),
      "a skip nobody can see is the failure mode this issue is about; the gate must say it skipped",
    );
    assert.ok(
      !plugin.logs.some((line) => line.includes(LOG_REGISTERED(INJECTION_KEY))),
      "the disabled gate must not also claim to have registered",
    );
  });

  it("logs the registration, with the namespaced key, when the toggle is on", (t) => {
    setInjectionToggle(true);
    const plugin = startPlugin();
    t.after(plugin.stop);

    assert.ok(
      plugin.logs.some((line) => line.includes(LOG_REGISTERED(INJECTION_KEY))),
      `the enabled gate must log that it registered both hooks under '${INJECTION_KEY}'`,
    );
    assert.ok(
      !plugin.logs.some((line) => line.includes(LOG_DISABLED)),
      "the enabled gate must not report a skip",
    );
  });
});
