#!/usr/bin/env node
/**
 * npm publish preparation and staged handoff for plugin packages
 * (xpufx-org/paseo#211).
 *
 * A Paseo plugin is consumed as TypeScript source (the daemon compiles
 * `index.client.{ts,tsx}` / `index.server.{ts,tsx}` with esbuild at load), so
 * there is no build step and no `dist/`. The published package ships sources,
 * the manifest, the README/LICENSE, and the vendored helper copies nested under
 * client/server/shared.
 *
 * Three roles, one script:
 *
 *   dry run (default)   Readiness report + `npm pack --dry-run` preview. Never
 *                       contacts the registry and needs no credentials.
 *   --stage             Runs the same checks, then packs real tarballs into a
 *                       known output directory (`publish-stage/` by default)
 *                       with a `manifest.json` describing them. Still never
 *                       contacts the registry and needs no credentials — an
 *                       agent or CI uploads the directory as an artifact.
 *   --publish           The human step. Publishes the staged tarballs (or, with
 *                       --from-dirs, the plugin directories) via
 *                       `npm publish --access public`, prompting for the OTP /
 *                       two-factor code when the registry requires it.
 *
 * Registry-native alternative: npm (>=11.19) can defer proof-of-presence itself
 * with `npm stage publish <tarball>` (no 2FA, needs a token) followed by the
 * human running `npm stage approve <stage-id>` (2FA). The staged tarballs this
 * script produces feed either path; use the npm-native commands when the
 * account/registry has staged publishing enabled.
 *
 * Usage:
 *   node scripts/publish-npm.mjs                              # dry run
 *   node scripts/publish-npm.mjs --stage                      # pack to publish-stage/
 *   node scripts/publish-npm.mjs --stage --out=/tmp/npm-stage # custom output
 *   node scripts/publish-npm.mjs --publish                    # human: publish staged tarballs
 *   node scripts/publish-npm.mjs --publish --dry-run          # print the publish commands only
 *   node scripts/publish-npm.mjs --publish --otp=123456       # non-interactive OTP
 *   node scripts/publish-npm.mjs --publish --from-dirs        # publish dirs, not staged tarballs
 *   node scripts/publish-npm.mjs --clean-stage                # remove the staged output
 *
 * Options:
 *   --plugin=a,b   restrict to these plugin ids (default: all)
 *   --out=DIR      staging output directory (default: publish-stage)
 *   --otp=NNNNNN   OTP for --publish (otherwise npm prompts)
 *   --from-dirs    with --publish: run npm publish inside each plugin dir
 *   --dry-run      with --publish: print commands without executing them
 *   --allow-dirty  skip the clean-tree assertion (stage and publish)
 *   --quiet        suppress the per-package readiness/preview detail
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { filesAllowlist, publishName, REQUIRED_FILES } from "./lib/npm-manifest.mjs";
import { hasBareHelperSpecifier, rewriteBareSpecifiers } from "./lib/plugin-helper-layout.mjs";

const PLUGIN_DIR = "plugins";
const DEFAULT_STAGE_DIR = "publish-stage";
const PACK_CACHE = process.env.npm_config_cache ?? "/tmp/paseo-npm-pack-cache";

/** Parse the supported flags. Throws on mutually exclusive modes. */
export function parseArgs(argv) {
  const valueOf = (name) => {
    for (let i = 0; i < argv.length; i += 1) {
      if (argv[i] === name) return argv[i + 1];
      if (argv[i].startsWith(`${name}=`)) return argv[i].slice(name.length + 1);
    }
    return undefined;
  };
  const stage = argv.includes("--stage");
  const publish = argv.includes("--publish");
  const clean = argv.includes("--clean-stage");
  if ([stage, publish, clean].filter(Boolean).length > 1) {
    throw new Error("--stage, --publish and --clean-stage are mutually exclusive");
  }
  const pluginsRaw = valueOf("--plugin");
  return {
    mode: stage ? "stage" : publish ? "publish" : clean ? "clean" : "dry-run",
    outDir: valueOf("--out") ?? DEFAULT_STAGE_DIR,
    plugins: pluginsRaw ? pluginsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    otp: valueOf("--otp"),
    fromDirs: argv.includes("--from-dirs"),
    dryRun: argv.includes("--dry-run"),
    allowDirty: argv.includes("--allow-dirty"),
    allowOrphans: argv.includes("--allow-orphans"),
    quiet: argv.includes("--quiet"),
  };
}

