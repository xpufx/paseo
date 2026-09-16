#!/usr/bin/env node
// paseo-cafe-submit: script the per-plugin paseo.cafe registry submission.
//
// Hand-written registry JSON failed their Biome format gate (multi-line
// arrays + missing trailing newline; Biome collapses short arrays onto one
// line). This emits Biome-clean registry/<id>.json content:
// {"repo","path","categories","submittedBy"} with single-line arrays and a
// trailing newline, and validates it against the registry schema basics.
//
// Usage:
//   node scripts/paseo-cafe-submit.mjs <plugin-id> --categories=a,b [--write]
//   node scripts/paseo-cafe-submit.mjs --plugin=top --categories=monitoring
//   make cafe-submit PLUGIN=top CATEGORIES=monitoring
//
// Env overrides: PLUGIN, CATEGORIES (comma-separated), REPO, SUBMITTED_BY.
// By default prints the file content + placement; --write also writes
// registry/<id>.json in the operator's checkout (they copy it into their
// paseo.cafe fork — this script never touches the network or opens PRs).

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function usage(exit = 2) {
  console.error(
    "usage: node scripts/paseo-cafe-submit.mjs <plugin-id> --categories=a,b [--write] [--repo=R] [--submitted-by=U]",
  );
  process.exit(exit);
}

const argv = process.argv.slice(2);
const opts = { plugin: process.env.PLUGIN ?? null, categories: process.env.CATEGORIES ?? null, repo: process.env.REPO ?? "xpufx/paseo", submittedBy: process.env.SUBMITTED_BY ?? "xpufx", write: false };
for (const a of argv) {
  if (a === "--write") opts.write = true;
  else if (a.startsWith("--plugin=")) opts.plugin = a.slice(9);
  else if (a.startsWith("--categories=")) opts.categories = a.slice(13);
  else if (a.startsWith("--repo=")) opts.repo = a.slice(7);
  else if (a.startsWith("--submitted-by=")) opts.submittedBy = a.slice(15);
  else if (a === "-h" || a === "--help") usage(0);
  else if (a.startsWith("-")) usage();
  else if (!opts.plugin) opts.plugin = a;
  else usage();
}
if (!opts.plugin) usage();
if (!opts.categories) {
  console.error("error: categories required (--categories=a,b or CATEGORIES=a,b)");
  usage();
}

const id = opts.plugin;
const pluginDir = path.join(ROOT, "plugins", id);
const errors = [];
if (!fs.existsSync(pluginDir)) errors.push(`plugin path missing: plugins/${id}`);

let manifestId = null;
try {
  manifestId = JSON.parse(fs.readFileSync(path.join(pluginDir, "paseo-plugin.json"), "utf8")).id;
} catch {
  errors.push(`unreadable manifest: plugins/${id}/paseo-plugin.json`);
}
let version = null;
try {
  version = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8")).version;
} catch {
  errors.push(`unreadable package.json: plugins/${id}/package.json`);
}
if (manifestId !== null && manifestId !== id) errors.push(`manifest id "${manifestId}" != plugin "${id}"`);
if (version === "0.0.0" || version == null) errors.push(`version "${version}" is not submittable (must be real semver, not 0.0.0)`);
if (!/^\d+\.\d+\.\d+/.test(version ?? "")) errors.push(`version "${version}" is not semver`);

const categories = opts.categories.split(",").map((s) => s.trim()).filter(Boolean);
if (categories.length === 0) errors.push("no categories parsed from --categories/CATEGORIES");
if (errors.length > 0) {
  for (const e of errors) console.error(`error: ${e}`);
  process.exit(1);
}

const relPath = `plugins/${id}`;
// JSON.stringify with 2-space indent keeps short arrays on one line, which is
// exactly the Biome-collapsed shape the gate expects. One trailing newline.
// JSON.stringify with indent puts arrays multi-line; the paseo.cafe Biome
// gate wants short arrays collapsed, so fold ["a",\n "b"] onto one line.
function collapseArrays(pretty) {
  return pretty.replace(/\[\s*("(?:[^"\\]|\\.)*"\s*,?\s*)+\]/g, (m) => {
    const items = [...m.matchAll(/"(?:[^"\\]|\\.)*"/g)].map((x) => x[0]);
    return `[${items.join(", ")}]`;
  });
}
const content = `${collapseArrays(JSON.stringify({ repo: opts.repo, path: relPath, categories, submittedBy: opts.submittedBy }, null, 2))}\n`;

const dest = path.join("registry", `${id}.json`);
if (opts.write) fs.mkdirSync(path.join(ROOT, "registry"), { recursive: true });
if (opts.write) fs.writeFileSync(path.join(ROOT, dest), content);
process.stdout.write(content);
console.error(`\nvalidated: id=${manifestId} version=${version} path=${relPath} categories=[${categories.join(", ")}]`);
console.error(opts.write ? `wrote ${dest}` : `place as ${dest} in your paseo.cafe fork (re-run with --write to write it here)`);
