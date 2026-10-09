import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { dirname, join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  UppidiFleetAuditReceiptSchema,
  type UppidiAuditRecordInput,
  type UppidiAuditRecordOutput,
  type UppidiAuditCheckOutput,
  type UppidiAuditSummaryInput,
  type UppidiAuditSummaryOutput,
  type UppidiFleetAuditReceipt,
} from "../shared/contracts.js";
import { canonicalRepoKey } from "../shared/repo-identity.js";

/**
 * Append-only audit receipt storage (platform#348 Phase A / #1172).
 *
 * Receipts are immutable JSONL lines appended to
 * `~/.paseo/plugin-data/xpufx/uppidi-fleet/audits.jsonl` (overridable via
 * `UPPIDI_FLEET_AUDITS_FILE`, a PluginStorage context, or an explicit path).
 * Merge observations from the hook router's webhook reconciliation live in a
 * sibling `audit-reconciliations.jsonl`; the server-side projection (CQRS)
 * derives the quality summary from the two append-only logs.
 */

/** Durable audit receipt file under the plugin's scoped plugin-data dir. */
export function defaultAuditsFilePath(context?: any): string {
  const override = process.env.UPPIDI_FLEET_AUDITS_FILE?.trim();
  if (override) return override;

  if (typeof context === "string" && context.trim()) {
    const trimmed = context.trim();
    return trimmed.endsWith(".jsonl") ? trimmed : join(trimmed, "audits.jsonl");
  }

  if (context && typeof context === "object") {
    const storage = context.storage;
    if (typeof storage === "string" && storage.trim()) {
      const s = storage.trim();
      return s.endsWith(".jsonl") ? s : join(s, "audits.jsonl");
    }
    if (storage && typeof storage === "object") {
      if (typeof storage.path === "string" && storage.path.trim()) {
        const p = storage.path.trim();
        return p.endsWith(".jsonl") ? p : join(p, "audits.jsonl");
      }
      if (typeof storage.path === "function") {
        try {
          const res = storage.path("audits.jsonl");
          if (typeof res === "string" && res.trim()) {
            const p = res.trim();
            return p.endsWith(".jsonl") ? p : join(p, "audits.jsonl");
          }
        } catch (err) {
          console.warn(`[uppidi-fleet:audits] storage provider failed:`, err);
        }
      }
      if (typeof storage.filePath === "string" && storage.filePath.trim()) {
        return storage.filePath.trim();
      }
      if (typeof storage.dir === "string" && storage.dir.trim()) {
        return join(storage.dir.trim(), "audits.jsonl");
      }
      if (typeof storage.getFilePath === "function") {
        try {
          const res = storage.getFilePath("audits.jsonl");
          if (typeof res === "string" && res.trim()) return res.trim();
        } catch (err) {
          console.warn(`[uppidi-fleet:audits] storage provider failed:`, err);
        }
      }
    }
  }

  const pluginData = process.env.PASEO_PLUGIN_DATA?.trim();
  if (pluginData) {
    if (pluginData.endsWith("uppidi-fleet") || pluginData.endsWith("uppidi-fleet/")) {
      return join(pluginData, "audits.jsonl");
    }
    if (pluginData.endsWith("xpufx") || pluginData.endsWith("xpufx/")) {
      return join(pluginData, "uppidi-fleet", "audits.jsonl");
    }
    return join(pluginData, "xpufx", "uppidi-fleet", "audits.jsonl");
  }

  const home = process.env.HOME ?? os.homedir();
  return join(home, ".paseo", "plugin-data", "xpufx", "uppidi-fleet", "audits.jsonl");
}

/** Durable merge-reconciliation log, a sibling of the audit receipt file. */
export function defaultAuditReconciliationsFilePath(context?: any): string {
  const override = process.env.UPPIDI_FLEET_AUDIT_RECONCILIATIONS_FILE?.trim();
  if (override) return override;
  return join(dirname(defaultAuditsFilePath(context)), "audit-reconciliations.jsonl");
}

