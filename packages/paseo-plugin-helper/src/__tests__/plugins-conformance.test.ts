import { describe, it, expect } from "vitest";
import {
  auditAllPlugins,
  auditPluginConformance,
  findPluginDirectories,
} from "../cli/conformance.js";
import type { AuditIssue } from "../cli/types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const pluginsDir = path.join(repoRoot, "plugins");

/**
 * Documented, plugin-specific conformance allowlist (#578).
 *
 * The conformance rules themselves are NOT relaxed. Every entry names the
 * exact file and rule it excuses plus the helper-gap rationale, and the suite
 * fails when a finding escapes this list or an entry outlives its finding.
 * Migrations are tracked in xpufx-org/paseo#580.
 */
interface AllowlistEntry {
  file: string;
  ruleId: string;
  rationale: string;
}

const CONFORMANCE_ALLOWLIST: Record<string, AllowlistEntry[]> = {
  "uppidi-fleet": [
    {
      file: "client/surface.tsx",
      ruleId: "no-bespoke-react-native-interactions",
      rationale:
        "Dense issue metric rows need RN-web hover/press semantics that helper Button (a labeled button) does not own; #534/#560. Migration tracked in xpufx-org/paseo#580.",
    },
    {
      file: "client/tree-view.tsx",
      ruleId: "no-bespoke-react-native-interactions",
      rationale:
        "Interactive agent status lights / parent pills need hover+tooltip and press-event propagation; #537. Migration tracked in xpufx-org/paseo#580.",
    },
  ],
  wellbeing: [
    {
      file: "client/surface.tsx",
      ruleId: "no-bespoke-react-native-interactions",
      rationale:
        "Local action controls pending migration to helper Button; migration tracked in xpufx-org/paseo#580.",
    },
    {
      file: "client/surface.tsx",
      ruleId: "no-bespoke-style-system",
      rationale:
        "Small local composition styles pending migration to helper layout primitives; migration tracked in xpufx-org/paseo#580.",
    },
  ],
};

function allowlisted(pluginName: string, issue: AuditIssue): boolean {
  return (CONFORMANCE_ALLOWLIST[pluginName] ?? []).some(
    (entry) => entry.file === issue.file && entry.ruleId === issue.ruleId,
  );
}

describe("Monorepo plugin UI conformance", () => {
  for (const pluginDir of findPluginDirectories(pluginsDir)) {
    const pluginName = path.basename(pluginDir);

    it(`${pluginName} has no undocumented UI conformance findings`, () => {
      const issues = auditPluginConformance(pluginDir).issues;
      const undocumented = issues.filter((issue) => !allowlisted(pluginName, issue));
      expect(undocumented).toEqual([]);

      for (const entry of CONFORMANCE_ALLOWLIST[pluginName] ?? []) {
        expect(
          issues.some((issue) => issue.file === entry.file && issue.ruleId === entry.ruleId),
          `${entry.file} (${entry.ruleId}) is allowlisted but no longer reported`,
        ).toBe(true);
      }
    });
  }

  it("audits every plugin against the documented conformance allowlist", () => {
    const reports = auditAllPlugins(pluginsDir);
    expect(reports).toHaveLength(findPluginDirectories(pluginsDir).length);

    for (const report of reports) {
      const pluginName = path.basename(report.targetDir);
      expect(report.issues.filter((issue) => !allowlisted(pluginName, issue))).toEqual([]);
    }

    const allowedPlugins = Object.keys(CONFORMANCE_ALLOWLIST).sort();
    const flaggedPlugins = reports
      .filter((report) => report.issues.length > 0)
      .map((report) => path.basename(report.targetDir))
      .sort();
    expect(flaggedPlugins).toEqual(allowedPlugins);
  });
});
