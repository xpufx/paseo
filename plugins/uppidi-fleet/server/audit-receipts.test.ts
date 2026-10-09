import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAuditReceipt,
  appendAuditReconciliation,
  readAuditReceipts,
  readAuditReconciliations,
  findAuditReceipt,
  auditCheck,
  projectAuditSummary,
  handleUppidiAuditRecord,
  handleUppidiAuditCheck,
  handleUppidiAuditSummary,
  setAuditsFilePathForTest,
  setAuditReconciliationsFilePathForTest,
} from "./audit-receipts.js";
import type { UppidiAuditRecordInput } from "../shared/contracts.js";

function baseInput(overrides: Partial<UppidiAuditRecordInput> = {}): UppidiAuditRecordInput {
  return {
    repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
    pr: 1172,
    headCommit: "aaaa1111",
    iteration: 1,
    taxonomy: [],
    actors: {
      auditor: { agentId: "aud-1", role: "orchestrator", model: "gemini-3.8-pro" },
      author: { agentId: "wrk-1", role: "worker", model: "gemini-3.8-flash" },
    },
    verdict: "approved",
    verification: {
      workerClaimed: "passed",
      auditorVerified: "passed",
      checksRun: ["typecheck"],
      isolatedEnv: true,
    },
    summary: "clean",
    ...overrides,
  };
}

