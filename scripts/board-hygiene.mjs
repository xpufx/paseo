#!/usr/bin/env node
/**
 * board-hygiene — flag routing gaps on the Forgejo board (xpufx-org/paseo#217).
 *
 * Read-only. Reports issues whose labels contradict their actual state. Two
 * classes, both found by hand before this existed:
 *
 *   OPEN, unrouted   — an open issue with no `attention/*` label is invisible to
 *                      BOTH routing lanes: it is in no agent queue and no operator
 *                      queue. It simply sits. (Seen on #233, #235.) A missing
 *                      `state/*` label likewise hides it from lifecycle filtering.
 *   CLOSED, stale    — a closed issue still carrying an action signal
 *                      (`attention/1-agent`, `attention/0-orchestrator`,
 *                      `attention/2-user`, non-terminal `state/*`, `dep/*`,
 *                      `priority/0-SOS`, `flag/stop-work`, `format/0-needed`)
 *                      advertises work that is already finished. (The 133-item
 *                      cleanup that produced #217.)
 *
 * Exit code is 1 when findings exist, so it can gate CI or a pre-release check;
 * pass --quiet to report only the count.
 *
 * Usage:
 *   node scripts/board-hygiene.mjs [--repo owner/name] [--host host] [--quiet] [--json]
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

const DEFAULT_REPO = "xpufx-org/paseo";
const DEFAULT_HOST = "forge.mrs.uppidi.com";
const PAGE_LIMIT = 100;
const MAX_PAGES = 20;

/** Labels that must not survive an issue's closure. Both numeric (legacy) and
 * numberless (canonical, platform#247) spellings are checked during migration. */
export const CLOSED_ACTION_SIGNALS = [
  "attention/1-agent",
  "attention/agent",
  "attention/0-orchestrator",
  "attention/orchestrator",
  "attention/2-user",
  "attention/user",
  "dep/blocked",
  "dep/blocker",
  "priority/0-SOS",
  "priority/sos",
  "flag/stop-work",
  "format/0-needed",
  "format/needed",
  "review/0-needed",
  "review/needed",
  "review/1-changes-requested",
  "review/changes-requested",
  "spec/0-needed",
  "spec/needed",
  "linked/0-needs-split",
  "linked/needs-split",
];

/** States that describe unfinished work; wrong on a closed issue. */
const NON_TERMINAL_STATES = [
  "state/0-triage",
  "state/triage",
  "state/1-wip",
  "state/wip",
  "state/2-review",
  "state/review",
  "state/3-verify",
  "state/verify",
];

export function parseArgs(argv) {
  const opts = { repo: DEFAULT_REPO, host: DEFAULT_HOST, quiet: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--repo") opts.repo = argv[++i];
    else if (a === "--host") opts.host = argv[++i];
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--help" || a === "-h") opts.help = true;
  }
  return opts;
}

/**
 * Fetch every issue for one state, excluding pull requests.
 *
 * `--paginate --slurp` returns an array of per-page arrays, so this flattens
 * fully (a single `.flat()` left inner arrays intact and silently yielded zero
 * issues — the guard reported "clean" for a board that was not). Pull requests
 * appear in the issues endpoint with a `pull_request` object and must be
 * dropped; real issues carry `null` there, so this tests for truthiness rather
 * than key absence.
 */
function api(path, { host }) {
  const out = execFileSync(
    "teax",
    ["api", path, "--hostname", host],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(out);
  const flat = Array.isArray(parsed) ? parsed.flat(Infinity) : [parsed];
  return flat.filter((item) => item && !item.pull_request);
}

export function fetchIssues({ repo, host }, state) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = api(
      `repos/${repo}/issues?state=${state}&limit=${PAGE_LIMIT}&page=${page}`,
      { repo, host },
    );
    all.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
  }
  return all;
}

const labelNames = (issue) => (issue.labels ?? []).map((l) => l.name);

/** Open issue with no attention route (and/or no lifecycle state). */
export function openRoutingGaps(issues) {
  const findings = [];
  for (const issue of issues) {
    const labels = labelNames(issue);
    const missing = [];
    if (!labels.some((l) => l.startsWith("attention/"))) missing.push("attention/*");
    if (!labels.some((l) => l.startsWith("state/"))) missing.push("state/*");
    if (missing.length > 0) {
      findings.push({ number: issue.number, title: issue.title, missing });
    }
  }
  return findings;
}

