import fs from "node:fs";
import path from "node:path";
import { auditProject } from "./scanner.js";
import type { AuditOptions, AuditReport } from "./types.js";

export const UI_CONFORMANCE_RULES = new Set([
  "no-bare-react-native-ui",
  "no-bespoke-react-native-interactions",
  "no-bespoke-style-system",
  "no-hardcoded-modal-dimensions",
  "no-helper-width-cap",
  "no-host-scroll-hijack",
]);

export function findPluginDirectories(pluginsDir: string): string[] {
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => path.join(pluginsDir, entry.name))
    .sort();
}

export function auditPluginConformance(
  targetDir: string,
  options: AuditOptions = {},
): AuditReport {
  const report = auditProject(targetDir, options);
  const uiIssues = report.issues.filter((issue) => UI_CONFORMANCE_RULES.has(issue.ruleId));

  return {
    ...report,
    issues: uiIssues,
    summary: {
      errorCount: uiIssues.filter((issue) => issue.severity === "error").length,
      warnCount: uiIssues.filter((issue) => issue.severity === "warn").length,
      infoCount: uiIssues.filter((issue) => issue.severity === "info").length,
      suggestionCount: uiIssues.filter((issue) => issue.severity === "suggestion").length,
    },
    passed: uiIssues.length === 0,
  };
}

export function auditAllPlugins(
  pluginsDir: string,
  options: AuditOptions = {},
): AuditReport[] {
  return findPluginDirectories(pluginsDir).map((pluginDir) =>
    auditPluginConformance(pluginDir, options),
  );
}
