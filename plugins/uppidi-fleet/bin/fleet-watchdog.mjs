#!/usr/bin/env node
import { register } from "node:module";
import { parseArgs } from "node:util";

// Install TS-extension resolver hook so node can load .ts server modules directly
const hookUrl = new URL("../test/resolve-ts-hooks.mjs", import.meta.url);
register(hookUrl, import.meta.url);

const { HookRouter, getActiveHookRouter } = await import("../server/hook-router.ts");
const { renderWatchdogAuditMarkdown } = await import("../server/mcp.ts");

function printHelp() {
  console.log(`Usage: fleet-watchdog [options]

Audit fleet agent health across daemons, detecting turn concurrency locks,
timeouts, and stalled agents, with optional auto-recovery.

Options:
  --front-desk-id <id>          Front Desk agent ID to notify regarding health alerts
  --recover                     Attempt conservative recovery for eligible anomalies (default: true)
  --no-recover                  Run health audit in read-only diagnostic mode
  --steer-message <msg>         Custom wake message when steering recovered agents
  --agents-dir <path>           Custom directory containing stored agent records
  --daemon-log-dir <path>       Custom directory containing daemon logs
  --recency-seconds <sec>       Seconds to consider cancellation timeouts (default: 300)
  --stale-seconds <sec>         Seconds before flagging a running turn as zombie (default: 900)
  --assume-pending-work         Treat finished idle agents requiring attention as stalled
  --json                        Output JSON instead of markdown
  -h, --help                    Display this help message
`);
}

async function main() {
  let values;
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        "front-desk-id": { type: "string" },
        recover: { type: "boolean", default: true },
        "no-recover": { type: "boolean", default: false },
        "steer-message": { type: "string" },
        "agents-dir": { type: "string" },
        "daemon-log-dir": { type: "string" },
        "recency-seconds": { type: "string" },
        "stale-seconds": { type: "string" },
        "assume-pending-work": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
    });
    values = parsed.values;
  } catch (err) {
    console.error(`Error parsing arguments: ${err.message}`);
    printHelp();
    process.exit(2);
  }

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const recover = values["no-recover"] ? false : values.recover;
  const frontDeskId = values["front-desk-id"];
  const steerMessage = values["steer-message"];
  const agentsDir = values["agents-dir"];
  const daemonLogDir = values["daemon-log-dir"];

  if (values["recency-seconds"] !== undefined) {
    const parsed = Number(values["recency-seconds"]);
    if (!Number.isFinite(parsed) || parsed < 0) {
      console.error("Error: --recency-seconds must be a non-negative number");
      process.exit(2);
    }
  }
  if (values["stale-seconds"] !== undefined) {
    const parsed = Number(values["stale-seconds"]);
    if (!Number.isFinite(parsed) || parsed < 0) {
      console.error("Error: --stale-seconds must be a non-negative number");
      process.exit(2);
    }
  }

  const cancellationRecencySeconds = values["recency-seconds"] ? parseFloat(values["recency-seconds"]) : undefined;
  const runningStaleSeconds = values["stale-seconds"] ? parseFloat(values["stale-seconds"]) : undefined;
  const assumePendingWork = values["assume-pending-work"] ?? false;
  const json = values.json ?? false;

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const result = await router.runWatchdogAudit({
      recover,
      frontDeskId,
      steerMessage,
      agentsDir,
      daemonLogDir,
      cancellationRecencySeconds,
      runningStaleSeconds,
      assumePendingWork,
    });

    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stdout.write(renderWatchdogAuditMarkdown(result));
    }

    process.exit(result.anomalies.length > 0 ? 1 : 0);
  } catch (err) {
    console.error(`fleet-watchdog failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}

await main();
