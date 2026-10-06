#!/usr/bin/env node
/** npm-native staged publishing; 2fado notification is opt-in and decoupled from staging. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * npm's synthetic version for the first publish of a never-before-published
 * package. `npm stage publish` exits 0 after creating it even though the
 * requested version never reached the staging area.
 */
export const PLACEHOLDER_VERSION = "0.0.0-stage";

function commandResult(command, args) {
  return execFileSync(command, args, { encoding: "utf8" });
}

export function hasStagedVersion(stages, packageName, version) {
  return Array.isArray(stages) && stages.some((stage) => stage?.packageName === packageName && stage?.version === version);
}

/**
 * Versions already live on the registry can never be restaged: npm rejects them
 * with "You cannot publish over the previously published versions". Skip them
 * before staging so the run does not spend a registry round-trip on a version
 * that cannot change.
 */
export function isPublishedVersion(versions, version) {
  return Array.isArray(versions) && versions.includes(version);
}

export function isPlaceholderVersion(version) {
  return version === PLACEHOLDER_VERSION;
}

/**
 * Only a definitive registry 404 means "this package has never been published".
 * Auth, TLS, and network failures carry different codes and must surface rather
 * than be silently read as "not published", which would change the code path.
 */
export function isNotFoundError(err) {
  const text = [err?.message, err?.stderr, err?.stdout].filter(Boolean).join("\n");
  return /\bE404\b/i.test(text) || /404\s+not\s+found/i.test(text) || /not in this registry/i.test(text);
}

/**
 * Read a package's published versions. `published: false` is returned only for
 * a definitive 404; any other `npm view` failure throws so a flaky registry
 * read cannot silently change the staging path.
 */