export function pluginIds() {
  return fs
    .readdirSync(PLUGIN_DIR, { withFileTypes: true })
    // Symlinked plugin aliases are not distinct publishable packages.
    // `isDirectory()` is already false for a symlink under `withFileTypes`, but
    // that is incidental: skip links explicitly so an alias can never be staged
    // and published twice.
    .filter((e) => !e.isSymbolicLink() && e.isDirectory())
    .filter((e) => fs.existsSync(path.join(PLUGIN_DIR, e.name, "paseo-plugin.json")))
    .filter((e) => {
      const pkgPath = path.join(PLUGIN_DIR, e.name, "package.json");
      if (!fs.existsSync(pkgPath)) return false;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        return pkg.private !== true;
      } catch {
        return false;
      }
    })
    .map((e) => e.name)
    .sort();
}

export const PLACEHOLDER_VERSION = "0.0.0-stage";

export function isPlaceholderVersion(version) {
  return version === PLACEHOLDER_VERSION || Boolean(version?.startsWith("0.0.0-stage"));
}

/**
 * Detect untracked (orphan) files in a directory via git ls-files.
 */
export function detectOrphanFiles(dir) {
  try {
    const out = execFileSync("git", ["ls-files", "--others", "--exclude-standard", path.resolve(dir)], {
      encoding: "utf8",
    }).trim();
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Guard against untracked orphan files when staging or publishing.
 * When --allow-dirty is passed, untracked files in the target plugin directories
 * pose an orphan risk (accidentally packaging uncommitted or scratch files).
 */
export function assertNoOrphanRisk(dirs, { allowOrphans = false } = {}) {
  const dirList = Array.isArray(dirs) ? dirs : [dirs];
  const allOrphans = [];
  for (const d of dirList) {
    const found = detectOrphanFiles(d);
    for (const f of found) allOrphans.push(f);
  }
  if (allOrphans.length > 0) {
    const msg = `[publish-npm] untracked orphan file(s) detected in publish path:\n  - ${allOrphans.join("\n  - ")}`;
    if (allowOrphans) {
      console.warn(`WARNING: ${msg}\nProceeding because --allow-orphans was specified.`);
    } else {
      console.error(msg);
      throw new Error(`refusing to stage/publish: untracked orphan files detected (pass --allow-orphans to override)`);
    }
  }
}

/**
 * Detect symlink hazards in a plugin directory before direct publishing (--from-dirs).
 * Publishing directly from a directory containing symlinks can create broken/dangling
 * symlinks in installed packages, packing loops, or ship unintended symlink aliases.
 */
export function assertNoSymlinkHazards(dir, manifest) {
  const resolvedDir = path.resolve(dir);
  if (fs.lstatSync(resolvedDir).isSymbolicLink()) {
    throw new Error(`[publish-npm] symlink hazard: ${resolvedDir} is a symbolic link; direct publish from a symlink alias is forbidden`);
  }
  const publishedDirs = ["client", "server", "shared", "mcp", "docs", "examples", "scripts"];
  const hazards = [];

  for (const sub of publishedDirs) {
    const subPath = path.join(resolvedDir, sub);
    if (!fs.existsSync(subPath)) continue;
    if (fs.lstatSync(subPath).isSymbolicLink()) {
      hazards.push(`${sub} (publish directory is a symlink)`);
      continue;
    }
    const entries = fs.readdirSync(subPath, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        const parent = entry.parentPath ?? entry.path ?? subPath;
        const fullPath = path.join(parent, entry.name);
        const relPath = path.relative(resolvedDir, fullPath);
        hazards.push(`${relPath} (symlink inside published directory ${sub}/)`);
      }
    }
  }

  const topFiles = manifest?.files ?? REQUIRED_FILES;
  for (const file of topFiles) {
    if (file.startsWith("!") || publishedDirs.includes(file)) continue;
    const filePath = path.join(resolvedDir, file);
    try {
      if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
        hazards.push(`${file} (published entry point/file is a symlink)`);
      }
    } catch {
      /* missing file handled elsewhere */
    }
  }

  if (hazards.length > 0) {
    throw new Error(`[publish-npm] symlink hazard(s) in ${dir}:\n  - ${hazards.join("\n  - ")}`);
  }
}

