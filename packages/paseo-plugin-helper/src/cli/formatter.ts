import type { AuditReport } from "./types.js";
import { formatExemption } from "./conformance-exemptions.js";

export function formatReportPretty(report: AuditReport): string {
  const lines: string[] = [];

  lines.push(`Auditing Paseo plugin at ${report.targetDir}...`);
  lines.push("");

  // Exemptions are printed before the verdict so a clean audit that was
  // reached by opting out of a rule is never silently indistinguishable from
  // one that had nothing to exempt.
  for (const exemption of report.exemptions) {
    lines.push(formatExemption(exemption));
  }
  if (report.exemptions.length > 0) lines.push("");

  if (report.issues.length === 0) {
    lines.push(
      report.exemptions.length > 0
        ? `[PASS] Clean audit with ${report.exemptions.length} declared exemption(s). All ${report.scannedFiles} files follow paseo-plugin-helper patterns.`
        : `[PASS] Clean audit. All ${report.scannedFiles} files follow paseo-plugin-helper patterns.`,
    );
    return lines.join("\n");
  }

  for (const issue of report.issues) {
    const prefix = issue.severity.toUpperCase().padEnd(10);
    lines.push(`[${prefix}] ${issue.file}:${issue.line}:${issue.column} (${issue.ruleId})`);
    lines.push(`           ${issue.message}`);
    if (issue.codeSnippet) {
      lines.push(`           Code: ${issue.codeSnippet}`);
    }
    lines.push(`           Replacement: ${issue.replacement}`);
    if (issue.docUrl) {
      lines.push(`           Docs: ${issue.docUrl}`);
    }
    lines.push("");
  }

  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `Audit Summary: ${report.issues.length} opportunities found across ${report.scannedFiles} scanned files ` +
      `(${report.summary.errorCount} errors, ${report.summary.warnCount} warnings, ${report.summary.suggestionCount} suggestions).`,
  );

  if (!report.passed) {
    lines.push("Result: FAILED (strict mode enabled or errors found)");
  } else {
    lines.push("Result: PASSED with suggestions/warnings");
  }

  return lines.join("\n");
}

export function formatReportJson(report: AuditReport): string {
  return JSON.stringify(report, null, 2);
}
