import { isRepoMatching } from "./kanban.js";

/**
 * Multi-repository association for the Kanban board (#1282). Groups are ad-hoc:
 * a board can watch `[paseo, platform, 2fado]` as "Core" and a different set as
 * "Active Sprint" without either group being a forge-side concept.
 */
export interface RepoGroup {
  id: string;
  name: string;
  repos: string[];
}

/**
 * Decouples Kanban visibility from autonomous execution (#1282). A repository
 * is always visible on the board; the tier only governs whether the fleet may
 * dispatch work onto it.
 *
 * - `full-active`: visible, live webhook sync, autonomous dispatch enabled.
 * - `paused`: visible, live webhook sync, dispatch buffered for human grooming.
 * - `kanban-only`: visible, on-demand REST only, autonomous dispatch barred.
 */
export type AutomationTier = "full-active" | "paused" | "kanban-only";

/** Canonical tiers in escalation order (least to most restrictive). */
export const AUTOMATION_TIERS: readonly AutomationTier[] = [
  "full-active",
  "paused",
  "kanban-only",
] as const;

export interface AutomationTierMeta {
  tier: AutomationTier;
  label: string;
  tone: "success" | "warning" | "info";
  description: string;
}

/** Presentation metadata shared by every board surface (badge text + tone). */
export const AUTOMATION_TIER_META: Record<AutomationTier, AutomationTierMeta> = {
  "full-active": {
    tier: "full-active",
    label: "Full Fleet Active",
    tone: "success",
    description: "Kanban visible · live webhook sync · autonomous fleet dispatch active",
  },
  paused: {
    tier: "paused",
    label: "Paused Fleet",
    tone: "warning",
    description: "Kanban visible · live webhook sync · dispatch queue buffered",
  },
  "kanban-only": {
    tier: "kanban-only",
    label: "Kanban-Only",
    tone: "info",
    description: "Kanban visible · on-demand REST · autonomous dispatch barred",
  },
};

/** Pseudo-group id for the implicit `All` filter pill. */
export const DEFAULT_REPO_GROUP_ID = "all";

/** Implicit group matching every repository; hosts render it as `All`. */
export const DEFAULT_REPO_GROUP: RepoGroup = {
  id: DEFAULT_REPO_GROUP_ID,
  name: "All",
  repos: [],
};

export function isKnownAutomationTier(value: unknown): value is AutomationTier {
  return value === "full-active" || value === "paused" || value === "kanban-only";
}

/** Deterministic cycle used by tier pills: active → paused → kanban-only → active. */
export function nextAutomationTier(tier: AutomationTier): AutomationTier {
  const index = AUTOMATION_TIERS.indexOf(tier);
  return AUTOMATION_TIERS[(index + 1) % AUTOMATION_TIERS.length];
}

/** True when `repo` belongs to `group`; the implicit `all` group matches everything. */
export function repoGroupMatches(group: RepoGroup, repo?: string | null): boolean {
  if (group.id === DEFAULT_REPO_GROUP_ID) return true;
  if (!repo) return false;
  return group.repos.some((candidate) => isRepoMatching(candidate, repo));
}

/**
 * Resolves the tier for a repository from a repo → tier map. Matching tolerates
 * URL/bare/canonical key forms and defaults to `full-active` when unset, so a
 * repo the board has never configured keeps dispatching rather than silently
 * going passive.
 */
export function resolveRepoAutomationTier(
  tiers: Record<string, AutomationTier> | null | undefined,
  repo?: string | null,
): AutomationTier {
  if (!tiers) return "full-active";
  if (repo && isKnownAutomationTier(tiers[repo])) return tiers[repo];
  for (const [key, tier] of Object.entries(tiers)) {
    if (!isKnownAutomationTier(tier)) continue;
    if (repo && (isRepoMatching(key, repo) || key === repo)) return tier;
  }
  return "full-active";
}
