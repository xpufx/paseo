#!/usr/bin/env node

/**
 * doctor:live - Monorepo live deployment and daemon freshness inspector
 *
 * Verifies that:
 * 1. packages/paseo-plugin-helper/dist is compiled and up-to-date with src
 * 2. Each plugin's shared/version.ts contains current code changes
 * 3. Each plugin's Paseo daemon is running and loaded with current code changes
 * 4. No plugin has a linked (non-installable) vendored helper tree — warned,
 *    never auto-materialized and never reported healthy
 *
 * `diagnose()` is strictly read-only. All builds, stamps, vendor syncs, nested
 * helper removals and daemon reloads live in `remediate()`, which is only
 * reached when `--reload`/`--fix` is passed.
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
    const hash = execSync(`git log -n 1 --format="%h" -- "${rel}" ":(exclude)**/version.ts"`, {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    const timeAgo = execSync(`git log -n 1 --format="%cr" -- "${rel}" ":(exclude)**/version.ts"`, {
      cwd: ROOT_DIR,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
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

function getStampedVersion(pluginDir) {
  const possiblePaths = [
    path.join(pluginDir, "shared", "version.ts"),
    path.join(pluginDir, "version.ts"),
    path.join(pluginDir, "src", "version.ts"),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, "utf8");
      const match = content.match(/PLUGIN_VERSION\s*=\s*["']([^"']+)["']/);
      if (match) {
        const full = match[1];
        const sha = full.includes("+") ? full.split("+")[1] : full;
        return { full, sha, file: p };
      }
    }
  }
  return null;
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

