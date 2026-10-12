// ---------------------------------------------------------------------------
// Label taxonomy & definitions (issues #122, #189, #200, platform#247)
// ---------------------------------------------------------------------------

export const STATE_ORDER = [
  "state/triage",
  "state/wip",
  "state/review",
  "state/verify",
  "state/done",
] as const;
export type StateLabel = (typeof STATE_ORDER)[number];

export const LEGACY_STATE_ORDER = [
  "state/0-triage",
  "state/1-wip",
  "state/2-review",
  "state/3-verify",
  "state/4-done",
] as const;

export const PRIORITY_ORDER = [
  "priority/sos",
  "priority/high",
  "priority/normal",
  "priority/low",
  "priority/backburner",
] as const;
export type PriorityLabel = (typeof PRIORITY_ORDER)[number];

export const LEGACY_PRIORITY_ORDER = [
  "priority/0-SOS",
  "priority/1-high",
  "priority/2-normal",
  "priority/3-low",
  "priority/4-backburner",
] as const;

export const ATTENTION_LABELS = [
  "attention/orchestrator",
  "attention/agent",
  "attention/user",
  "attention/ignore",
] as const;
export type AttentionLabel = (typeof ATTENTION_LABELS)[number];

export const LEGACY_ATTENTION_LABELS = [
  "attention/0-orchestrator",
  "attention/1-agent",
  "attention/2-user",
  "attention/3-ignore",
] as const;

export const SPEC_LABELS = [
  "spec/needed",
  "spec/checklist",
  "spec/approved",
] as const;
export type SpecLabel = (typeof SPEC_LABELS)[number];

export const LEGACY_SPEC_LABELS = [
  "spec/0-needed",
  "spec/1-checklist",
  "spec/2-approved",
] as const;

function aliasPairs(
  canonical: readonly string[],
  legacy: readonly string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  canonical.forEach((name, i) => {
    const legacyName = legacy[i];
    if (legacyName) map[legacyName] = name;
  });
  return map;
}

/** Legacy numeric label -> canonical numberless label (all scopes). */
export const LABEL_ALIASES: Record<string, string> = {
  ...aliasPairs(STATE_ORDER, LEGACY_STATE_ORDER),
  ...aliasPairs(PRIORITY_ORDER, LEGACY_PRIORITY_ORDER),
  ...aliasPairs(ATTENTION_LABELS, LEGACY_ATTENTION_LABELS),
  ...aliasPairs(SPEC_LABELS, LEGACY_SPEC_LABELS),
  "review/0-needed": "review/needed",
  "review/1-changes-requested": "review/changes-requested",
  "review/2-approved": "review/approved",
  "format/0-needed": "format/needed",
  "format/1-ok": "format/ok",
  "size/0-cheap": "size/cheap",
  "size/1-medium": "size/medium",
  "size/2-expensive": "size/expensive",
  "size/3-chunk": "size/chunk",
  "linked/0-needs-split": "linked/needs-split",
  "linked/1-peer": "linked/peer",
  "linked/2-done": "linked/done",
  "upstream/0-explore": "upstream/explore",
  "upstream/1-blocked": "upstream/blocked",
  "upstream/2-aligned": "upstream/aligned",
};

/** Canonical numberless spelling of a label; unknown labels pass through. */
export function canonicalLabel(label: string): string {
  return LABEL_ALIASES[label] ?? label;
}

/** True when two spellings name the same scoped label under the alias map. */
export function sameLabel(a: string, b: string): boolean {
  return canonicalLabel(a) === canonicalLabel(b);
}

const CANONICAL_SHORT: Record<string, string> = {
  "state/triage": "Triage",
  "state/wip": "WIP",
  "state/review": "Review",
  "state/verify": "Verify",
  "state/done": "Done",
  "priority/sos": "SOS",
  "priority/high": "High",
  "priority/normal": "Normal",
  "priority/low": "Low",
  "priority/backburner": "Parked",
};

/** Compact display alias for a scoped label ("state/1-wip" -> "WIP"). */
export function shortLabelName(label: string): string {
  return CANONICAL_SHORT[canonicalLabel(label)] ?? label;
}

/** The issue's current `state/*` label (canonical), or null when it carries none. */
export function currentStateLabel(labels: string[]): string | null {
  for (const label of labels) {
    const canonical = canonicalLabel(label);
    if ((STATE_ORDER as readonly string[]).includes(canonical)) return canonical;
  }
  return null;
}

/** The issue's current `priority/*` label, defaulting to normal. */
export function currentPriorityLabel(labels: string[]): string {
  for (const label of labels) {
    const canonical = canonicalLabel(label);
    if ((PRIORITY_ORDER as readonly string[]).includes(canonical)) return canonical;
  }
  return "priority/normal";
}

/** Next `state/*` promotion step, or null when already done. */
export function nextStateLabel(labels: string[]): string | null {
  const current = currentStateLabel(labels);
  if (!current) return "state/wip";
  const idx = (STATE_ORDER as readonly string[]).indexOf(current);
  if (idx < 0 || idx + 1 >= STATE_ORDER.length) return null;
  return STATE_ORDER[idx + 1];
}

