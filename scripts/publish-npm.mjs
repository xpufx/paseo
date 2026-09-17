#!/usr/bin/env node
/**
 * npm publish preparation for plugin packages (xpufx-org/paseo#211).
 *
 * DRY-RUN BY DEFAULT — prints exactly what would be published and exits without
 * contacting the registry. Pass --publish to actually publish, which also
 * requires a configured npm credential; this repo has none by default.
 *
 * A Paseo plugin is consumed as TypeScript source (the daemon compiles
 * `index.client.{ts,tsx}` / `index.server.{ts,tsx}` with esbuild at load), so
 * there is no build step and no `dist/`. The published package ships sources,
 * the manifest, the README/LICENSE, and the vendored helper copies nested under
 * client/server/shared.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { filesAllowlist, publishName, repositoryField, REQUIRED_FILES } from "./lib/npm-manifest.mjs";

const REPO_URL = "git+https://github.com/xpufx/paseo.git";
const PLUGIN_DIR = "plugins";

const args = process.argv.slice(2);
const shouldPublish = args.includes("--publish");
const dryRun = !shouldPublish;

function pluginIds() {
  return fs
    .readdirSync(PLUGIN_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(PLUGIN_DIR, e.name, "paseo-plugin.json")))
    .map((e) => e.name)
    .sort();
}

/** Refuse to publish from a dirty tree: the tarball would not match any commit. */
function assertCleanTree() {
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (status) {
    console.error("[publish-npm] refusing to publish: working tree is dirty");
    console.error(status);
    process.exit(1);
  }
}

function manifestFor(id) {
  const dir = path.join(PLUGIN_DIR, id);
  const pkgPath = path.join(dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const entries = fs.readdirSync(dir);
  const missing = REQUIRED_FILES.filter((f) => !entries.includes(f));
  return {
    id,
    dir,
    pkgPath,
    pkg,
    publishAs: publishName(id),
    currentName: pkg.name,
    version: pkg.version,
    isPrivate: pkg.private === true,
    files: filesAllowlist(entries),
    missingRequired: missing,
  };
}

function report(manifests) {
  console.log("[publish-npm] plugin package readiness\n");
  let blocked = 0;
  for (const m of manifests) {
    const problems = [];
    if (m.isPrivate) problems.push('"private": true blocks publish');
    if (m.version === undefined) problems.push("no version");
    if (m.missingRequired.length > 0) problems.push(`missing: ${m.missingRequired.join(", ")}`);
    const status = problems.length === 0 ? "READY" : "BLOCKED";
    if (problems.length > 0) blocked += 1;
    console.log(`  ${status.padEnd(8)} ${m.id}`);
    console.log(`           publish as : ${m.publishAs}   (current name: ${m.currentName})`);
    console.log(`           version    : ${m.version ?? "-"}`);
    console.log(`           files      : ${m.files.join(" ")}`);
    if (problems.length > 0) console.log(`           problems   : ${problems.join("; ")}`);
    console.log("");
  }
  console.log(`[publish-npm] ${manifests.length} plugin(s), ${blocked} blocked`);
  return blocked;
}

function dryRunTarballs(manifests) {
  console.log("[publish-npm] tarball preview (npm pack --dry-run)\n");
  for (const m of manifests) {
    try {
      const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: path.resolve(m.dir),
        encoding: "utf8",
        env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? "/tmp/paseo-npm-pack-cache" },
      });
      const info = JSON.parse(out)[0];
      console.log(
        `  ${m.id.padEnd(15)} ${String(info.files.length).padStart(4)} files  ${(info.unpackedSize / 1024).toFixed(0).padStart(5)} kB unpacked  ${(info.size / 1024).toFixed(0).padStart(4)} kB packed`,
      );
    } catch (error) {
      console.log(`  ${m.id.padEnd(15)} pack failed: ${error.message.split("\n")[0]}`);
    }
  }
  console.log("");
}

function main() {
  const manifests = pluginIds().map(manifestFor);
  const blocked = report(manifests);

  if (dryRun) {
    dryRunTarballs(manifests);
    if (blocked > 0) {
      console.log("[publish-npm] DRY RUN — some packages are not ready (see BLOCKED above)");
    } else {
      console.log("[publish-npm] DRY RUN — all packages ready; re-run with --publish to publish");
    }
    return;
  }

  if (blocked > 0) {
    console.error("[publish-npm] refusing to publish while any package is BLOCKED");
    process.exit(1);
  }
  assertCleanTree();
  for (const m of manifests) {
    console.log(`[publish-npm] publishing ${m.publishAs}@${m.version} from ${m.dir}`);
    execFileSync("npm", ["publish", "--access", "public"], { cwd: path.resolve(m.dir), stdio: "inherit" });
  }
}

main();
