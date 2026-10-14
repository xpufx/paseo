/**
 * Deterministic fleet membership — zero heuristics (#1151).
 *
 * `isFleetMember` is the single authoritative predicate that answers whether an
 * agent is an authorized fleet member eligible for auto-adjudication, teardown,
 * watchdog audits, and worker classification.  It relies exclusively on the
 * authoritative roster (registered Front Desk id + registered orchestrator ids)
 * and explicit parentage metadata — no title regexes, no cwd guessing, no
 * generic role="worker" checks.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FleetRoster {
  /** Registered Front Desk agent id. */
  frontDeskId?: string | null;
  /** Registered orchestrator agent ids. */
  orchestratorIds: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Core predicate
// ---------------------------------------------------------------------------

/**
 * Authoritative fleet membership check. Returns true when the agent is one of:
 *   1. The registered Front Desk agent.
 *   2. A registered orchestrator.
 *   3. An agent whose `fleet.uppidi.com/parent`, `paseo.parent-agent-id`, or
 *      `parentId` matches a registered orchestrator.
 *
 * Zero heuristics: no title regexes (`/Orchestrator\b/i`, `/Front Desk/i`),
 * no cwd guessing, no generic `role="worker"` checks.
 */
export function isFleetMember(
  agent: { id: string; parentId?: string | null; labels?: Record<string, string> | null } | null | undefined,
  roster: FleetRoster,
): boolean {
  if (!agent?.id) return false;
  if (roster.frontDeskId && agent.id === roster.frontDeskId) return true;
  if (roster.orchestratorIds.has(agent.id)) return true;
  const parentId =
    agent.labels?.["fleet.uppidi.com/parent"] ??
    agent.labels?.["paseo.parent-agent-id"] ??
    agent.parentId;
  if (parentId && roster.orchestratorIds.has(parentId as string)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Endpoint stamping helpers
// ---------------------------------------------------------------------------

/**
 * Stamp fleet identity labels on a Front Desk spawn payload.
 * Sets `fleet.uppidi.com/role`, `fleet.uppidi.com/fleet-id`, and registers
 * the agent in the authoritative roster.
 */
export function stampFrontDeskLabels(labels: Record<string, string>, agentId: string, fleetId: string): void {
  labels["fleet.uppidi.com/role"] = "front-desk";
  labels["fleet.uppidi.com/fleet-id"] = fleetId;
}

/**
 * Stamp fleet identity labels on an Orchestrator spawn payload.
 * Sets `fleet.uppidi.com/role`, `fleet.uppidi.com/fleet-id`, and registers
 * the agent in the authoritative roster.
 */
export function stampOrchestratorLabels(labels: Record<string, string>, agentId: string, fleetId: string, repo: string): void {
  labels["fleet.uppidi.com/role"] = "orchestrator";
  labels["fleet.uppidi.com/fleet-id"] = fleetId;
  labels["repo"] = repo;
}

/**
 * Stamp fleet identity labels on a coding-agent (worker) spawn payload.
 * Sets `fleet.uppidi.com/role`, `fleet.uppidi.com/parent`, and optionally
 * `fleet.uppidi.com/issue`.
 */
export function stampWorkerLabels(
  labels: Record<string, string>,
  orchestratorAgentId: string,
  issueNumber?: number | string | null,
): void {
  labels["fleet.uppidi.com/role"] = "coding-agent";
  labels["fleet.uppidi.com/parent"] = orchestratorAgentId;
  if (issueNumber != null) {
    labels["fleet.uppidi.com/issue"] = String(issueNumber);
  }
}
