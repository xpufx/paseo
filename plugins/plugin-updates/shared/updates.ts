import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

export const PluginUpdateStatusSchema = z.enum([
  "checking",
  "current",
  "behind",
  "pinned",
  "unpinned",
  "no-upstream",
  "missing",
  "not-a-repo",
  "orphaned",
  "error",
]);
export type PluginUpdateStatus = z.infer<typeof PluginUpdateStatusSchema>;

export const RefKindSchema = z.enum(["branch", "tag", "sha", "detached"]);
export type RefKind = z.infer<typeof RefKindSchema>;

// One short-hash length for every git id rendered in the row UI (and in detail
// strings): full 40-char ids are wasted width and cannot clash with peers in
// the same repo.
export const SHORT_HASH_LENGTH = 10;

export function shortHash(value: string | null | undefined): string {
  return value ? value.slice(0, SHORT_HASH_LENGTH) : "unknown";
}

export const PluginUpdateChangeSchema = z.object({
  commit: z.string(),
  date: z.string().nullable(),
  subject: z.string().nullable(),
});
export type PluginUpdateChange = z.infer<typeof PluginUpdateChangeSchema>;

export const PluginUpdateSchema = z.object({
  id: z.string(),
  path: z.string(),
  source: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  repoRoot: z.string().nullable(),
  subdir: z.string().nullable(),
  ref: z.string().nullable(),
  refKind: RefKindSchema.nullable(),
  remote: z.string().nullable(),
  localCommit: z.string().nullable(),
  remoteCommit: z.string().nullable(),
  localTree: z.string().nullable(),
  remoteTree: z.string().nullable(),
  workingTree: z.string().nullable(),
  dirty: z.boolean().nullable(),
  updateAvailable: z.boolean(),
  status: PluginUpdateStatusSchema,
  error: z.string().nullable(),
  detail: z.string().nullable(),
  latestChange: PluginUpdateChangeSchema.nullable(),
});
export type PluginUpdate = z.infer<typeof PluginUpdateSchema>;

// ---------------------------------------------------------------------------
// Source URL derivation (pure, forge-agnostic)
// ---------------------------------------------------------------------------

/**
 * Converts any git remote or package URL form into a browsable `https://` base:
 *
 * - `ssh://git@host[:port]/owner/repo.git` → `https://host/owner/repo`
 * - `git@host:owner/repo.git` (scp-like)   → `https://host/owner/repo`
 * - `https://` / `http://` / `git://`      → `https://` with `.git` stripped
 *
 * Userinfo and port are dropped (never part of a browse URL), duplicate slashes
 * are collapsed, a trailing `.git` and trailing slash are removed. Returns
 * `null` when the input cannot yield an `owner/repo` browse URL.
 */
export function normalizeRepoUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let hostAndPath: string;
  const match = trimmed.match(/^[a-z][a-z0-9+.-]*:\/\/(.+)$/i);
  if (match) {
    // Strip `user[:pass]@` before splitting host from path so a colon inside
    // credentials is never mistaken for a port.
    const authorityPath = match[1]!.replace(/^[^@/]*@/, "");
    const slash = authorityPath.indexOf("/");
    if (slash <= 0) return null;
    const host = authorityPath.slice(0, slash).replace(/:\d+$/, "");
    if (!host) return null;
    hostAndPath = `${host}/${authorityPath.slice(slash + 1)}`;
  } else {
    const scp = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
    if (!scp?.[1] || !scp[2]) return null;
    hostAndPath = `${scp[1]}/${scp[2]}`;
  }

  const cleaned = hostAndPath
    .replace(/\.git$/i, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "");
  if (!cleaned.includes("/")) return null;
  return `https://${cleaned}`;
}

// Browse deep-link shape by host: GitHub scopes a path with `/tree/<ref>`,
// while Forgejo/Gitea (and the generic fallback) use `/src/branch/<ref>`.
function deepLink(base: string, ref: string, subdir: string): string {
  let host = "";
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return base;
  }
  const prefix = host === "github.com" ? "tree" : "src/branch";
  const refPath = ref.split("/").map(encodeURIComponent).join("/");
  const subdirPath = subdir.split("/").map(encodeURIComponent).join("/");
  return `${base}/${prefix}/${refPath}/${subdirPath}`;
}

export interface SourceUrlInput {
  repositoryUrl?: string | null;
  homepage?: string | null;
  remoteUrl?: string | null;
  ref?: string | null;
  subdir?: string | null;
}

/**
 * Resolves the plugin's browse URL, preferring `package.json` metadata
 * (`repository.url`, then `homepage`) over the resolved git remote.
 *
 * `subdir` is the plugin's path relative to the checked-out repository root, so
 * it is only meaningful for that repository's browse URL: deep-linking it onto
 * a different repo (e.g. a plugin whose `package.json` points at its own
 * standalone upstream) would 404. When a resolved remote is known and the
 * chosen URL points elsewhere, the repo root is used instead. `null` when
 * nothing yields a URL.
 */
export function deriveSourceUrl(input: SourceUrlInput): string | null {
  const remote = normalizeRepoUrl(input.remoteUrl);
  const base = normalizeRepoUrl(input.repositoryUrl) ?? normalizeRepoUrl(input.homepage) ?? remote;
  if (!base) return null;
  const subdir = input.subdir?.replace(/^\/+|\/+$/g, "") ?? "";
  const ref = input.ref?.trim() ?? "";
  if (!subdir || !ref) return base;
  if (remote && remote !== base) return base;
  return deepLink(base, ref, subdir);
}

export const pluginUpdatesCheckRpc = defineContract({
  name: "plugin-updates.check",
  description: "Checks installed plugins for per-subdirectory git updates",
  input: z.object({ workspaceId: z.string().optional() }),
  output: z.object({
    checkedAt: z.string(),
    plugins: z.array(PluginUpdateSchema),
  }),
});

export const PluginUpdateActionSchema = z.object({
  pluginId: z.string(),
  status: z.enum(["updated", "error"]),
  output: z.string().nullable(),
  error: z.string().nullable(),
  requiresForce: z.boolean().optional(),
});
export type PluginUpdateActionResult = z.infer<typeof PluginUpdateActionSchema>;

export const pluginUpdatesUpdateRpc = defineContract({
  name: "plugin-updates.update",
  description: "Pulls and reloads one installed plugin in place",
  input: z.object({
    workspaceId: z.string().optional(),
    pluginId: z.string(),
    force: z.boolean().optional(),
  }),
  output: PluginUpdateActionSchema,
});

export const pluginUpdatesUpdateAllRpc = defineContract({
  name: "plugin-updates.update-all",
  description: "Pulls and reloads every installed plugin with a remote update",
  input: z.object({
    workspaceId: z.string().optional(),
    force: z.boolean().optional(),
  }),
  output: z.object({
    results: z.array(PluginUpdateActionSchema),
  }),
});
