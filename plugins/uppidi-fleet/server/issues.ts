import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type UppidiIssuesInput,
  type UppidiIssuesOutput,
  type UppidiIssue,
  type AttentionLabel,
} from "../shared/contracts.js";
import { forgejoApiGet, forgejoToken, resolveForgejoHost } from "./forgejo-api.js";

const DEFAULT_REPO = "xpufx-org/paseo";

export async function handleUppidiIssues(
  input: UppidiIssuesInput,
  _context?: PluginHandlerContext,
): Promise<UppidiIssuesOutput> {
  const repo = input.repo || DEFAULT_REPO;
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
      repo,
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

    // Operator attention is strictly signaled by user attention labels. The
    // canonical, scoped form is `attention/2-user`; legacy `attention/user`
    // and `attention:user` spellings normalize to the same operator signal.
    const hasUserAttention = normalizedLabels.some(
      (l) => l === "attention/2-user" || l === "attention/user" || l === "attention:user",
    );
    const hasOrchestratorAttention = normalizedLabels.some(
      (l) => l === "attention/0-orchestrator" || l === "attention/orchestrator" || l === "attention:orchestrator",
    );

    let attention: AttentionLabel = "attention/1-agent";
    if (hasUserAttention) attention = "attention/2-user";
    else if (hasOrchestratorAttention) attention = "attention/0-orchestrator";

    let status: "Backlog" | "In progress" | "Review" | "Done" = "Backlog";
    if (raw.state === "closed") {
      status = "Done";
    } else if (labelNames.some((l) => l === "state/2-review" || l === "state/3-verify" || l.startsWith("review/"))) {
      status = "Review";
    } else if (labelNames.some((l) => l === "state/1-wip")) {
      status = "In progress";
    }

    // Detect branch from issue body if referenced
    const branchMatch = (raw.body || "").match(/\b(feat|fix|chore|docs)\/[a-zA-Z0-9_\-\.\/]+\b/);

    return {
      number: raw.number,
      title: raw.title,
      state: raw.state,
      repo: repo.split("/")[1] || repo,
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
    repo,
    issues,
    openCount: openIssues.length,
    inFlightCount: openIssues.filter((i) => i.status === "In progress").length,
    reviewCount: openIssues.filter((i) => i.status === "Review").length,
    needsYouCount: openIssues.filter((i) => i.attention === "attention/2-user").length,
  };
}
