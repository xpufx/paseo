import { createSharedPluginSettings } from "paseo-plugin-helper/server";
import {
  SuiteSettingsContract,
  SuiteSettingsSchema,
  type SuiteSettings,
} from "paseo-plugin-helper/shared";
import { log } from "./demo.js";

export const suiteSettings = createSharedPluginSettings<SuiteSettings>({
  suite: "xpufx-suite",
  schema: SuiteSettingsSchema,
  contract: SuiteSettingsContract,
  description: "Shared xpufx suite settings (demo plugin side)",
});

export const suiteSettingsHandlers = suiteSettings.createHandlers({
  onUpdate: (next) => {
    log.info("Shared suite settings updated via demo plugin:", next);
  },
  onReset: () => {
    log.info("Shared suite settings reset via demo plugin");
  },
});
