# @xpufx/paseo-plugin-ui

Private, in-repo shared UI composition for Paseo plugins (xpufx-org/paseo#976,
option 3). It is a normal workspace **devDependency** that is bundled (inlined)
into each consuming plugin's client bundle at build time — it is never published
to npm, vendored as a source tree, or installed by `paseo plugin add`.

## Contract

- Imports only the host plugin allowlist: `@getpaseo/plugin/client/react-native`,
  `react`, `react-native`. No root provider, no `react-native-svg`, no
  `paseo-plugin-helper` dependency.
- Host-delegating: the host SDK owns the design language (via `Icon`,
  `ScrollView`, `useToast`, `copyText`) and the host `theme` prop is the only
  color source. Components compose plain React Native layout over those tokens.
- Preserves the plugin UI invariants: `HostModalSection` fills the host frame
  (`flex: 1, minHeight: 0`) so a single `HostScroll` owns the scroll
  (xpufx-org/paseo#975, #1049); `HostTabs` wraps instead of competing with the
  host scroller; `HostCollapsible` / `HostVital` stay content-sized
  (xpufx-org/paseo#1009, #1010).

## Usage

```tsx
import { HostThemeProvider, HostCard, HostBadge, HostButton } from "@xpufx/paseo-plugin-ui";

<HostThemeProvider theme={props.theme}>
  <HostCard>
    <HostBadge label="ok" variant="success" />
    <HostButton label="Refresh" onPress={refresh} />
  </HostCard>
</HostThemeProvider>
```

Every registration that renders adapters must sit inside `HostThemeProvider` so
colors come from the host `theme` prop and never from a static fallback.

## Build

```
npm run build     # tsup -> dist/index.{js,cjs,d.ts}
npm run typecheck
```
