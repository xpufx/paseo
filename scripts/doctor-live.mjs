#!/usr/bin/env node

/**
 * doctor:live - Monorepo live deployment and daemon freshness inspector
 *
 * Verifies that:
 * 1. packages/paseo-plugin-helper/dist is compiled and up-to-date with src
 * 2. Each plugin's shared/version.ts contains current code changes
 * 3. Each plugin's Paseo daemon is running and loaded with current code changes
 * 4. No plugin has a legacy linked (non-installable) vendored helper tree —
 *    warned, never auto-materialized and never reported healthy. Vendored-copy
 *    drift from the helper src is reported as a publish-time warning only: a
 *    locally-loaded plugin resolves the bare paseo-plugin-helper specifier into
 *    *this checkout* through its tsconfig paths, so the committed vendor tree is
 *    the publish artifact and not what dev runs.
 * 5. Each plugin's served paseo-plugin-helper is identified and attributable
 *    (#633): what it serves, which version the checkout holds, which revision of
 *    the helper that is, and whether the plugin was stamped against it. A plugin
 *    that cannot answer those is `stale-helper`, never healthy.
 *
 * Liveness never depends on a fixed log tail. The whole retained plugin log is
 * read; a version tag is attributed to the current process (after the last
 * "Loading plugin"), and when a chatty plugin has evicted every tag the boot
 * time is compared against the plugin's own code mtime. A missing stamp and
 * uncommitted working-tree changes are distinct states (`no-stamp`, `dirty`) —
 * never silently reported as fresh. A plugin is stamp-required when it declares
 * a `stamp` script or ships a stamp file; that gate is no longer vacuous.
 *
 * `diagnose()` is strictly read-only. All builds, stamps, vendor syncs, nested
 * helper removals and daemon reloads live in `remediate()`, which is only
 * reached when `--reload`/`--fix` is passed.
 *
 * JSON: each `plugins[]` entry gains `dirty`, `dirtyFiles`, `stampRequired`,
 * `liveSource` ("log-tag" | "process-start" | "-") and `helper`
 * (`servedFrom`, `helperVersion`, `helperRevision`, `helperStatus`, `helperDetail`).
 *
 * Usage:
 *   npm run doctor:live             # Check status and print diagnostic table
 *   npm run doctor:live -- --reload # Auto-rebuild helper, re-stamp versions, & reload stale daemons
 *   npm run doctor:live -- --json   # Machine-readable JSON output
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { notifyReloadOutcome } from "./reload-notify.mjs";
import { evaluateHelperIdentity, readPluginStamp } from "./lib/helper-identity.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const isJson = args.includes("--json");
const shouldReload = args.includes("--reload") || args.includes("--fix");

// ANSI color helpers
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

// Checks that cannot complete must not vanish: each catch below records the
// context and the underlying cause, printed once before the process exits.
const diagnostics = [];

function recordDiagnostic(context, err) {
  const message = err instanceof Error ? err.message : String(err);
  diagnostics.push({ context, message });
}

function isMissingPath(err) {
  return Boolean(err) && err.code === "ENOENT";
}

function printDiagnostics() {
  if (diagnostics.length === 0) return;
  console.error(`${colors.yellow}⚠️  Diagnostics (checks that could not complete):${colors.reset}`);
  for (const d of diagnostics) {
    console.error(`   ${d.context}: ${d.message}`);
  }
}

function getLatestMtime(dir) {
  if (!fs.existsSync(dir)) return 0;
  let maxMtime = 0;

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > maxMtime) {
          maxMtime = stat.mtimeMs;
        }
      }
    }
  }

  walk(dir);
  return maxMtime;
}

function getRepoHead() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch (err) {
    recordDiagnostic("git rev-parse --short HEAD", err);
    return "-";
  }
}

function getPluginCommit(dir) {
  try {
    const rel = path.relative(ROOT_DIR, dir);
    const fields = execSync(
      `git log -n 1 --format="%h%x09%cr" -- "${rel}" ":(exclude)**/version.ts"`,
      {
        cwd: ROOT_DIR,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }
    ).trim();
    const [hash, timeAgo] = fields.split("\t");
    return { hash: hash || "-", timeAgo: timeAgo || "-" };
  } catch (err) {
    recordDiagnostic(`git log for ${path.relative(ROOT_DIR, dir)}`, err);
    return { hash: "-", timeAgo: "-" };
  }
}

