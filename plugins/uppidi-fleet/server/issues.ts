import { spawn } from "node:child_process";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type UppidiIssuesInput,
  type UppidiIssuesOutput,
  type UppidiIssue,
  type AttentionLabel,
  type UppidiTransitionIssueInput,
  type UppidiTransitionIssueOutput,
  type KanbanColumnId,
} from "../shared/contracts.js";
import { forgejoApiGet, forgejoToken, resolveForgejoHost } from "./forgejo-api.js";
import { resolveCanonicalRepo, type CanonicalRepo } from "../shared/repo-identity.js";

const DEFAULT_REPO = "xpufx-org/paseo";

/**
 * Resolves a requested repo to its canonical identity. A bare name is
 * unresolvable here; only owner/repo, host-qualified, or URL forms pass (#888).
 */
function resolveIssueRepo(inputRepo?: string): CanonicalRepo | null {
  return resolveCanonicalRepo(inputRepo?.trim() || DEFAULT_REPO);
}

export async function handleUppidiIssues(
  input: UppidiIssuesInput,
  _context?: PluginHandlerContext,
): Promise<UppidiIssuesOutput> {
  const resolvedRepo = resolveIssueRepo(input.repo);
  if (!resolvedRepo) {
    return {
      ok: false,
      repo: null,
      issues: [],
      openCount: 0,
      inFlightCount: 0,
      reviewCount: 0,
      needsYouCount: 0,
      error: `Unknown repository: ${input.repo?.trim() || DEFAULT_REPO}`,
    };
  }
  const repo = resolvedRepo.compact;
  const host = resolveForgejoHost();
  const token = await forgejoToken(host);

  const path = `/api/v1/repos/${repo}/issues?state=${input.state}&limit=50`;
  const res = await forgejoApiGet<
    Array<{
      number: number;
      title: string;
      state: string;
      body?: string;
      comments?: number;
      html_url?: string;
      updated_at?: string;
      labels?: Array<{ name: string }>;
    }>
  >(path, { host, token });

  if (res.outcome !== "ok") {
    return {
      ok: false,
      repo: resolvedRepo.key,
      issues: [],
      openCount: 0,
      inFlightCount: 0,
      reviewCount: 0,
      needsYouCount: 0,
      error: res.error,
    };
  }

  const rawList = Array.isArray(res.data) ? res.data : [];
  const issues: UppidiIssue[] = rawList.map((raw) => {
    const labelNames = (raw.labels ?? []).map((l) => l.name);
    const normalizedLabels = labelNames.map((l) => l.trim().toLowerCase());

    // Operator attention is strictly signaled by user attention labels. Both the
    // canonical numberless form (`attention/user`) and the legacy numeric form
    // (`attention/2-user`) are accepted during the migration (platform#247).
    const hasUserAttention = normalizedLabels.some(
      (l) => l === "attention/user" || l === "attention/2-user" || l === "attention:user",
    );
    const hasOrchestratorAttention = normalizedLabels.some(
      (l) =>
        l === "attention/orchestrator" ||
        l === "attention/0-orchestrator" ||
        l === "attention:orchestrator",
    );

    let attention: AttentionLabel = "attention/agent";
    if (hasUserAttention) attention = "attention/user";
    else if (hasOrchestratorAttention) attention = "attention/orchestrator";

    let status: "Backlog" | "In progress" | "Review" | "Done" = "Backlog";
    if (raw.state === "closed" || normalizedLabels.some((l) => l === "state/done" || l === "state/4-done")) {
      status = "Done";
    } else if (
      normalizedLabels.some(
        (l) =>
          l === "state/review" ||
          l === "state/2-review" ||
          l === "state/verify" ||
          l === "state/3-verify" ||
          l.startsWith("review/"),
      )
    ) {
      status = "Review";
    } else if (normalizedLabels.some((l) => l === "state/wip" || l === "state/1-wip")) {
      status = "In progress";
    }

    // Detect branch from issue body if referenced
    const branchMatch = (raw.body || "").match(/\b(feat|fix|chore|docs)\/[a-zA-Z0-9_\-\.\/]+\b/);

    return {
      number: raw.number,
      title: raw.title,
      state: raw.state,
      repo: resolvedRepo.key,
      status,
      attention,
      branch: branchMatch ? branchMatch[0] : undefined,
      comments: raw.comments ?? 0,
      labels: labelNames,
      url: raw.html_url,
      updatedAt: raw.updated_at,
    };
  });

  const openIssues = issues.filter((i) => i.state === "open");
  return {
    ok: true,
    repo: resolvedRepo.key,
    issues,
    openCount: openIssues.length,
    inFlightCount: openIssues.filter((i) => i.status === "In progress").length,
    reviewCount: openIssues.filter((i) => i.status === "Review").length,
    needsYouCount: openIssues.filter((i) => i.attention === "attention/user").length,
  };
}

