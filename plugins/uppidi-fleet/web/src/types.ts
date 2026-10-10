export type AgentCategory = "frontdesk" | "orchestrator" | "worker";

export type FleetAgentState =
  | "working"
  | "running"
  | "sleeping"
  | "idle:waiting"
  | "idle:quota-exhausted"
  | "attention-required"
  | "permission-prompt"
  | "failed:quota-exhausted"
  | "failed:spawn"
  | "failed:timeout"
  | "failed:error"
  | "unknown";

export interface FleetAgent {
  id: string;
  name: string;
  category: AgentCategory;
  provider?: string;
  model?: string | null;
  deterministicState: FleetAgentState;
  project?: string;
  repo?: string;
  issue?: number;
  branch?: string;
  updatedAt?: string;
  requiresAttention?: boolean;
}

export interface FleetAgentsSnapshot {
  frontdesk: FleetAgent[];
  orchestrators: FleetAgent[];
  workers: FleetAgent[];
  totalCount: number;
  runningCount: number;
  idleCount: number;
  errorCount: number;
}

export type CandidateStatus = "Backlog" | "In progress" | "Review" | "Done";

export interface CandidateIssue {
  number: number;
  title: string;
  repo: string;
  status: CandidateStatus;
  attention: string;
  branch?: string;
  url?: string;
  labels: string[];
  comments: number;
  updatedAt?: string;
}

export interface FleetHealth {
  total: number;
  running: number;
  idle: number;
  errored: number;
  attention: number;
  byCategory: Record<AgentCategory, number>;
}

const RUNNING_STATES: ReadonlySet<string> = new Set(["working", "running"]);
const ERROR_STATES: ReadonlySet<string> = new Set([
  "failed:quota-exhausted",
  "failed:spawn",
  "failed:timeout",
  "failed:error",
]);

export function summarizeFleetHealth(agents: FleetAgent[]): FleetHealth {
  const byCategory: Record<AgentCategory, number> = {
    frontdesk: 0,
    orchestrator: 0,
    worker: 0,
  };
  let running = 0;
  let errored = 0;
  let attention = 0;
  for (const agent of agents) {
    byCategory[agent.category] += 1;
    if (RUNNING_STATES.has(agent.deterministicState)) running += 1;
    if (ERROR_STATES.has(agent.deterministicState)) errored += 1;
    if (agent.requiresAttention === true) attention += 1;
  }
  return {
    total: agents.length,
    running,
    idle: Math.max(0, agents.length - running - errored),
    errored,
    attention,
    byCategory,
  };
}

export function flattenAgents(snapshot: FleetAgentsSnapshot | null): FleetAgent[] {
  if (!snapshot) return [];
  return [...snapshot.frontdesk, ...snapshot.orchestrators, ...snapshot.workers];
}

export function isAgentCategory(value: unknown): value is AgentCategory {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/-/g, "");
  return (
    normalized === "frontdesk" ||
    normalized === "orchestrator" ||
    normalized === "worker" ||
    normalized === "codingagent"
  );
}

export function normalizeAgentCategory(value: unknown): AgentCategory {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/-/g, "");
  if (normalized === "frontdesk" || normalized === "orchestrator" || normalized === "worker") {
    return normalized;
  }
  // Canonical `coding-agent` (and anything unknown) maps onto the legacy
  // `worker` bucket so the snapshot shape stays stable (#1126).
  return "worker";
}
