import type { UppidiAgent } from "../shared/contracts.js";

export interface AgentSwitcherGroup {
  repo: string;
  orchestrator: UppidiAgent;
}

export interface AgentSwitcherData {
  frontDesk: UppidiAgent | null;
  orchestratorsByRepo: AgentSwitcherGroup[];
}

/**
 * Maps the fleet agents snapshot into structured switcher groups:
 * - Live Front Desk agent (or null if none)
 * - Orchestrators grouped by repo (one row per repo), sorted by repo key
 */
export function mapAgentSwitcherData(agentsOutput?: {
  frontDesk?: UppidiAgent[];
  orchestrators?: UppidiAgent[];
} | null): AgentSwitcherData {
  if (!agentsOutput) {
    return { frontDesk: null, orchestratorsByRepo: [] };
  }

  const liveFrontDesk =
    agentsOutput.frontDesk && agentsOutput.frontDesk.length > 0
      ? agentsOutput.frontDesk[0]!
      : null;

  const rawOrchestrators = agentsOutput.orchestrators ?? [];
  const repoMap = new Map<string, UppidiAgent>();

  for (const orch of rawOrchestrators) {
    const repoKey =
      orch.registryRepoKey ||
      orch.project ||
      orch.attributedWork?.repo ||
      orch.labels?.["repo"] ||
      "unassigned";
    if (!repoMap.has(repoKey)) {
      repoMap.set(repoKey, orch);
    }
  }

  const sortedRepos = Array.from(repoMap.keys()).sort((a, b) =>
    a.localeCompare(b),
  );

  const orchestratorsByRepo: AgentSwitcherGroup[] = sortedRepos.map((repo) => ({
    repo,
    orchestrator: repoMap.get(repo)!,
  }));

  return {
    frontDesk: liveFrontDesk,
    orchestratorsByRepo,
  };
}
