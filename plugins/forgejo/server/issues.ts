import { safeSpawn, createPluginLogger } from "paseo-plugin-helper/server";
import {
  ForgejoIssueSchema,
  openIssuesContract,
  parseForgejoRemote,
  type OpenIssuesInput,
  type OpenIssuesOutput,
} from "../shared/issues.js";
import type { RpcOutput } from "paseo-plugin-helper/shared";

const log = createPluginLogger("paseo-forgejo");

type OpenIssuesResult = RpcOutput<typeof openIssuesContract>;

async function spawnText(command: string, args: string[]): Promise<string | null> {
  try {
    const result = await safeSpawn(command, args, { timeoutMs: 15000 });
    if (result.code !== 0) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function resolveRepo(directory?: string): Promise<{ host: string; repo: string } | null> {
  if (!directory) return null;
  const remoteUrl = await spawnText("git", ["-C", directory, "remote", "get-url", "origin"]);
  if (!remoteUrl) return null;
  const parsed = parseForgejoRemote(remoteUrl);
  if (!parsed) return null;
  return { host: parsed.host, repo: `${parsed.owner}/${parsed.repo}` };
}

async function listIssuesJson(
  runner: string,
  repo: string,
  host: string,
): Promise<unknown[] | null> {
  const raw = await spawnText(runner, ["issue", "list", "-R", repo, "--hostname", host, "--json"]);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toIssueRefs(rows: unknown[]): OpenIssuesResult["issues"] {
  const issues: OpenIssuesResult["issues"] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const labels = Array.isArray(record.labels)
      ? (record.labels as unknown[])
          .map((entry) =>
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>).name
              : entry,
          )
          .filter((name): name is string => typeof name === "string")
      : [];
    const candidate = {
      number: record.number,
      title: record.title,
      state: record.state,
      labels,
      updatedAt: typeof record.updated_at === "string" ? record.updated_at : undefined,
    };
    const parsed = ForgejoIssueSchema.safeParse(candidate);
    if (parsed.success) issues.push(parsed.data);
  }
  return issues;
}

/**
 * List open Forgejo issues for the repo backing a workspace directory.
 * Resolves owner/repo from the directory's git origin remote, shells out to
 * fgjx (falling back to fgj), and never throws: failures surface as an
 * error field so the pill renders a placeholder instead of breaking.
 */
export async function handleOpenIssues(input: OpenIssuesInput): Promise<OpenIssuesOutput> {
  const resolved = await resolveRepo(input?.directory);
  if (!resolved) {
    return {
      repo: null,
      issues: [],
      error: "No Forgejo repo found for this workspace",
    };
  }
  const { host, repo } = resolved;
  let rows = await listIssuesJson("fgjx", repo, host);
  if (!rows) rows = await listIssuesJson("fgj", repo, host);
  if (!rows) {
    log.warn("issue list failed", { repo, host });
    return { repo, issues: [], error: "Issue list unavailable" };
  }
  const issues = toIssueRefs(rows).filter((issue) => issue.state === "open");
  return { repo, issues };
}
