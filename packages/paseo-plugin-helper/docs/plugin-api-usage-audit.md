# Plugin API Usage Audit

> **Ticket:** [xpufx-org/paseo#1057](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1057)
> (umbrella: [#1043](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1043) deterministic
> UI guard, [#976](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/976) shared UI package,
> [#847](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/847) helper).
> **Status:** docs-only audit. No code changed, so there are no tests to run. Every
> claim below is a reading of source; nothing was executed against a running daemon.

This audit inventories the documented Paseo plugin reference surface, maps what the
`plugins/*` suite actually uses, names the first concrete gap (typed theme colors), and
shapes the follow-up checklist. It deliberately separates **verified in code** from
**could not verify**.

## 0. Method, sources, and what could not be verified

**Sources**

- The live reference was reachable. `curl https://paseo.sh/docs/plugins/reference` returned
  HTTP 200, and the page advertises an alternate markdown endpoint. I read
  `https://paseo.sh/docs/plugins/reference.md` (132 KB, 2452 lines) fetched 2026-10-06.
  Section anchors below are from that document.
- Installed SDK types:
  - `@getpaseo/plugin@0.11.0-beta.5` at
    `/usr/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/plugin` — the host the
    reference documents.
  - `@getpaseo/plugin@0.9.0-beta.2` at `<repo>/node_modules/@getpaseo/plugin`
    — the range the plugins declare (`^0.9.0`), read from the primary checkout.
- Repo docs: `docs/plugin/*.md`, `packages/paseo-plugin-helper/docs/*.md`,
  `packages/paseo-plugin-ui-testing/src/ui-guard.ts`, and the per-plugin
  `conformance.json` / `paseo-plugin.json`.
- Static scan: `rg` over `plugins/*/index.client.tsx`, `plugins/*/index.server.ts`,
  `plugins/<p>/client/**`, `plugins/<p>/server/**`, excluding `**/vendor/**`,
  `*.test.*`, `**/testing/**`, and markdown.

**Could not verify (explicit)**

- **No `node_modules` in this worktree**, so I could not run `npm run typecheck`, the
  conformance scanner, or any render test. Everything here is static source reading, not a
  green build.
- The SDK type evidence comes from the system-installed 0.11 host and a sibling 0.9
  checkout, not from a resolved install in this repo. The plugin declarations (`^0.9.0`,
  `^0.11.0-beta.3`) are the authority for the intended target.
- Runtime behavior of the deprecated `addSurface` / `addSidebarItem` / `openSurface`
  aliases on a current daemon was not exercised; the 0.11 `.d.ts` marks them `@deprecated`
  but still declares them, which is all I can prove.
- The raw-color scan is regex-based. It cannot prove a literal actually paints (many are
  `fallback || literal` guards) and it would miss computed or named colors. I found no
  quoted `"white"`/`"black"`/`"red"` literals in the scanned client code.
- `plugins/uppidi-forge` is a **symlink** to `plugins/uppidi-fleet` (`git ls-files -s`
  records mode `120000`), not a second plugin. The suite is 13 real plugins.
- `paseo.sh/docs/plugins/reference` has no per-version tabs; the fetched reference is the
  current one. Version-gating statements below come from diffing the two SDK `.d.ts` trees.

---

## 1. The documented reference surface

Source: `https://paseo.sh/docs/plugins/reference.md`. This is the inventory the issue asks
for; it is not a restatement of every table, only the contribution surface the suite can
consume.

### 1.1 Runtime entries and module layout

| Entry | Runtime | Receives | Doc |
| --- | --- | --- | --- |
| `index.client.tsx` | Paseo app, per client | `PluginClientContext` | §Runtime entries |
| `index.server.ts` | Daemon subprocess | `PluginServerContext` | §Runtime entries |

Client modules: `@getpaseo/plugin` (shared data, `defineRpc`, `defineSettings`,
`defineAttachmentSource`, `RpcInput`/`RpcOutput`), `@getpaseo/plugin/client` (contexts,
`usePaseo`, `useRpc`, `useSettings`, data hooks), `@getpaseo/plugin/client/react-native`
(host UI primitives), `@getpaseo/plugin/client/ui` (named settings components), plus
`react`, `react-native`, `@tanstack/react-query`, `zod`. Server modules:
`@getpaseo/plugin/server`, `/server/provider`, `/server/usage`, `/server/acp`.
`/client/host` is private to the host.

### 1.2 Client registrations

| Registration | Shape | Returns |
| --- | --- | --- |
| `addScreen({ id, title, Component })` | full-page plugin screen; `title` may be a params function | remover |
| `addSidebarHeaderItem({ id, title, Component })` | sidebar header row | remover |
| `addSidebarFooterItem({ id, title, Component })` | sidebar footer row | remover |
| `addWorkspacePanel({ id, title, icon, context, locations?, Component })` | workspace/agent tab panel | remover |
| `addCommandCenterItem({ id, title, icon, keywords?, context, onSelect })` | ⌘K action | remover |
| `addSlashCommand({ name, description, argumentHint, context, onSubmit })` | composer `/command` | remover |
| `addHeaderButton({ id, workspaceId, button })` | workspace header button | `{ update, remove }` |
| `addComposerPill({ id, workspaceId, agentId, button })` | per-agent composer pill | `{ update, remove }` |
| `addSettingsScreen({ id, title, icon, Component })` | Settings → Plugins page | remover |
| `addTheme({ id, name, appearance, colors })` | light/dark appearance theme | remover |
| `addTimelineTransformer(contribution)` / `addTimelineRenderer(contribution)` | transform/replace timeline rows | remover |
| `addAttachmentSource(contribution)` | composer attachment search source | remover |

Deprecated aliases still declared by 0.11: `addSurface(id, Component)` (“Use `addScreen`”),
`addSidebarItem(contribution)` (“Use `addSidebarHeaderItem`”), `openSurface(id)` (“Use
`openScreen`”). `PluginSidebarContribution` is deprecated in favor of
`PluginSidebarItemContribution`.

### 1.3 Client navigation

- `PluginScreenProps.navigation`, `PluginSidebarItemProps`, and panel props carry
  `navigation?: { openAgent({agentId, serverId?}), openWorkspace({workspaceId, serverId?}),
  openBrowser({url, workspaceId, serverId?}) }`. `openBrowser` is Electron-only and
  `undefined` on web/iOS/Android. All three exist in the 0.9 SDK too.
- Sidebar items carry `currentScreen`, `openScreen({screenId, params?})`, and
  `openPopover(Content)`. Popovers anchor on wide layouts, bottom-sheet on compact.
- Command callbacks carry `openScreen`, `openSettings`, `openPanel(id, {location?})`;
  header/pill buttons and settings screens carry placement-specific `openPanel`.

### 1.4 Theme and layout

- Every surface receives `theme: PluginTheme` (typed `colors.*`) and
  `layout: { compact, platform }`. The reference is explicit: “Color and spacing must come
  from those props. Hardcoded colors and unstyled `Text` break when the host theme
  changes.” Tokens: `foreground`, `foregroundMuted`, `surface0/1/2`, `border`, `accent`,
  `accentForeground`, `statusSuccess/Warning/Danger`. Recreate styles when `theme` or
  `layout.compact` changes.
- `addTheme` contributes a *host* theme (raw hex is correct there); it is not a way for a
  plugin to paint its own surfaces.

### 1.5 Lifecycle (server)

- Events: `agent.created`, `agent.closed`, `agent.turn_started`, `agent.turn_ended`,
  `agent.permission_requested`, `agent.permission_resolved`, `agent.archived`,
  `workspace.created`, `workspace.archived`.
- Before hooks: `agent.create`, `agent.session_open`, `workspace.create`.
- `server.handle(contract, handler)` for RPC; `server.registerSettings(defineSettings(...))`
  for host-persisted settings + `useSettings`; `server.registerProvider` for providers;
  `server.registerUsageSource` (0.11) for quota sources.
- Plugin timeline append: `paseo.agents.ref(id).timeline.append({ type: "plugin", id, kind,
  version, data })`.

### 1.6 Host UI primitives

`@getpaseo/plugin/client/react-native`: `Icon`, `Modal`/`Modal.Content`, `ScrollView`,
`FlatList`, `TextInput`, `useToast`, `copyText`, `useRevealedText`, and `playAudio`
(0.11). `@getpaseo/plugin/client/ui`: `ExternalLink` plus
`SettingsGroup/Section/Card/Row/Switch/Select/Input/Action`. `useHosts()` /
`getPaseoClient(serverId)` (0.9+) for multi-host.

---

## 2. Per-plugin usage matrix

Legend — **U** = used; **H** = used through `paseo-plugin-helper`; **—** = not used. Only
documented reference capabilities are listed. Citations are file:line in this worktree.

### 2.1 Registration and navigation

| Plugin | screen/sidebar | panel | cmd-center | slash | header/pill | settings | theme | timeline | attach | nav.open* |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| demo | — | — | — | — | H pill `client/pill.tsx:981` | — (server settings, §2.2) | — | — | — | — |
| forges | — | H `index.client.tsx:87` | — | — | H pill `:76` | — | — | U `:47-55` | — | — |
| mcp-tools | — | — | U `client/commands.ts:99` | U `:26` | H pill `client/pill.tsx:793` | — | — | U `client/timeline.tsx:96,114,120,126` | — | — |
| permission-logger | H sidebar `index.client.tsx:28` | — | — | — | — | — | — | — | — | — |
| plugin-updates | — | — | — | — | U header `client/updates.tsx:487` | — | — | — | — | — |
| slash | H sidebar `index.client.tsx:15` | — | H `:21` | U `client/commands.ts:80,94,106` | — | — | — | U `client/timeline.tsx:35` | — | — |
| top | H sidebar `client/pill.tsx:1893` | U `index.client.tsx:47` | U `:54` | — | H pill `client/pill.tsx:360` | — | — | U `index.client.tsx:34` | — | — |
| twofado | H sidebar `index.client.tsx:36` | — | U `:42` | — | U header `:55` | H `:25` | — | — | — | — |
| uppidi-fleet | H sidebar `index.client.tsx:52`; U `addSidebarHeaderItem`+`addScreen` `:31-46` | U `:59` | — | — | — | H `:68` | — | — | — | U `client/tree-view.tsx:150`; `client/agent-switcher.tsx:311` |
| wellbeing | H sidebar `index.client.tsx:28` | — | — | — | — | U `server/settings.ts:186` | — | — | — | — |
| worktree-install | **legacy** `addSidebarItem`+`addSurface` `index.client.tsx:27-28` | U `:34` | — | — | — | — | own palette `client/theme.ts` | — | — | U `client/fleet-view.tsx:240,532,739,755,852,922` |
| x-comms | H sidebar `index.client.tsx:31` | U `:20` | — | — | U header `:38`; H pill `client/x-comms-pill.tsx:163` | — | — | U `:15-19` | — | — |
| antigravity-claude | server-only provider | — | — | — | — | — | — | — | — | — |

### 2.2 Server lifecycle, settings, providers, timeline append

| Plugin | `server.on` events | `server.before` | `registerSettings` | `registerProvider` | `registerUsageSource` | `timeline.append` |
| --- | --- | --- | --- | --- | --- | --- |
| antigravity-claude | — | — | — | U `index.server.ts:5` | — | — |
| demo | — | — | U `server/server-settings.ts:133` (via `index.server.ts:32`) | — | — | — |
| forges | — | — | — | — | — | — |
| mcp-tools | — | U `index.server.ts:30` (`agent.create`) | — | — | — | U `server/mcp.ts:216` |
| permission-logger | — | — | — | — | — | — |
| plugin-updates | — | — | — | — | — | — |
| slash | — | — | — | — | — | U `client/commands.ts:121,142` |
| top | `agent.turn_started` `:96`, `agent.created` `:125`, `agent.turn_ended` `:229` | — | — | — | — | U `index.server.ts:204` |
| twofado | — | — | — | — | — | — |
| uppidi-fleet | `hook-router.ts:7399` (capability probe only) | — | — | — | — | — |
| wellbeing | `agent.turn_ended` `:57`, `agent.permission_resolved` `:66` | — | U `server/settings.ts:186` | — | — | — |
| worktree-install | — | — | — | — | — | — |
| x-comms | `agent.created` `:75`, `agent.archived` `:79`, `agent.turn_started` `:87`, `agent.turn_ended` `:91` | U `server/recipient-instructions.ts:82` (`agent.create`) | — | — | — | U `server/handlers.ts:1290,1445` |

### 2.3 What the matrix says

- **Every plugin that registers a sidebar surface except `worktree-install` does so
  through the helper's `registerSidebarSurface`, which registers with the *deprecated*
  API.** See §4 G1. `worktree-install` calls the deprecated
  `addSurface`/`addSidebarItem` directly (`index.client.tsx:27-28`).
- `uppidi-fleet` is the only plugin that feature-detects and uses the documented
  `addScreen`/`addSidebarHeaderItem` (`index.client.tsx:31-46`); the guard means those
  registrations silently disappear on hosts that lack them.
- `navigation.openAgent`/`openWorkspace` are used by exactly two plugins
  (`worktree-install`, `uppidi-fleet`); `openBrowser` by none.
- `addAttachmentSource` and `addTheme` have **zero** users. `useHosts`/`getPaseoClient`
  is used by `top` (`client/multi-host.ts`, feature-detected) and by `x-comms`
  (`client/x-comms-conversation.tsx:1,106,179`, **not** feature-detected).
- Server settings are split: `demo`/`wellbeing` use the documented
  `defineSettings`/`registerSettings`/`useSettings`, while `top`/`forges`/`mcp-tools`/
  `slash`/`twofado`/`uppidi-fleet` persist through the helper's bespoke
  settings-contract + `PluginStorage` RPC (`packages/paseo-plugin-helper/src/shared/settings.ts`,
  `.../server/settings.ts`, `.../core/settings.ts`).

---

## 3. First concrete gap: typed theme colors

### 3.1 The guard is real but its coverage is narrow

`packages/paseo-plugin-ui-testing/src/ui-guard.ts` implements the #1043
`colorsOutsidePalette(root, palette)` invariant: it walks the render tree, collects every
painted color, and flags anything not in the supplied host palette (palette tokens with an
appended alpha nibble are accepted; `transparent`/`none`/… are escaped).

Only **two** test files instantiate it with a palette:

- `plugins/top/client/ui-guard.test.tsx:133` (`palette: PALETTE`, light tokens) for the
  top telemetry card.
- `plugins/worktree-install/client/ui-guard.test.ts:81` (`palette: PALETTES.dark`) for the
  four worktree-install surfaces.

`plugins/uppidi-fleet/client/ui-guard.test.ts` calls `checkInvariants` **without**
`palette`, so it never runs `colorsOutsidePalette` at all. `forges`, `mcp-tools`,
`twofado`, `plugin-updates`, `x-comms`, `wellbeing`, `demo`, `slash`, `permission-logger`
have no render-guard palette pass. There is also **no static conformance rule** for color
literals — `packages/paseo-plugin-helper/src/cli/rules.ts` has no `no-raw-color` entry, so
`make conformance` cannot see them either. So the gap is not only “some literals exist”;
it is “the invariant that would catch them is not pointed at most of the suite”.

### 3.2 Violators (raw color literals in shipped client code)

`#ffffff` is a value no host `ThemeColors` token is guaranteed to contain; the others are
static palette copies. Cited lines, all in non-vendor, non-test client code:

| # | Site | Literal(s) | Should come from | Severity |
| --- | --- | --- | --- | --- |
| T1 | `plugins/uppidi-fleet/shared/sort-filter.ts:16-18` (`STATUS_LIGHT_GREEN/ORANGE/RED`) | `#10b981`, `#f59e0b`, `#ef4444` | `theme.colors.statusSuccess/Warning/Danger` via `useFleetTheme()` | **high** — unconditional, painted by every `AgentStatusLight` / tree row, and its own guard test skips the palette |
| T2 | `plugins/twofado/client/approvals.tsx:471,711,848`; `plugins/twofado/client/ask.tsx:219` | `#ffffff` icon color on status/accent fills | `theme.colors.accentForeground`, or a contrast helper over `statusDanger`/`statusWarning` | **high** — icons on colored fills render white text in every theme |
| T3 | `plugins/wellbeing/client/surface.tsx:134-135` | `text: "#ffffff"` for `statusSuccess`/`statusWarning` badges | `accentForeground` / `getContrastColor` | medium |
| T4 | `plugins/wellbeing/client/surface.tsx:358` | `borderColor: "rgba(128,128,128,0.2)"` | `alpha(colors.border, 0.2)` | medium |
| T5 | `plugins/uppidi-fleet/client/tree-view.tsx:205,1799,1801,199-200,2039` (and the older `#000` shadow at `:205`) | `#000`, `rgba(255,255,255,0.04)`, `rgba(128,128,128,0.06)`, `#1e293b`, `#334155` fallbacks | `colors.surface*`/`border`/`alpha(...)`; drop the fallbacks once the host token is required | medium |
| T6 | `plugins/forges/client/host-ui.tsx:62,278,364` | `FALLBACK_ACCENT_FOREGROUND = "#ffffff"` | `colors.accentForeground` (fallback only) | low-medium |
| T7 | `plugins/plugin-updates/client/updates.tsx:221,223,238,240,242,243` | `#ef4444`, `#f59e0b`, `#22c55e` status fallbacks | `theme.colors.status*` (fallback only) | low |
| T8 | `plugins/top/client/host-ui.tsx:119-129`; `plugins/x-comms/client/host-ui.tsx:1479-1489`; `packages/paseo-plugin-helper/src/lifecycle/host-theme.tsx:55-67` | full 11-token dark fallback palettes | the host `theme` prop; keep at most one shared fallback in the helper | low — only paints when a provider is missing |
| T9 | `plugins/x-comms/client/host-ui.tsx:1748`; `plugins/x-comms/client/x-comms-conversation.tsx:427` | `shadowColor: "#000"` | host shadow/overlay token if one exists; otherwise document as an allowed constant | low |
| T10 | `plugins/worktree-install/client/theme.ts:61-92` | two complete 13-token local palettes | host `PluginTheme.colors` | **by design** — see below |

**T10 assessment: acceptable, but it must be an explicit exemption.** The #1043 census
and `conformance.json` already record that `worktree-install` exists to prove the shared
kit is not mandatory (xpufx-org/paseo#629) and that it “deliberately composes its UI
without the shared kit; its two palettes are the module-local literals the guard allows”.
That is a documented decision, not a bug. The gap is that a *typed-theme* rule would flag
it, so the rule needs a named exemption for “plugin ships its own appearance layer” rather
than silently failing or being bypassed. `plugins/worktree-install/client/theme.ts:9-13`
uses `paletteFor(background)` derived from the host background, so it is host-aware even
though it is not token-typed.

**Fallbacks vs unconditional literals.** T1-T4 paint unconditionally. T5-T9 only paint
when the host omits a token (`colors.border || "#334155"`) or when no theme provider is
mounted (T8). A render-guard pass with a *complete* palette would not catch a fallback on
a host that supplies every token; catching it requires rendering with a sentinel or
partial palette, which is exactly the second half of the `colorsOutsidePalette` doc
comment (“Pair it with a second render under a sentinel palette”).

### 3.3 What a typed-theme rule should assert

1. **Render-level:** every surface that takes a `theme` prop is run through
   `checkInvariants(..., { palette })` — start with `uppidi-fleet` (drop the
   palette-less call), then `forges`, `twofado`, `wellbeing`, `plugin-updates`, `x-comms`.
2. **Static:** a conformance rule `no-raw-color-literal` that flags quoted `#rgb[a]` /
   `rgb[a](...)` in `client/` outside `addTheme` contributions and outside a named
   “own appearance layer” exemption.
3. **Sentinel render:** a second palette render per surface (e.g. all tokens sentinel)
   so `theme.colors.x || "#fallback"` is caught even when the host supplies the token.

---

## 4. Other gaps and their assessment

| # | Gap | Evidence | Assessment |
| --- | --- | --- | --- |
| G1 | **The suite uses the deprecated screen/sidebar API.** `registerSidebarSurface` calls `plugin.addSurface(id, …)` + `plugin.addSidebarItem({surface:id})` (`packages/paseo-plugin-helper/src/lifecycle/surface.tsx:117-118`); the 0.11 `.d.ts` marks both `@deprecated` (“Use `addScreen`” / “Use `addSidebarHeaderItem`”). `openSurface` is deprecated too and is used by `slash/index.client.tsx`, `twofado/index.client.tsx:57`, `x-comms` (via buttons). The documented `addScreen` / `addSidebarHeaderItem` / `addSidebarFooterItem` / `openScreen` are unused by every plugin except `uppidi-fleet`'s feature-detected header item. | **real gap, highest leverage after theme.** The helper is the one chokepoint: migrating it to the documented API (with feature detection for pre-0.10 hosts) upgrades all sidebar surfaces at once. Blocked only by the helper's `peerDependencies` (`>=0.9.0`) and the plugins' `^0.9.0` SDK range. |
| G2 | **Host settings are bypassed by the helper settings layer.** The helper persists settings as its own `get/update/reset` RPCs over `PluginStorage` (`shared/settings.ts`, `server/settings.ts`), so `top`/`forges`/`mcp-tools`/`slash`/`twofado`/`uppidi-fleet` get no host revision-conflict handling, cross-client sync, or `useSettings` state; only `demo`/`wellbeing` use `defineSettings`/`registerSettings`. | **real gap, medium.** The host settings contract exists in 0.9, so this is adoption, not an upstream dependency. Migration is per-plugin but mechanical; the helper could offer a compatibility shim. |
| G3 | **`addAttachmentSource` unused.** Zero registrations or `defineAttachmentSource` calls; `rg` over `plugins/` returns none. The reference documents it and #1052 just shipped the *consumer* side (fleet envelope text attachment). | **real gap, low/optional.** Only worth building if a plugin actually has a searchable external resource. Otherwise N/A. |
| G4 | **`addTheme` unused.** No plugin contributes a host appearance theme. | **acceptable.** The suite paints on the host theme (T1-T9 aside); contributing a theme is a product choice, not a requirement. Record as “not applicable today”. |
| G5 | **`navigation.openAgent`/`openWorkspace` barely used; `openBrowser` unused.** `worktree-install/client/fleet-view.tsx` and `uppidi-fleet/client/tree-view.tsx:150`, `client/surface.tsx:1562`, `client/agent-switcher.tsx:311` use `openAgent`; nothing uses `openWorkspace` or `openBrowser`. Cross-host targeting (`serverId`) is unused except `top`'s `getPaseoClient` adapter. | **mixed.** Real gap where a surface lists agents/workspaces (fleet, worktree-install, x-comms conversations) but falls back to `window.open`/`Linking` (`tree-view.tsx:162-172`). Acceptable where a deep link is the intent. `openBrowser` is Electron-only, so N/A on mobile/web. |
| G6 | **`useHosts`/`getPaseoClient` underused and inconsistently guarded.** `top/client/multi-host.ts:25-42` feature-detects them against the mobile bundle gap; `x-comms/client/x-comms-conversation.tsx:1,106,179` imports and calls them directly, with no `multiHostSupported()` guard. | **real gap, medium/high.** The x-comms call is the exact #1043 fleet-view crash class (`useHosts is not a function` on a mobile bundle that omits the primitives). A shared, feature-detected multi-host hook in the helper would fix x-comms and remove top's per-plugin fork. |
| G7 | **Host UI primitives vs bespoke RN.** Every plugin keeps a local `client/host-ui.tsx`; `conformance.json` exemptions across `demo`, `forges`, `mcp-tools`, `plugin-updates`, `slash`, `top`, `twofado`, `uppidi-fleet`, `wellbeing`, `x-comms`, `worktree-install` record the same reason (#937/#924/#629). | **accepted by policy; drift risk.** The reference says to use the host `react-native`/`ui` primitives. The exemptions are documented and reviewed, but there are now 10 UI plugins each carrying a divergent copy of `Card/Badge/Button/alpha/getStatusColor` (`plugins/*/client/host-ui.tsx`; `uppidi-forge` is a symlink, not an 11th). The #976 shared-UI package is the consolidation path; flag as a follow-up, not a defect. |
| G8 | **`openPopover` used once** (`uppidi-fleet` agent switcher). | **acceptable.** Most sidebar items are single-purpose. |
| G9 | **`playAudio` / `ExternalLink` / `openExternalUrl` unused.** | **N/A / acceptable.** No plugin has audio or external-link needs. |
| G10 | **Server lifecycle coverage is shallow.** The suite touches 6 of 9 events and 2 of 3 before-hooks; `workspace.created`/`archived`, `agent.closed`, `agent.permission_requested`, `agent.session_open`, `workspace.create` are unused. | **acceptable.** Hooks are demand-driven; `wellbeing`/`x-comms`/`top` use the ones their domain needs. The reference lists 11 hooks via the `lifecycle-logger` example; absence is not a defect. |
| G11 | **`addSidebarFooterItem` unused.** All sidebar rows are header rows, and they use the deprecated item shape. | folds into G1. |
| G12 | **Timeline transformers/renderers and `timeline.append` are used and current** (forges, mcp-tools, slash, top, x-comms; append in top/mcp-tools/slash/x-comms). | **no gap.** This is the suite’s most complete corner of the reference. |
| G13 | **Raw `client.rpc` fallback** in `forges/index.client.tsx:59` and `slash/client/commands.ts:49,114` instead of typed `useRpc`. | **acceptable-but-brittle.** It is a deliberate degradation for hosts that omit `client.rpc`; it uses `as never` casts, so a contract drift would not typecheck-fail. Low priority. |

---

## 5. Dispatchable follow-up checklist

Ordered by leverage. Each item is independently assignable; none requires a decision from
the operator before a worker can start, except where noted.

- [ ] **#1057-A (theme renders):** add `palette` to `plugins/uppidi-fleet/client/ui-guard.test.ts`
  so `colorsOutsidePalette` actually runs, and add a render-guard palette pass for
  `forges`, `twofado`, `wellbeing`, `plugin-updates`, `x-comms`. Failing-first on the T1
  status-light trio. *Acceptance:* guard red before, green after.
- [ ] **#1057-B (theme fixes):** replace T1-T4 with host tokens/contrast helpers; convert
  the T5-T9 `|| "#fallback"` guards to a single documented fallback owned by the helper, or
  to a sentinel-tested fallback. *Depends on A for the red→green evidence.*
- [ ] **#1057-C (static rule):** add a `no-raw-color-literal` conformance rule to
  `packages/paseo-plugin-helper/src/cli/rules.ts` + scanner, with an exemption shape for
  `worktree-install`’s own appearance layer (T10) and for `addTheme` contributions.
  Document it in `packages/paseo-plugin-helper/docs/cli.md`.
- [ ] **#1057-D (sentinel palette):** extend the render guard design
  (`packages/paseo-plugin-helper/docs/ui-regression-guard.md`) with the second
  sentinel-palette render so `theme.colors.x || "#fallback"` is caught.
- [ ] **#1057-E (deprecated API):** migrate `registerSidebarSurface` callers
  (all sidebar surfaces) and the helper’s `openSurface` users to
  `addScreen` + `addSidebarHeaderItem` + `openScreen`, behind feature detection for hosts
  older than the rename; then raise the helper `peerDependencies` floor and the plugins’
  `@getpaseo/plugin` range. *Highest structural leverage; touches every plugin.*
- [ ] **#1057-F (host settings):** decide and record whether the helper settings layer
  moves onto `defineSettings`/`registerSettings`/`useSettings` (`top`, `forges`,
  `mcp-tools`, `slash`, `twofado`, `uppidi-fleet`), or whether the bespoke layer is the
  supported path. If the former, add a helper compatibility shim and migrate one plugin as
  the pilot.
- [ ] **#1057-G (multi-host):** extract `top`’s feature-detected `useHosts`/`getPaseoClient`
  adapter into `paseo-plugin-helper`, and route `x-comms/client/x-comms-conversation.tsx`
  through it — its direct `useHosts()` call is the #1043 mobile-crash class unguarded.
- [ ] **#1057-H (navigation):** where a surface already lists agents/workspaces
  (`uppidi-fleet`, `worktree-install`, x-comms), prefer `navigation.openAgent`/
  `openWorkspace` over the `window.open`/`Linking` fallback when the prop is present.
- [ ] **#1057-I (shared UI):** feed the G7 divergence (10 local `host-ui.tsx` copies) into
  #976 as candidate consolidations; do not block this ticket on it.
- [ ] **#1057-J (attachment/theme):** record `addAttachmentSource` and `addTheme` as
  intentionally unused in this doc; reopen only when a plugin has a real source/theme.

---

## 6. Summary

The suite is strongest on timeline items, composer pills, command center, header buttons,
and RPC — those map cleanly onto the reference. The two structural gaps are (1) the
deprecated screen/sidebar registration path that the helper drives for every plugin, and
(2) typed theme colors, where the #1043 `colorsOutsidePalette` invariant exists but is
pointed at only two surfaces and has no static counterpart. The rest of the reference
(attachments, themes, multi-host, navigation, provider/usage sources) is either used,
partially used with a documented reason, or genuinely not applicable. No code changed in
this ticket; follow-ups are dispatched from §5.