let auditsFilePathOverride: string | null = null;
let auditReconciliationsFilePathOverride: string | null = null;

/** Test hook: pin the audit receipt file, or pass null to restore the default. */
export function setAuditsFilePathForTest(filePath: string | null): void {
  auditsFilePathOverride = filePath;
}

/** Test hook: pin the reconciliation log, or pass null to restore the default. */
export function setAuditReconciliationsFilePathForTest(filePath: string | null): void {
  auditReconciliationsFilePathOverride = filePath;
}

export function getAuditsFilePath(context?: any): string {
  return (
    auditsFilePathOverride ??
    (context && typeof context === "object" && context.auditsFilePath
      ? context.auditsFilePath
      : defaultAuditsFilePath(context))
  );
}

export function getAuditReconciliationsFilePath(context?: any): string {
  return (
    auditReconciliationsFilePathOverride ??
    (context && typeof context === "object" && context.auditReconciliationsFilePath
      ? context.auditReconciliationsFilePath
      : defaultAuditReconciliationsFilePath(context))
  );
}

export interface AuditStoreOptions {
  /** Explicit receipt file path. Takes precedence over `context`. */
  filePath?: string;
  /** Explicit reconciliation log path. Takes precedence over `context`. */
  reconciliationsPath?: string;
  /** RPC/plugin context used to resolve the default paths. */
  context?: any;
}

function resolveStorePaths(options: AuditStoreOptions = {}): {
  filePath: string;
  reconciliationsPath: string;
} {
  return {
    filePath: options.filePath ?? getAuditsFilePath(options.context),
    reconciliationsPath:
      options.reconciliationsPath ?? getAuditReconciliationsFilePath(options.context),
  };
}

function lineRecords(filePath: string): Record<string, unknown>[] {
  if (!existsSync(filePath)) return [];
  const records: Record<string, unknown>[] = [];
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") records.push(parsed);
    } catch {
      // Skip a torn/partial line rather than fail the whole read.
    }
  }
  return records;
}

/** Canonical repo/commit comparators shared by check and projection. */
function repoKeyEquals(a: string, b: string): boolean {
  const canonicalA = canonicalRepoKey(a) ?? a;
  const canonicalB = canonicalRepoKey(b) ?? b;
  return canonicalA === canonicalB;
}

export interface AppendAuditReceiptOptions extends AuditStoreOptions {
  /** Deterministic auditId generator for tests. */
  idFactory?: () => string;
  now?: () => Date;
}

export interface AppendAuditReceiptResult {
  ok: boolean;
  /** Fully materialised receipt (v/auditId/timestamp stamped). */
  receipt: UppidiFleetAuditReceipt;
  filePath: string;
  error?: string;
}

/**
 * Appends one immutable audit receipt as a JSONL line. The caller supplies the
 * record input (everything except v/auditId/timestamp); this module stamps the
 * envelope fields and validates the complete receipt against
 * {@link UppidiFleetAuditReceiptSchema} before persisting.
 */
export function appendAuditReceipt(
  input: UppidiAuditRecordInput,
  options: AppendAuditReceiptOptions = {},
): AppendAuditReceiptResult {
  const now = (options.now ?? (() => new Date()))();
  const receipt = UppidiFleetAuditReceiptSchema.parse({
    ...input,
    v: 1 as const,
    auditId: `aud_${(options.idFactory ?? randomUUID)()}`,
    timestamp: now.toISOString(),
  });
  const { filePath } = resolveStorePaths(options);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    appendFileSync(filePath, `${JSON.stringify(receipt)}\n`, "utf8");
    return { ok: true, receipt, filePath };
  } catch (err: any) {
    return {
      ok: false,
      receipt,
      filePath,
      error: err?.message ?? String(err),
    };
  }
}

