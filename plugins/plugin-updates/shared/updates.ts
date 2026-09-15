import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

export const PluginUpdateStatusSchema = z.enum(["checking", "fresh", "stale", "ahead", "diverged", "error"]);
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
  ahead: z.number().nullable(),
  behind: z.number().nullable(),
  detail: z.string().nullable(),
  sharedRepo: z.boolean().nullable(),
  repoRoot: z.string().nullable().optional(),
  repoPlugins: z.array(z.string()).nullable().optional(),
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

export const pluginUpdatesUpdateRpc = defineContract({
  name: "plugin-updates.update",
  description: "Updates one installed plugin through the Paseo CLI",
  input: z.object({ workspaceId: z.string().optional(), pluginId: z.string() }),
  output: z.object({
    pluginId: z.string(),
    status: z.enum(["updated", "error"]),
    output: z.string().nullable(),
    error: z.string().nullable(),
  }),
});

export const pluginUpdatesUpdateAllRpc = defineContract({
  name: "plugin-updates.update-all",
  description: "Updates all installed plugins through the Paseo CLI",
  input: z.object({ workspaceId: z.string().optional() }),
  output: z.object({
    results: z.array(
      z.object({
        pluginId: z.string(),
        status: z.enum(["updated", "error"]),
        output: z.string().nullable(),
        error: z.string().nullable(),
      }),
    ),
  }),
});

export type PluginUpdateActionResult = {
  pluginId: string;
  status: "updated" | "error";
  output: string | null;
  error: string | null;
};