/** Refuse to stage/publish from a dirty tree: the artifact would match no commit. */
function assertCleanTree({ allowDirty = false, allowOrphans = false, dirs = [] } = {}) {
  const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (status && !allowDirty) {
    console.error("[publish-npm] refusing to stage/publish: working tree is dirty (pass --allow-dirty to override)");
    console.error(status);
    process.exit(1);
  }
  if (allowDirty && dirs.length > 0) {
    try {
      assertNoOrphanRisk(dirs, { allowOrphans });
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }
}

export function manifestFor(id) {
  const dir = path.join(PLUGIN_DIR, id);
  const pkgPath = path.join(dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const entries = fs.readdirSync(dir);
  const missing = REQUIRED_FILES.filter((f) => !entries.includes(f));
  // Publish name derives from the plugin's identity in paseo-plugin.json, not
  // the directory name: the two diverge (e.g. plugins/demo -> id
  // "paseo-helper-demo"), and the npm package name must match the id the
  // daemon installs by.
  let pluginId = id;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "paseo-plugin.json"), "utf8"));
    if (typeof meta.id === "string" && meta.id.length > 0) pluginId = meta.id;
  } catch {
    /* keep directory name when paseo-plugin.json is missing/unreadable */
  }
  return {
    id,
    pluginId,
    dir,
    pkgPath,
    pkg,
    publishAs: publishName(pluginId),
    currentName: pkg.name,
    version: pkg.version,
    isPrivate: pkg.private === true,
    files: filesAllowlist(entries),
    missingRequired: missing,
  };
}

export function readiness(m) {
  const problems = [];
  if (m.isPrivate) problems.push('"private": true blocks publish');
  if (m.version === undefined) problems.push("no version");
  if (m.missingRequired.length > 0) problems.push(`missing: ${m.missingRequired.join(", ")}`);
  return problems;
}

function report(manifests, quiet) {
  if (quiet) {
    const blocked = manifests.filter((m) => readiness(m).length > 0).length;
    console.log(`[publish-npm] ${manifests.length} plugin(s), ${blocked} blocked`);
    return blocked;
  }
  console.log("[publish-npm] plugin package readiness\n");
  let blocked = 0;
  for (const m of manifests) {
    const problems = readiness(m);
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

function dryRunTarballs(manifests, quiet) {
  if (quiet) return;
  console.log("[publish-npm] tarball preview (npm pack --dry-run)\n");
  for (const m of manifests) {
    try {
      const info = pack(m, { dryRun: true });
      console.log(
        `  ${m.id.padEnd(15)} ${String(info.files.length).padStart(4)} files  ${(info.unpackedSize / 1024).toFixed(0).padStart(5)} kB unpacked  ${(info.size / 1024).toFixed(0).padStart(4)} kB packed`,
      );
    } catch (error) {
      console.log(`  ${m.id.padEnd(15)} pack failed: ${error.message.split("\n")[0]}`);
    }
  }
  console.log("");
}

/** Run `npm pack` for one manifest; returns the parsed --json record. */
function pack(m, { dryRun = false, destination } = {}) {
  const args = ["pack", path.resolve(m.dir), "--json"];
  if (dryRun) args.push("--dry-run");
  if (destination) args.push("--pack-destination", path.resolve(destination));
  const out = execFileSync("npm", args, {
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: PACK_CACHE },
  });
  return JSON.parse(out)[0];
}

const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;

/**
 * Rewrite every nested manifest that claims the plugin's own npm name so it
 * reports the root version, and return the paths that actually changed.
 *
 * A plugin can ship a subdirectory that has a manifest of its own
 * (plugins/x-comms/mcp), and when that manifest reuses the plugin's package
 * name the two files describe one npm package. A release bump only ever edits
 * the root manifest, so the nested copy silently shipped a stale version
 * (xpufx-org/paseo#604) — and the same blind spot is what let the nested copy
 * keep a wrong license value for months (#595).
 *
 * The root manifest is the source of truth: it is what a release bump edits and
 * what `manifestFor` reports as the staged version, so the nested copy follows
 * rather than voting.
 */
export function syncNestedManifestVersions(pluginRoot, { name, version }) {
  if (name === undefined || version === undefined) return [];
  const synced = [];
  const stack = [pluginRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(current, entry.name);
      const nestedPath = path.join(dir, "package.json");
      if (fs.existsSync(nestedPath)) {
        const pkg = JSON.parse(fs.readFileSync(nestedPath, "utf8"));
        if (pkg.name === name && pkg.version !== version) {
          fs.writeFileSync(nestedPath, `${JSON.stringify({ ...pkg, version }, null, 2)}\n`, "utf8");
          synced.push(path.relative(pluginRoot, nestedPath));
        }
      }
      stack.push(dir);
    }
  }
  return synced;
}

