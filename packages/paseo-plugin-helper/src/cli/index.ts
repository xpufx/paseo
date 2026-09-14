#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { auditProject } from "./scanner.js";
import { auditAllPlugins, auditPluginConformance } from "./conformance.js";
import { adoptProject, formatAdoptResult } from "./adopt.js";
import { formatReportPretty, formatReportJson } from "./formatter.js";
import type { AuditOptions } from "./types.js";

export * from "./types.js";
export * from "./rules.js";
export * from "./scanner.js";
export * from "./conformance.js";
export * from "./formatter.js";
export * from "./adopt.js";

export function runCli(argv: string[] = process.argv.slice(2)): number {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`
Paseo Plugin Helper CLI (audit & lint)

Usage:
  npx paseo-plugin-helper audit [path] [options]
  npx paseo-plugin-helper doctor [path] [options]
  npx paseo-plugin-helper conformance <plugin-dir>
  npx paseo-plugin-helper conformance --all [plugins-dir]
  npx paseo-plugin-helper adopt [path]
  npx paseo-plugin-helper [path] [options]

Commands:
  audit / doctor    Scan for bespoke patterns replaceable by helper primitives
  conformance       Check plugin UI helper conformance
  adopt             Layer paseo-plugin-helper onto a \`paseo plugin init\` scaffold

Options:
  --strict             Exit with code 1 if any warnings or errors are found
  --format <type>      Output format: pretty (default) or json
  --ignore <dirs>      Comma-separated list of directories to ignore
  --all                Run conformance against every plugin directory
  -h, --help           Show this help message

Examples:
  npx paseo-plugin-helper audit .
  npx paseo-plugin-helper doctor .
  npx paseo-plugin-helper adopt ~/code/my-plugin
  npx paseo-plugin-helper audit ~/code/my-plugin --strict
  npx paseo-plugin-helper audit . --format json
  npx paseo-plugin-helper conformance plugins/x-comms --strict
  npx paseo-plugin-helper conformance --all plugins
`);
    return 0;
  }

  if (argv[0] === "adopt") {
    const targetDir = argv[1] && !argv[1].startsWith("-") ? argv[1] : ".";
    try {
      const result = adoptProject(targetDir);
      console.log(formatAdoptResult(result));
      return 0;
    } catch (err) {
      console.error(`adopt failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  if (argv[0] === "conformance") {
    const all = argv.includes("--all");
    const positional = argv.filter((arg, index) =>
      index > 0 && !arg.startsWith("-") && argv[index - 1] !== "--format" && argv[index - 1] !== "--ignore",
    );
    const target = positional[0] ?? ".";
    const options: AuditOptions = {
      strict: argv.includes("--strict"),
      format: argv.includes("--format") && argv[argv.indexOf("--format") + 1] === "json" ? "json" : "pretty",
      ignore: [],
    };

    if (all) {
      const pluginsDir = path.basename(target) === "plugins" ? target : path.join(target, "plugins");
      const reports = auditAllPlugins(pluginsDir, options);
      if (options.format === "json") {
        console.log(JSON.stringify(reports, null, 2));
      } else {
        for (const report of reports) console.log(formatReportPretty(report));
      }
      return reports.every((report) => report.passed) ? 0 : 1;
    }

    const report = auditPluginConformance(target, options);
    console.log(options.format === "json" ? formatReportJson(report) : formatReportPretty(report));
    return report.passed ? 0 : 1;
  }

  let targetDir = ".";
  const options: AuditOptions = {
    strict: false,
    format: "pretty",
    ignore: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "audit" || arg === "doctor") {
      continue;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "--format" && argv[i + 1]) {
      options.format = argv[i + 1] === "json" ? "json" : "pretty";
      i++;
    } else if (arg === "--ignore" && argv[i + 1]) {
      options.ignore = argv[i + 1].split(",").map((s) => s.trim());
      i++;
    } else if (!arg.startsWith("-")) {
      targetDir = arg;
    }
  }

  const report = auditProject(targetDir, options);

  if (options.format === "json") {
    console.log(formatReportJson(report));
  } else {
    console.log(formatReportPretty(report));
  }

  return report.passed ? 0 : 1;
}

// Auto-run if executed as CLI entry point
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("/cli.cjs") ||
    process.argv[1].endsWith("/paseo-plugin-helper.js") ||
    process.argv[1].includes("paseo-plugin-helper"));

if (isMain) {
  const exitCode = runCli();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}
