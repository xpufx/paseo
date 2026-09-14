import {
  defineContract,
  defineSettingsContract,
  type RpcOutput,
} from "paseo-plugin-helper/shared";
import { z } from "zod";

export const DemoSettingsSchema = z.object({
  showCpuUsage: z.boolean().default(true),
  accentPillLabel: z.string().default("demo"),
  pollingRate: z.enum(["1s", "2s", "5s", "paused"]).default("2s"),
  highCpuThreshold: z.number().default(80),
  // Visual Flair Customization Studio (Persisted)
  flairRadius: z.enum(["sharp", "rounded", "pill"]).default("rounded"),
  flairDensity: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  flairSurface: z.enum(["flat", "tinted", "elevated"]).default("flat"),
  flairBorderWidth: z.number().default(1),
  flairUppercase: z.boolean().default(false),
  flairAccentColor: z.string().default("#6366f1"),
});

export type DemoSettings = z.infer<typeof DemoSettingsSchema>;

export const demoSettingsContract = defineSettingsContract({
  name: "helper-demo.settings",
  schema: DemoSettingsSchema,
  description: "Showcase demo settings",
});

export const getDemoDataRpc = defineContract({
  name: "helper-demo.get-data",
  description: "Get comprehensive demo metrics, hardware stats, and service items",
  input: z.object({}),
  output: z.object({
    version: z.string(),
    hostname: z.string(),
    platform: z.string(),
    cpuModel: z.string(),
    cpuUsagePercent: z.number(),
    memoryUsedPercent: z.number(),
    memoryUsedBytes: z.number(),
    memoryTotalBytes: z.number(),
    loadAvg: z.array(z.number()),
    uptimeSeconds: z.number(),
    daemonPort: z.number(),
    backgroundTicks: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        category: z.string(),
        status: z.enum(["running", "idle", "syncing", "warning"]),
        loadPercent: z.number(),
      })
    ),
  }),
});

export const triggerDemoActionRpc = defineContract({
  name: "helper-demo.trigger-action",
  description: "Trigger an RPC action on the daemon",
  input: z.object({
    actionName: z.string(),
  }),
  output: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
});

export type DemoData = RpcOutput<typeof getDemoDataRpc>;
