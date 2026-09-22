import { z } from "zod";
import { defineContract, defineSettingsContract } from "paseo-plugin-helper/shared";

export const WELLBEING_VERSION = "0.2.1";

export const CircadianWindowSchema = z.object({
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM format required"),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM format required"),
});
export type CircadianWindow = z.infer<typeof CircadianWindowSchema>;

export const WellbeingSettingsSchema = z.object({
  workingHours: CircadianWindowSchema.default({ start: "09:00", end: "18:00" }),
  windDownTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM format required").default("22:30"),
  wakeUpTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM format required").default("07:30"),
  bedMode: z.boolean().default(false),
  maxSessionContinuousMinutes: z.number().int().min(15).max(720).default(180),
  idleTimeoutMinutes: z.number().int().min(1).max(120).default(15),
  fatigueAlertCooldownMinutes: z.number().int().min(5).max(360).default(60),
  notifyVia2fado: z.boolean().default(true),
});
export type WellbeingSettings = z.infer<typeof WellbeingSettingsSchema>;

export const OperatorPhaseSchema = z.enum([
  "working",
  "extended-stretch",
  "wind-down",
  "bed-mode",
  "idle",
]);
export type OperatorPhase = z.infer<typeof OperatorPhaseSchema>;

export const FleetPostureSchema = z.enum([
  "active-focus",
  "extended-stretch",
  "wind-down",
  "bed-mode-custodial",
  "idle-standby",
]);
export type FleetPosture = z.infer<typeof FleetPostureSchema>;

export const ActivitySourceSchema = z.enum([
  "client_surface",
  "client_interaction",
  "interactive_turn",
  "permission_resolved",
  "manual_override",
]);
export type ActivitySource = z.infer<typeof ActivitySourceSchema>;

export const WellbeingStatusSchema = z.object({
  phase: OperatorPhaseSchema,
  fleetPosture: FleetPostureSchema,
  fleetDirective: z.string(),
  isBedMode: z.boolean(),
  activeStretchMinutes: z.number(),
  longestStretchMinutes: z.number(),
  breaksTaken: z.number(),
  idleMinutes: z.number(),
  dailyUsageMinutes: z.number(),
  lastActivityAt: z.string().nullable(),
  lastActivitySource: ActivitySourceSchema.nullable(),
  streakStartedAt: z.string().nullable(),
  fatigueAlertTriggered: z.boolean(),
  fatigueAlertCount: z.number(),
  snoozedUntil: z.string().nullable(),
  settings: WellbeingSettingsSchema,
});
export type WellbeingStatus = z.infer<typeof WellbeingStatusSchema>;

export const wellbeingSettingsContract = defineSettingsContract({
  name: "wellbeing.settings",
  schema: WellbeingSettingsSchema,
  description: "Circadian windows, continuous stretch fatigue limits, and Bed Mode configuration",
});

export const statusRpc = defineContract({
  name: "wellbeing.status",
  description: "Get current operator presence, continuous session metrics, and circadian phase",
  input: z.object({}),
  output: WellbeingStatusSchema,
});

export const toggleBedModeRpc = defineContract({
  name: "wellbeing.toggle_bed_mode",
  description: "Toggle or set Bed Mode posture",
  input: z.object({
    enabled: z.boolean().optional(),
  }),
  output: z.object({
    isBedMode: z.boolean(),
    phase: OperatorPhaseSchema,
    fleetPosture: FleetPostureSchema,
    fleetDirective: z.string(),
  }),
});

export const recordActivityRpc = defineContract({
  name: "wellbeing.record_activity",
  description: "Record human operator or interactive client activity timestamp",
  input: z.object({
    source: ActivitySourceSchema.optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    activeStretchMinutes: z.number(),
    source: ActivitySourceSchema,
  }),
});

export const snoozeAlertRpc = defineContract({
  name: "wellbeing.snooze_alert",
  description: "Snooze fatigue alerts for N minutes",
  input: z.object({
    minutes: z.number().int().min(1).max(180).default(15),
  }),
  output: z.object({
    ok: z.boolean(),
    snoozedUntil: z.string(),
  }),
});
