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
export interface AuditExemption {
  ruleId: string;
  reason: string;
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