/** Reads every audit receipt, in append order. */
export function readAuditReceipts(options: AuditStoreOptions = {}): UppidiFleetAuditReceipt[] {
  const { filePath } = resolveStorePaths(options);
  const receipts: UppidiFleetAuditReceipt[] = [];
  for (const record of lineRecords(filePath)) {
    const parsed = UppidiFleetAuditReceiptSchema.safeParse(record);
    if (parsed.success) receipts.push(parsed.data);
  }
  return receipts;
}

export interface AuditLookupQuery {
  repo: string;
  pr: number;
  commit: string;
}

/** Finds the first receipt matching a repo/pr/headCommit triple, newest first. */
export function findAuditReceipt(
  query: AuditLookupQuery,
  options: AuditStoreOptions = {},
): UppidiFleetAuditReceipt | undefined {
  const { repo, pr, commit } = query;
  const normalizedCommit = commit.trim();
  const receipts = readAuditReceipts(options).filter(
    (r) => r.pr === pr && r.headCommit.trim() === normalizedCommit && repoKeyEquals(r.repo, repo),
  );
  return receipts[receipts.length - 1];
}

export interface AuditMergeReconciliation {
  v: 1;
  repo: string;
  pr: number;
  headCommit: string;
  mergedAt: string;
  /** `audited` when a receipt matched the merged commit; `direct_or_adhoc` otherwise. */
  status: "audited" | "direct_or_adhoc";
  auditId?: string;
  verdict?: string;
}

export const AUDIT_RECONCILIATION_VERSION = 1 as const;

export function appendAuditReconciliation(
  record: AuditMergeReconciliation,
  options: AuditStoreOptions = {},
): { ok: boolean; filePath: string; error?: string } {
  const { reconciliationsPath } = resolveStorePaths(options);
  try {
    mkdirSync(dirname(reconciliationsPath), { recursive: true });
    appendFileSync(reconciliationsPath, `${JSON.stringify(record)}\n`, "utf8");
    return { ok: true, filePath: reconciliationsPath };
  } catch (err: any) {
    return {
      ok: false,
      filePath: reconciliationsPath,
      error: err?.message ?? String(err),
    };
  }
}