function isAncestorOrEqual(requiredCommit, targetCommit) {
  if (!requiredCommit || requiredCommit === "-" || !targetCommit || targetCommit === "-") return false;
  if (targetCommit.startsWith(requiredCommit) || requiredCommit.startsWith(targetCommit)) return true;
  try {
    execSync(`git merge-base --is-ancestor "${requiredCommit}" "${targetCommit}"`, {
      cwd: ROOT_DIR,
      stdio: ["pipe", "pipe", "ignore"],
    });
    return true;
  } catch (err) {
    // Exit 1 is the normal "not an ancestor" answer; anything else is a real failure.
    if (err.status !== 1) {
      recordDiagnostic(`git merge-base --is-ancestor ${requiredCommit} ${targetCommit}`, err);
    }
    return false;
  }
}

function getVersionFilePath(pluginDir) {
  const possiblePaths = [
    path.join(pluginDir, "shared", "version.ts"),
    path.join(pluginDir, "version.ts"),
    path.join(pluginDir, "src", "version.ts"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getStampedVersion(pluginDir) {
  return readPluginStamp(pluginDir);
}

// Read-only: a plugin's own uncommitted working-tree changes. Generated stamp
// and vendored-helper trees are excluded — `--reload` rewrites them by design,
// so they are not "dirty code". Everything else (tracked edits, new files) is.
function getPluginDirtyFiles(fullPath) {
  const rel = path.relative(ROOT_DIR, fullPath);
  try {
    const out = execSync(`git status --porcelain -- "${rel}"`, {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        let p = line.slice(3);
        const arrow = p.indexOf(" -> ");
        if (arrow !== -1) p = p.slice(arrow + 4);
        return p.replace(/^"|"$/g, "");
      })
      .filter((p) => !p.endsWith("/shared/version.ts") && !p.includes("/vendor/"));
  } catch (err) {
    recordDiagnostic(`git status for ${rel}`, err);
    return [];
  }
}

function getPluginPackageJson(name, fullPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(fullPath, "package.json"), "utf-8"));
  } catch (err) {
    recordDiagnostic(`read plugins/${name}/package.json`, err);
    return null;
  }
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const CODE_SCAN_SKIP_DIRS = new Set(["node_modules", ".git", "dist", "vendor"]);

// Read-only: newest mtime of the plugin's own runtime source, excluding docs,
// generated stamps and vendored trees. Rotation-proof fallback evidence for a
// plugin whose log no longer carries a version tag.
function getPluginCodeMtime(dir) {
  let max = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      if (!isMissingPath(err)) {
        recordDiagnostic(`scan ${path.relative(ROOT_DIR, current)}`, err);
      }
      continue;
    }
    for (const entry of entries) {
      if (CODE_SCAN_SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (
        entry.isFile() &&
        entry.name !== "version.ts" &&
        CODE_EXTENSIONS.has(path.extname(entry.name))
      ) {
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs > max) max = stat.mtimeMs;
        } catch (err) {
          if (!isMissingPath(err)) {
            recordDiagnostic(`stat ${path.relative(ROOT_DIR, full)}`, err);
          }
        }
      }
    }
  }
  return max;
}

