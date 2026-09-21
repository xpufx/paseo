import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { UppidiAgent, UppidiAgentsOutput } from "../shared/contracts.js";

const execFileAsync = promisify(execFile);

interface RawAgentRecord {
  id: string;
  shortId?: string;
  name?: string;
  title?: string;
  provider?: string;
  status?: string;
  cwd?: string;
  created?: string;
  workspaceId?: string;
}

export function categorizeAgent(name: string): "front-desk" | "orchestrator" | "worker" {
  const lower = (name || "").toLowerCase();
  if (lower.includes("front desk") || lower === "frontdesk") {
    return "front-desk";
  }
  if (lower.includes("orchestrator")) {
    return "orchestrator";
  }
  return "worker";
}

export function normalizeRawAgent(raw: RawAgentRecord): UppidiAgent {
  const id = raw.id || "";
  const shortId = raw.shortId || id.slice(0, 7);
  const name = raw.name || raw.title || `Agent ${shortId}`;
  const category = categorizeAgent(name);
  const status = raw.status || "idle";

  return {
    id,
    shortId,
    name,
    category,
    provider: raw.provider,
    status,
    cwd: raw.cwd,
    created: raw.created,
    workspaceId: raw.workspaceId,
  };
}

export async function fetchPaseoAgents(context?: PluginHandlerContext): Promise<UppidiAgent[]> {
  // 1. Try SDK context.paseo.agents.list()
  if (context?.paseo?.agents?.list) {
    try {
      const list = await context.paseo.agents.list();
      if (Array.isArray(list?.entries)) {
        return list.entries.map((entry: any) => {
          const a = entry.agent || entry;
          return normalizeRawAgent({
            id: a.id,
            name: a.name || a.title,
            status: a.status,
            provider: a.provider || a.config?.provider,
            cwd: a.cwd || a.config?.cwd,
            workspaceId: a.workspaceId,
            created: a.created || a.createdAt,
          });
        });
      }
    } catch {
      // Fallback to CLI if SDK call throws
    }
  }

  // 2. Fallback to CLI: paseo ls --json
  try {
    const { stdout } = await execFileAsync("paseo", ["ls", "--json"], {
      timeout: 5000,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normalizeRawAgent(item));
    }
  } catch {
    // If CLI unavailable, return empty array
  }

  return [];
}

export async function handleUppidiAgents(
  _input: Record<string, never>,
  context: PluginHandlerContext
): Promise<UppidiAgentsOutput> {
  try {
    const agents = await fetchPaseoAgents(context);

    const frontDesk: UppidiAgent[] = [];
    const orchestrators: UppidiAgent[] = [];
    const workers: UppidiAgent[] = [];

    let runningCount = 0;
    let idleCount = 0;
    let errorCount = 0;

    for (const agent of agents) {
      if (agent.status === "running") runningCount++;
      else if (agent.status === "idle") idleCount++;
      else if (agent.status === "error") errorCount++;

      if (agent.category === "front-desk") {
        frontDesk.push(agent);
      } else if (agent.category === "orchestrator") {
        orchestrators.push(agent);
      } else {
        workers.push(agent);
      }
    }

    return {
      ok: true,
      frontDesk,
      orchestrators,
      workers,
      totalCount: agents.length,
      runningCount,
      idleCount,
      errorCount,
    };
  } catch (err: any) {
    return {
      ok: false,
      frontDesk: [],
      orchestrators: [],
      workers: [],
      totalCount: 0,
      runningCount: 0,
      idleCount: 0,
      errorCount: 0,
      error: err?.message || String(err),
    };
  }
}
