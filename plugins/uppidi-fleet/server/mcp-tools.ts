import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type UppidiToolDefinition,
  type UppidiFleetToolListOutput,
  type UppidiFleetToolExecuteInput,
  type UppidiFleetToolExecuteOutput,
} from "../shared/contracts.js";
import {
  runIssuesCheck,
  renderIssuesCheckJson,
  renderIssuesCheckMarkdown,
  ISSUES_CHECK_DEFAULT_HOSTNAME,
  ISSUES_CHECK_DEFAULT_REPO,
  ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS,
  type IssuesCheckRole,
} from "./issues-check.js";
import {
  HookRouter,
  getActiveHookRouter,
  type WatchdogAuditOptions,
  type WatchdogAuditResult,
} from "./hook-router.js";
import {
  evaluateWorkerSpawnWorkspace,
  WORKER_PRIMARY_CHECKOUT_ERROR,
} from "./workspace-guard.js";

/**
 * Declared MCP tools for Uppidi Fleet.
 * Exposes deterministic board triage and fleet watchdog health auditing.
 */
export const FLEET_MCP_TOOLS: UppidiToolDefinition[] = [
  {
    name: "fleet_check_board",
    description:
      "Deterministic board check and triage ranking for Forgejo issues. Scans open issues, sweeps stale WIP, and returns ranked candidates.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: `Target repository in 'owner/repo' format (default: ${ISSUES_CHECK_DEFAULT_REPO})`,
          default: ISSUES_CHECK_DEFAULT_REPO,
        },
        hostname: {
          type: "string",
          description: `Forgejo host name (default: ${ISSUES_CHECK_DEFAULT_HOSTNAME})`,
          default: ISSUES_CHECK_DEFAULT_HOSTNAME,
        },
        role: {
          type: "string",
          enum: ["orchestrator", "worker", "coding_worker"],
          description: "Agent role perspective for triage ranking (default: orchestrator)",
          default: "orchestrator",
        },
        force: {
          type: "boolean",
          description: "Force board check even if cache signature matches",
          default: false,
        },
        all: {
          type: "boolean",
          description: "Process all open issues without filtering",
          default: false,
        },
        staleWipHours: {
          type: "number",
          description: `Hours before WIP issues are considered stale (default: ${ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS})`,
          default: ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS,
        },
        dryRun: {
          type: "boolean",
          description: "Dry-run mode: calculate triage without mutating board labels",
          default: false,
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
    },
  },
  {
    name: "fleet_watchdog_audit",
    description:
      "Audit fleet agent health across daemons, detecting turn concurrency locks, timeouts, and stalled agents, with optional auto-recovery.",
    inputSchema: {
      type: "object",
      properties: {
        recover: {
          type: "boolean",
          description: "Attempt conservative recovery for eligible anomalies (default: false)",
          default: false,
        },
        frontDeskId: {
          type: "string",
          description: "Front Desk agent ID to notify regarding health alerts",
        },
        steerMessage: {
          type: "string",
          description: "Custom wake message when steering recovered agents",
        },
        cancellationRecencySeconds: {
          type: "number",
          description: "Upper bound in seconds to consider cancellation timeouts (default: 300)",
        },
        runningStaleSeconds: {
          type: "number",
          description: "Seconds of inactivity before flagging a running turn as zombie (default: 900)",
        },
        assumePendingWork: {
          type: "boolean",
          description: "Treat finished idle agents requiring attention as stalled (default: false)",
          default: false,
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
    },
  },
  {
    name: "fleet_board_sweep",
    description:
      "Trigger deterministic board sweep across all enrolled (or specified) repositories, evaluating open issues and stale WIP, and alerting Front Desk on actionable work or check errors.",
    inputSchema: {
      type: "object",
      properties: {
        repos: {
          type: "string",
          description:
            "Target repositories to sweep (comma-delimited slugs e.g. 'owner/repo1,owner/repo2', optional; defaults to all enrolled repositories)",
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
    },
  },
  {
    name: "fleet_prune_orchestrators",
    description:
      "Audit registered orchestrators against live Paseo daemon agents, pruning dead, stopped, or killed orchestrators from disk registry.",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: {
          type: "boolean",
          description: "Dry-run mode: report dead orchestrators without deleting records (default: false)",
          default: false,
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
    },
  },
  {
    name: "fleet_queue_inspect",
    description:
      "Inspect buffered webhook payloads, attempt counts, and pending status for repository queues.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Filter inspection by repository slug (e.g. 'owner/repo' or 'frontdesk', optional)",
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
    },
  },
  {
    name: "fleet_queue_purge",
    description:
      "Safely purge or drop stuck/poisoned webhook payloads for a specific repository queue without requiring manual filesystem surgery or full fleet reset.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Target repository slug to purge (e.g. 'owner/repo' or 'frontdesk')",
        },
        confirm: {
          type: "boolean",
          description: "Safety confirmation flag (must be explicitly true to execute purge)",
          default: false,
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
      required: ["repo", "confirm"],
    },
  },
  {
    name: "fleet_handoff_generate",
    description:
      "Generate a fleet shift handoff report (latest-handoff.md) capturing active worker assignments, open PRs, and blocking state across enrolled repositories.",
    inputSchema: {
      type: "object",
      properties: {
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
    },
  },
  {
    name: "fleet_rotate_role",
    description:
      "Rotate a long-lived fleet role onto a fresh agent (provider-independent respawn): spawn replacement, verify it registered, deliver a rotation brief, then archive the incumbent. Manual by default; manual triggers ignore cooldown and mid-turn but never overlap an in-flight rotation.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          enum: ["orchestrator", "front-desk", "auditor", "coding-agent"],
          description: "Role to rotate (default: orchestrator)",
          default: "orchestrator",
        },
        repo: {
          type: "string",
          description: "Repository slug; required for orchestrator rotation",
        },
        reason: {
          type: "string",
          description: "Operator-supplied rationale recorded in the rotation brief",
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
    },
  },
  {
    name: "fleet_ensure_orchestrator",
    description:
      "Deterministically ensure an active, autonomous orchestrator agent exists for a repository. If already running, returns existing agentId; otherwise resolves workspace from daemon workspaces.json, provisions agent defaulting to autonomous yolo mode, registers it, and drains pending queues.",
    inputSchema: {
      type: "object",
      properties: {
        repo: {
          type: "string",
          description: "Target repository slug or key (e.g. 'owner/repo')",
        },
        mode: {
          type: "string",
          description: "Execution permission mode (default: 'yolo')",
          default: "yolo",
        },
        provider: {
          type: "string",
          description: "Agent model provider (default: 'antigravity-acp')",
        },
        model: {
          type: "string",
          description: "Model name override",
        },
        force: {
          type: "boolean",
          description: "Force provisioning a new orchestrator even if one is currently active",
          default: false,
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
      required: ["repo"],
    },
  },
  {
    name: "fleet_validate_workspace",
    description:
      "Worktree-only dispatch validator (#918). Refuses a worker workspace that resolves to the repository primary checkout (git-dir == git-common-dir) or a local/isolation:local workspace. Call before dispatching a worker; a refusal is hard and names the provisioning action.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute workspace_path to validate (the worker cwd)",
        },
        workspaceId: {
          type: "string",
          description: "Paseo workspace id to resolve from the daemon registry when path is omitted",
        },
        json: {
          type: "boolean",
          description: "Output machine-readable JSON instead of markdown",
          default: false,
        },
      },
    },
  },
];

