import {
  defineContract,
  defineSettingsContract,
  type RpcOutput,
} from "./vendor/paseo-plugin-helper/index";
import { z } from "zod";

export const DemoSettingsSchema = z.object({
  showCpuUsage: z.boolean().default(true),
  accentPillLabel: z.string().default("demo"),
  pollingRate: z.enum(["1s", "2s", "5s", "paused"]).default("2s"),
  navigationStyle: z.enum(["tabs", "dropdown"]).default("dropdown"),
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
  name: "helper-demo-v8.settings",
  schema: DemoSettingsSchema,
  description: "Showcase demo settings",
});

export const getDemoDataRpc = defineContract({
  name: "helper-demo-v8.get-data",
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
  name: "helper-demo-v8.trigger-action",
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

export const demoAgentIdentityContract = defineContract({
  name: "helper-demo-v8.agent-identity",
  description: "Get active agent identity and session for self-inspection",
  input: z.object({}),
  output: z.object({
    identity: z
      .object({
        id: z.string().optional(),
        name: z.string().optional(),
        model: z.string().optional(),
        provider: z.string().optional(),
        repo: z.string().optional(),
        branch: z.string().optional(),
        envelopeText: z.string().optional(),
      })
      .nullable(),
  }),
});

export type DemoAgentIdentity = RpcOutput<typeof demoAgentIdentityContract>;

export const demoBeaconSetContract = defineContract({
  name: "helper-demo-v8.beacon-set",
  description: "Set workspace status beacon label on the active workspace",
  input: z.object({
    workspaceId: z.string().min(1),
    name: z.string().default("DEMO:ACTIVE"),
    color: z.string().default("sky"),
  }),
  output: z.object({
    success: z.boolean(),
    message: z.string(),
    labelApplied: z.boolean(),
    titleApplied: z.boolean(),
  }),
});

export const demoBeaconBlinkContract = defineContract({
  name: "helper-demo-v8.beacon-blink",
  description: "Blink workspace beacon between emerald and orange states",
  input: z.object({
    workspaceId: z.string().min(1),
    rounds: z.number().int().positive().default(5),
  }),
  output: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
});

export const demoBeaconClearContract = defineContract({
  name: "helper-demo-v8.beacon-clear",
  description: "Clear workspace beacon label and restore original title",
  input: z.object({
    workspaceId: z.string().min(1),
    name: z.string().default("DEMO:ACTIVE"),
  }),
  output: z.object({
    success: z.boolean(),
    message: z.string(),
    labelCleared: z.boolean(),
    titleRestored: z.boolean(),
  }),
});
