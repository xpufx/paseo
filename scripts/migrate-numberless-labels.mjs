#!/usr/bin/env node
/**
 * migrate-numberless-labels — move open issues/PRs off the legacy numeric label
 * taxonomy (platform#247, paseo#1007).
 *
 * Idempotent and dry-run by default: it only proposes edits where a numeric
 * label is present. Every write goes through `teax issue edit --add-label /
 * --remove-label` (never the raw Forgejo client), so scoped eviction and the
 * label-normalisation rules are preserved.
 *
 * Usage:
 *   node scripts/migrate-numberless-labels.mjs [--repo owner/name] [--host host] [--apply] [--json]
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

const DEFAULT_REPO = "xpufx-org/paseo";
const DEFAULT_HOST = "forge.mrs.uppidi.com";

/** Legacy numeric label -> canonical numberless label. */
export const LABEL_MIGRATIONS = {
  "state/0-triage": "state/triage",
  "state/1-wip": "state/wip",
  "state/2-review": "state/review",
  "state/3-verify": "state/verify",
  "state/4-done": "state/done",
  "attention/0-orchestrator": "attention/orchestrator",
  "attention/1-agent": "attention/agent",
  "attention/2-user": "attention/user",
  "attention/3-ignore": "attention/ignore",
  "priority/0-SOS": "priority/sos",
  "priority/1-high": "priority/high",
  "priority/2-normal": "priority/normal",
  "priority/3-low": "priority/low",
  "priority/4-backburner": "priority/backburner",
  "spec/0-needed": "spec/needed",
  "spec/1-checklist": "spec/checklist",
  "spec/2-approved": "spec/approved",
  "format/0-needed": "format/needed",
  "format/1-ok": "format/ok",
  "review/0-needed": "review/needed",
  "review/1-changes-requested": "review/changes-requested",
  "review/2-approved": "review/approved",
  "size/0-cheap": "size/cheap",
  "size/1-medium": "size/medium",
  "size/2-expensive": "size/expensive",
  "size/3-chunk": "size/chunk",
  "linked/0-needs-split": "linked/needs-split",
  "linked/1-peer": "linked/peer",
  "linked/2-done": "linked/done",
  "upstream/0-explore": "upstream/explore",
  "upstream/1-blocked": "upstream/blocked",
  "upstream/2-aligned": "upstream/aligned",
};

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_REPO, host: DEFAULT_HOST, apply: false, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--repo") opts.repo = argv[++i];
    else if (a === "--host") opts.host = argv[++i];
    else if (a === "--apply") opts.apply = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

/** Parse the space-separated `labels` field from `teax ... --json`. */
export function parseLabels(value) {
  if (typeof value !== "string") return [];
  return value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Pure migration plan for one subject. Returns null when nothing to do, else
 * the numberless labels to add and numeric labels to remove (both sorted).
 */
export function planMigration(labels) {
  const present = new Set(labels);
  const add = [];
  const remove = [];
  for (const [legacy, canonical] of Object.entries(LABEL_MIGRATIONS)) {
    if (present.has(legacy)) {
      remove.push(legacy);
      if (!present.has(canonical)) add.push(canonical);
    }
  }
  if (remove.length === 0) return null;
  return { add: add.sort(), remove: remove.sort() };
}

function teaxJson(args, { host }) {
  const out = execFileSync("teax", [...args, "--hostname", host], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [];
}

function teaxRun(args, { host }) {
  execFileSync("teax", [...args, "--hostname", host], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Open issues and pull requests, de-duplicated by number. */
export function fetchOpenSubjects({ repo, host }) {
  const issues = teaxJson(["issue", "list", "-R", repo, "--state", "open", "-o", "json"], { host });
  const pulls = teaxJson(["pr", "list", "-R", repo, "--state", "open", "-o", "json"], { host });
  const seen = new Set();
  const subjects = [];
  for (const raw of [...issues, ...pulls]) {
    const number = Number(raw.index);
    if (!Number.isInteger(number) || seen.has(number)) continue;
    seen.add(number);
    subjects.push({ number, title: raw.title ?? "", labels: parseLabels(raw.labels) });
  }
  return subjects.sort((a, b) => a.number - b.number);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "usage: node scripts/migrate-numberless-labels.mjs [--repo owner/name] [--host host] [--apply] [--json]",
    );
    return 0;
  }

  const subjects = fetchOpenSubjects(opts);
  const changes = [];
  for (const subject of subjects) {
    const plan = planMigration(subject.labels);
    if (plan) changes.push({ ...subject, ...plan });
  }

  if (opts.json) {
    console.log(JSON.stringify({ repo: opts.repo, host: opts.host, apply: opts.apply, changes }, null, 2));
  } else {
    console.log(`numberless label migration — ${opts.repo} @ ${opts.host} (${opts.apply ? "apply" : "dry-run"})`);
    for (const change of changes) {
      console.log(
        `  #${change.number}  add ${change.add.join(",") || "-"}  remove ${change.remove.join(",")}`,
      );
    }
    console.log(`${changes.length} subject(s) with legacy numeric labels`);
  }

  if (!opts.apply) {
    console.log("dry-run only; pass --apply to write via teax");
    return 0;
  }

  for (const change of changes) {
    const args = ["issue", "edit", String(change.number), "-R", opts.repo];
    if (change.add.length > 0) args.push("--add-label", change.add.join(","));
    if (change.remove.length > 0) args.push("--remove-label", change.remove.join(","));
    teaxRun(args, opts);
    console.log(`  applied #${change.number}`);
  }
  return 0;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("migrate-numberless-labels.mjs");
if (invokedDirectly) process.exit(main());
