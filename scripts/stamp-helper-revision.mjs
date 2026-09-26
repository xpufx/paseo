// Record which paseo-plugin-helper a plugin was stamped against (#649).
//
// `shared/version.ts` gets the plugin's own checkout revision from the helper's
// `stampVersion`. That sha identifies the *checkout*, and a squash-merge deletes
// the very commit it names: #643's branch head `525c597e` landed as `08277a55`,
// so four plugins carried a sha that no clean clone could resolve
// (`fatal: bad object 525c597e`) and the helper-identity gate failed in CI while
// passing on any machine that still had the branch worktree.
//
// This writes the other half — a content digest of the helper tree actually on
// disk — into `shared/helper-version.ts` as `HELPER_REVISION`. A digest answers
// the question directly ("is the helper I am serving the one I was built
// against?") and no VCS operation can invalidate it.
//
// Idempotent: rewrites the existing HELPER_REVISION line in place, or appends
// the constant if absent. Run after any helper change, alongside `npm run stamp`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { helperContentDigest, resolveServedFrom } from "./lib/helper-identity.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const DECLARATION = "shared/helper-version.ts";

const plugins = process.argv.slice(2);
if (plugins.length === 0) {
  console.error("usage: node scripts/stamp-helper-revision.mjs <plugin-dir> [...]");
  process.exit(2);
}

const digest = helperContentDigest(REPO_ROOT);
if (!digest) {
  console.error("[stamp-helper-revision] could not digest packages/paseo-plugin-helper/src");
  process.exit(1);
}
console.log(`[stamp-helper-revision] helper content digest: ${digest}`);

for (const plugin of plugins) {
  const pluginDir = path.join(REPO_ROOT, "plugins", plugin);
  // Decide from what the plugin *resolves*, not from whether a declaration file
  // happens to exist. A plugin can carry a committed vendored tree AND still be
  // served from the checkout, because its bare specifier resolves through the
  // tsconfig `paths` alias: demo, forges, mcp-tools, slash and top are all
  // `checkout` or `mixed` despite vendoring. Keying off file presence skipped
  // exactly those five.
  const servedFrom = resolveServedFrom(pluginDir).servedFrom;
  // "none" is skipped alongside "vendored": a plugin that imports nothing from
  // the helper has no served copy whose identity could go stale, so there is
  // nothing to record. worktree-install is the live case — it ships a vendored
  // tree it never imports from. Declaring "checkout" for it would be false, and
  // the mismatch test correctly refuses it.
  if (servedFrom === "vendored" || servedFrom === "none") {
    console.log(`[stamp-helper-revision] ${plugin}: serves no helper copy from a source that can drift — nothing to record`);
    continue;
  }
  const target = path.join(pluginDir, DECLARATION);
  if (!fs.existsSync(target)) {
    console.error(
      `[stamp-helper-revision] ${plugin}: served from the checkout but has no ${DECLARATION} — create it with HELPER_VERSION and HELPER_SERVED_FROM="checkout"`,
    );
    process.exitCode = 1;
    continue;
  }
  const before = fs.readFileSync(target, "utf8");
  const line = `export const HELPER_REVISION = "${digest}";`;
  const after = /HELPER_REVISION\s*=/.test(before)
    ? before.replace(/export const HELPER_REVISION\s*=\s*["'][^"']*["'];/, line)
    : `${before.replace(/\s*$/, "")}\n${line}\n`;
  if (after !== before) {
    fs.writeFileSync(target, after);
    console.log(`[stamp-helper-revision] ${plugin}: recorded ${digest}`);
  } else {
    console.log(`[stamp-helper-revision] ${plugin}: already ${digest}`);
  }
}
