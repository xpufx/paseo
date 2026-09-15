#!/usr/bin/env node

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// CLI Arguments
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isForce = args.includes("--force");
const isAll = args.includes("--all");
const targetRemote = process.env.GITHUB_REMOTE || "github";
const targetBranch = process.env.GITHUB_BRANCH || "main";
const targetUrl = "git@github.com:xpufx/paseo.git";

// Parse targets (plugins and packages)
const selectedTargets = new Set();
for (const arg of args) {
  if (arg.startsWith("--target=") || arg.startsWith("--plugin=") || arg.startsWith("--include=")) {
    const val = arg.split("=")[1].trim();
    val.split(",").map(t => t.trim()).filter(Boolean).forEach(t => selectedTargets.add(t));
  }
}

// Normalize helper aliases
const includesHelper = isAll || selectedTargets.has("helper") || selectedTargets.has("paseo-plugin-helper") || args.includes("--with-helper");
selectedTargets.delete("helper");
selectedTargets.delete("paseo-plugin-helper");

// If nothing specified and not all, default to "top"
if (!isAll && selectedTargets.size === 0 && !includesHelper) {
  selectedTargets.add("top");
}

const displayTargets = [];
if (includesHelper) displayTargets.push("helper");
selectedTargets.forEach(t => displayTargets.push(t));

const targetSummaryStr = isAll ? "all" : displayTargets.join(", ");
console.log(`[mirror-github] Syncing targets: [${targetSummaryStr}] to ${targetRemote}:${targetBranch}...`);
if (isDryRun) {
  console.log(`[mirror-github] DRY-RUN MODE: No changes will be pushed to remote.`);
}

// 0. Refuse linked dev state: vendor symlinks must be materialized copies.
const linkedVendors = [];
for (const p of selectedTargets) {
  for (const tree of ["client", "server", "shared"]) {
    const v = path.join("plugins", p, tree, "vendor", "paseo-plugin-helper");
    try {
      if (fs.lstatSync(v).isSymbolicLink()) linkedVendors.push(v);
    } catch {
      // Missing vendor dir — not this check's problem.
    }
  }
}
if (linkedVendors.length > 0) {
  console.error(`[mirror-github] error: linked dev state under publish paths — materialize first:`);
  for (const v of linkedVendors) console.error(`  - ${v}`);
  console.error(`[mirror-github] run: node scripts/vendor-sync.mjs`);
  process.exit(1);
}

// 1. Ensure remote is recognized
let remoteDestination = targetRemote;
try {
  execSync(`git remote get-url ${targetRemote}`, { stdio: "ignore" });
} catch {
  remoteDestination = targetUrl;
}

