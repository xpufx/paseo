import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

export const PluginUpdateStatusSchema = z.enum([
  "checking",
  "current",
  "behind",
  "pinned",
  "unpinned",
  "no-upstream",
  "not-a-repo",
  "orphaned",
  "error",
]);
export type PluginUpdateStatus = z.infer<typeof PluginUpdateStatusSchema>;

export const RefKindSchema = z.enum(["branch", "tag", "sha", "detached"]);
export type RefKind = z.infer<typeof RefKindSchema>;

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
