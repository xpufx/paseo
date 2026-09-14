#!/usr/bin/env node

/**
 * doctor:live - Monorepo live deployment and daemon freshness inspector
 *
 * Verifies that:
 * 1. packages/paseo-plugin-helper/dist is compiled and up-to-date with src
 * 2. Each plugin's shared/version.ts contains current code changes
 * 3. Each plugin's Paseo daemon is running and loaded with current code changes
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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
  } catch {
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

async function main() {
  let stampVersionFn = null;
  try {
    const helperServer = await import(
      path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "dist", "server", "index.js")
    );
    stampVersionFn = helperServer.stampVersion;
  } catch {
    // helper dist not compiled yet
  }

  const repoHead = getRepoHead();

  const result = {
    timestamp: new Date().toISOString(),
    ready: true,
    repoHead,
    helper: null,
    plugins: [],
    nestedHelperShadows: [],
    sdkDrift: [],
    npmHelperDeps: [],
    reloaded: [],
  };

  // 1. Check Helper Build Sync
  const helperSrcDir = path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "src");
  const helperDistDir = path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "dist");
  const srcMtime = getLatestMtime(helperSrcDir);
  const distMtime = getLatestMtime(helperDistDir);

  const helperStale = !fs.existsSync(helperDistDir) || srcMtime > distMtime;
  const helperDiff = Math.abs(srcMtime - distMtime);

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
    if (shouldReload) {
      console.log(`${colors.yellow}⚡ Rebuilding helper (dist was stale)...${colors.reset}`);
      execSync("npm run build --workspace=packages/paseo-plugin-helper", {
        cwd: ROOT_DIR,
        stdio: "inherit",
      });
      result.reloaded.push("packages/paseo-plugin-helper");
      result.helper.status = "synced";

      if (!stampVersionFn) {
        try {
          const helperServer = await import(
            path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "dist", "server", "index.js")
          );
          stampVersionFn = helperServer.stampVersion;
        } catch {}
      }
    }
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
  const vendorDrifted = new Set();
  try {
    const out = execSync("node scripts/vendor-sync.mjs --check", {
      cwd: ROOT_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    void out;
  } catch (e) {
    const out = (e.stdout || "") + "\n" + (e.stderr || "");
    for (const m of out.matchAll(/drift:\s*plugins\/([^/\s]+)/g)) {
      vendorDrifted.add(m[1]);
    }
  }
  const vendorNeedsReload = new Set(vendorDrifted);
  if (shouldReload && vendorDrifted.size > 0) {
    console.log(`${colors.yellow}⚡ Synchronizing vendored helper trees before reload...${colors.reset}`);
    execSync("node scripts/vendor-sync.mjs", {
      cwd: ROOT_DIR,
      stdio: "inherit",
    });
    vendorDrifted.clear();
  }

  for (const name of pluginDirs) {
    const fullPath = path.join(pluginsDir, name);
    // Guard: a registry-installed nested paseo-plugin-helper shadows the
    // workspace symlink and freezes the plugin on stale helper types/code.
    // (Orbit: scoped `npm install --workspace` during version bumps.)
    const nestedHelper = path.join(fullPath, "node_modules", "paseo-plugin-helper");
    let nestedStat = null;
    try {
      nestedStat = fs.lstatSync(nestedHelper);
    } catch {}
    if (nestedStat && !nestedStat.isSymbolicLink()) {
      let nestedVersion = "?";
      try {
        nestedVersion = JSON.parse(
          fs.readFileSync(path.join(nestedHelper, "package.json"), "utf-8")
        ).version;
      } catch {}
      result.nestedHelperShadows.push({ plugin: name, version: nestedVersion });
      result.ready = false;
      if (shouldReload) {
        console.log(`${colors.yellow}⚡ Removing nested paseo-plugin-helper@${nestedVersion} shadowing workspace link in plugins/${name}...${colors.reset}`);
        fs.rmSync(nestedHelper, { recursive: true, force: true });
        result.reloaded.push(`plugins/${name}/node_modules/paseo-plugin-helper`);
      }
    }
    const pluginCommit = getPluginCommit(fullPath);
    let stamped = getStampedVersion(fullPath);

    // Match with Paseo configured plugins
    const configured = configuredPlugins.find(
      (p) => p.id === name || (p.path && path.resolve(p.path) === fullPath)
    );

    const pluginId = configured ? configured.id : name;
    const daemonRunning = configured && configured.status === "running";
    let liveInfo = configured ? getLivePluginVersion(pluginId) : null;

    // Check stamp freshness: stamped SHA must be at least as new as the latest code commit
    const stampFresh = !stamped || isAncestorOrEqual(pluginCommit.hash, stamped.sha);
    const stampStale = stamped && !stampFresh;

    if (stampStale && shouldReload && stampVersionFn && stamped.file) {
      console.log(`${colors.yellow}⚡ Stamping updated git version into ${path.relative(ROOT_DIR, stamped.file)}...${colors.reset}`);
      stampVersionFn({ cwd: fullPath, targetFile: stamped.file });
      stamped = getStampedVersion(fullPath);
    }

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

    const pluginData = {
      name,
      pluginId,
      status,
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
    } catch {
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
    } catch {
      pluginData.vendorPin = "-";
    }
    if (pluginData.vendorPin !== "-" && vendorDrifted.has(name)) {
      pluginData.vendorDrift = true;
      result.ready = false;
    } else {
      pluginData.vendorDrift = false;
    }

    result.plugins.push(pluginData);

    if (
      shouldReload &&
      configured &&
      (status === "stale-daemon" ||
        status === "stale-stamp" ||
        status === "stopped" ||
        vendorNeedsReload.has(name))
    ) {
      console.log(`${colors.yellow}⚡ Reloading plugin '${pluginId}' via paseo...${colors.reset}`);
      try {
        execSync(`paseo plugin reload "${pluginId}"`, { stdio: "inherit" });
        result.reloaded.push(pluginId);
        pluginData.status = "reloaded";
        pluginData.detail = "Reloaded just now";
      } catch (e) {
        pluginData.detail = `Reload failed: ${e.message}`;
      }
    }
  }

  // SDK drift: distinct declared ranges across plugins (ignoring "-" and "?")
  const sdkRanges = new Set(
    result.plugins.map((p) => p.sdk).filter((s) => s && s !== "-" && s !== "?")
  );
  if (sdkRanges.size > 1) {
    result.sdkDrift = [...sdkRanges].sort();
    result.ready = false;
  }

  // (vendor drift computed above, before the plugin loop)

  // 3. Output Handling
  // Re-resolve workspace links once after removing nested shadows (without
  // this the plugin keeps resolving stale nested helper types)
  if (shouldReload && result.nestedHelperShadows.length > 0) {
    console.log(`${colors.yellow}⚡ Restoring workspace links via root npm install...${colors.reset}`);
    execSync("npm install", { cwd: ROOT_DIR, stdio: "inherit" });
  }
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ready ? 0 : 1);
  }

  console.log("");
  console.log(`${colors.bold}🔍 Paseo Live Deployment Doctor${colors.reset}  ${colors.gray}[${new Date().toLocaleTimeString()} • HEAD: ${repoHead}]${colors.reset}`);
  console.log("─".repeat(82));

  // Helper Row
  let helperVersion = "?";
  try {
    helperVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, "packages", "paseo-plugin-helper", "package.json"), "utf-8")
    ).version || "?";
  } catch {}
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
    process.exit(1);
  } else {
    console.log(`${colors.green}✔ All configured daemons and helper builds are synchronized with latest code!${colors.reset}`);
    console.log(`${colors.gray}🖥️  Client UI Note: If you have Paseo open, press Ctrl+R (Cmd+R) or re-open the plugin modal/surface to verify UI changes.${colors.reset}`);
    console.log("");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Doctor failed:", err);
  process.exit(1);
});