// Canonical numberless column labels (platform#247); transitions write these.
export const STATE_LABELS_FOR_COLUMN: Record<KanbanColumnId, string> = {
  backlog: "state/triage",
  in_progress: "state/wip",
  review: "state/review",
  done: "state/done",
};

// Removal set carries both spellings so a transition clears whichever the board
// still holds; the target label itself is filtered out by the caller.
export const ALL_STATE_LABELS = [
  "state/triage",
  "state/wip",
  "state/review",
  "state/verify",
  "state/done",
  "state/0-triage",
  "state/1-wip",
  "state/2-review",
  "state/3-verify",
  "state/4-done",
];

export type CommandRunnerFn = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

function defaultTeaxRun(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("teax", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
    child.on("error", (err) => {
      resolve({ code: -1, stdout, stderr: err.message });
    });
  });
}

let commandRunner: CommandRunnerFn = defaultTeaxRun;

export function setIssueCommandRunnerForTest(fn: CommandRunnerFn | null): void {
  commandRunner = fn ?? defaultTeaxRun;
}

export async function handleUppidiTransitionIssue(
  input: UppidiTransitionIssueInput,
  _context?: PluginHandlerContext,
): Promise<UppidiTransitionIssueOutput> {
  const resolvedRepo = resolveIssueRepo(input.repo);
  if (!resolvedRepo) {
    return {
      ok: false,
      number: input.number,
      targetState: input.targetState,
      error: `Unknown repository: ${input.repo?.trim() || DEFAULT_REPO}`,
    };
  }
  const repo = resolvedRepo.compact;
  const host = resolveForgejoHost();
  const targetLabel = input.targetLabel || STATE_LABELS_FOR_COLUMN[input.targetState];
  const removeLabels = ALL_STATE_LABELS.filter((l) => l !== targetLabel);

  try {
    if (input.targetState !== "done") {
      // Reopen issue if it was closed
      await commandRunner(["issue", "reopen", String(input.number), "--hostname", host, "-R", repo]);
    }

    const editArgs = [
      "issue",
      "edit",
      String(input.number),
      "--hostname",
      host,
      "-R",
      repo,
      "--add-label",
      targetLabel,
    ];
    for (const rem of removeLabels) {
      editArgs.push("--remove-label", rem);
    }

    const editRes = await commandRunner(editArgs);
    if (editRes.code !== 0 && !editRes.stdout.includes("OK") && !editRes.stdout.includes("updated") && editRes.stderr) {
      return {
        ok: false,
        number: input.number,
        targetState: input.targetState,
        error: editRes.stderr || `Command failed with code ${editRes.code}`,
      };
    }

    if (input.targetState === "done") {
      await commandRunner(["issue", "close", String(input.number), "--hostname", host, "-R", repo]);
    }

    return {
      ok: true,
      number: input.number,
      targetState: input.targetState,
      appliedLabel: targetLabel,
      message: `Issue #${input.number} moved to ${input.targetState} (${targetLabel})`,
    };
  } catch (err: any) {
    return {
      ok: false,
      number: input.number,
      targetState: input.targetState,
      error: err?.message || String(err),
    };
  }
}