/**
 * Copy a plugin to an isolated packing tree and rewrite its live workspace
 * helper imports to the committed vendored copies. The source tree is never
 * modified: only the exact files handed to `npm pack` are rewritten.
 */
export function rewrittenPackingManifest(m) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-publish-pack-"));
  const pluginRoot = path.join(root, m.id);
  fs.cpSync(m.dir, pluginRoot, {
    recursive: true,
    filter: (source) => !["node_modules", ".git"].includes(path.basename(source)),
  });

  const stack = [pluginRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (SOURCE_FILE_RE.test(entry.name)) {
        if (entryPath.includes(`${path.sep}vendor${path.sep}paseo-plugin-helper${path.sep}`)) continue;
        const source = fs.readFileSync(entryPath, "utf8");
        const rewritten = rewriteBareSpecifiers(source, entryPath, pluginRoot);
        if (hasBareHelperSpecifier(rewritten)) {
          throw new Error(`a bare paseo-plugin-helper specifier survived the publish rewrite in ${entryPath}`);
        }
        if (rewritten !== source) fs.writeFileSync(entryPath, rewritten);
      }
    }
  }
  const synced = syncNestedManifestVersions(pluginRoot, { name: m.pkg?.name, version: m.version });
  if (synced.length > 0) {
    console.log(`[publish-npm] ${m.id}: nested manifest version synced to ${m.version} (${synced.join(", ")})`);
  }
  return { manifest: { ...m, dir: pluginRoot }, root };
}