export interface FleetToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Execute fleet_check_board with validated parameters.
 */
export async function executeFleetCheckBoard(args: Record<string, unknown> = {}): Promise<FleetToolCallResult> {
  const hostname = typeof args.hostname === "string" && args.hostname.trim() ? args.hostname.trim() : ISSUES_CHECK_DEFAULT_HOSTNAME;
  const repo = typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : ISSUES_CHECK_DEFAULT_REPO;
  const rawRole = typeof args.role === "string" ? args.role.trim() : "orchestrator";
  const validRoles = ["orchestrator", "worker", "coding_worker"] as const;
  if (!validRoles.includes(rawRole as (typeof validRoles)[number])) {
    return {
      content: [{ type: "text", text: `Invalid role "${rawRole}". Must be one of: ${validRoles.join(", ")}` }],
      isError: true,
    };
  }
  const role: IssuesCheckRole = rawRole === "worker" || rawRole === "coding_worker" ? "worker" : "orchestrator";
  const force = Boolean(args.force);
  const all = Boolean(args.all);
  const staleWipHours = typeof args.staleWipHours === "number" ? args.staleWipHours : ISSUES_CHECK_DEFAULT_STALE_WIP_HOURS;
  if (staleWipHours < 0) {
    return {
      content: [{ type: "text", text: "staleWipHours must be a non-negative number" }],
      isError: true,
    };
  }
  const dryRun = Boolean(args.dryRun);
  const json = Boolean(args.json);

  try {
    const outcome = await runIssuesCheck({
      hostname,
      repo,
      role,
      force,
      all,
      staleWipHours,
      dryRun,
    });

    const text = json
      ? renderIssuesCheckJson(outcome)
      : renderIssuesCheckMarkdown(outcome, { hostname, repo, role, staleWipHours, dryRun });

    return {
      content: [{ type: "text", text }],
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `fleet_check_board failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Render a human-readable markdown report from watchdog audit results.
 */
export function renderWatchdogAuditMarkdown(audit: WatchdogAuditResult): string {
  const lines: string[] = ["# Fleet Watchdog Health Audit", ""];
  const date = new Date(audit.timestamp || Date.now()).toISOString();
  const audited = audit.audited || { orchestrators: 0, agents: 0, queues: 0 };
  lines.push(
    `Checked at: \`${date}\` \u00b7 Audited: **${audited.agents} agents**, **${audited.orchestrators} orchestrators**, **${audited.queues} queues**`,
  );

  if (!audit.anomalies || audit.anomalies.length === 0) {
    lines.push("", "\u2705 **All agents healthy.** No anomalies detected.");
    return lines.join("\n") + "\n";
  }

  lines.push("", `\u26a0\ufe0f **${audit.anomalies.length} anomal${audit.anomalies.length === 1 ? "y" : "ies"} detected:**`, "");

  for (const a of audit.anomalies) {
    const severityBadge = a.severity === "high" ? "\ud83d\udd34 HIGH" : "\ud83d\udfe1 MODERATE";
    const agentLabel = a.agentId ? `Agent \`${a.agentId}\`` : a.key ? `Queue \`${a.key}\`` : "Finding";
    lines.push(`### ${agentLabel} [${severityBadge}]`);
    if (a.taxonomy && a.taxonomy.length > 0) {
      lines.push(`- **Taxonomy:** ${a.taxonomy.map((t) => `\`${t}\``).join(", ")}`);
    }
    if (a.reason) {
      lines.push(`- **Reason:** ${a.reason}`);
    }
    if (a.details && typeof a.details === "object") {
      const detailEntries = Object.entries(a.details);
      for (const [tax, msg] of detailEntries) {
        lines.push(`- **${tax}:** ${msg}`);
      }
    }
    if (a.recovered !== undefined) {
      lines.push(`- **Recovered:** ${a.recovered ? "\u2705 Yes" : "\u274c No"}`);
    }
    if (a.recoveryActions && a.recoveryActions.length > 0) {
      lines.push(`- **Actions:** ${a.recoveryActions.join("; ")}`);
    }
    if (a.error) {
      lines.push(`- **Error:** ${a.error}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

/**
 * Execute fleet_watchdog_audit with validated parameters.
 */
export async function executeFleetWatchdogAudit(args: Record<string, unknown> = {}): Promise<FleetToolCallResult> {
  const recover = Boolean(args.recover);
  const frontDeskId = typeof args.frontDeskId === "string" && args.frontDeskId.trim() ? args.frontDeskId.trim() : undefined;
  const steerMessage = typeof args.steerMessage === "string" && args.steerMessage.trim() ? args.steerMessage.trim() : undefined;
  const cancellationRecencySeconds =
    typeof args.cancellationRecencySeconds === "number" ? args.cancellationRecencySeconds : undefined;
  const runningStaleSeconds =
    typeof args.runningStaleSeconds === "number" ? args.runningStaleSeconds : undefined;
  const assumePendingWork = Boolean(args.assumePendingWork);
  const json = Boolean(args.json);

  const opts: WatchdogAuditOptions = {
    recover,
    frontDeskId,
    steerMessage,
    cancellationRecencySeconds,
    runningStaleSeconds,
    assumePendingWork,
  };

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const result = await router.runWatchdogAudit(opts);
    const text = json ? JSON.stringify(result, null, 2) : renderWatchdogAuditMarkdown(result);

    return {
      content: [{ type: "text", text }],
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `fleet_watchdog_audit failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Execute fleet_board_sweep with validated parameters.
 */
export async function executeFleetBoardSweep(
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  const json = Boolean(args.json);
  let parsedRepos: string[] | undefined;
  if (Array.isArray(args.repos)) {
    parsedRepos = args.repos.map((r) => String(r).trim()).filter(Boolean);
  } else if (typeof args.repos === "string" && args.repos.trim()) {
    parsedRepos = args.repos.split(",").map((r) => r.trim()).filter(Boolean);
  }

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const result = await router.runBoardSweep(parsedRepos);

    if (json) {
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    const lines: string[] = [
      "# Fleet Board Sweep",
      `- Swept repositories: ${result.swept}`,
      `- Actionable repositories: ${result.actionable.length}`,
      `- Orchestrator records pruned: ${result.prunedCount}`,
      `- Front Desk notified: ${result.notified > 0 ? "Yes" : "No"}`,
    ];

    if (result.actionable.length > 0) {
      lines.push("", "### Actionable Repositories");
      for (const a of result.actionable) {
        lines.push(`- **${a.repo}**: ${a.count} actionable (${a.dispatchable} dispatchable)`);
      }
    }

    if (result.errors && result.errors.length > 0) {
      lines.push("", "### Errors");
      for (const e of result.errors) {
        lines.push(`- **${e.repo}**: ${e.error}`);
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: !result.ok,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `fleet_board_sweep failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Execute fleet_prune_orchestrators with validated parameters.
 */
export async function executeFleetPruneOrchestrators(
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  const json = Boolean(args.json);
  const dryRun = Boolean(args.dryRun);

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const result = await router.pruneOrchestrators({ dryRun });

    if (json) {
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    const lines: string[] = [
      `# Fleet Orchestrator Prune${result.dryRun ? " (Dry Run)" : ""}`,
      `- Status: ${result.ok ? "Success" : "Failed"}`,
      `- Pruned count: ${result.prunedCount}`,
    ];

    if (result.error) {
      lines.push(`- Error: ${result.error}`);
    }

    if (result.pruned.length > 0) {
      lines.push("", "### Pruned Orchestrators");
      for (const p of result.pruned) {
        lines.push(`- **${p.key}** (agent \`${p.agentId || "none"}\`): ${p.reason}`);
      }
    } else {
      lines.push("", "All registered orchestrators are healthy and active.");
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: !result.ok,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `fleet_prune_orchestrators failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Execute fleet_queue_inspect with validated parameters.
 */
export async function executeFleetQueueInspect(
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  const json = Boolean(args.json);
  const repo = typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : undefined;

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const overview = router.inspectQueues(repo);

    if (json) {
      return {
        content: [{ type: "text", text: JSON.stringify(overview, null, 2) }],
        isError: !overview.ok,
      };
    }

    const paused = Array.isArray(overview.paused) ? (overview.paused as string[]) : [];
    const queues = Array.isArray(overview.queues) ? (overview.queues as Array<Record<string, unknown>>) : [];

    const lines: string[] = [
      "# Fleet Queue Inspection",
      `- Service: ${String(overview.service ?? "uppidi-fleet-hook-router")}`,
      `- Uptime: ${String(overview.uptime ?? 0)}s`,
      `- Paused Queues: ${paused.length > 0 ? paused.join(", ") : "None"}`,
      `- Total Queues Inspected: ${queues.length}`,
    ];

    if (queues.length === 0) {
      lines.push("", repo ? `No queue found matching "${repo}".` : "No queues currently registered.");
    } else {
      for (const q of queues) {
        lines.push("", `### Queue: \`${String(q.key)}\``);
        lines.push(`- Depth: ${Number(q.depth ?? 0)}`);
        lines.push(`- Status: ${q.paused ? "Paused" : q.isBusy ? "Busy" : "Idle"}`);
        lines.push(`- Dropped: ${Number(q.dropped ?? 0)} | Busy Attempts: ${Number(q.busyAttempts ?? 0)}`);
        const orch = q.orchestrator as { agentId?: string; by?: string } | null;
        lines.push(`- Orchestrator: ${orch?.agentId ? `\`${orch.agentId}\` (${orch.by ?? "unknown"})` : "_None_"}`);

        const messages = Array.isArray(q.messages) ? (q.messages as Array<{ id: string; ts: number; preview: string }>) : [];
        if (messages.length > 0) {
          lines.push(`- Pending Messages (${messages.length}):`);
          for (const m of messages) {
            lines.push(`  - \`${m.id}\` (${new Date(m.ts).toISOString()}): ${m.preview}`);
          }
        }
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: !overview.ok,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `fleet_queue_inspect failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Execute fleet_queue_purge with validated parameters.
 */
export async function executeFleetQueuePurge(
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  const json = Boolean(args.json);
  const repo = typeof args.repo === "string" ? args.repo.trim() : "";
  const confirm = Boolean(args.confirm);

  if (!repo) {
    return {
      content: [{ type: "text", text: "Error: repo parameter is required" }],
      isError: true,
    };
  }

  if (!confirm) {
    return {
      content: [
        {
          type: "text",
          text: `Purge aborted: confirm must be set to true to purge queue for "${repo}"`,
        },
      ],
      isError: true,
    };
  }

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const result = router.purgeQueue(repo);

    if (json) {
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    const lines: string[] = [
      "# Fleet Queue Purge",
      `- Status: ${result.ok ? "Success" : "Failed"}`,
      `- Repository: ${result.repo}`,
      `- Purged Messages: ${result.purgedMessages}`,
      `- File Removed: ${result.fileRemoved ? "Yes" : "No"}`,
    ];

    if (result.error) {
      lines.push(`- Error: ${result.error}`);
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      isError: !result.ok,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `fleet_queue_purge failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Execute fleet_handoff_generate with validated parameters.
 */
export async function executeFleetHandoffGenerate(
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  const json = Boolean(args.json);

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const result = await router.generateHandoff();

    if (json) {
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.ok,
      };
    }

    return {
      content: [{ type: "text", text: result.report }],
      isError: !result.ok,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `fleet_handoff_generate failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Execute fleet_rotate_role with validated parameters.
 */
export async function executeFleetRotateRole(
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  const json = Boolean(args.json);
  const role = typeof args.role === "string" && args.role.trim() ? args.role.trim() : "orchestrator";
  const repo = typeof args.repo === "string" && args.repo.trim() ? args.repo.trim() : undefined;
  const reason = typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : undefined;

  try {
    const router = getActiveHookRouter();
    if (!router) {
      return { content: [{ type: "text", text: "fleet_rotate_role failed: hook router is not running" }], isError: true };
    }
    const result = await router.rotateRole({ role, repo, reason, force: true });
    if (json) {
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.ok };
    }
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `fleet_rotate_role failed for ${role}${repo ? `/${repo}` : ""}: ${result.error ?? "unknown error"}` }],
        isError: true,
      };
    }
    const lines = [
      `# Role Rotation — ${result.role}${result.repo ? ` · ${result.repo}` : ""}`,
      `- Previous agent: ${result.oldAgentId ? `\`${result.oldAgentId}\`` : "_none_"}`,
      `- Replacement: \`${result.agentId}\``,
      `- Triggers: ${result.triggers.join(", ") || "manual"}`,
    ];
    if (result.briefPath) lines.push(`- Brief: \`${result.briefPath}\``);
    return { content: [{ type: "text", text: lines.join("\n") }], isError: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `fleet_rotate_role failed: ${message}` }], isError: true };
  }
}

