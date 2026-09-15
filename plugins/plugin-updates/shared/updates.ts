import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

export const PluginUpdateStatusSchema = z.enum([
  "checking",
  "current",
  "behind",
  "not-a-repo",
  "unpinned",
  "no-upstream",
  "orphaned",
  "error",
]);
export type PluginUpdateStatus = z.infer<typeof PluginUpdateStatusSchema>;

export const PluginUpdateSchema = z.object({
  id: z.string(),
  path: z.string(),
  remote: z.string().nullable(),
  branch: z.string().nullable(),
  localCommit: z.string().nullable(),
  remoteCommit: z.string().nullable(),
  status: PluginUpdateStatusSchema,
  error: z.string().nullable(),
  detail: z.string().nullable(),
  sharedRepo: z.boolean().nullable(),
  repoRoot: z.string().nullable().optional(),
  repoPlugins: z.array(z.string()).nullable().optional(),
  source: z.string().nullable().optional(),
});
export type PluginUpdate = z.infer<typeof PluginUpdateSchema>;

export const pluginUpdatesCheckRpc = defineContract({
  name: "plugin-updates.check",
  description: "Checks installed plugin git remotes for available updates",
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