function gitValue(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Pack every ready manifest into `<outDir>/<id>/<tarball>` and write a
 * `manifest.json` (plus a short `PUBLISH.md`) so an agent/CI can upload the
 * directory. No registry contact, no credentials.
 */
export function stagePackages(manifests, opts) {
  const outDir = path.resolve(opts.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const packages = [];
  for (const m of manifests) {
    const dest = path.resolve(outDir, m.id);
    const relativeDest = path.relative(outDir, dest);
    if (!relativeDest || relativeDest === ".." || relativeDest.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDest)) {
      throw new Error(`refusing to clear staging destination outside ${outDir}: ${m.id}`);
    }
    // npm pack writes only the tarball, so start each package directory fresh.
    // This also removes extracted output (such as package/) from an earlier
    // stage, making the handoff artifact unambiguous.
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const { manifest: packingManifest, root } = rewrittenPackingManifest(m);
    let info;
    try {
      info = (opts.pack ?? pack)(packingManifest, { destination: dest });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    const tarball = path.join(m.id, info.filename);
    packages.push({
      id: m.id,
      publishAs: m.publishAs,
      version: m.version,
      tarball,
      shasum: info.shasum,
      integrity: info.integrity,
      size: info.size,
      unpackedSize: info.unpackedSize,
      fileCount: info.files.length,
    });
    console.log(`[publish-npm] staged ${m.publishAs}@${m.version} -> ${tarball}`);
  }
  const manifest = {
    stagedAt: new Date().toISOString(),
    gitCommit: gitValue(["rev-parse", "HEAD"]),
    gitBranch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    packages,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "PUBLISH.md"), stageNote(manifest));
  console.log(`[publish-npm] ${packages.length} package(s) staged in ${path.relative(process.cwd(), outDir) || outDir}`);
  console.log(`[publish-npm] manifest: ${path.relative(process.cwd(), path.join(outDir, "manifest.json"))}`);
  return manifest;
}

/** Human-facing note dropped next to the staged tarballs. */
function stageNote(manifest) {
  const rows = manifest.packages
    .map((p) => `| \`${p.publishAs}\` | \`${p.version}\` | \`${p.tarball}\` | \`${p.shasum}\` |`)
    .join("\n");
  return `# Staged npm plugin packages

Staged ${manifest.stagedAt} from \`${manifest.gitBranch ?? "?"}@${(manifest.gitCommit ?? "?").slice(0, 12)}\`.

This directory is a CI/agent artifact. It is inert — nothing here has touched
the npm registry. Upload the whole directory, then a human publishes.

| package | version | tarball | shasum |
| --- | --- | --- | --- |
${rows}

## Human publish (requires npm 2FA / OTP)

\`\`\`sh
node scripts/publish-npm.mjs --publish
# or from a downloaded copy of this directory:
npm publish <tarball> --access public
\`\`\`

A later \`--publish\` re-reads \`manifest.json\`; re-stage if a plugin version
changed. Registry-native alternative (npm >= 11.19, defers 2FA to approval):
\`npm stage publish <tarball>\` by the agent/CI, then \`npm stage approve <id>\`
by the human.
`;
}

function readStage(outDir) {
  const manifestPath = path.join(path.resolve(outDir), "manifest.json");
  if (!fs.existsSync(manifestPath)) return undefined;
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

/**
 * Resolve the publish plan without executing it: each entry is either a staged
 * tarball (`target`) or a plugin directory (`dir`). Fails when the stage is
 * missing/stale relative to the current plugin versions.
 */
export function resolvePublishPlan(manifests, opts) {
  const outDir = path.resolve(opts.outDir);
  const stage = opts.fromDirs ? undefined : readStage(outDir);
  if (opts.fromDirs) {
    return manifests.map((m) => ({ id: m.id, publishAs: m.publishAs, version: m.version, dir: path.resolve(m.dir) }));
  }
  if (!stage) {
    console.log(`[publish-npm] no stage at ${path.relative(process.cwd(), outDir)} — publishing from plugin dirs`);
    return manifests.map((m) => ({ id: m.id, publishAs: m.publishAs, version: m.version, dir: path.resolve(m.dir) }));
  }
  return manifests.map((m) => {
    const staged = stage.packages.find((p) => p.id === m.id);
    if (!staged) throw new Error(`no staged tarball for ${m.id} in ${path.relative(process.cwd(), outDir)}; re-run --stage`);
    if (staged.version !== m.version) {
      throw new Error(`staged ${m.id}@${staged.version} does not match current ${m.version}; re-run --stage`);
    }
    if (isPlaceholderVersion(staged.version)) {
      throw new Error(`staged ${m.id}@${staged.version} is a placeholder version; re-run --stage`);
    }
    const target = path.join(outDir, staged.tarball);
    if (!fs.existsSync(target)) throw new Error(`staged tarball missing: ${staged.tarball}; re-run --stage`);
    return { id: m.id, publishAs: m.publishAs, version: m.version, target, shasum: staged.shasum };
  });
}

/**
 * Built-in verification of a staged artifact before publishing.
 * Verifies that:
 * 1. Staged version is not a placeholder (0.0.0-stage).
 * 2. If target tarball exists: the tarball's internal package.json version and name
 *    match entry.version and entry.publishAs, and shasum matches if provided.
 * 3. If target is directory: directory package.json version and name match.
 */
export function verifyStagedBeforePublish(entry, { runTar = execFileSync } = {}) {
  if (isPlaceholderVersion(entry.version)) {
    throw new Error(`[publish-npm] verification failed: refusing to publish placeholder version ${entry.version} for ${entry.id ?? entry.publishAs}`);
  }

  if (entry.target) {
    if (!fs.existsSync(entry.target)) {
      throw new Error(`[publish-npm] verification failed: staged tarball missing: ${entry.target}`);
    }
    if (entry.shasum) {
      const buf = fs.readFileSync(entry.target);
      const actualSha = crypto.createHash("sha1").update(buf).digest("hex");
      if (actualSha !== entry.shasum) {
        throw new Error(`[publish-npm] verification failed: shasum mismatch for ${entry.target} (expected ${entry.shasum}, got ${actualSha})`);
      }
    }
    let raw;
    try {
      raw = runTar("tar", ["-xOf", path.resolve(entry.target), "package/package.json"], { encoding: "utf8" });
    } catch (err) {
      throw new Error(`[publish-npm] verification failed: could not read package/package.json from tarball ${entry.target}: ${err.message}`);
    }
    let innerPkg;
    try {
      innerPkg = JSON.parse(raw);
    } catch (err) {
      throw new Error(`[publish-npm] verification failed: tarball ${entry.target} contains invalid package.json: ${err.message}`);
    }
    if (innerPkg.version !== entry.version) {
      throw new Error(`[publish-npm] verification failed: tarball version ${innerPkg.version} does not match expected ${entry.version} for ${entry.id ?? entry.publishAs}`);
    }
    if (entry.publishAs && innerPkg.name !== entry.publishAs) {
      throw new Error(`[publish-npm] verification failed: tarball package name ${innerPkg.name} does not match expected ${entry.publishAs}`);
    }
    if (isPlaceholderVersion(innerPkg.version)) {
      throw new Error(`[publish-npm] verification failed: tarball contains placeholder version ${innerPkg.version}`);
    }
  } else if (entry.dir) {
    assertNoSymlinkHazards(entry.dir);
    const pkgPath = path.join(entry.dir, "package.json");
    if (!fs.existsSync(pkgPath)) {
      throw new Error(`[publish-npm] verification failed: package.json missing in ${entry.dir}`);
    }
    const innerPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (innerPkg.version !== entry.version) {
      throw new Error(`[publish-npm] verification failed: directory version ${innerPkg.version} does not match expected ${entry.version} for ${entry.id ?? entry.publishAs}`);
    }
    if (isPlaceholderVersion(innerPkg.version)) {
      throw new Error(`[publish-npm] verification failed: directory contains placeholder version ${innerPkg.version}`);
    }
  }
  return true;
}

export function publishPlan(plan, opts = {}) {
  for (const entry of plan) {
    verifyStagedBeforePublish(entry, opts);
    const publishArgs = ["publish", entry.target ?? entry.dir, "--access", "public"];
    if (opts.otp) publishArgs.push(`--otp=${opts.otp}`);
    if (opts.dryRun) {
      console.log(`[publish-npm] would run: npm ${publishArgs.join(" ")}`);
      continue;
    }
    console.log(`[publish-npm] publishing ${entry.publishAs}@${entry.version}${entry.target ? ` from ${entry.target}` : ""}`);
    execFileSync("npm", publishArgs, { cwd: process.cwd(), stdio: "inherit" });
  }
}

function cleanStage(opts) {
  const outDir = path.resolve(opts.outDir);
  if (outDir === path.resolve("/") || outDir === process.cwd()) {
    console.error(`[publish-npm] refusing to remove ${outDir}`);
    process.exit(1);
  }
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
    console.log(`[publish-npm] removed ${path.relative(process.cwd(), outDir)}`);
  } else {
    console.log(`[publish-npm] nothing to remove at ${path.relative(process.cwd(), outDir)}`);
  }
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.mode === "clean") {
    cleanStage(opts);
    return;
  }

  const known = pluginIds();
  if (opts.plugins.length > 0) {
    const unknown = opts.plugins.filter((id) => !known.includes(id));
    if (unknown.length > 0) {
      console.error(`[publish-npm] unknown plugin(s): ${unknown.join(", ")}`);
      process.exit(1);
    }
  }
  const ids = opts.plugins.length > 0 ? known.filter((id) => opts.plugins.includes(id)) : known;
  const manifests = ids.map(manifestFor);
  const blocked = report(manifests, opts.quiet);

  if (opts.mode === "dry-run") {
    dryRunTarballs(manifests, opts.quiet);
    if (blocked > 0) {
      console.log("[publish-npm] DRY RUN — some packages are not ready (see BLOCKED above)");
    } else {
      console.log("[publish-npm] DRY RUN — all packages ready; re-run with --stage to stage tarballs (or --publish to publish)");
    }
    return;
  }

  if (blocked > 0) {
    console.error(`[publish-npm] refusing to ${opts.mode} while any package is BLOCKED`);
    process.exit(1);
  }

  const pluginDirs = manifests.map((m) => m.dir);

  if (opts.mode === "stage") {
    dryRunTarballs(manifests, opts.quiet);
    assertCleanTree({ allowDirty: opts.allowDirty, allowOrphans: opts.allowOrphans, dirs: pluginDirs });
    stagePackages(manifests, opts);
    console.log("\n[publish-npm] staged artifacts are inert — upload them, then a human runs:");
    console.log(`  node scripts/publish-npm.mjs --publish${opts.outDir !== DEFAULT_STAGE_DIR ? ` --out=${opts.outDir}` : ""}`);
    return;
  }

  // publish: staged tarballs are pinned by shasum, so only a dir publish needs
  // a clean tree (the live directory is the artifact).
  const plan = resolvePublishPlan(manifests, opts);
  const fromDirs = plan.every((entry) => entry.dir !== undefined);
  if (fromDirs) {
    for (const entry of plan) {
      assertNoSymlinkHazards(entry.dir, manifests.find((m) => m.id === entry.id));
    }
    assertCleanTree({ allowDirty: opts.allowDirty, allowOrphans: opts.allowOrphans, dirs: pluginDirs });
  }
  publishPlan(plan, opts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
