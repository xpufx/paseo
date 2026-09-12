import { z } from "zod";
import { defineSettingsContract } from "./settings.js";

export const SuiteSettingsSchema = z.object({
  suiteTitle: z.string().default("xpufx Suite"),
  accentColor: z.string().default("#6366f1"),
  density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  showSuiteTabs: z.boolean().default(true),
});

export type SuiteSettings = z.infer<typeof SuiteSettingsSchema>;

export const SuiteSettingsContract = defineSettingsContract({
  name: "xpufx.suite.settings",
  schema: SuiteSettingsSchema,
  description: "Shared xpufx suite settings",
});
