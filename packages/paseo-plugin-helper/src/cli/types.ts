export type AuditSeverity = "error" | "warn" | "info" | "suggestion";

export interface AuditIssue {
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

export interface AuditReport {
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

export interface AuditOptions {
  cwd?: string;
  strict?: boolean;
  format?: "pretty" | "json";
  ignore?: string[];
  rules?: string[];
}

export interface AuditRule {
  id: string;
  severity: AuditSeverity;
  description: string;
  replacement: string;
  docUrl?: string;
}