// 2. Discover existing plugins and packages in workspace
const allAvailablePlugins = fs.existsSync("plugins")
  ? fs.readdirSync("plugins", { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  : [];

const allAvailablePackages = fs.existsSync("packages")
  ? fs.readdirSync("packages", { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  : [];

// Determine paths to prune from the isolated index
const unwantedPaths = [];

if (!isAll) {
  for (const plugin of allAvailablePlugins) {
    if (!selectedTargets.has(plugin)) {
      unwantedPaths.push(`plugins/${plugin}`);
    }
  }

  if (!includesHelper) {
    unwantedPaths.push("packages");
  } else {
    // If helper is included, prune any other package in packages/ that wasn't targeted
    for (const pkg of allAvailablePackages) {
      if (pkg !== "paseo-plugin-helper" && !selectedTargets.has(pkg)) {
        unwantedPaths.push(`packages/${pkg}`);
      }
    }
  }

  // Internal/development tooling
  unwantedPaths.push("mcp", ".agents", "skills");

  // The monorepo lockfile references pruned workspace paths (packages/*,
  // sibling plugins); shipping it breaks `npm install` in the scoped
  // checkout, so dependency resolution falls back to the registry instead.
  unwantedPaths.push("package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml");
}

// 3. Prepare isolated temporary git index
const tempIndex = path.join(os.tmpdir(), `git-index-mirror-${Date.now()}`);
const tempPkg = path.join(os.tmpdir(), `pkg-mirror-${Date.now()}.json`);
const env = { ...process.env, GIT_INDEX_FILE: tempIndex };

try {
  // Read current HEAD tree into temporary index
  execSync("git read-tree HEAD", { env, stdio: "inherit" });

  // Prune unwanted paths
  for (const item of unwantedPaths) {
    try {
      execSync(`git rm -r --cached --quiet --ignore-unmatch ${item}`, {
        env,
        stdio: "ignore",
      });
    } catch {
      // Ignored if path was not in tree
    }
  }

  // 4. Prepare scoped root package.json for the monorepo baseline
  const rootPkgRaw = fs.readFileSync("package.json", "utf-8");
  const rootPkg = JSON.parse(rootPkgRaw);

  const scopedWorkspaces = [];
  if (includesHelper) {
    scopedWorkspaces.push("packages/paseo-plugin-helper");
  }
  if (isAll) {
    allAvailablePlugins.forEach(p => scopedWorkspaces.push(`plugins/${p}`));
  } else {
    for (const p of selectedTargets) {
      if (allAvailablePlugins.includes(p)) {
        scopedWorkspaces.push(`plugins/${p}`);
      }
    }
  }

  rootPkg.workspaces = scopedWorkspaces;
  if (rootPkg.repository) {
    rootPkg.repository.url = targetUrl;
  }

  fs.writeFileSync(tempPkg, JSON.stringify(rootPkg, null, 2) + "\n");
  const blobId = execSync(`git hash-object -w "${tempPkg}"`, {
    encoding: "utf-8",
  }).trim();

  execSync(`git update-index --cacheinfo 100644 ${blobId} package.json`, {
    env,
    stdio: "inherit",
  });

  // 5. Write new tree object
  const treeId = execSync("git write-tree", {
    env,
    encoding: "utf-8",
  }).trim();
  console.log(`[mirror-github] Prepared tree ID: ${treeId}`);

  // 6. Determine remote parent commit for clean fast-forward
  let parentArgs = [];
  try {
    const lsRemote = execFileSync(
      "git",
      ["ls-remote", remoteDestination, `refs/heads/${targetBranch}`],
      { encoding: "utf-8" }
    ).trim();
    if (lsRemote) {
      const remoteHead = lsRemote.split(/\s+/)[0];
      if (remoteHead && /^[0-9a-f]{40}$/.test(remoteHead)) {
        parentArgs = ["-p", remoteHead];
        console.log(`[mirror-github] Remote parent: ${remoteHead}`);
      }
    }
  } catch (err) {
    console.warn("[mirror-github] Could not query remote HEAD; committing as root or manual parent.");
  }

  // 7. Get latest commit subject from local HEAD
  const headSubject = execFileSync(
    "git",
    ["log", "-1", "--format=%s", "HEAD"],
    { encoding: "utf-8" }
  ).trim();
  const commitMsg = `sync(${targetSummaryStr}): ${headSubject}`;

  // 8. Create commit object
  const commitArgs = ["commit-tree", treeId, ...parentArgs, "-m", commitMsg];
  const commitId = execFileSync("git", commitArgs, {
    encoding: "utf-8",
  }).trim();
  console.log(`[mirror-github] Created commit ID: ${commitId}`);

  // 9. Push commit to GitHub
  const pushArgs = ["push"];
  if (isDryRun) pushArgs.push("--dry-run");
  if (isForce) pushArgs.push("--force");
  pushArgs.push(remoteDestination, `${commitId}:refs/heads/${targetBranch}`);

  console.log(`[mirror-github] Executing: git ${pushArgs.join(" ")}`);
  execFileSync("git", pushArgs, { stdio: "inherit" });

  console.log(`[mirror-github] Success! Targets [${targetSummaryStr}] synchronized to ${remoteDestination}:${targetBranch}`);
} finally {
  if (fs.existsSync(tempIndex)) fs.unlinkSync(tempIndex);
  if (fs.existsSync(tempPkg)) fs.unlinkSync(tempPkg);
}
