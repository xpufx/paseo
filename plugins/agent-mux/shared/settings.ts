import { z } from "zod";
import { defineSettingsContract } from "paseo-plugin-helper/shared";
import type { PluginSettingsValues } from "./types.js";

export const agentMuxSettingsSchema = z
  .object({
    autoRefreshInterval: z.number().int().min(0).max(300).default(10),
    logTailDepth: z.number().int().min(5).max(500).default(50),
    autoProbeOnLoad: z.boolean().default(false),
    showLiveCountdown: z.boolean().default(true),
  })
  .strict();

export const agentMuxSettings = defineSettingsContract<PluginSettingsValues>({
  name: "agent-mux.settings",
  schema: agentMuxSettingsSchema,
  defaultData: {
    autoRefreshInterval: 10,
    logTailDepth: 50,
    autoProbeOnLoad: false,
    showLiveCountdown: true,
  },
  description: "Agent Mux Plugin Settings",
});
