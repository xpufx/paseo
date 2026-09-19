/**
 * Paseo Plugin Helper — Settings UI adapters.
 *
 * These re-export the bundle-driven settings renderer from `client/`, whose
 * entire contract is already upstream-shaped: the caller passes the host's
 * native `@getpaseo/plugin/client/ui` primitives
 * (`SettingsSection`, `SettingsCard`, `SettingsSwitch`, `SettingsSelect`,
 * `SettingsInput`) as the `ui` bundle, and the helper only maps a zod
 * settings contract to fields — no bespoke switches, rows, or cards.
 *
 * ```tsx
 * import * as UpstreamUi from "@getpaseo/plugin/client/ui";
 * registerHelperSettingsScreen(client, contract, { ui: UpstreamUi });
 * ```
 */

export {
  contractSchemaToFields,
  registerHelperSettingsScreen,
} from "../client/settings-screen.js";
export type {
  HelperSettingsUiBundle,
  HelperSettingsCardProps,
  HelperSettingsSectionProps,
  HelperSettingsRowBaseProps,
  HelperSettingsSwitchProps,
  HelperSettingsSelectProps,
  HelperSettingsInputProps,
  HelperSettingsSelectComponent,
  HelperSettingsScreenContribution,
  HelperSettingsScreenRegistrar,
  HelperSettingsFieldKind,
  HelperSettingsField,
  HelperSettingsFieldOverrides,
  RegisterHelperSettingsScreenOptions,
} from "../client/settings-screen.js";
