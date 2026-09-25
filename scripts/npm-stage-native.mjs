#!/usr/bin/env node
/** npm-native staged publishing with a notify-only 2fado follow-up. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function commandResult(command, args) {
  return execFileSync(command, args, { encoding: "utf8" });
}

export function hasStagedVersion(stages, packageName, version) {
  return Array.isArray(stages) && stages.some((stage) => stage?.packageName === packageName && stage?.version === version);
}

export function notificationSummary(packageName, version) {
  return `npm staging accepted ${packageName}@${version}; awaiting manual npm stage approve (2FA).`;
}

/**
 * npm reads a bare `user/repo` argument as a `github:` shorthand and refuses to
 * fetch git dependencies when they are disabled (EALLOWGIT). Manifest tarballs
 * are repo-relative paths like `demo/pkg.tgz`, so force npm to see a local path.
 */
export function localTarballPath(tarball) {
  return tarball.startsWith(".") || path.isAbsolute(tarball) ? tarball : `./${tarball}`;
}

/**
 * Best-effort probe for the notify-only daemon. Returns whether notifications
 * are possible; a missing CLI or unreachable socket only warns and never stops
 * staging.
 */
export function preflightNotifyDaemon({ run = commandResult, notifyBin = "2fado" } = {}) {
  try {
    run(notifyBin, ["list"]);
    return true;
  } catch (err) {
    console.warn(`[npm-stage] 2fado notify CLI/daemon unavailable (${err.message}); staging without notification.`);
    return false;
  }
}

/** Send one best-effort notify; a failed daemon never propagates. */
function notifyStaged({ run, notifyBin, link }, entry) {
  try {
    run(notifyBin, ["notify", "--link", link, "--summary", notificationSummary(entry.publishAs, entry.version)]);
    console.log(`[npm-stage] notified 2fado: ${entry.publishAs}@${entry.version} accepted for staging.`);
  } catch (err) {
    console.warn(`[npm-stage] 2fado notify failed (continuing): ${err.message}`);
  }
}

/** Stage one tarball; skips and npm errors deliberately return before notify. */
export function stagePackage(entry, { run = commandResult, npmBin = "npm", notifyBin = "2fado", link, notify = true }) {
  const stages = JSON.parse(run(npmBin, ["stage", "list", entry.publishAs, "--json"]));
  if (hasStagedVersion(stages, entry.publishAs, entry.version)) {
    console.log(`[npm-stage] skipping ${entry.publishAs}@${entry.version}: already staged; not a fresh stage.`);
    return { outcome: "skipped" };
  }

  console.log(`[npm-stage] staging ${entry.publishAs}@${entry.version} from ${entry.tarball}`);
  run(npmBin, ["stage", "publish", localTarballPath(entry.tarball), "--access", "public"]);
  if (notify) notifyStaged({ run, notifyBin, link }, entry);
  return { outcome: "staged" };
}

export function stagePackages(manifest, options) {
  if (!Array.isArray(manifest?.packages)) throw new Error("manifest packages must be an array");
  const notify = options?.notify ?? preflightNotifyDaemon(options ?? {});
  return manifest.packages.map((entry) => stagePackage(entry, { ...options, notify }));
}

function parseArgs(argv) {
  const manifestArg = argv.find((arg) => arg.startsWith("--manifest="));
  if (!manifestArg) throw new Error("usage: node scripts/npm-stage-native.mjs --manifest=publish-stage/manifest.json");
  return { manifestPath: manifestArg.slice("--manifest=".length) };
}

function workflowRunLink(env) {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = env;
  if (!server || !repository || !runId) throw new Error("GITHUB_SERVER_URL, GITHUB_REPOSITORY, and GITHUB_RUN_ID are required for 2fado notification links");
  return `${server}/${repository}/actions/runs/${runId}`;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { manifestPath } = parseArgs(argv);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));
  return stagePackages(manifest, {
    npmBin: env.NPM_STAGE_NPM_BIN || "npm",
    notifyBin: env.TWOFADO_NOTIFY_BIN || "2fado",
    link: workflowRunLink(env),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