describe("audit receipt storage & projection (#1172)", () => {
  let tempDir: string;
  let auditsPath: string;
  let reconciliationsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "paseo-audits-"));
    auditsPath = join(tempDir, "audits.jsonl");
    reconciliationsPath = join(tempDir, "audit-reconciliations.jsonl");
    setAuditsFilePathForTest(auditsPath);
    setAuditReconciliationsFilePathForTest(reconciliationsPath);
  });

  afterEach(() => {
    setAuditsFilePathForTest(null);
    setAuditReconciliationsFilePathForTest(null);
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("appends an immutable receipt and re-reads it", () => {
    const result = appendAuditReceipt(baseInput(), {
      idFactory: () => "uuid-1",
      now: () => new Date("2026-10-09T00:00:00.000Z"),
    });
    assert.equal(result.ok, true);
    assert.equal(result.receipt.auditId, "aud_uuid-1");
    assert.equal(result.receipt.v, 1);
    assert.equal(result.receipt.timestamp, "2026-10-09T00:00:00.000Z");
    assert.ok(existsSync(auditsPath));

    const [line] = readFileSync(auditsPath, "utf8").trim().split("\n");
    const raw = JSON.parse(line);
    assert.equal(raw.auditId, "aud_uuid-1");
    assert.equal(raw.pr, 1172);

    const receipts = readAuditReceipts();
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].headCommit, "aaaa1111");
  });

  it("append is append-only: repeated appends accumulate lines", () => {
    appendAuditReceipt(baseInput({ pr: 1, headCommit: "c1" }), { idFactory: () => "u1" });
    appendAuditReceipt(baseInput({ pr: 2, headCommit: "c2" }), { idFactory: () => "u2" });
    const receipts = readAuditReceipts();
    assert.equal(receipts.length, 2);
    assert.deepEqual(
      receipts.map((r) => r.pr),
      [1, 2],
    );
  });

  it("findAuditReceipt matches repo/pr/headCommit and ignores other PRs", () => {
    appendAuditReceipt(baseInput({ pr: 10, headCommit: "aaa1" }), { idFactory: () => "u1" });
    appendAuditReceipt(baseInput({ pr: 11, headCommit: "bbb2" }), { idFactory: () => "u2" });

    assert.equal(
      findAuditReceipt({ repo: "xpufx-org/paseo", pr: 10, commit: "aaa1" })?.pr,
      10,
    );
    // Short repo form resolves to the same canonical repository.
    assert.equal(
      findAuditReceipt({ repo: "forge.mrs.uppidi.com/xpufx-org/paseo", pr: 10, commit: "aaa1" })?.auditId,
      "aud_u1",
    );
    assert.equal(findAuditReceipt({ repo: "xpufx-org/paseo", pr: 11, commit: "aaa1" }), undefined);
    assert.equal(findAuditReceipt({ repo: "xpufx-org/paseo", pr: 10, commit: "nope" }), undefined);
  });

  it("auditCheck returns the audited receipt projection or a null audit", () => {
    appendAuditReceipt(baseInput({ pr: 5, headCommit: "cccc" }), { idFactory: () => "u9" });
    const hit = auditCheck({ repo: "xpufx-org/paseo", pr: 5, commit: "cccc" });
    assert.equal(hit.audited, true);
    assert.ok(hit.audit);
    assert.equal(hit.audit.auditId, "aud_u9");
    assert.equal(hit.audit.verdict, "approved");

    const miss = auditCheck({ repo: "xpufx-org/paseo", pr: 6, commit: "dddd" });
    assert.equal(miss.audited, false);
    assert.equal(miss.audit, null);
  });

  it("projectAuditSummary computes first-pass, taxonomy and model scorecard", () => {
    appendAuditReceipt(
      baseInput({
        pr: 1,
        headCommit: "c1",
        iteration: 1,
        verdict: "approved",
        taxonomy: [],
        actors: {
          auditor: { agentId: "a", role: "orchestrator", model: "Auditor-X" },
          author: { agentId: "w1", role: "worker", model: "Worker-A" },
        },
      }),
      { idFactory: () => "u1", now: () => new Date("2026-10-08T00:00:00.000Z") },
    );
    appendAuditReceipt(
      baseInput({
        pr: 2,
        headCommit: "c2",
        iteration: 2,
        verdict: "approved",
        taxonomy: ["test_failure", "spec_mismatch"],
        actors: {
          auditor: { agentId: "a", role: "orchestrator", model: "Auditor-X" },
          author: { agentId: "w1", role: "worker", model: "Worker-A" },
        },
      }),
      { idFactory: () => "u2", now: () => new Date("2026-10-08T01:00:00.000Z") },
    );
    appendAuditReceipt(
      baseInput({
        repo: "forge.mrs.uppidi.com/xpufx-org/other",
        pr: 1,
        headCommit: "c3",
        iteration: 1,
        verdict: "changes_requested",
        taxonomy: ["scope_creep"],
        actors: {
          auditor: { agentId: "a", role: "reviewer", model: "Auditor-X" },
          author: { agentId: "w2", role: "worker", model: "Worker-B" },
        },
      }),
      { idFactory: () => "u3", now: () => new Date("2026-10-09T00:00:00.000Z") },
    );

    // Reconcile one audited and one ad-hoc merge, and give the second receipt a
    // direct_or_adhoc merge observation on the same repo for the compliance math.
    appendAuditReconciliation({
      v: 1,
      repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
      pr: 1,
      headCommit: "c1",
      mergedAt: "2026-10-09T00:00:00.000Z",
      status: "audited",
      auditId: "aud_u1",
    });
    appendAuditReconciliation({
      v: 1,
      repo: "forge.mrs.uppidi.com/xpufx-org/paseo",
      pr: 99,
      headCommit: "zzz",
      mergedAt: "2026-10-09T00:00:00.000Z",
      status: "direct_or_adhoc",
    });

    const all = projectAuditSummary({}, { filePath: auditsPath, reconciliationsPath });
    assert.equal(all.ok, true);
    assert.equal(all.totalAudits, 3);
    assert.equal(all.auditedMerges, 1);
    assert.equal(all.unauditedMerges, 1);
    assert.equal(all.complianceRate, 50);
    // One first-pass approval (pr 1) out of three audits.
    const fpExpected = Math.round((1 / 3) * 10000) / 100;
    assert.equal(all.firstPassSuccessRate, fpExpected);
    assert.deepEqual(all.defectTaxonomyCounts, {
      test_failure: 1,
      spec_mismatch: 1,
      scope_creep: 1,
    });
    assert.deepEqual(all.modelScorecard, [
      { model: "Worker-A", reviewsReceived: 2, firstPassApproved: 1, changesRequested: 0 },
      { model: "Worker-B", reviewsReceived: 1, firstPassApproved: 0, changesRequested: 1 },
    ]);

    // Repo filter excludes the other repository's audit and reconciliation.
    const scoped = projectAuditSummary(
      { repo: "xpufx-org/paseo" },
      { filePath: auditsPath, reconciliationsPath },
    );
    assert.equal(scoped.totalAudits, 2);
    assert.equal(scoped.auditedMerges, 1);
    assert.equal(scoped.unauditedMerges, 1);
    assert.equal(scoped.firstPassSuccessRate, 50);
  });

  it("respects the since filter on timestamps", () => {
    appendAuditReceipt(baseInput({ pr: 1, headCommit: "c1", iteration: 1, verdict: "approved" }), {
      idFactory: () => "u1",
      now: () => new Date("2026-10-01T00:00:00.000Z"),
    });
    appendAuditReceipt(baseInput({ pr: 2, headCommit: "c2", iteration: 2, verdict: "approved" }), {
      idFactory: () => "u2",
      now: () => new Date("2026-10-09T00:00:00.000Z"),
    });

    const out = projectAuditSummary(
      { since: "2026-10-05T00:00:00.000Z" },
      { filePath: auditsPath, reconciliationsPath },
    );
    assert.equal(out.totalAudits, 1);
  });

  it("skips torn JSONL lines instead of failing the read", () => {
    appendAuditReceipt(baseInput({ pr: 1, headCommit: "c1" }), { idFactory: () => "u1" });
    appendFileSync(auditsPath, "{ not valid json }\n", "utf8");
    const receipts = readAuditReceipts();
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].pr, 1);
  });

  it("RPC record handler stamps the envelope and returns output", async () => {
    const out = await handleUppidiAuditRecord(baseInput(), {
      storage: tempDir,
    } as any);
    assert.equal(out.ok, true);
    assert.match(out.auditId, /^aud_/);
    assert.ok(out.recordedAt);
    const found = await handleUppidiAuditCheck(
      { repo: "xpufx-org/paseo", pr: 1172, commit: "aaaa1111" },
      { storage: tempDir } as any,
    );
    assert.equal(found.audited, true);
  });

  it("RPC summary handler derives the projection", async () => {
    await handleUppidiAuditRecord(baseInput(), { storage: tempDir } as any);
    const out = await handleUppidiAuditSummary({}, { storage: tempDir } as any);
    assert.equal(out.totalAudits, 1);
    assert.equal(out.modelScorecard.length, 1);
  });
});