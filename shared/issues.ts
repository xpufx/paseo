import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

export const FORGEJO_PLUGIN_ID = "paseo-forgejo";

export const ForgejoIssueSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  labels: z.array(z.string()),
  updatedAt: z.string().optional(),
});
export type ForgejoIssue = z.infer<typeof ForgejoIssueSchema>;

export const OpenIssuesInputSchema = z.object({
  directory: z.string().optional(),
});
export type OpenIssuesInput = z.infer<typeof OpenIssuesInputSchema>;

export const OpenIssuesOutputSchema = z.object({
  repo: z.string().nullable(),
  issues: z.array(ForgejoIssueSchema),
  error: z.string().optional(),
});
export type OpenIssuesOutput = z.infer<typeof OpenIssuesOutputSchema>;

export const openIssuesContract = defineContract({
  name: "forgejo.open-issues",
  description: "List open Forgejo issues for the repo backing a workspace directory",
  input: OpenIssuesInputSchema,
  output: OpenIssuesOutputSchema,
});

export interface ForgejoRemote {
  host: string;
  owner: string;
  repo: string;
}

/**
 * Parse a git remote URL into Forgejo coordinates. Handles
 * git@host:owner/repo(.git), https://host/owner/repo(.git), and
 * ssh://git@host/owner/repo(.git). Returns null when the URL does not
 * carry an owner/repo path.
 */
export function parseForgejoRemote(url: string | undefined | null): ForgejoRemote | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim().replace(/\/+$/, "");
  const scp = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  let host: string | undefined;
  let pathPart: string | undefined;
  if (scp && !trimmed.includes("://")) {
    host = scp[1];
    pathPart = scp[2];
  } else {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `ssh://${trimmed}`;
    try {
      const parsed = new URL(withScheme);
      host = parsed.hostname || undefined;
      pathPart = parsed.pathname.replace(/^\/+/, "") || undefined;
    } catch {
      return null;
    }
  }
  if (!host || !pathPart) return null;
  const segments = pathPart.replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const repo = segments.pop() as string;
  const owner = segments.pop() as string;
  return { host, owner, repo };
}

export interface ForgejoIssueLink {
  host: string;
  owner: string;
  repo: string;
  number: number;
  url: string;
}

const ISSUE_URL_PATTERN =
  /https?:\/\/([^/\s#?]+)\/([^/\s#?]+)\/([^/\s#?]+)\/issues\/(\d+)(?![/\w])/g;

/**
 * Extract issue URLs (host/owner/repo/issues/N) from chat text for the
 * timeline linkifier. Returns one entry per match, in order.
 */
export function extractForgejoIssueUrls(text: string | undefined | null): ForgejoIssueLink[] {
  if (!text || typeof text !== "string") return [];
  const links: ForgejoIssueLink[] = [];
  ISSUE_URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ISSUE_URL_PATTERN.exec(text)) !== null) {
    links.push({
      host: match[1],
      owner: match[2],
      repo: match[3],
      number: Number(match[4]),
      url: match[0],
    });
  }
  return links;
}

/**
 * Pill label for an issue count. Null (unknown) renders a placeholder,
 * never a false zero.
 */
export function formatIssueCountLabel(count: number | null | undefined): string {
  if (count == null) return "issues --";
  return count === 1 ? "1 issue" : `${count} issues`;
}