export function registryLookup(packageName, { run = commandResult, npmBin = "npm" } = {}) {
  let out;
  try {
    out = run(npmBin, ["view", packageName, "versions", "--json"]);
  } catch (err) {
    if (isNotFoundError(err)) return { published: false, versions: [] };
    throw new Error(`npm view ${packageName} failed: ${err.message}`, { cause: err });
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (err) {
    throw new Error(`npm view ${packageName} returned unparseable output: ${err.message}`, { cause: err });
  }
  return { published: true, versions: Array.isArray(parsed) ? parsed : [parsed] };
}

/** Published versions of a package, or `[]` when a definitive 404 says it is not on the registry yet. */
export function publishedVersions(packageName, options) {
  return registryLookup(packageName, options).versions;
}

/** The staging-area entries for one package (`npm stage list <pkg> --json`). */
export function readStages(packageName, { run = commandResult, npmBin = "npm" } = {}) {
  const out = run(npmBin, ["stage", "list", packageName, "--json"]);
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [];
}

export function notificationSummary(packageName, version) {
  return `npm staging accepted ${packageName}@${version}; awaiting manual npm stage approve (2FA).`;
}

/**
 * npm reads a bare `user/repo` argument as a `github:` shorthand and refuses to
 * fetch git dependencies when they are disabled (EALLOWGIT). Manifest tarballs
 * are stage-relative paths like `demo/pkg.tgz`, so force npm to see a local
 * path. `baseDir` is the manifest's own directory: the manifest records each
 * tarball relative to the stage dir, not to the process CWD.
 */
export function localTarballPath(tarball, baseDir) {
  const resolved = baseDir ? path.resolve(baseDir, tarball) : tarball;
  return resolved.startsWith(".") || path.isAbsolute(resolved) ? resolved : `./${resolved}`;
}

/**
 * Probe for the notify-only daemon. By default, an unavailable CLI or unreachable
 * daemon causes a hard failure (throws an Error). This primitive is not part of
 * the staging path: staging runs without notification by default, so a missing
 * daemon can never fail a stage. It is only consulted when a caller explicitly
 * opts into notification via `notify: true`, and then with `allowNoNotify: true`
 * so the best-effort probe cannot hard-fail either.
 */
export function preflightNotifyDaemon({ run = commandResult, notifyBin = "2fado", allowNoNotify = false, env = process.env } = {}) {
  const isOptional = allowNoNotify || env?.TWOFADO_NOTIFY_OPTIONAL === "1";
  try {
    run(notifyBin, ["list"]);
    return true;
  } catch (err) {
    if (isOptional) {
      console.warn(`[npm-stage] 2fado notify CLI/daemon unavailable (${err.message}); staging without notification (opt-out enabled).`);
      return false;
    }
    throw new Error(`[npm-stage] 2fado notify CLI/daemon unavailable (${err.message}). Staging is unaffected; opt into notification only when the 2fado daemon is reachable.`);
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

/**
 * Guard the human `npm stage approve` step. Approving a stage list that only
 * holds the placeholder would move `latest` to `0.0.0-stage`, so refuse and name
 * the direct-publish remediation instead.
 */
export function assertApprovable(stages, version) {
  const rows = Array.isArray(stages) ? stages : [];
  if (rows.some((stage) => stage?.version === version)) return true;
  if (rows.some((stage) => isPlaceholderVersion(stage?.version))) {
    throw new Error(`refusing to approve ${PLACEHOLDER_VERSION}: it is a placeholder, not ${version}; run 'npm publish --access public' (2FA) to publish the real version first.`);
  }
  throw new Error(`no staged entry for ${version}; nothing to approve.`);
}

/**
 * The only safe approve command for a stage list, or the reason approval is
 * refused. Never returns a command that would move `latest` to the placeholder.
 */
export function approvalGuidance(stages, version) {
  try {
    assertApprovable(stages, version);
  } catch (err) {
    return { approvable: false, message: err.message };
  }
  const stage = (Array.isArray(stages) ? stages : []).find((row) => row?.version === version);
  return { approvable: true, message: `npm stage approve ${stage?.id ?? "<stage-id>"} (2FA)` };
}

/**
 * Confirm what npm actually stored. `npm stage publish` exits 0 even when npm
 * only creates the placeholder, so the exit code is not evidence: re-read the
 * staging area and require the intended version to be present.
 */
export function verifyStage(entry, { run = commandResult, npmBin = "npm", notifyBin = "2fado", link, notify = true, stagesBefore = [], publishedBefore = [] } = {}) {
  const stagesAfter = readStages(entry.publishAs, { run, npmBin });
  if (hasStagedVersion(stagesAfter, entry.publishAs, entry.version)) {
    const guidance = approvalGuidance(stagesAfter, entry.version);
    console.log(`[npm-stage] verified ${entry.publishAs}@${entry.version} in the staging area; approve with: ${guidance.message}`);
    if (notify) notifyStaged({ run, notifyBin, link }, entry);
    return { outcome: "staged", packageName: entry.publishAs, version: entry.version, detail: "verified in the npm staging area" };
  }

  // `||` short-circuits so a transient npm view failure cannot mask placeholder
  // evidence already visible in the stage lists.
  const placeholderSeen = stagesAfter.some((stage) => isPlaceholderVersion(stage?.version))
    || stagesBefore.some((stage) => isPlaceholderVersion(stage?.version))
    || publishedBefore.some(isPlaceholderVersion)
    || publishedVersions(entry.publishAs, { run, npmBin }).some(isPlaceholderVersion);

  if (placeholderSeen) {
    console.warn(`[npm-stage] PLACEHOLDER STAGE: ${entry.publishAs}@${entry.version} is NOT in the staging area.`);
    console.warn(`[npm-stage] npm only created the ${PLACEHOLDER_VERSION} placeholder; approving it would leave 'latest' pointing at an empty version.`);
    console.warn(`[npm-stage] Do NOT run 'npm stage approve'. One-time remediation (operator 2FA):`);
    console.warn(`[npm-stage]   npm publish --access public   # run in the package directory; afterwards npm stage works normally`);
    return { outcome: "placeholder", packageName: entry.publishAs, version: entry.version, detail: `only ${PLACEHOLDER_VERSION} present` };
  }

  console.warn(`[npm-stage] UNVERIFIED STAGE: npm stage publish accepted ${entry.publishAs}@${entry.version} but it is absent from npm stage list.`);
  return { outcome: "failed", packageName: entry.publishAs, version: entry.version, detail: `npm stage publish succeeded but ${entry.version} is absent from npm stage list` };
}

/** Stage one tarball; skips and npm errors deliberately return before notify. */
export function stagePackage(entry, { run = commandResult, npmBin = "npm", notifyBin = "2fado", link, notify = true, baseDir } = {}) {
  const stages = readStages(entry.publishAs, { run, npmBin });
  if (hasStagedVersion(stages, entry.publishAs, entry.version)) {
    console.log(`[npm-stage] skipping ${entry.publishAs}@${entry.version}: already staged; not a fresh stage.`);
    return { outcome: "skipped", packageName: entry.publishAs, version: entry.version, detail: "already staged" };
  }
  const lookup = registryLookup(entry.publishAs, { run, npmBin });
  if (isPublishedVersion(lookup.versions, entry.version)) {
    console.log(`[npm-stage] skipping ${entry.publishAs}@${entry.version}: already published; npm cannot restage a live version.`);
    return { outcome: "skipped", packageName: entry.publishAs, version: entry.version, detail: "already published" };
  }

  console.log(`[npm-stage] staging ${entry.publishAs}@${entry.version} from ${entry.tarball}`);
  run(npmBin, ["stage", "publish", localTarballPath(entry.tarball, baseDir), "--access", "public"]);
  return verifyStage(entry, { run, npmBin, notifyBin, link, notify, stagesBefore: stages, publishedBefore: lookup.versions });
}

/**
 * Stage every manifest package, isolating per-package errors so one bad entry
 * cannot abort the rest of the batch. Only a malformed manifest is systemic and
 * throws; per-package npm failures become `failed` rows.
 */
export function stagePackages(manifest, options) {
  if (!Array.isArray(manifest?.packages)) throw new Error("manifest packages must be an array");
  // Notification is decoupled from staging: a missing 2fado daemon must never
  // fail a stage. Callers opt in with `notify: true`; even then the preflight is
  // best-effort and only warns.
  const notify = options?.notify === true
    ? preflightNotifyDaemon({ ...options, allowNoNotify: true })
    : false;
  return manifest.packages.map((entry) => {
    try {
      return stagePackage(entry, { ...options, notify });
    } catch (err) {
      console.error(`[npm-stage] failed ${entry.publishAs}@${entry.version}: ${err.message}`);
      return { outcome: "failed", packageName: entry.publishAs, version: entry.version, detail: err.message };
    }
  });
}

/** Collapse a multi-line npm error into one table cell without breaking the row. */
function tableCell(text) {
  return String(text ?? "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}

/** Markdown table of every package's outcome, for the operator and CI summary. */
export function formatOutcomeTable(results) {
  const rows = Array.isArray(results) ? results : [];
  const lines = ["| package | version | outcome | detail |", "| --- | --- | --- | --- |"];
  for (const row of rows) {
    lines.push(`| ${tableCell(row.packageName)} | ${tableCell(row.version)} | ${tableCell(row.outcome)} | ${tableCell(row.detail)} |`);
  }
  return lines.join("\n");
}

/** Tally of outcomes in a batch. */
export function outcomeCounts(results) {
  const counts = { staged: 0, skipped: 0, placeholder: 0, failed: 0 };
  for (const row of Array.isArray(results) ? results : []) counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
  return counts;
}

/**
 * A batch fails if any package encountered a real staging error (outcome === "failed")
 * or landed on a placeholder (outcome === "placeholder"), or if no package was staged/skipped.
 */
export function shouldFailBatch(results) {
  const rows = Array.isArray(results) ? results : [];
  if (rows.length === 0) return false;
  const counts = outcomeCounts(rows);
  return counts.failed > 0 || counts.placeholder > 0 || (counts.staged === 0 && counts.skipped === 0);
}

/**
 * Stable outcome label recorded in the manifest and consumed by post-stage
 * verification. "already published" is separated from "already staged" because
 * only the former is absent from the staging area by design.
 */
export function classifyOutcome(result) {
  if (result?.outcome === "staged") return "staged";
  if (result?.outcome === "skipped") {
    return result.detail === "already published" ? "skipped_already_published" : "skipped_already_staged";
  }
  if (result?.outcome === "placeholder") return "placeholder";
  return "failed";
}

const STAGING_OUTCOMES = ["staged", "skipped_already_published", "skipped_already_staged", "placeholder", "failed"];

/** Per-package staging outcome plus a tally, for `manifest.staging`. */
export function stagingSummary(results, completedAt = new Date()) {
  const packages = (Array.isArray(results) ? results : []).map((row) => ({
    publishAs: row.packageName,
    version: row.version,
    outcome: classifyOutcome(row),
    detail: row.detail,
  }));
  const counts = Object.fromEntries(STAGING_OUTCOMES.map((name) => [name, 0]));
  for (const row of packages) counts[row.outcome] += 1;
  return { completedAt: completedAt.toISOString(), counts, packages };
}

/**
 * Add the staging outcome to the manifest publish-npm.mjs wrote, preserving the
 * original fields. This is the hand-off to "Post-stage verification": without
 * it that step cannot tell a deliberately skipped (already live) version from a
 * staged-but-unverified one (xpufx-org/paseo#1002).
 */
export function writeStagingOutcomes(manifestPath, results, completedAt = new Date()) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.staging = stagingSummary(results, completedAt);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest.staging;
}

/**
 * Post-stage verification. Only versions the stager actually submitted can be
 * in `npm stage list`; a version that was already published is live and was
 * deliberately skipped, so it counts as success rather than a missing stage
 * (xpufx-org/paseo#1002). Genuinely staged versions are still verified, and a
 * staged version absent from the registry is still a failure.
 */
export function verifyStagedPackages(manifest, { run = commandResult, npmBin = "npm" } = {}) {
  const packages = Array.isArray(manifest?.packages) ? manifest.packages : [];
  const recorded = new Map(
    (Array.isArray(manifest?.staging?.packages) ? manifest.staging.packages : [])
      .map((row) => [`${row.publishAs}@${row.version}`, row.outcome]),
  );
  const results = [];
  for (const pkg of packages) {
    const outcome = recorded.get(`${pkg.publishAs}@${pkg.version}`);
    if (outcome === "skipped_already_published") {
      results.push({ ...pkg, verification: "skipped", detail: "already published; nothing staged to verify" });
      continue;
    }
    if (outcome === "failed" || outcome === "placeholder") {
      results.push({ ...pkg, verification: "failed", detail: `staging outcome ${outcome}` });
      continue;
    }
    // staged, already staged, or no staging record at all: verify rather than
    // assume success, so this never weakens the staged-package check.
    try {
      const stages = readStages(pkg.publishAs, { run, npmBin });
      const present = hasStagedVersion(stages, pkg.publishAs, pkg.version);
      results.push({ ...pkg, verification: present ? "verified" : "missing", detail: present ? "found in npm staging area" : "absent from npm stage list" });
    } catch (err) {
      results.push({ ...pkg, verification: "error", detail: err.message });
    }
  }
  return {
    results,
    verified: results.filter((row) => row.verification === "verified"),
    skipped: results.filter((row) => row.verification === "skipped"),
    failed: results.filter((row) => ["failed", "missing", "error"].includes(row.verification)),
  };
}

function reportOutcomes(results, env = process.env) {
  const counts = outcomeCounts(results);
  const table = formatOutcomeTable(results);
  const tally = `${counts.staged} staged, ${counts.skipped} skipped, ${counts.placeholder} placeholder, ${counts.failed} failed`;
  console.log("[npm-stage] per-package outcome:");
  console.log(table);
  console.log(`[npm-stage] ${tally}`);
  if (counts.placeholder > 0) {
    console.warn("[npm-stage] placeholder stage(s) detected — approving one would leave 'latest' pointing at 0.0.0-stage:");
    console.warn("[npm-stage]   npm publish --access public   # run in the package directory; prompts for npm 2FA/OTP");
    console.warn("[npm-stage]   Do NOT run 'npm stage approve' for a placeholder-only stage.");
  }
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      const remediation = counts.placeholder > 0
        ? "\n\nPlaceholder stage(s) need a one-time direct publish before npm stage can accept the real version: `npm publish --access public` (2FA/OTP). Do not approve the placeholder."
        : "";
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `\n### npm stage outcomes\n\n${table}\n\n${tally}${remediation}\n`);
    } catch (err) {
      console.warn(`[npm-stage] could not append to GITHUB_STEP_SUMMARY (continuing): ${err.message}`);
    }
  }
}

function parseArgs(argv) {
  const manifestArg = argv.find((arg) => arg.startsWith("--manifest="));
  if (!manifestArg) throw new Error("usage: node scripts/npm-stage-native.mjs --manifest=publish-stage/manifest.json [--notify]");
  // Staging never notifies by default: notification belongs to the publish
  // handoff, not the stage run. `--notify` opts into the best-effort follow-up.
  const notify = argv.includes("--notify") && !argv.includes("--skip-notify") && !argv.includes("--allow-no-notify");
  return { manifestPath: manifestArg.slice("--manifest=".length), notify };
}

function workflowRunLink(env) {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = env;
  if (!server || !repository || !runId) throw new Error("GITHUB_SERVER_URL, GITHUB_REPOSITORY, and GITHUB_RUN_ID are required for 2fado notification links");
  return `${server}/${repository}/actions/runs/${runId}`;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const { manifestPath, notify } = parseArgs(argv);
  const resolved = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const results = stagePackages(manifest, {
    npmBin: env.NPM_STAGE_NPM_BIN || "npm",
    notifyBin: env.TWOFADO_NOTIFY_BIN || "2fado",
    link: notify ? workflowRunLink(env) : undefined,
    baseDir: path.dirname(resolved),
    notify,
    env,
  });
  reportOutcomes(results, env);
  writeStagingOutcomes(resolved, results);
  if (shouldFailBatch(results)) {
    const counts = outcomeCounts(results);
    console.error(`[npm-stage] batch failed: ${counts.failed} failed, ${counts.placeholder} placeholder, ${counts.staged} staged, ${counts.skipped} skipped (${results.length} total).`);
    process.exitCode = 1;
  }
  return results;
}

export function verifyMain(argv = process.argv.slice(2), env = process.env) {
  const manifestArg = argv.find((arg) => arg.startsWith("--verify-manifest="));
  if (!manifestArg) throw new Error("usage: node scripts/npm-stage-native.mjs --verify-manifest=publish-stage/manifest.json");
  const resolved = path.resolve(manifestArg.slice("--verify-manifest=".length));
  const manifest = JSON.parse(fs.readFileSync(resolved, "utf8"));
  const { results, verified, skipped, failed } = verifyStagedPackages(manifest, {
    npmBin: env.NPM_STAGE_NPM_BIN || "npm",
  });
  for (const row of skipped) console.log(`[post-stage-verify] SKIP: ${row.publishAs}@${row.version} ${row.detail}.`);
  for (const row of verified) console.log(`[post-stage-verify] OK: ${row.publishAs}@${row.version} found in staging area.`);
  for (const row of failed) console.error(`[post-stage-verify] FAIL: ${row.publishAs}@${row.version} ${row.detail}!`);
  if (failed.length > 0) {
    console.error(`::error::Post-stage verification failed: ${failed.length} package(s) unverified in registry staging area`);
    process.exitCode = 1;
  } else if (verified.length === 0) {
    console.log(`[post-stage-verify] Nothing to verify (${skipped.length} already-published package(s) skipped).`);
  } else {
    console.log("[post-stage-verify] All staged packages successfully verified in registry staging area.");
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some((arg) => arg.startsWith("--verify-manifest="))) verifyMain();
  else main();
}
