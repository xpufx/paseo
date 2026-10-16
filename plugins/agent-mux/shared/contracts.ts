import { z } from "zod";
import { defineContract } from "paseo-plugin-helper/shared";

// 1. Status RPC
export const PoolStatusSchema = z
  .object({
    pool: z.string(),
    state: z.string(),
    details: z.string().optional(),
  })
  .strict();

export const ProfileStatusSchema = z
  .object({
    profile: z.string(),
    authenticated: z.boolean(),
    accountIdentity: z.string().optional(),
    pools: z.array(PoolStatusSchema),
    enabled: z.boolean().optional(),
  })
  .strict();

export const ProviderStatusSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    profiles: z.array(ProfileStatusSchema),
  })
  .strict();

export const SystemStatusSchema = z
  .object({
    isolationMode: z.string(),
    bwrapVersion: z.string().optional(),
    profileOverride: z.string().nullable().optional(),
    providers: z.array(ProviderStatusSchema),
    activeCooldownsCount: z.number(),
    quotaHealth: z.enum(["green", "yellow", "red"]),
    rawOutput: z.string().optional(),
  })
  .strict();

export const agentMuxStatusRpc = defineContract({
  name: "agent-mux.status",
  input: z
    .object({
      probe: z.boolean().optional(),
      provider: z.string().optional(),
    })
    .strict()
    .optional(),
  output: SystemStatusSchema,
});

// 2. Profiles RPC
export const ProfileInventoryItemSchema = z
  .object({
    name: z.string(),
    status: z.string(),
    accountIdentity: z.string().optional(),
    registered: z.boolean(),
    directory: z.string(),
    enabled: z.boolean(),
  })
  .strict();

export const ProviderProfilesSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    profiles: z.array(ProfileInventoryItemSchema),
  })
  .strict();

export const ProfilesPayloadSchema = z
  .object({
    isolationMode: z.string(),
    sandboxedWarning: z.boolean(),
    providers: z.array(ProviderProfilesSchema),
  })
  .strict();

export const agentMuxProfilesRpc = defineContract({
  name: "agent-mux.profiles",
  input: z
    .object({
      provider: z.string().optional(),
    })
    .strict()
    .optional(),
  output: ProfilesPayloadSchema,
});

// 3. Cooldowns RPC
export const CooldownItemSchema = z
  .object({
    provider: z.string(),
    profile: z.string(),
    pool: z.string(),
    remainingSeconds: z.number(),
    remainingDisplay: z.string(),
    reason: z.string(),
    resetAt: z.string(),
  })
  .strict();

export const CooldownsPayloadSchema = z
  .object({
    cooldowns: z.array(CooldownItemSchema),
    totalCount: z.number(),
  })
  .strict();

export const agentMuxCooldownsRpc = defineContract({
  name: "agent-mux.cooldowns",
  input: z.object({}).strict().optional(),
  output: CooldownsPayloadSchema,
});

// 4. Logs RPC
export const LogEntrySchema = z
  .object({
    raw: z.string(),
    timestamp: z.string().optional(),
    level: z.string().optional(),
    message: z.string(),
  })
  .strict();

export const LogsPayloadSchema = z
  .object({
    logFile: z.string(),
    entries: z.array(LogEntrySchema),
  })
  .strict();

export const agentMuxLogsRpc = defineContract({
  name: "agent-mux.logs",
  input: z
    .object({
      tail: z.number().optional(),
      filterType: z.string().optional(),
    })
    .strict()
    .optional(),
  output: LogsPayloadSchema,
});

// 5. Config RPC
export const WrapperInfoSchema = z
  .object({
    binaryName: z.string(),
    status: z.enum(["WRAPPED", "UNWRAPPED", "NOT FOUND"]),
    sourcePath: z.string().optional(),
    targetPath: z.string().optional(),
  })
  .strict();

export const ConfigPayloadSchema = z
  .object({
    configFile: z.string(),
    activeSurfaceAccount: z.string(),
    activeRoutingPolicy: z.string(),
    surfaceAccountOverridden: z.boolean(),
    routingPolicyOverridden: z.boolean(),
    settings: z.record(z.string(), z.unknown()),
    wrappers: z.array(WrapperInfoSchema),
  })
  .strict();

export const agentMuxConfigRpc = defineContract({
  name: "agent-mux.config",
  input: z.object({}).strict().optional(),
  output: ConfigPayloadSchema,
});

// 6. Probe RPC
export const ProbeResultSchema = z
  .object({
    profile: z.string(),
    pool: z.string().optional(),
    state: z.string(),
    details: z.string(),
  })
  .strict();

export const ProbePayloadSchema = z
  .object({
    provider: z.string(),
    results: z.array(ProbeResultSchema),
    rawOutput: z.string(),
  })
  .strict();

export const agentMuxProbeRpc = defineContract({
  name: "agent-mux.probe",
  input: z
    .object({
      provider: z.string(),
      profile: z.string().optional(),
      pool: z.string().optional(),
    })
    .strict(),
  output: ProbePayloadSchema,
});

// 7. Toggle Profile RPC
export const agentMuxToggleProfileRpc = defineContract({
  name: "agent-mux.toggle-profile",
  input: z
    .object({
      provider: z.string(),
      profile: z.string(),
      enabled: z.boolean(),
    })
    .strict(),
  output: z
    .object({
      ok: z.boolean(),
      enabled: z.boolean(),
    })
    .strict(),
});

// 8. Clear Cooldown RPC
export const agentMuxClearCooldownRpc = defineContract({
  name: "agent-mux.clear-cooldown",
  input: z
    .object({
      provider: z.string().optional(),
      profile: z.string().optional(),
      pool: z.string().optional(),
    })
    .strict()
    .optional(),
  output: z
    .object({
      ok: z.boolean(),
      message: z.string(),
    })
    .strict(),
});
