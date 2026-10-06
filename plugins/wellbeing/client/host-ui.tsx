/**
 * Thin re-export of the shared plugin UI composition
 * (`@xpufx/paseo-plugin-ui`, xpufx-org/paseo#976).
 *
 * The wellbeing surface only ever used this subset of the kit, so the local
 * copy is replaced by the canonical shared implementation. Call sites keep
 * importing `./host-ui.js`; the raw `Pressable` / `StyleSheet` seam now lives
 * in the bundled package, so this plugin needs no `no-bespoke-*` exemption.
 */
export { HostButton, HostProgressBar, HostRow, HostStack } from "@xpufx/paseo-plugin-ui";

export type {
  HostButtonProps,
  HostButtonSize,
  HostButtonVariant,
  HostProgressBarProps,
  HostRowProps,
  HostStackProps,
} from "@xpufx/paseo-plugin-ui";