export function scopeOfLabel(label: string): string | null {
  const slash = label.indexOf("/");
  if (slash <= 0 || slash + 1 >= label.length) return null;
  const scope = label.slice(0, slash);
  if (!/^[A-Za-z0-9_.-]+$/.test(scope)) return null;
  return scope;
}

export function liveScopesFromLabels(allLabels: string[]): string[] {
  const scopes: string[] = [];
  for (const label of allLabels) {
    const scope = scopeOfLabel(label);
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

export function liveScopesFromIssues(issues: { labels: string[] }[]): string[] {
  return liveScopesFromLabels(issues.flatMap((issue) => issue.labels));
}

function rankOf(label: string | null, order: readonly string[]): number {
  if (!label) return order.length;
  const idx = (order as readonly string[]).indexOf(label);
  return idx < 0 ? order.length : idx;
}

export function rankIssues<T extends { labels: string[]; updatedAt?: string }>(issues: T[]): T[] {
  return [...issues].sort((a, b) => {
    const pri =
      rankOf(currentPriorityLabel(a.labels), PRIORITY_ORDER) -
      rankOf(currentPriorityLabel(b.labels), PRIORITY_ORDER);
    if (pri !== 0) return pri;
    const state =
      rankOf(currentStateLabel(a.labels), STATE_ORDER) -
      rankOf(currentStateLabel(b.labels), STATE_ORDER);
    if (state !== 0) return state;
    return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
  });
}

export const PASEO_LABEL_SCOPES = [
  "state",
  "priority",
  "attention",
  "spec",
  "kind",
  "target",
  "format",
  "size",
  "dep",
  "flag",
] as const;

export const INSTALL_LABEL_MODES = ["merge", "replace"] as const;
export type InstallLabelMode = (typeof INSTALL_LABEL_MODES)[number];

export interface ForgeLabelRef {
  id?: number;
  name: string;
}

export interface LabelDefinition {
  name: string;
  color: string;
  exclusive: boolean;
  description: string;
}

export interface LabelSetPlan {
  mode: InstallLabelMode;
  create: LabelDefinition[];
  remove: ForgeLabelRef[];
  skip: string[];
}

const STATE_COLORS = ["#1d76db", "#0e7c6b", "#a6700b", "#6e40c9", "#1a7f37"];
const PRIORITY_COLORS = ["#d1242f", "#e85d04", "#1d76db", "#59636e", "#8c959f"];

const LABEL_DEFS: LabelDefinition[] = [
  ...STATE_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: STATE_COLORS[i] ?? "#59636e",
    exclusive: true,
    description: `Workflow state ${i}`,
  })),
  ...LEGACY_STATE_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: STATE_COLORS[i] ?? "#59636e",
    exclusive: true,
    description: `Workflow state ${i} (legacy numeric)`,
  })),
  ...PRIORITY_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: PRIORITY_COLORS[i] ?? "#59636e",
    exclusive: true,
    description: `Priority ${i}`,
  })),
  ...LEGACY_PRIORITY_ORDER.map((name, i): LabelDefinition => ({
    name,
    color: PRIORITY_COLORS[i] ?? "#59636e",
    exclusive: true,
    description: `Priority ${i} (legacy numeric)`,
  })),
  ...ATTENTION_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#8250df",
    exclusive: true,
    description: "Who acts next",
  })),
  ...LEGACY_ATTENTION_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#8250df",
    exclusive: true,
    description: "Who acts next (legacy numeric)",
  })),
  ...SPEC_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#0e7c6b",
    exclusive: true,
    description: "Spec readiness",
  })),
  ...LEGACY_SPEC_LABELS.map((name): LabelDefinition => ({
    name,
    color: "#0e7c6b",
    exclusive: true,
    description: "Spec readiness (legacy numeric)",
  })),
];

export function paseoLabelSet(): LabelDefinition[] {
  return LABEL_DEFS.map((def) => ({ ...def }));
}

export function paseoLabelScopes(): string[] {
  const scopes: string[] = [];
  for (const def of LABEL_DEFS) {
    const scope = scopeOfLabel(def.name);
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

export function planLabelSetInstall(
  existing: ForgeLabelRef[],
  mode: InstallLabelMode,
): LabelSetPlan {
  const desired = paseoLabelSet();
  const desiredNames = new Set(desired.map((def) => def.name));
  const existingNames = new Set(
    existing.map((label) => label.name).filter((name): name is string => typeof name === "string"),
  );
  const ownScopes = new Set(paseoLabelScopes());
  const remove =
    mode === "replace"
      ? existing.filter((label) => {
          const scope = scopeOfLabel(label.name);
          return scope !== null && ownScopes.has(scope) && !desiredNames.has(label.name);
        })
      : [];
  const create = desired.filter((def) => !existingNames.has(def.name));
  const skip = desired.filter((def) => existingNames.has(def.name)).map((def) => def.name);
  return { mode, create, remove, skip };
}
