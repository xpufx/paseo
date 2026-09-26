import fs from "node:fs";
import path from "node:path";
import { AUDIT_RULES } from "./rules.js";
import type { AuditExemption } from "./types.js";

const KNOWN_RULES = new Set(Object.keys(AUDIT_RULES));

export interface ResolvedExemptions {
  exemptions: Map<string, string>;
  unknownExemptions: string[];
}

/**
 * Reads the optional `exempt` block from a plugin's sibling `conformance.json`:
 *
 * ```json
 * {
 *   "exempt": {
 *     "no-bare-react-native-ui": "why this plugin does not apply"
 *   }
 * }
 * ```
 *
 * Deliberately per *rule* rather than per plugin, and a reason is mandatory:
 * the escape hatch exists for a plugin that is intentionally built to a
 * different standard, and it must cost that plugin an explicit, greppable
 * sentence rather than a blanket switch. An entry naming a rule that does not
 * exist is reported so a typo cannot make an audit look clean.
 *
 * This lives in its own file rather than in `paseo-plugin.json` because the
 * host's manifest schema is `z.object({...}).strict()` (paseo
 * `packages/server/src/server/plugins/manifest.ts`) and rejects unknown
 * top-level keys. A `conformance` block in the manifest makes the plugin
 * uninstallable, so the escape hatch could never be exercised. Keep this file
 * out of the manifest.
 *
 * A malformed or missing file yields no exemptions.
 */
export function readPluginConformanceExemptions(pluginDir: string): ResolvedExemptions {
  const exemptions = new Map<string, string>();
  const unknownExemptions: string[] = [];

  try {
    const manifestPath = path.join(pluginDir, "conformance.json");
    if (!fs.existsSync(manifestPath)) return { exemptions, unknownExemptions };

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const declared = manifest?.exempt;
    if (!declared || typeof declared !== "object" || Array.isArray(declared)) {
      return { exemptions, unknownExemptions };
    }

    for (const [ruleId, reason] of Object.entries(declared as Record<string, unknown>)) {
      if (!KNOWN_RULES.has(ruleId)) {
        unknownExemptions.push(ruleId);
        continue;
      }
      if (typeof reason !== "string" || reason.trim().length === 0) {
        // A reason is the whole point; an empty one is treated as no exemption.
        continue;
      }
      exemptions.set(ruleId, reason.trim());
    }
  } catch {
    // Unparseable manifest is the daemon's complaint, not the audit's.
  }

  return { exemptions, unknownExemptions };
}

export function formatExemption(exemption: AuditExemption): string {
  return `[EXEMPT ] ${exemption.ruleId} — ${exemption.reason}`;
}
