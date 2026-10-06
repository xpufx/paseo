#!/usr/bin/env node
import { register } from "node:module";
import { parseArgs } from "node:util";

// Install TS-extension resolver hook so node can load .ts server modules directly
const hookUrl = new URL("../test/resolve-ts-hooks.mjs", import.meta.url);
register(hookUrl, import.meta.url);

const { HookRouter, getActiveHookRouter } = await import("../server/hook-router.ts");

function printHelp() {
  console.log(`Usage: fleet-ensure-orchestrator [options] [repo]

Deterministically ensure an active, autonomous orchestrator agent exists for a repository.

Options:
  --repo <repo>          Target repository slug or key (e.g. 'owner/repo')
  --mode <mode>          Execution permission mode (default: 'yolo')
  --provider <provider>  Agent model provider (default: configured orchestrator role, skipping disabled host providers)
  --model <model>        Model name override
  --force                Force provisioning even if an orchestrator is active
  --json                 Output JSON instead of formatted text
  -h, --help             Display this help message
`);
}

async function main() {
  let values;
  let positionals;
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        repo: { type: "string" },
        mode: { type: "string", default: "yolo" },
        provider: { type: "string" },
        model: { type: "string" },
        force: { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    printHelp();
    process.exit(1);
  }

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const repo = values.repo || positionals[0];
  if (!repo) {
    console.error("Error: repository is required (--repo <repo> or positional argument)\n");
    printHelp();
    process.exit(1);
  }

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const result = await router.ensureOrchestrator({
      repo,
      mode: values.mode,
      provider: values.provider,
      model: values.model,
      force: values.force,
    });

    if (values.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.ok) {
        console.log(`✓ Orchestrator ${result.status}: ${result.agentId}`);
        console.log(`  Repo: ${result.repo}`);
        if (result.workspaceId) console.log(`  Workspace: ${result.workspaceId}`);
        if (result.cwd) console.log(`  CWD: ${result.cwd}`);
        console.log(`  Mode: ${values.mode || "yolo"}`);
      } else {
        console.error(`✗ Failed to ensure orchestrator: ${result.error}`);
        process.exit(1);
      }
    }

    if (!result.ok) {
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error ensuring orchestrator: ${message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
