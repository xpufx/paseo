import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  type UppidiIssuesInput,
  type UppidiIssuesOutput,
  type UppidiIssue,
  type AttentionLabel,
} from "../shared/contracts.js";

const DEFAULT_HOST = process.env.FORGEJO_HOST || "forge.mrs.uppidi.com";
const DEFAULT_REPO = "xpufx-org/paseo";

async function resolveToken(host: string): Promise<string | null> {
  if (process.env.FORGEJO_TOKEN) return process.env.FORGEJO_TOKEN.trim();
  if (process.env.GITEA_TOKEN) return process.env.GITEA_TOKEN.trim();
  try {
    const teaConfigPath = join(homedir(), ".config", "tea", "config.yml");
    const content = await readFile(teaConfigPath, "utf8");
    const lines = content.split("\n");
    let currentLoginMatches = false;
    for (const line of lines) {
      if (line.includes(host) || line.includes("https://" + host)) {
        currentLoginMatches = true;
      } else if (line.trim().startsWith("- name:")) {
        currentLoginMatches = line.includes(host);
      }
      if (currentLoginMatches && line.trim().startsWith("token:")) {
        const token = line.replace(/.*token:\s*/, "").trim();
        if (token) return token;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export async function handleUppidiIssues(
  input: UppidiIssuesInput,
  _context?: PluginHandlerContext,
): Promise<UppidiIssuesOutput> {
  const repo = input.repo || DEFAULT_REPO;
  const host = DEFAULT_HOST;
  const token = await resolveToken(host);

  const url = `https://${host}/api/v1/repos/${repo}/issues?state=${input.state}&limit=50`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) {
      return {
        ok: false,
        repo,
        issues: [],
        openCount: 0,
        inFlightCount: 0,
        reviewCount: 0,
        needsYouCount: 0,
        error: `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const rawList = (await res.json()) as Array<{
      number: number;
      title: string;
      state: string;
      body?: string;
      comments?: number;
      html_url?: string;
      updated_at?: string;
      labels?: Array<{ name: string }>;
    }>;

    const issues: UppidiIssue[] = rawList.map((raw) => {
      const labelNames = (raw.labels ?? []).map((l) => l.name);

      let attention: AttentionLabel = "attention/1-agent";
      if (labelNames.includes("attention/2-user")) attention = "attention/2-user";
      else if (labelNames.includes("attention/0-orchestrator")) attention = "attention/0-orchestrator";

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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      repo,
      issues: [],
      openCount: 0,
      inFlightCount: 0,
      reviewCount: 0,
      needsYouCount: 0,
      error: msg,
    };
  }
}