/**
 * Execute fleet_ensure_orchestrator with validated parameters.
 */
export async function executeFleetEnsureOrchestrator(
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  const repo = typeof args.repo === "string" ? args.repo.trim() : "";
  if (!repo) {
    return {
      content: [{ type: "text", text: "repo is required" }],
      isError: true,
    };
  }
  const mode = typeof args.mode === "string" && args.mode.trim() ? args.mode.trim() : "yolo";
  const provider = typeof args.provider === "string" && args.provider.trim() ? args.provider.trim() : undefined;
  const model = typeof args.model === "string" && args.model.trim() ? args.model.trim() : undefined;
  const force = Boolean(args.force);
  const json = Boolean(args.json);

  try {
    const router = getActiveHookRouter() ?? new HookRouter();
    const result = await router.ensureOrchestrator({ repo, mode, provider, model, force });
    if (!result.ok) {
      return {
        content: [{ type: "text", text: `fleet_ensure_orchestrator failed: ${result.error ?? "unknown error"}` }],
        isError: true,
      };
    }
    const text = json
      ? JSON.stringify(result, null, 2)
      : `### Orchestrator Ensured: ${repo}\n- **Agent ID**: \`${result.agentId}\`\n- **Status**: \`${result.status}\`\n- **Mode**: \`${mode}\`${result.workspaceId ? `\n- **Workspace**: \`${result.workspaceId}\`` : ""}${result.cwd ? `\n- **CWD**: \`${result.cwd}\`` : ""}`;
    return {
      content: [{ type: "text", text }],
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `fleet_ensure_orchestrator failed: ${message}` }],
      isError: true,
    };
  }
}

/**
 * Execute fleet_validate_workspace with validated parameters.
 *
 * The Orchestrator launch contract calls this before dispatching a worker. A
 * refusal is hard: `isError` is true and the text names the provisioning
 * action, so an unmodified caller cannot treat a refusal as a green light.
 */
export async function executeFleetValidateWorkspace(
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  const pathArg = typeof args.path === "string" ? args.path.trim() : "";
  const workspaceId = typeof args.workspaceId === "string" ? args.workspaceId.trim() : "";
  const json = Boolean(args.json);

  if (!pathArg && !workspaceId) {
    return {
      content: [{ type: "text", text: "path or workspaceId is required" }],
      isError: true,
    };
  }

  const decision = await evaluateWorkerSpawnWorkspace(
    {
      category: "worker",
      cwd: pathArg || undefined,
      workspaceId: workspaceId || undefined,
    },
    undefined,
    getActiveHookRouter()?.getPaseo() ?? undefined,
  );
  const payload = {
    ok: decision.allowed,
    path: pathArg || undefined,
    workspaceId: workspaceId || undefined,
    reason: decision.reason,
    error: decision.error,
  };
  const text = json
    ? JSON.stringify(payload, null, 2)
    : decision.allowed
      ? `worktree-only dispatch: OK — ${decision.reason}`
      : `${decision.error ?? WORKER_PRIMARY_CHECKOUT_ERROR}\n\nreason: ${decision.reason}`;
  return {
    content: [{ type: "text", text }],
    isError: !decision.allowed,
  };
}

/**
 * Dispatch an MCP tool call by name.
 */
export async function executeFleetTool(
  toolName: string,
  args: Record<string, unknown> = {},
): Promise<FleetToolCallResult> {
  switch (toolName) {
    case "fleet_check_board":
      return executeFleetCheckBoard(args);
    case "fleet_watchdog_audit":
      return executeFleetWatchdogAudit(args);
    case "fleet_board_sweep":
      return executeFleetBoardSweep(args);
    case "fleet_prune_orchestrators":
      return executeFleetPruneOrchestrators(args);
    case "fleet_queue_inspect":
      return executeFleetQueueInspect(args);
    case "fleet_queue_purge":
      return executeFleetQueuePurge(args);
    case "fleet_handoff_generate":
      return executeFleetHandoffGenerate(args);
    case "fleet_rotate_role":
      return executeFleetRotateRole(args);
    case "fleet_ensure_orchestrator":
      return executeFleetEnsureOrchestrator(args);
    case "fleet_validate_workspace":
      return executeFleetValidateWorkspace(args);
    default:
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: "${toolName}". Available fleet tools: ${FLEET_MCP_TOOLS.map((t) => t.name).join(", ")}`,
          },
        ],
        isError: true,
      };
  }
}

/**
 * RPC Handler: list available fleet tools.
 */
export async function handleFleetToolList(
  _input: Record<string, unknown>,
  _context?: PluginHandlerContext,
): Promise<UppidiFleetToolListOutput> {
  return {
    ok: true,
    tools: FLEET_MCP_TOOLS,
  };
}

/**
 * RPC Handler: execute a fleet tool.
 */
export async function handleFleetToolExecute(
  input: UppidiFleetToolExecuteInput,
  _context?: PluginHandlerContext,
): Promise<UppidiFleetToolExecuteOutput> {
  const result = await executeFleetTool(input.toolName, input.arguments);
  return {
    ok: !result.isError,
    output: result.content[0]?.text ?? "",
    isError: Boolean(result.isError),
    error: result.isError ? result.content[0]?.text : undefined,
  };
}
