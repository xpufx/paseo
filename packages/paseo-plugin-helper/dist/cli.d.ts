#!/usr/bin/env node
type AuditSeverity = "error" | "warn" | "info" | "suggestion";
interface AuditIssue {
    ruleId: string;
    severity: AuditSeverity;
    file: string;
    line: number;
    column: number;
    message: string;
    codeSnippet?: string;
    replacement: string;
    docUrl?: string;
}
interface AuditReport {
    targetDir: string;
    scannedFiles: number;
    issues: AuditIssue[];
    summary: {
        errorCount: number;
        warnCount: number;
        infoCount: number;
        suggestionCount: number;
    };
    passed: boolean;
}
interface AuditOptions {
    cwd?: string;
    strict?: boolean;
    format?: "pretty" | "json";
    ignore?: string[];
    rules?: string[];
}
interface AuditRule {
    id: string;
    severity: AuditSeverity;
    description: string;
    replacement: string;
    docUrl?: string;
}

declare const AUDIT_RULES: Record<string, AuditRule>;

declare function auditProject(targetDir: string, options?: AuditOptions): AuditReport;
/**
 * Alias for auditProject.
 */
declare const doctorProject: typeof auditProject;

declare function formatReportPretty(report: AuditReport): string;
declare function formatReportJson(report: AuditReport): string;

interface AdoptResult {
    directory: string;
    sdkMajor: 7 | 8;
    addedDependency: boolean;
    addedInit: boolean;
    alreadyAdopted: boolean;
}
interface AdoptOptions {
    helperVersion?: string;
}
/**
 * Layers paseo-plugin-helper onto a plugin directory created by
 * `paseo plugin init`: adds the dependency and injects the required
 * `initClientHelpers()` call into the client entry using import specifiers
 * that match the installed SDK generation. Safe to run twice.
 */
declare function adoptProject(targetDir: string, options?: AdoptOptions): AdoptResult;
declare function formatAdoptResult(result: AdoptResult): string;

declare function runCli(argv?: string[]): number;

export { AUDIT_RULES, type AdoptOptions, type AdoptResult, type AuditIssue, type AuditOptions, type AuditReport, type AuditRule, type AuditSeverity, adoptProject, auditProject, doctorProject, formatAdoptResult, formatReportJson, formatReportPretty, runCli };
