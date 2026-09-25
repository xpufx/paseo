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
    /**
     * Rules the target's `paseo-plugin.json` declared as deliberately not
     * applicable, with the reason it gave. Reported rather than silently dropped
     * so an exemption is always visible in the audit output.
     */
    exemptions: AuditExemption[];
    /** Exemptions naming a rule that does not exist. Always an audit finding. */
    unknownExemptions: string[];
    summary: {
        errorCount: number;
        warnCount: number;
        infoCount: number;
        suggestionCount: number;
    };
    passed: boolean;
}
/**
 * A plugin's declared opt-out from a specific rule, read from
 * `paseo-plugin.json`:
 *
 * ```json
 * { "conformance": { "exempt": { "no-bare-react-native-ui": "why" } } }
 * ```
 *
 * The exemption is per rule, never per plugin, and requires a reason, so a
 * plugin cannot switch the whole audit off.
 */
interface AuditExemption {
    ruleId: string;
    reason: string;
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

declare const UI_CONFORMANCE_RULES: Set<string>;
declare function findPluginDirectories(pluginsDir: string): string[];
declare function auditPluginConformance(targetDir: string, options?: AuditOptions): AuditReport;
declare function auditAllPlugins(pluginsDir: string, options?: AuditOptions): AuditReport[];

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

export { AUDIT_RULES, type AdoptOptions, type AdoptResult, type AuditExemption, type AuditIssue, type AuditOptions, type AuditReport, type AuditRule, type AuditSeverity, UI_CONFORMANCE_RULES, adoptProject, auditAllPlugins, auditPluginConformance, auditProject, doctorProject, findPluginDirectories, formatAdoptResult, formatReportJson, formatReportPretty, runCli };
