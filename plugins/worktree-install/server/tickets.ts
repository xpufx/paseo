import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  AttentionLabel,
  Ticket,
  TicketBoardOutput,
  TicketStatus,
} from "../shared/contracts.js";

/**
 * Board access. The host and repo are operator-configured (`FORGEJO_HOST`,
 * `FORGEJO_REPO`) rather than compiled in, so the plugin is not welded to one
 * board.
 */
const DEFAULT_HOST = process.env.FORGEJO_HOST || "forge.mrs.uppidi.com";
const DEFAULT_REPO = process.env.FORGEJO_REPO || "xpufx-org/paseo";

/**
 * Token resolution, in order: an explicit env token, then the `tea` CLI config
 * for this host. A board with no token still serves public issues.
 */
export async function resolveToken(host: string): Promise<string | null> {
  const explicit = process.env.FORGEJO_TOKEN?.trim() || process.env.GITEA_TOKEN?.trim();
  if (explicit) return explicit;
  try {
    const content = await readFile(join(homedir(), ".config", "tea", "config.yml"), "utf8");
    let inHostBlock = false;
    for (const line of content.split("\n")) {
      if (line.includes(host)) inHostBlock = true;
      else if (line.trim().startsWith("- name:")) inHostBlock = false;
      if (inHostBlock && line.trim().startsWith("token:")) {
        const token = line.replace(/.*token:\s*/, "").trim();
        if (token) return token;
      }
    }
  } catch {
    // No tea config: the board may still be public.
  }
  return null;
}

/** Operator attention, plus the two legacy spellings that mean the same thing. */
export function deriveAttention(labelNames: string[]): AttentionLabel {
  const normalized = labelNames.map((l) => l.trim().toLowerCase());
  if (normalized.some((l) => l === "attention/2-user" || l === "attention/user" || l === "attention:user")) {
    return "attention/2-user";
  }
  if (
    normalized.some(
      (l) => l === "attention/0-orchestrator" || l === "attention/orchestrator" || l === "attention:orchestrator",
    )
  ) {
    return "attention/0-orchestrator";
  }
  return "attention/1-agent";
}

export function deriveStatus(state: string, labelNames: string[]): TicketStatus {
  if (state === "closed") return "Done";
  if (
    labelNames.some(
      (l) => l === "state/2-review" || l === "state/3-verify" || l.startsWith("review/"),
    )
  ) {
    return "Review";
  }
  if (labelNames.some((l) => l === "state/1-wip")) return "In progress";
  return "Backlog";
}

const BRANCH_PATTERN = /\b(feat|fix|chore|docs)\/[a-zA-Z0-9_\-./]+\b/;

/** The dispatched worktree branch, when the ticket body names one. */
export function deriveBranch(body?: string): string | undefined {
  return body?.match(BRANCH_PATTERN)?.[0];
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  body?: string;
  comments?: number;
  html_url?: string;
  updated_at?: string;
  labels?: Array<{ name: string }>;
}

export function normalizeIssue(raw: RawIssue, repo: string): Ticket {
  const labelNames = (raw.labels ?? []).map((l) => l.name);
  return {
    number: raw.number,
    title: raw.title,
    state: raw.state,
    repo: repo.split("/").pop() || repo,
    status: deriveStatus(raw.state, labelNames),
    attention: deriveAttention(labelNames),
    branch: deriveBranch(raw.body),
    comments: raw.comments ?? 0,
    labels: labelNames,
    url: raw.html_url,
    updatedAt: raw.updated_at,
  };
}

export async function readTickets(input: {
  host?: string;
  repo?: string;
  state?: "open" | "closed" | "all";
}): Promise<TicketBoardOutput> {
  const host = input.host || DEFAULT_HOST;
  const repo = input.repo || DEFAULT_REPO;
  const state = input.state ?? "open";
  const fail = (error: string): TicketBoardOutput => ({
    ok: false,
    repo,
    tickets: [],
    openCount: 0,
    inFlightCount: 0,
    reviewCount: 0,
    needsYouCount: 0,
    error,
  });

  const url = `https://${host}/api/v1/repos/${repo}/issues?state=${state}&limit=50`;
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = await resolveToken(host);
  if (token) headers.Authorization = `token ${token}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return fail(`HTTP ${res.status}: ${res.statusText}`);

    const raw = (await res.json()) as RawIssue[];
    const list = Array.isArray(raw) ? raw : [];
    // The issues endpoint returns pull requests too; a ticket list without PRs
    // in it is a ticket list nobody can triage.
    const tickets = list.filter((i) => i && typeof i.number === "number" && !("pull_request" in i)).map((i) =>
      normalizeIssue(i, repo),
    );
    const open = tickets.filter((t) => t.state === "open");
    return {
      ok: true,
      repo,
      tickets,
      openCount: open.length,
      inFlightCount: open.filter((t) => t.status === "In progress").length,
      reviewCount: open.filter((t) => t.status === "Review").length,
      needsYouCount: open.filter((t) => t.attention === "attention/2-user").length,
    };
  } catch (err: unknown) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

export async function handleTickets(
  input: { host?: string; repo?: string; state?: "open" | "closed" | "all" },
  _context?: PluginHandlerContext,
): Promise<TicketBoardOutput> {
  return readTickets(input);
}
