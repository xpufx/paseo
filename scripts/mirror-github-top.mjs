#!/usr/bin/env node

import { execSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const isDryRun = process.argv.includes("--dry-run");
const isForce = process.argv.includes("--force");
const targetRemote = process.env.GITHUB_REMOTE || "github";
const targetUrl = "git@github.com:xpufx/paseo.git";

console.log("[mirror-top] Starting GitHub mirror sync for 'plugins/top'...");
if (isDryRun) {
  console.log("[mirror-top] DRY-RUN MODE: No changes will be pushed.");
}

// 1. Ensure remote is recognized
let remoteDestination = targetRemote;
try {
  execSync(`git remote get-url ${targetRemote}`, { stdio: "ignore" });
} catch {
  remoteDestination = targetUrl;
}

// 2. Prepare isolated temporary git index
const tempIndex = path.join(os.tmpdir(), `git-index-mirror-top-${Date.now()}`);
const tempPkg = path.join(os.tmpdir(), `pkg-mirror-top-${Date.now()}.json`);
const env = { ...process.env, GIT_INDEX_FILE: tempIndex };

try {
  // Read current HEAD tree into temporary index
  execSync("git read-tree HEAD", { env, stdio: "inherit" });

  // Exclude directories not yet ready for GitHub mirror
  const unwanted = [
    "packages",
    "plugins/demo",
    "plugins/forgejo",
    "plugins/mcp-tools",
    "plugins/x-comms",
    "mcp",
    ".agents",
    "skills",
  ];

  for (const item of unwanted) {
    try {
      execSync(`git rm -r --cached --quiet --ignore-unmatch ${item}`, {
        env,
        stdio: "ignore",
      });
    } catch {
      // Ignored if path was not in index
    }
  }

  // 3. Prepare scoped root package.json for the monorepo baseline
  const rootPkgRaw = fs.readFileSync("package.json", "utf-8");
  const rootPkg = JSON.parse(rootPkgRaw);
  rootPkg.workspaces = ["plugins/top"];
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

  // 4. Write new tree object
  const treeId = execSync("git write-tree", {
    env,
    encoding: "utf-8",
  }).trim();
  console.log(`[mirror-top] Prepared tree ID: ${treeId}`);

  // 5. Determine remote parent commit for clean fast-forward
  let parentArgs = [];
  try {
    const lsRemote = execFileSync(
      "git",
      ["ls-remote", remoteDestination, "refs/heads/main"],
      { encoding: "utf-8" }
    ).trim();
    if (lsRemote) {
      const remoteHead = lsRemote.split(/\s+/)[0];
      if (remoteHead && /^[0-9a-f]{40}$/.test(remoteHead)) {
        parentArgs = ["-p", remoteHead];
        console.log(`[mirror-top] Remote parent: ${remoteHead}`);
      }
    }
  } catch (err) {
    console.warn("[mirror-top] Could not query remote HEAD; committing as root or manual parent.");
  }

  // 6. Get latest commit subject from local HEAD
  const headSubject = execFileSync(
    "git",
    ["log", "-1", "--format=%s", "HEAD"],
    { encoding: "utf-8" }
  ).trim();
  const commitMsg = `sync(top): ${headSubject}`;

  // 7. Create commit object
  const commitArgs = ["commit-tree", treeId, ...parentArgs, "-m", commitMsg];
  const commitId = execFileSync("git", commitArgs, {
    encoding: "utf-8",
  }).trim();
  console.log(`[mirror-top] Created commit ID: ${commitId}`);

  // 8. Push commit to GitHub
  const pushArgs = ["push"];
  if (isDryRun) pushArgs.push("--dry-run");
  if (isForce) pushArgs.push("--force");
  pushArgs.push(remoteDestination, `${commitId}:refs/heads/main`);

  console.log(`[mirror-top] Executing: git ${pushArgs.join(" ")}`);
  execFileSync("git", pushArgs, { stdio: "inherit" });

  console.log(`[mirror-top] Success! Top plugin synchronized to ${remoteDestination}:main`);
} finally {
  if (fs.existsSync(tempIndex)) fs.unlinkSync(tempIndex);
  if (fs.existsSync(tempPkg)) fs.unlinkSync(tempPkg);
}