function getLivePluginVersion(pluginId) {
  try {
    const stdout = execSync(`paseo plugin logs "${pluginId}" 2>/dev/null | tail -n 80`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });

    const loggerMatches = [...stdout.matchAll(/\[[a-zA-Z0-9_-]+\s+v([0-9a-zA-Z.-]+)\+([0-9a-fA-F]+)\]/g)];
    if (loggerMatches.length > 0) {
      const lastMatch = loggerMatches[loggerMatches.length - 1];
      return { version: lastMatch[1], sha: lastMatch[2], source: "log-tag" };
    }

    return null;
  } catch (err) {
    recordDiagnostic(`paseo plugin logs ${pluginId}`, err);
    return null;
  }
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
  };

  const state = {
    helperStale: false,
    stampVersionFn: await loadStampVersionFn(),
    vendorDrifted: new Set(),
    vendorLinked: new Set(),
    vendorNeedsReload: new Set(),
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
  state.vendorNeedsReload = new Set(state.vendorDrifted);

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
    const liveInfo = configured ? getLivePluginVersion(pluginId) : null;

    // Check stamp freshness: stamped SHA must be at least as new as the latest code commit
    const stampFresh = !stamped || isAncestorOrEqual(pluginCommit.hash, stamped.sha);
    const stampStale = Boolean(stamped) && !stampFresh;

    // Check live daemon freshness: running SHA must be at least as new as the latest code commit
    const liveFresh = liveInfo ? isAncestorOrEqual(pluginCommit.hash, liveInfo.sha) : false;

    let status = "ready";
    let message = "Live & up-to-date";

    if (!configured) {
      status = "not-configured";
      message = "Not in paseo plugin ls (ignored)";
    } else if (!daemonRunning) {
      status = "stopped";
      message = `Daemon ${configured.status || "stopped"}`;
      result.ready = false;
    } else if (liveInfo && !liveFresh) {
      status = "stale-daemon";
      message = `Running ${liveInfo.sha}, needs >= ${pluginCommit.hash}`;
      result.ready = false;
    } else if (stampStale) {
      status = "stale-stamp";
      message = `version.ts at ${stamped.sha}, needs >= ${pluginCommit.hash}`;
      result.ready = false;
    } else if (!liveInfo) {
      status = "running";
      message = "Daemon running";
    }

    // A linked vendor tree is not installable and must never read as healthy.
    // Do not auto-materialize it (#146): warn and leave the fix to the user.
    const vendorIsLinked = state.vendorLinked.has(name);
    if (vendorIsLinked) {
      status = "vendor-linked";
      message = "Vendored helper is a dev link — not installable";
      result.ready = false;
    }

    const pluginData = {
      name,
      pluginId,
      status,
      vendorLinked: vendorIsLinked,
      repoHead: pluginCommit.hash,
      repoTimeAgo: pluginCommit.timeAgo,
      stampedSha: stamped?.sha || "-",
      liveSha: liveInfo?.sha || "-",
      daemonStatus: configured?.status || "none",
      detail: message,
    };

    // SDK + helper-dep audit: every plugin should pin the same
    // @getpaseo/plugin range, and none should take the helper from npm
    // post-vendoring (vendored trees are the install path).
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(fullPath, "package.json"), "utf-8"));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      pluginData.sdk = deps["@getpaseo/plugin"] || "-";
      pluginData.helperDep = deps["paseo-plugin-helper"] || null;
      if (pluginData.helperDep) {
        result.npmHelperDeps.push({ plugin: name, range: pluginData.helperDep });
        result.ready = false;
      }
    } catch (err) {
      recordDiagnostic(`read plugins/${name}/package.json`, err);
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
    if (pluginData.vendorPin !== "-" && state.vendorDrifted.has(name)) {
      pluginData.vendorDrift = true;
      result.ready = false;
    } else {
      pluginData.vendorDrift = false;
    }

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

  if (state.vendorDrifted.size > 0) {
    console.log(`${colors.yellow}⚡ Synchronizing vendored helper trees before reload...${colors.reset}`);
    execSync("node scripts/vendor-sync.mjs", {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
    state.vendorDrifted.clear();
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
        ps.pluginData.status === "stopped" ||
        state.vendorNeedsReload.has(ps.name));

    if (needsReload) {
      console.log(`${colors.yellow}⚡ Reloading plugin '${ps.pluginId}' via paseo...${colors.reset}`);
      try {
        execSync(`paseo plugin reload "${ps.pluginId}"`, { stdio: "inherit" });
        result.reloaded.push(ps.pluginId);
        ps.pluginData.status = "reloaded";
        ps.pluginData.detail = "Reloaded just now";
      } catch (err) {
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

  // Plugins Table
  console.log(
    `${colors.bold}${"Plugin".padEnd(12)} ${"Status".padEnd(17)} ${"SDK".padEnd(10)} ${"Vendor".padEnd(16)} ${"Code".padEnd(9)} ${"Stamped".padEnd(9)} ${"Live".padEnd(9)} Notes${colors.reset}`
  );
  console.log("─".repeat(82));

  for (const p of result.plugins) {
    let statColor = colors.green;
    let icon = "✔";
    if (p.status === "stale-daemon" || p.status === "stale-stamp") {
      statColor = colors.yellow;
      icon = "▲";
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
    const sdkCol = (p.sdk + (p.helperDep ? " +npmHelper" : "")).padEnd(10);
    const vendorCol = (p.vendorPin === "-" ? "-" : `${p.vendorPin}${p.vendorDrift ? "*" : ""}`).padEnd(16);
    const repoCol = p.repoHead.padEnd(9);
    const stampCol = p.stampedSha.padEnd(9);
    const liveCol = p.liveSha.padEnd(9);
    const noteCol = `${colors.gray}${p.detail}${colors.reset}`;

    console.log(`${nameCol} ${statCol} ${sdkCol} ${vendorCol} ${repoCol} ${stampCol} ${liveCol} ${noteCol}`);
  }

  console.log("─".repeat(82));

  const linkedPlugins = result.plugins.filter((p) => p.vendorLinked);
  if (linkedPlugins.length > 0) {
    console.log(`${colors.yellow}⚠️  Vendored helper trees are dev links — NOT installable, do not ship/publish:${colors.reset}`);
    for (const p of linkedPlugins) {
      console.log(`      plugins/${p.name} — materialize with ${colors.cyan}node scripts/vendor-sync.mjs${colors.reset}`);
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
    {
      const drifted = result.plugins.filter((p) => p.vendorDrift);
      if (drifted.length > 0) {
        console.log(`  ⚠️  Vendor drift (vendored copy differs from helper src): ${colors.cyan}make vendor-sync${colors.reset}`);
        for (const p of drifted) {
          console.log(`      ${p.name}: pinned ${p.vendorPin}, needs re-sync`);
        }
      }
    }
    if (result.nestedHelperShadows.length > 0) {
      for (const s of result.nestedHelperShadows) {
        console.log(`  ⚠️  Nested paseo-plugin-helper@${s.version} shadows workspace link in plugins/${s.plugin} (stale types/code): ${colors.cyan}rm -rf plugins/${s.plugin}/node_modules/paseo-plugin-helper && npm install${colors.reset}`);
      }
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