/** Closed issue still carrying an action signal or a non-terminal state. */
export function closedStaleLabels(issues) {
  const findings = [];
  for (const issue of issues) {
    const labels = labelNames(issue);
    const stale = labels.filter(
      (l) => CLOSED_ACTION_SIGNALS.includes(l) || NON_TERMINAL_STATES.includes(l),
    );
    if (stale.length > 0) {
      findings.push({ number: issue.number, title: issue.title, stale });
    }
  }
  return findings;
}

/** Orchestrator-ownership spellings, numeric (legacy) and numberless (#1007). */
const ORCHESTRATOR_LABELS = ["attention/0-orchestrator", "attention/orchestrator"];

/** Default idle window before an `0-orchestrator` issue counts as stuck. */
export const ORCHESTRATOR_IDLE_MS = 2 * 60 * 60 * 1000;

/**
 * Open issue parked on `attention/0-orchestrator` (or numberless
 * `attention/orchestrator`) with no recent activity.
 *
 * `0-orchestrator` means "you own it, don't let it sit" — it is a working state,
 * not a resting one. An issue left there past the idle window is invisible: it
 * is not in an agent queue (`attention/1-agent`) and not in the operator queue
 * (`attention/2-user`), so nothing picks it up.
 *
 * The window matters: freshly-set `0-orchestrator` is legitimate (the
 * orchestrator just took ownership). Only stale ones are findings.
 *
 * @param now injectable for tests
 */
export function orchestratorParked(issues, now = Date.now(), idleMs = ORCHESTRATOR_IDLE_MS) {
  const findings = [];
  for (const issue of issues) {
    const labels = labelNames(issue);
    if (!labels.some((label) => ORCHESTRATOR_LABELS.includes(label))) continue;
    const updated = Date.parse(issue.updated_at ?? "");
    if (Number.isNaN(updated)) continue;
    const idleMinutes = Math.floor((now - updated) / 60000);
    if (now - updated > idleMs) {
      findings.push({
        number: issue.number,
        title: issue.title,
        idleMinutes,
      });
    }
  }
  return findings;
}

function render(title, findings, describe) {
  if (findings.length === 0) {
    console.log(`  OK   ${title}`);
    return;
  }
  console.log(`  ${String(findings.length).padStart(3)}  ${title}`);
  for (const f of findings) {
    console.log(`       #${f.number} ${describe(f)} :: ${f.title.slice(0, 56)}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "usage: node scripts/board-hygiene.mjs [--repo owner/name] [--host host] [--quiet] [--json]",
    );
    return 0;
  }

  const open = openRoutingGaps(fetchIssues(opts, "open"));
  const closed = closedStaleLabels(fetchIssues(opts, "closed"));
  const parked = orchestratorParked(fetchIssues(opts, "open"));

  if (opts.json) {
    console.log(
      JSON.stringify({ openRoutingGaps: open, closedStaleLabels: closed, orchestratorParked: parked }, null, 2),
    );
    return open.length + closed.length + parked.length > 0 ? 1 : 0;
  }

  if (opts.quiet) {
    console.log(
      `board-hygiene: ${open.length} unrouted open, ${closed.length} stale closed, ${parked.length} parked on 0-orchestrator`,
    );
    return open.length + closed.length + parked.length > 0 ? 1 : 0;
  }

  console.log(`board-hygiene — ${opts.repo} @ ${opts.host}\n`);
  render("open issues missing attention/* and/or state/*", open, (f) => `missing ${f.missing.join(", ")}`);
  render("closed issues still carrying action signals", closed, (f) => f.stale.join(", "));
  render(
    "open issues parked on attention/orchestrator past the idle window",
    parked,
    (f) => `idle ${f.idleMinutes}m`,
  );
  const total = open.length + closed.length + parked.length;
  console.log(
    total === 0 ? "\nBoard is clean." : `\n${total} finding(s) — see above.`,
  );
  return total > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("board-hygiene.mjs");
if (invokedDirectly) process.exit(main());