function getPaseoPlugins() {
  try {
    const stdout = execSync("paseo plugin ls --json", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    return JSON.parse(stdout);
  } catch (err) {
    recordDiagnostic("paseo plugin ls --json", err);
    return [];
  }
}

const VERSION_TAG_RE = /\[[a-zA-Z0-9_-]+\s+v([0-9a-zA-Z.-]+)\+([0-9a-fA-F]+)\]/g;

function getPluginLogEntries(pluginId) {
  try {
    const stdout = execSync(`paseo plugin logs "${pluginId}" --json`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    recordDiagnostic(`paseo plugin logs ${pluginId} --json`, err);
    return null;
  }
}

// Reads the whole retained log instead of a fixed tail. A chatty plugin can
// evict its boot banner from the ring buffer, so the version tag is first
// attributed to the current process (after the last "Loading plugin"); when no
// tag survives, the boot timestamp is returned as a rotation-proof fallback.
function getLivePluginInfo(pluginId) {
  const entries = getPluginLogEntries(pluginId);
  if (!entries || entries.length === 0) return null;

  let bootIndex = -1;
  for (let i = 0; i < entries.length; i++) {
    const message = entries[i].message || "";
    if (/\[paseo\]\s+Loading plugin/.test(message)) bootIndex = i;
  }
  if (bootIndex < 0) {
    for (let i = 0; i < entries.length; i++) {
      if (/Initializing plugin/.test(entries[i].message || "")) bootIndex = i;
    }
  }

  let tag = null;
  for (let i = entries.length - 1; i >= Math.max(bootIndex, 0); i--) {
    const matches = [...(entries[i].message || "").matchAll(VERSION_TAG_RE)];
    if (matches.length > 0) {
      tag = matches[matches.length - 1];
      break;
    }
  }

  const bootEntry = bootIndex >= 0 ? entries[bootIndex] : null;
  const parsedStart = bootEntry ? Date.parse(bootEntry.timestamp) : NaN;
  const processStartedAt = Number.isFinite(parsedStart) ? parsedStart : null;

  if (!tag && !processStartedAt) return null;
  return {
    version: tag ? tag[1] : null,
    sha: tag ? tag[2] : null,
    source: tag ? "log-tag" : "process-start",
    processStartedAt,
  };
}

function formatDuration(ms) {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  return `${hrs}h ago`;
}

async function loadStampVersionFn() {
  const entry = path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "dist", "server", "index.js");
  try {
    const helperServer = await import(entry);
    return helperServer.stampVersion ?? null;
  } catch (err) {
    // Expected before the first build; the helper row reports staleness.
    recordDiagnostic(`import helper dist at ${path.relative(ROOT_DIR, entry)}`, err);
    return null;
  }
}

// Read-only: inspects the helper, vendored trees and every plugin, and returns
// both the reportable result and the state remediation needs. No writes.
async function diagnose() {
  const result = {
    timestamp: new Date().toISOString(),
    ready: true,
    repoHead: getRepoHead(),
    helper: null,
    plugins: [],
    nestedHelperShadows: [],
    sdkDrift: [],
    npmHelperDeps: [],
    vendorLinked: [],
    reloaded: [],
    reloadFailed: [],
  };

  const state = {
    helperStale: false,
    stampVersionFn: await loadStampVersionFn(),
    vendorDrifted: new Set(),
    vendorLinked: new Set(),
    pluginStates: [],
  };

  // 1. Check Helper Build Sync
  const helperSrcDir = path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "src");
  const helperDistDir = path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "dist");
  const srcMtime = getLatestMtime(helperSrcDir);
  const distMtime = getLatestMtime(helperDistDir);

  const helperStale = !fs.existsSync(helperDistDir) || srcMtime > distMtime;
  const helperDiff = Math.abs(srcMtime - distMtime);

  state.helperStale = helperStale;
  result.helper = {
    status: helperStale ? "stale" : "synced",
    srcMtime,
    distMtime,
    detail: helperStale
      ? distMtime === 0
        ? "dist missing (needs build)"
        : `dist older than src by ${formatDuration(helperDiff)}`
      : `dist synced (${formatDuration(Date.now() - distMtime)})`,
  };

  if (helperStale) {
    result.ready = false;
  }

  // 2. Check Monorepo Plugins
  const configuredPlugins = getPaseoPlugins();
  const pluginsDir = path.join(ROOT_DIR, "plugins");
  const pluginDirs = fs.existsSync(pluginsDir)
    ? fs.readdirSync(pluginsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];

  // Vendor drift (once): which plugins' vendored helper copies differ
  // from a fresh sync. Paths look like "drift: plugins/<name>/...".
  // A deliberate dev link ("linked: plugins/<name>/...") is NOT drift and must
  // never be auto-materialized here (#146) — it is reported as a warning, since
  // a linked tree is not installable. It is also excluded from reload: the
  // Paseo compiler rejects the relative vendored symlink.
  try {
    execSync("node scripts/vendor-sync.mjs --check", {
      cwd: ROOT_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch (err) {
    // A non-zero exit is expected when drift/linked output was produced; a
    // genuine failure is one that yields neither.
    const out = (err.stdout || "") + "\n" + (err.stderr || "");
    for (const m of out.matchAll(/drift:\s*plugins\/([^/\s]+)/g)) {
      state.vendorDrifted.add(m[1]);
    }
    for (const m of out.matchAll(/linked:\s*plugins\/([^/\s]+)/g)) {
      state.vendorLinked.add(m[1]);
    }
    if (state.vendorDrifted.size === 0 && state.vendorLinked.size === 0) {
      recordDiagnostic("node scripts/vendor-sync.mjs --check", err);
    }
  }
  if (state.vendorLinked.size > 0) result.ready = false;

  for (const name of pluginDirs) {
    const fullPath = path.join(pluginsDir, name);
    // Guard: a registry-installed nested paseo-plugin-helper shadows the
    // workspace symlink and freezes the plugin on stale helper types/code.
    // (Orbit: scoped `npm install --workspace` during version bumps.)
    const nestedHelper = path.join(fullPath, "node_modules", "paseo-plugin-helper");
    let nestedStat = null;
    try {
      nestedStat = fs.lstatSync(nestedHelper);
    } catch (err) {
      // No nested helper is the normal case; anything else is a real failure.
      if (!isMissingPath(err)) {
        recordDiagnostic(`inspect plugins/${name}/node_modules/paseo-plugin-helper`, err);
      }
    }

    let nestedShadow = false;
    let nestedVersion = "?";
    if (nestedStat && !nestedStat.isSymbolicLink()) {
      nestedShadow = true;
      try {
        nestedVersion = JSON.parse(
          fs.readFileSync(path.join(nestedHelper, "package.json"), "utf-8")
        ).version;
      } catch (err) {
        recordDiagnostic(`read plugins/${name}/node_modules/paseo-plugin-helper/package.json`, err);
      }
      result.nestedHelperShadows.push({ plugin: name, version: nestedVersion });
      result.ready = false;
    }

    const pluginCommit = getPluginCommit(fullPath);
    const stamped = getStampedVersion(fullPath);

    // Match with Paseo configured plugins
    const configured = configuredPlugins.find(
      (p) => p.id === name || (p.path && path.resolve(p.path) === fullPath)
    );

    const pluginId = configured ? configured.id : name;
    const daemonRunning = configured && configured.status === "running";
    const liveInfo = configured ? getLivePluginInfo(pluginId) : null;

    // A plugin is stamp-required when it opts into the regime (a `stamp` script)
    // or already carries a stamp file. The check is no longer vacuously true when
    // the file is missing, so an unstamped plugin can never read as fresh.
    const pkg = getPluginPackageJson(name, fullPath);
    const stampRequired = Boolean(pkg?.scripts?.stamp) || getVersionFilePath(fullPath) !== null;
    const stampMissing = stampRequired && !stamped;

    // Check stamp freshness: stamped SHA must be at least as new as the latest code commit
    const stampFresh = stamped ? isAncestorOrEqual(pluginCommit.hash, stamped.sha) : false;
    const stampStale = Boolean(stamped) && !stampFresh;

    // Check live daemon freshness. A retained version tag is commit-based; with
    // no tag left, the process boot time vs the plugin's own code mtime still
    // reflects the code the daemon actually loaded.
    let liveFresh = false;
    let liveSource = null;
    if (liveInfo?.sha) {
      liveFresh = isAncestorOrEqual(pluginCommit.hash, liveInfo.sha);
      liveSource = "log-tag";
    } else if (liveInfo?.processStartedAt) {
      const codeAt = getPluginCodeMtime(fullPath);
      if (codeAt) {
        liveFresh = liveInfo.processStartedAt >= codeAt;
        liveSource = "process-start";
      }
    }

    const dirtyFiles = getPluginDirtyFiles(fullPath);
    const dirty = dirtyFiles.length > 0;

    let status = "ready";
    let message = "Live & up-to-date";

    if (!configured) {
      status = "not-configured";
      message = "Not in paseo plugin ls (ignored)";
    } else if (!daemonRunning) {
      status = "stopped";
      message = `Daemon ${configured.status || "stopped"}`;
      result.ready = false;
    } else if (liveSource && !liveFresh) {
      status = "stale-daemon";
      message = liveInfo.sha
        ? `Running ${liveInfo.sha}, needs >= ${pluginCommit.hash}`
        : `Started before ${pluginCommit.hash}`;
      result.ready = false;
    } else if (stampStale) {
      status = "stale-stamp";
      message = `version.ts at ${stamped.sha}, needs >= ${pluginCommit.hash}`;
      result.ready = false;
    } else if (stampMissing) {
      status = "no-stamp";
      message = "shared/version.ts is missing (stamp required)";
      result.ready = false;
    } else if (dirty) {
      // Only reached when the daemon and stamp would otherwise read as fresh:
      // uncommitted code is a distinct, non-fresh state (never a silent pass).
      status = "dirty";
      message = `${dirtyFiles.length} uncommitted change(s) in plugins/${name}`;
      result.ready = false;
    } else if (!liveSource) {
      status = "running";
      message = "Daemon running (no liveness evidence)";
    }

    // A linked vendor tree is not installable and must never read as healthy.
    // Do not auto-materialize it (#146): warn and leave the fix to the user.
    const vendorIsLinked = state.vendorLinked.has(name);
    if (vendorIsLinked) {
      status = "vendor-linked";
      message = "Vendored helper is a dev link — not installable";
      result.ready = false;
    }

    // #633: which paseo-plugin-helper this daemon is actually serving, and can
    // it be attributed to a commit. Read from the checkout, never from the
    // plugin's own claim about itself.
    const helperIdentity = evaluateHelperIdentity(fullPath, ROOT_DIR);
    const helperBroken = helperIdentity.status === "stale" || helperIdentity.status === "unknown";
    if (helperBroken && status !== "vendor-linked") {
      status = "stale-helper";
      message = helperIdentity.reasons[0];
      result.ready = false;
    } else if (helperIdentity.status === "behind" && status === "ready") {
      message = `Live; helper ${helperIdentity.resolved.version}@${helperIdentity.resolved.revision} is newer than the stamp`;
    }

    const pluginData = {
      name,
      pluginId,
      status,
      vendorLinked: vendorIsLinked,
      dirty,
      dirtyFiles: dirtyFiles.length,
      stampRequired,
      liveSource: liveSource || "-",
      repoHead: pluginCommit.hash,
      repoTimeAgo: pluginCommit.timeAgo,
      stampedSha: stamped?.sha || "-",
      liveSha: liveInfo?.sha || "-",
      daemonStatus: configured?.status || "none",
      helper: {
        servedFrom: helperIdentity.servedFrom,
        route: helperIdentity.route || "-",
        declaredVersion: helperIdentity.declared?.version || "-",
        declaredSource: helperIdentity.declared?.source || "-",
        version: helperIdentity.resolved.version || "-",
        revision: helperIdentity.resolved.revision || "-",
        stampHelperRevision: helperIdentity.stamped?.helperRevision || "-",
        status: helperIdentity.status,
        detail: helperIdentity.reasons.join("; ") || "-",
      },
      detail: message,
    };

    // SDK + helper-dep audit: every plugin should pin the same
    // @getpaseo/plugin range, and none should take the helper from npm
    // post-vendoring (vendored trees are the install path).
    if (pkg) {
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      pluginData.sdk = deps["@getpaseo/plugin"] || "-";
      pluginData.helperDep = deps["paseo-plugin-helper"] || null;
      if (pluginData.helperDep) {
        result.npmHelperDeps.push({ plugin: name, range: pluginData.helperDep });
        result.ready = false;
      }
    } else {
      pluginData.sdk = "?";
      pluginData.helperDep = null;
    }

    // Vendored helper: pinned version stamp + drift vs fresh sync.
    try {
      const readme = fs.readFileSync(
        path.join(fullPath, "shared", "vendor", "paseo-plugin-helper", "README.md"),
        "utf-8"
      );
      const vm = readme.match(/Pinned helper version:\s*([0-9A-Za-z.-]+)/);
      pluginData.vendorPin = vm ? vm[1].replace(/[.]+$/, "") : "?";
    } catch (err) {
      // A plugin without a vendored tree has no README; other errors are real.
      if (!isMissingPath(err)) {
        recordDiagnostic(`read vendored helper README for plugins/${name}`, err);
      }
      pluginData.vendorPin = "-";
    }
    // Vendor drift is a publish-time concern: dev resolves the bare helper
    // specifier to the helper src, so stale copies never block a dev reload.
    pluginData.vendorDrift = pluginData.vendorPin !== "-" && state.vendorDrifted.has(name);

    result.plugins.push(pluginData);

    state.pluginStates.push({
      name,
      fullPath,
      pluginId,
      configured,
      pluginData,
      pluginCommitHash: pluginCommit.hash,
      stampStale,
      stamped,
      nestedShadow,
      nestedVersion,
    });
  }

  result.vendorLinked = [...state.vendorLinked].sort();

  // SDK drift: distinct declared ranges across plugins (ignoring "-" and "?")
  const sdkRanges = new Set(
    result.plugins.map((p) => p.sdk).filter((s) => s && s !== "-" && s !== "?")
  );
  if (sdkRanges.size > 1) {
    result.sdkDrift = [...sdkRanges].sort();
    result.ready = false;
  }

  return { result, state };
}

// Mutating: only reached with --reload/--fix. Mirrors the historical fix order:
// helper rebuild, vendor sync, then per-plugin (drop nested shadow, re-stamp,
// reload), then a root npm install to restore workspace links.
async function remediate(result, state) {
  if (state.helperStale) {
    console.log(`${colors.yellow}⚡ Rebuilding helper (dist was stale)...${colors.reset}`);
    execSync("npm run build --workspace=packages/paseo-plugin-helper", {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
    result.reloaded.push("packages/paseo-plugin-helper");
    result.helper.status = "synced";

    if (!state.stampVersionFn) {
      state.stampVersionFn = await loadStampVersionFn();
    }
  }

  // Vendored copies are publish artifacts, not a dev dependency: never copy
  // them during a reload. The publish gate runs `vendor-sync` itself.
  if (state.vendorDrifted.size > 0) {
    console.log(`${colors.yellow}ℹ Vendored helper copies are stale (publish artifact) — run: node scripts/vendor-sync.mjs before publishing${colors.reset}`);
  }

  for (const ps of state.pluginStates) {
    if (ps.nestedShadow) {
      console.log(`${colors.yellow}⚡ Removing nested paseo-plugin-helper@${ps.nestedVersion} shadowing workspace link in plugins/${ps.name}...${colors.reset}`);
      fs.rmSync(path.join(ps.fullPath, "node_modules", "paseo-plugin-helper"), {
        recursive: true,
        force: true,
      });
      result.reloaded.push(`plugins/${ps.name}/node_modules/paseo-plugin-helper`);
    }

    if (ps.stampStale && state.stampVersionFn && ps.stamped && ps.stamped.file) {
      console.log(`${colors.yellow}⚡ Stamping updated git version into ${path.relative(ROOT_DIR, ps.stamped.file)}...${colors.reset}`);
      state.stampVersionFn({ cwd: ps.fullPath, targetFile: ps.stamped.file });
      const restamped = getStampedVersion(ps.fullPath);
      ps.pluginData.stampedSha = restamped?.sha || "-";
      if (ps.pluginData.status === "stale-stamp") {
        ps.pluginData.detail = `version.ts at ${ps.pluginData.stampedSha}, needs >= ${ps.pluginCommitHash}`;
      }
    }

    const needsReload =
      ps.configured &&
      (ps.pluginData.status === "stale-daemon" ||
        ps.pluginData.status === "stale-stamp" ||
        ps.pluginData.status === "stopped");

    if (needsReload) {
      console.log(`${colors.yellow}⚡ Reloading plugin '${ps.pluginId}' via paseo...${colors.reset}`);
      try {
        execSync(`paseo plugin reload "${ps.pluginId}"`, { stdio: "inherit" });
        result.reloaded.push(ps.pluginId);
        ps.pluginData.status = "reloaded";
        ps.pluginData.detail = "Reloaded just now";
      } catch (err) {
        result.reloadFailed.push(ps.pluginId);
        ps.pluginData.detail = `Reload failed: ${err.message}`;
      }
    }
  }

  // Re-resolve workspace links once after removing nested shadows (without
  // this the plugin keeps resolving stale nested helper types)
  if (result.nestedHelperShadows.length > 0) {
    console.log(`${colors.yellow}⚡ Restoring workspace links via root npm install...${colors.reset}`);
    execSync("npm install", { cwd: ROOT_DIR, stdio: "inherit" });
  }
}

function output(result) {
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return result.ready ? 0 : 1;
  }

  console.log("");
  console.log(`${colors.bold}🔍 Paseo Live Deployment Doctor${colors.reset}  ${colors.gray}[${new Date().toLocaleTimeString()} • HEAD: ${result.repoHead}]${colors.reset}`);
  console.log("─".repeat(82));

  // Helper Row
  let helperVersion = "?";
  try {
    helperVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "package.json"), "utf-8")
    ).version || "?";
  } catch (err) {
    recordDiagnostic("read packages/paseo-plugin-helper/package.json", err);
  }
  const helperColor = result.helper.status === "synced" ? colors.green : colors.yellow;
  const helperIcon = result.helper.status === "synced" ? "✔" : "▲";
  console.log(
    `${helperColor}${helperIcon} helper@${helperVersion} dist: ${colors.reset}` +
    `${result.helper.status.toUpperCase().padEnd(10)} ` +
    `${colors.gray}(${result.helper.detail})${colors.reset}`
  );
  console.log("─".repeat(82));

  // Plugins Table. The publish-only vendor pin is deliberately not a column: it
  // is printed in its own block below. What a column must answer is which helper
  // the running daemon is serving, which is a different question (#633).
  console.log(
    `${colors.bold}${"Plugin".padEnd(12)} ${"Status".padEnd(17)} ${"Helper".padEnd(14)} ${"Helper rev".padEnd(10)} ${"SDK".padEnd(10)} ${"Code".padEnd(9)} ${"Stamped".padEnd(9)} ${"Live".padEnd(9)} Notes${colors.reset}`,
  );
  console.log("─".repeat(82));

  for (const p of result.plugins) {
    let statColor = colors.green;
    let icon = "✔";
    if (p.status === "stale-daemon" || p.status === "stale-stamp" || p.status === "no-stamp") {
      statColor = colors.yellow;
      icon = "▲";
    } else if (p.status === "stale-helper") {
      statColor = colors.red;
      icon = "⚠";
    } else if (p.status === "dirty") {
      statColor = colors.yellow;
      icon = "✎";
    } else if (p.status === "stopped") {
      statColor = colors.red;
      icon = "✖";
    } else if (p.status === "not-configured") {
      statColor = colors.gray;
      icon = "○";
    } else if (p.status === "running") {
      statColor = colors.cyan;
      icon = "●";
    } else if (p.status === "reloaded") {
      statColor = colors.green;
      icon = "✔";
    } else if (p.status === "vendor-linked") {
      statColor = colors.red;
      icon = "⚠";
    }

    const nameCol = p.name.padEnd(12);
    const statCol = `${statColor}${icon} ${p.status.toUpperCase()}${colors.reset}`.padEnd(26);
    const helperCol = `${p.helper.servedFrom}${p.helper.status === "behind" ? "*" : ""}`.padEnd(14);
    const helperRevCol = p.helper.revision.padEnd(10);
    const sdkCol = (p.sdk + (p.helperDep ? " +npmHelper" : "")).padEnd(10);
    const repoCol = p.repoHead.padEnd(9);
    const stampCol = p.stampedSha.padEnd(9);
    const liveCol = p.liveSha.padEnd(9);
    const noteCol = `${colors.gray}${p.detail}${colors.reset}`;

    console.log(
      `${nameCol} ${statCol} ${helperCol} ${helperRevCol} ${sdkCol} ${repoCol} ${stampCol} ${liveCol} ${noteCol}`,
    );
  }

  console.log("─".repeat(82));

  // #633: the served helper, and whether this daemon can prove which one it is.
  const staleHelper = result.plugins.filter(
    (p) => p.helper.status === "stale" || p.helper.status === "unknown",
  );
  if (staleHelper.length > 0) {
    console.log(
      `${colors.red}✖ These plugins' served paseo-plugin-helper cannot be proven (#633) — a merged helper fix is invisible to them until the checkout moves forward:${colors.reset}`,
    );
    for (const p of staleHelper) {
      console.log(`      plugins/${p.name} — ${p.helper.detail}`);
      if (p.helper.servedFrom === "mixed") {
        console.log(
          `        A known finding the CI gate carries (KNOWN_MIXED_RESOLUTIONS in scripts/helper-resolution.test.mjs); fix it by importing the helper through one form only.`,
        );
      }
      console.log(
        `        served from ${p.helper.servedFrom}${p.helper.route === "-" ? "" : ` via ${p.helper.route}`}; ` +
          `this checkout's helper is ${p.helper.version}@${p.helper.revision}; ` +
          `declared ${p.helper.declaredVersion} (${p.helper.declaredSource})`,
      );
    }
    console.log("");
    console.log(
      `      To see what a merged helper fix added after this checkout stopped moving forward:`,
    );
    console.log(
      `      ${colors.cyan}git log ${result.repoHead}..origin/main --oneline -- packages/paseo-plugin-helper${colors.reset}`,
    );
    console.log(`      Then update the checkout the plugin was installed from and reload it.`);
    console.log("");
  }

  const behindHelper = result.plugins.filter((p) => p.helper.status === "behind");
  if (behindHelper.length > 0) {
    console.log(
      `${colors.cyan}ℹ These plugins are stamped against an older helper than this checkout serves (a re-stamp prompt, not drift):${colors.reset}`,
    );
    for (const p of behindHelper) {
      console.log(
        `      plugins/${p.name}: stamped against helper ${p.helper.stampHelperRevision}, serving ${p.helper.revision}`,
      );
    }
    console.log("");
  }

  const linkedPlugins = result.plugins.filter((p) => p.vendorLinked);
  if (linkedPlugins.length > 0) {
    console.log(`${colors.yellow}⚠️  Vendored helper trees are legacy dev symlinks — NOT installable, do not ship/publish:${colors.reset}`);
    for (const p of linkedPlugins) {
      console.log(`      plugins/${p.name} — materialize with ${colors.cyan}node scripts/vendor-sync.mjs${colors.reset}`);
    }
    console.log("");
  }

  // Publish-only signal: dev is unaffected because it resolves the bare helper
  // specifier straight to the helper src.
  const driftedPublish = result.plugins.filter((p) => p.vendorDrift);
  if (driftedPublish.length > 0) {
    console.log(`${colors.yellow}ℹ Vendored helper copies stale (publish artifact only — dev resolves helper src directly):${colors.reset}`);
    for (const p of driftedPublish) {
      console.log(`      plugins/${p.name}: pinned ${p.vendorPin} — run ${colors.cyan}node scripts/vendor-sync.mjs${colors.reset} before publishing`);
    }
    console.log("");
  }

  if (!result.ready && !shouldReload) {
    console.log(`${colors.yellow}⚠️  Action Required to Test Fresh Code:${colors.reset}`);
    if (result.helper.status === "stale") {
      console.log(`  1. Rebuild helper: ${colors.cyan}npm run build --workspace=packages/paseo-plugin-helper${colors.reset}`);
    }
    if (result.sdkDrift.length > 0) {
      console.log(`  ⚠️  SDK drift across plugins (expected one range): ${colors.cyan}${result.sdkDrift.join("  vs  ")}${colors.reset}`);
      for (const p of result.plugins) {
        console.log(`      ${p.name}: ${p.sdk}`);
      }
    }
    if (result.npmHelperDeps.length > 0) {
      for (const h of result.npmHelperDeps) {
        console.log(`  ⚠️  plugins/${h.plugin} still depends on npm paseo-plugin-helper@${h.range} (expected vendored, no dep)`);
      }
    }
    const dirtyPlugins = result.plugins.filter((p) => p.status === "dirty");
    if (dirtyPlugins.length > 0) {
      console.log(`  ⚠️  Uncommitted plugin code (commit before refreshing): ${dirtyPlugins.map((p) => p.name).join(", ")}`);
    }
    const unstampedPlugins = result.plugins.filter((p) => p.status === "no-stamp");
    if (unstampedPlugins.length > 0) {
      console.log(`  ⚠️  Missing version stamp: ${unstampedPlugins.map((p) => p.name).join(", ")} (generate shared/version.ts)`);
    }
    if (result.nestedHelperShadows.length > 0) {
      for (const s of result.nestedHelperShadows) {
        console.log(`  ⚠️  Nested paseo-plugin-helper@${s.version} shadows workspace link in plugins/${s.plugin} (stale types/code): ${colors.cyan}rm -rf plugins/${s.plugin}/node_modules/paseo-plugin-helper && npm install${colors.reset}`);
      }
    }
    // A stale served helper is not something --reload can fix: reloading from the
    // same checkout re-serves the same helper, which is exactly the #622 trap.
    const staleHelperPlugins = result.plugins.filter((p) => p.status === "stale-helper");
    if (staleHelperPlugins.length > 0) {
      console.log(
        `  ⚠️  Unproven served helper (reload will NOT help — see above): ${staleHelperPlugins.map((p) => p.name).join(", ")}`,
      );
    }
    const needsReload = result.plugins.filter((p) => p.status === "stale-daemon" || p.status === "stale-stamp");
    if (needsReload.length > 0) {
      const ids = needsReload.map((p) => p.pluginId).join(" ");
      console.log(`  2. Reload daemons: ${colors.cyan}paseo plugin reload ${ids}${colors.reset}`);
    }
    console.log(`  💡 Tip: run with ${colors.cyan}--reload${colors.reset} to auto-fix and reload: ${colors.cyan}npm run doctor:live -- --reload${colors.reset}`);
    console.log("");
    console.log(`${colors.gray}🖥️  Client UI Note: If you have Paseo open, press Ctrl+R (Cmd+R) or re-open the plugin modal/surface to pick up fresh evaluated client code.${colors.reset}`);
    console.log("");
    return 1;
  } else if (linkedPlugins.length > 0) {
    console.log(`${colors.red}✖ Linked vendored helper trees cannot load or install — refusing to report healthy.${colors.reset}`);
    console.log(`${colors.gray}Run: node scripts/vendor-sync.mjs${colors.reset}`);
    console.log("");
    return 1;
  } else {
    console.log(`${colors.green}✔ All configured daemons and helper builds are synchronized with latest code!${colors.reset}`);
    console.log(`${colors.gray}🖥️  Client UI Note: If you have Paseo open, press Ctrl+R (Cmd+R) or re-open the plugin modal/surface to verify UI changes.${colors.reset}`);
    console.log("");
    return 0;
  }
}

async function main() {
  const { result, state } = await diagnose();
  if (shouldReload) {
    await remediate(result, state);
    // One best-effort 2fado ping for the whole batch; the daemon being down
    // must never fail the doctor run.
    await notifyReloadOutcome({
      reloaded: result.reloaded,
      failed: result.reloadFailed,
      repoHead: result.repoHead,
    });
  }
  const exitCode = output(result);
  printDiagnostics();
  return exitCode;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("Doctor failed:", err);
    process.exit(1);
  });