export function readAuditReconciliations(
  options: AuditStoreOptions = {},
): AuditMergeReconciliation[] {
  const { reconciliationsPath } = resolveStorePaths(options);
  const records: AuditMergeReconciliation[] = [];
  for (const record of lineRecords(reconciliationsPath)) {
    const repo = record?.repo;
    const pr = record?.pr;
    const headCommit = record?.headCommit;
    const status = record?.status;
    if (
      record &&
      typeof record === "object" &&
      record.v === 1 &&
      typeof repo === "string" &&
      typeof pr === "number" &&
      typeof headCommit === "string" &&
      (status === "audited" || status === "direct_or_adhoc")
    ) {
      records.push(record as unknown as AuditMergeReconciliation);
    }
  }
  return records;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function matchesFilters<T extends { repo: string; pr: number; occurredAt: string }>(
  record: T,
  repo?: string,
  since?: string,
): boolean {
  const repoFilter = repo?.trim();
  const sinceFilter = since?.trim();
  if (repoFilter && !repoKeyEquals(record.repo, repoFilter)) return false;
  if (sinceFilter) {
    const sinceTs = Date.parse(sinceFilter);
    if (!Number.isNaN(sinceTs) && Date.parse(record.occurredAt) < sinceTs) return false;
  }
  return true;
}

/**
 * Server-side CQRS projection (platform#348): collapses the append-only audit
 * receipt log and the observed merge-reconciliation log into the aggregate that
 * `uppidiAuditSummaryContract` describes. No client-side joins or comment
 * scraping: every number here is arithmetic over stored records.
 */
export function projectAuditSummary(
  input: UppidiAuditSummaryInput = {},
  options: AuditStoreOptions = {},
): UppidiAuditSummaryOutput {
  const repo = input.repo;
  const since = input.since;

  const receipts = readAuditReceipts(options)
    .map((r) => ({ ...r, occurredAt: r.timestamp }))
    .filter((r) => matchesFilters(r, repo, since));
  const reconciliations = readAuditReconciliations(options)
    .map((r) => ({ ...r, occurredAt: r.mergedAt }))
    .filter((r) => matchesFilters(r, repo, since));

  const totalAudits = receipts.length;
  const auditedMerges = reconciliations.filter((r) => r.status === "audited").length;
  const unauditedMerges = reconciliations.filter((r) => r.status === "direct_or_adhoc").length;
  const totalMerges = auditedMerges + unauditedMerges;
  const complianceRate = round2(totalMerges > 0 ? (auditedMerges / totalMerges) * 100 : 0);

  const firstPass = receipts.filter(
    (r) => r.iteration === 1 && r.verdict === "approved",
  ).length;
  const firstPassSuccessRate = round2(totalAudits > 0 ? (firstPass / totalAudits) * 100 : 0);

  const defectTaxonomyCounts: Record<string, number> = {};
  for (const receipt of receipts) {
    for (const tag of receipt.taxonomy) {
      defectTaxonomyCounts[tag] = (defectTaxonomyCounts[tag] ?? 0) + 1;
    }
  }

  const byModel = new Map<
    string,
    { model: string; reviewsReceived: number; firstPassApproved: number; changesRequested: number }
  >();
  for (const receipt of receipts) {
    const model = receipt.actors?.author?.model?.trim() || "unknown";
    const entry = byModel.get(model) ?? {
      model,
      reviewsReceived: 0,
      firstPassApproved: 0,
      changesRequested: 0,
    };
    entry.reviewsReceived += 1;
    if (receipt.iteration === 1 && receipt.verdict === "approved") entry.firstPassApproved += 1;
    if (receipt.verdict === "changes_requested") entry.changesRequested += 1;
    byModel.set(model, entry);
  }
  const modelScorecard = [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));

  return {
    ok: true,
    totalAudits,
    auditedMerges,
    unauditedMerges,
    complianceRate,
    firstPassSuccessRate,
    defectTaxonomyCounts,
    modelScorecard,
  };
}

export function auditCheck(
  query: AuditLookupQuery,
  options: AuditStoreOptions = {},
): UppidiAuditCheckOutput {
  const audit = findAuditReceipt(query, options);
  return {
    ok: true,
    audited: Boolean(audit),
    repo: query.repo,
    pr: query.pr,
    commit: query.commit,
    audit: audit
      ? {
          auditId: audit.auditId,
          verdict: audit.verdict,
          timestamp: audit.timestamp,
          iteration: audit.iteration,
        }
      : null,
  };
}

/**
 * RPC handler for `uppidi-fleet.record-audit`: validates the input via
 * {@link UppidiFleetAuditReceiptSchema} and appends to the durable audit store.
 */
export async function handleUppidiAuditRecord(
  input: UppidiAuditRecordInput,
  context?: PluginHandlerContext,
): Promise<UppidiAuditRecordOutput> {
  try {
    const result = appendAuditReceipt(input, { context });
    if (!result.ok) {
      return { ok: false, auditId: result.receipt.auditId, recordedAt: "", error: result.error };
    }
    return { ok: true, auditId: result.receipt.auditId, recordedAt: result.receipt.timestamp };
  } catch (err: any) {
    return {
      ok: false,
      auditId: "",
      recordedAt: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** RPC handler for `uppidi-fleet.audit-summary`: emits the CQRS projection. */
export async function handleUppidiAuditSummary(
  input: UppidiAuditSummaryInput,
  context?: PluginHandlerContext,
): Promise<UppidiAuditSummaryOutput> {
  return projectAuditSummary(input, { context });
}

/** RPC handler for `uppidi-fleet.audit-check`: checks receipt existence. */
export async function handleUppidiAuditCheck(
  input: { repo: string; pr: number; commit: string },
  context?: PluginHandlerContext,
): Promise<UppidiAuditCheckOutput> {
  return auditCheck(input, { context });
}