# UI Regression Guard — Inventory, Canonical Remedies, and Deterministic Tests

> **Status:** design / decision doc (docs-only). Implements nothing.
> **Ticket:** [xpufx-org/paseo#1043](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1043) — umbrella.
> **Scope:** the recurring classes of plugin-UI regressions, the canonical
> paseo-standard fix for each, and the deterministic tests that make the
> invariant fail in CI instead of in the operator's hand.
> **Audience:** whoever implements the checklist in §6; reviewers deciding
> whether the guard is sufficient.

---

## 0. The failure mode this has to end

The operator's words on #1043: *"We tried to have a unified helper library …
and that failed terribly … Agents kept ignoring and making their own local
implementations anyway."* That is the actual root cause, and it is not a
component library problem. It is an **enforcement** problem:

- We fix a UI defect **per surface** (`plugins/top` pill modal scroll, `plugins/uppidi-fleet`
  switcher scroll, `plugins/worktree-install` mobile layout) and never encode
  the invariant that made it a defect. So the next surface, or the next
  migration, regresses the same class.
- The one mechanism that could have enforced a shared kit — the
  `paseo-plugin-helper` conformance audit — only knows a handful of
  `no-bespoke-*` rules. Worse, every plugin **exempts the exact file where the
  layout/theme seam lives** (`client/host-ui.tsx`), so the audit is blind to the
  code that actually breaks.
- Render-level tests exist, but they are **per-plugin, hand-rolled, and
  duplicated** (`flex-measure.ts` is copied verbatim between
  `plugins/uppidi-fleet` and `plugins/worktree-install`), so a new plugin starts
  from zero and the class is only caught where someone already wrote a test.

The fix is therefore two independent layers, both required:

1. **A shared render-level harness** that makes the four invariants (containment,
   host-theme colors, single scroll owner, truncation) a property of *every*
   surface at compact + wide with no per-plugin layout code.
2. **New static conformance rules** for the cases a render pass cannot decide
   statically, plus a hard rule that the audit must not be declared clean by
   exempting the theme/layout seam.

The shared UI package decision on [#976](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/976)
(option 3: a private, in-repo, bundled package) is the **right destination**,
but it is `dep/blocked` and it is not what makes regressions stop. Enforcement
is. Do the guard first or alongside; it is what makes a second shared library
survivable.

---

## 1. Inventory of recurring regression classes

Each class below names the real regressions, the tickets, and the files where
the defect lived. "Recurring" is measured by the number of tickets in the class,
not by severity.

### 1.1 Class A — children escaping / growing their container (flex containment)

The most repeated class in the repo. React Native's Yoga (and
react-native-web) differs from CSS in the one way that matters here:
**`flexShrink` defaults to `0`**, so a chip/row/text refuses to shrink and
pushes its row past the viewport. `minWidth` floors and `width: "100%"` children
inside a row make it worse.

| Ticket | Surface / file | Symptom | Root cause |
| --- | --- | --- | --- |
| [#621](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/621) | `plugins/uppidi-fleet` (`client/surface.tsx`, tree rows) | "overlapping fields" on a phone | unbounded chips with `flexShrink:0`; `minWidth` floors |
| [#641](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/641) | `plugins/uppidi-fleet` Work Queue modal | content clipped at one x-edge | helper `ModalBody size="large"` hard `minWidth: 640` |
| [#684](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/684) | `plugins/worktree-install` all four surfaces | "disaster on mobile" | unbounded stats rows; 99-char note without a line cap |
| [#189](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/189) | `plugins/forges` labels | one chip per line, not wrapping | chips sized to full scoped name; no `flexShrink`/`maxWidth` |
| [#1009](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1009) + [#1010](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1010) | `plugins/top/client/host-ui.tsx` `HostCollapsible` | title column squeezed, timestamp wraps under it | `headerRight` rendered as a direct row child; `HostRow` carries `width:"100%"` |

Key code evidence:

- `plugins/top/client/host-ui.tsx:1612-1613` —
  `fluid: { width: "100%" }`, `modalSection: { flex: 1, minHeight: 0, width: "100%" }`.
- `plugins/top/client/pill.tsx` `mcpInfo: { flex: 1 }` — a `flex:1` child with no
  `minWidth: 0` is the canonical "grows past its parent" shape.
- `plugins/worktree-install/client/testing/flex-measure.ts` documents the exact
  Yoga semantics the guard models: `flexShrink` defaults to 0, `flex:1` is
  `flexBasis:0` floored by `minWidth`, `numberOfLines` is the only escape hatch
  that lets text compress.

### 1.2 Class B — surfaces that ignore light/dark (theme fallback)

The host passes a resolved `theme` to every registration. The recurring defect
is a surface that never receives it (or reads a second, separate theme context),
so it silently falls back to a **static dark palette**.

| Ticket | Surface / file | Symptom | Root cause |
| --- | --- | --- | --- |
| [#923](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/923) | `plugins/top` pill/modal | paints dark on a light desktop | `useHostTheme()` returned `FALLBACK_COLORS` because no `HostThemeProvider` wrapped the registered subtree |
| [#1009](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1009) | `packages/permission-audit/src/client.tsx` | filter tabs dark on a light host | own `ColorsContext` seeded with static dark fallback; `top` passed `theme` nowhere |
| [#893](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/893) (rework) | `plugins/uppidi-fleet` agent switcher | brief **dark flash** before light | raw `addHeaderButton` popover never wrapped in `HostThemeProvider` |
| [#867](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/867) | surfaces/panels/pills | same class, pre-#923 | registration wrappers mounted only the legacy provider |

The mechanism is silent by construction: the fallback is a *valid-looking* dark
palette, so "wrong theme" produces no error and no conformance finding. Fix
history: #941 wrapped every helper registrar in `HostThemeProvider`; after the
helper `ui/` retirement each plugin re-implemented the provider **locally**
(`plugins/top/client/host-ui.tsx:117-157` `FALLBACK_COLORS` + `ThemeContext`), so
the class can reappear anywhere a new registration is added raw.

### 1.3 Class C — scroll not working / nested scroll / no scroll owner

The host bounds the modal frame; exactly one component must own the scroll
gesture. Zero owners = content clipped and unreachable. Two owners = the
x-comms "double-scroll freeze".

| Ticket | Surface / file | Symptom | Root cause |
| --- | --- | --- | --- |
| [#975](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/975) (and predecessors [#477](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/477), [#480](https://forge.mrs.uppidi.com/xpufx-org/paseo/pulls/480)) | `plugins/top/client/host-ui.tsx` `HostModalSection` | pill modal content does not scroll | section sized to its content; inner `HostScroll` never got a viewport. Fixed with `flex:1, minHeight:0` |
| [#893](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/893) (first rework, [#944](https://forge.mrs.uppidi.com/xpufx-org/paseo/pulls/944)) | `plugins/uppidi-fleet` `AgentSwitcherPopover` | **two scroll bars** in one dropdown | plugin `ScrollView` nested inside the host popover scroller |
| [#684](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/684) / [#688](https://forge.mrs.uppidi.com/xpufx-org/paseo/pulls/688) | `plugins/worktree-install` four surfaces | content below the fold simply gone | surface was `flex:1` inside `flex:1` with no scroller; host wraps no part of a surface |
| [#326](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/326) class | x-comms family | gesture lock / freeze | two scrollers fighting the pan recognizer |

Precedents for the fix: `plugins/top/client/pill-modal-scroll.test.tsx` asserts
**exactly one** `host-scroll-view` inside a fully flex-bounded ancestor chain;
`plugins/worktree-install/client/mobile-scroll.test.ts` asserts one plugin
scroller per surface and `flex:1, minHeight:0` on it.

### 1.4 Class D — long lines that do not wrap / no middle-ellipsis

Long identifiers, paths, SHAs, and model names are unbounded strings. Without a
line cap they demand their intrinsic width; with the wrong cap they wrap into
noise or lose the discriminating tail.

| Ticket | Surface / file | Symptom | Canonical fix |
| --- | --- | --- | --- |
| [#189](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/189) | `plugins/forges` labels | chips not wrapping | `flexShrink:1, maxWidth:"100%"` + `truncate` value half |
| [#684](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/684) | `plugins/worktree-install` ticket note | 99-char note is one 395px line | `numberOfLines` |
| [#162](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/162), [#72](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/72), [#8](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/8) | forges pill, CommandBox, x-comms bodies | tail truncation loses the identifier tail | `truncateMiddle` for ids/SHAs/keys |

Canonical primitives:

- **Tail ellipsis, layout-level:** `<Text numberOfLines={1}>` (and
  `ellipsizeMode`), which `flex-measure.ts` treats as the only compressible-text
  case.
- **Middle ellipsis, string-level:** `truncateMiddle(text, maxLength)` and
  `truncate`, `truncatePath` in
  `packages/paseo-plugin-helper/src/shared/formatters.ts:190-257` (exported via
  `paseo-plugin-helper/shared`). `plugins/x-comms/client/host-ui.tsx` is the
  reference implementation of `truncate: "middle" | "end" | "path"`.

### 1.5 Class E — the top telemetry card overflow/density regression (#1010)

Not its own invariant: it is Class A + Class D on one surface, and it is worth
naming because it shows *why* classes must be enforced as classes. The
helper-UI migration moved the whole vitals grid inside the collapse toggle
(collapsed went empty) and the (now full-width) chips were one per line.

- References: [#1010](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1010);
  fix PRs [#1023](https://forge.mrs.uppidi.com/xpufx-org/paseo/pulls/1023) (header
  containment) and [#1037](https://forge.mrs.uppidi.com/xpufx-org/paseo/pulls/1037)
  (density).
- Guard precedent: `plugins/top/client/telemetry-layout.test.tsx` asserts ≥6
  chips carry `maxWidth:110`, `flexGrow:1`, **not** `width:"100%"`, and live
  inside a `flexWrap:"wrap"` row. This is the shape the shared harness should
  generalise (see §5.2).

### 1.6 Class F — the MCP hang (reported, not yet filed)

The operator, on #1043: *"now MCP is broken. Actually top does scroll but is also
broken. It hangs. Might be the frequent logs."* There is **no dedicated ticket**
in the tracker as of this writing; this is captured from the #1043 body only.
What is knowable without guessing:

- The top pill modal's MCP card renders under the `mcp` tab
  (`plugins/top/client/pill.tsx` around the `MCP Servers Card`, ~line 1260) and
  is fed by `useTopResourceQuery` at `defaultRate: "5s"`
  (`plugins/top/client/resources-query.ts`). The MCP *servers* data comes from
  `paseo-mcp-tools` (`plugins/mcp-tools`), whose UI hook `useMcpQuery`
  (`plugins/mcp-tools/client/mcp-query.tsx`) sets `staleTime: 0`,
  `refetchOnMount: "always"`, and a health poll up to `30s`.
- "Hangs" is a **behavioural/perf** symptom. Whether it is a render loop, a
  query storm, or an expensive synchronous `paseo-mcp-tools` health probe is
  not yet established and **the guard cannot decide it** (§7). It must be
  reproduced against the live daemon before any code changes.
- Guardable *predecessor* property: the MCP list is long and unbounded, so it is
  exactly a Class A/D surface. The render sweep must include the `mcp` tab and
  the MCP server rows once the hang is triaged.

### 1.7 Class G — "works on web, not mobile" (platform-derived signals)

[#684](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/684): `worktree-install`
derived `isMobile` and touch targets from `layout.platform` rather than the
host-reported `layout.width`, so a 390px browser window rendered as desktop.
[#629](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/629) is the same
signal. The canonical rule is: **responsive decisions read `layout.compact` /
`layout.width`, never `Platform.OS` alone**; native platforms are mobile at any
width. This is deterministic to test (mount at widths 320/390/430/web) and is
already precedent in `plugins/worktree-install/client/mobile-layout.test.ts`.

---

## 2. Canonical paseo-standard remedy per class

Grounded in the installed host SDK (`@getpaseo/plugin*`), the helper
conformance rules (`packages/paseo-plugin-helper/src/cli/rules.ts`), the
migration contract (`packages/paseo-plugin-helper/docs/client-migration.md`),
and the UI guide (`docs/plugin/ui/*`).

### 2.1 One composition layer, two seams

- **Host primitives are the only UI imports:** `Modal` (+`Modal.Content`),
  `ScrollView`, `FlatList`, `TextInput`, `Icon`, `copyText`, `useToast` from
  `@getpaseo/plugin/client/react-native`; settings primitives from
  `/client/ui`.
- **Host `theme` is the only color source.** In the post-#937 world each plugin
  owns a local `client/host-ui.tsx` that carries the host colors through a
  provider (`HostThemeProvider` → `useHostTheme`). Every registration that
  renders adapters **must** be inside that provider. This is the one file
  allowed to contain the static dark `FALLBACK_COLORS`; nothing else may name a
  color.
- The failed shared library (#847/#976) does not change these seams; the shared
  package, when it lands, only changes where the adapters are imported from.

### 2.2 Per class

| Class | Canonical remedy | Enforced by |
| --- | --- | --- |
| A. containment | Flex children: `minWidth: 0` (and/or `flexShrink: 1`) on the shrinking child; never `width:"100%"` on a child of a multi-child row; bound text with `numberOfLines`; `flexWrap:"wrap"` for chip rows; no `minWidth` floors on fluid surfaces | render harness `findHorizontalOverflows`; static `no-hardcoded-modal-dimensions` (exists) |
| B. theming | Read `theme.colors.*` only; every registration wraps adapters in `HostThemeProvider theme={props.theme}`; never render an adapter outside a provider | render harness sentinel-palette assertion; **no conformance exemption may cover the theme seam** |
| C. scroll | Exactly one scroll owner per surface. Pill `renderModal` → `HostModalSection` (`flex:1, minHeight:0`) + one `HostScroll`. Own host modal → `HostModalContent` / `Modal.Content scrollable`; never add a second. Host-supplied popover/sheet scroller → render none | render harness `scrollContainers` count + bounded-ancestor assertion; static `no-host-scroll-hijack` (exists) |
| D. long lines | `numberOfLines` on every unbounded `<Text>`; `truncateMiddle`/`truncatePath` for ids/SHAs/paths/model names; `flexShrink:1, maxWidth:"100%"` for chips | render harness text-cap assertion + static `no-raw-color`-style literal lint for `truncateMiddle` on known long fields |
| E. density (#1010) | Keep information visible in the collapsed state; packing rows must be `flexWrap:"wrap"` with bounded chips (`maxWidth`, `flexGrow:1`) | telemetry test pattern generalised into the harness |
| F. MCP hang | Triage first (live); then apply C + A + D to the MCP card/list. Do not "fix" a hang with a layout change before reproducing it | not yet guardable; see §7 |
| G. platform signals | `layout.compact`/`layout.width` from the host; native platforms force compact | width sweep at 320/390/430 + platform sweep, already in `worktree-install` |

### 2.3 The five static rules the ticket asks for — what is actually implementable

The ticket asks to extend the audit with: *no raw color literals, no
`width:100%` where it breaks, single scroller, truncation required on long text,
no unbounded flex.* Be honest about which of these a line scanner can decide
without false positives:

| Asked-for rule | Static verdict | Why |
| --- | --- | --- |
| no raw color literals | **feasible, add it** | a hex/`rgba(`/named color in `client/**` outside the designated theme module is unambiguous |
| no `width:100%` where it breaks | **render-only** | "where it breaks" is contextual: `width:"100%"` is correct outside rows. The scanner sees styles in `StyleSheet.create`, not the JSX parent/child shape. The render harness decides it |
| single scroller | **render-only** | ownership depends on registration/runtime (host popover vs plugin scroller), not on file text. The harness counts them |
| truncation required on long text | **render-only + narrow static heuristic** | whether text *needs* truncation depends on measured width vs container; the harness knows. Static can additionally flag `truncateMiddle`/`numberOfLines` absence on a small allowlist of id/path fields |
| no unbounded flex | **render-only** | same reason as `width:100%`: a `flex:1` without `minWidth:0` is only wrong when it has content that cannot shrink |

The design therefore puts **one** new static rule (`no-raw-color-literal`) and
carries the other four in the **render harness**, where they are decidable. The
doc is explicit about this so nobody ships a noisy regex guard and then exempts
it.

---

## 3. What exists today (so the guard reuses, not reinvents)

| Asset | Location | Reuse |
| --- | --- | --- |
| Static audit scanner + rules | `packages/paseo-plugin-helper/src/cli/scanner.ts`, `rules.ts`; CLI `packages/paseo-plugin-helper/bin/paseo-plugin-helper.js` | extend `AUDIT_RULES` + `UI_CONFORMANCE_RULES` |
| Conformance subcommand / per-rule exemptions | `src/cli/conformance.ts`, `conformance-exemptions.ts`, `plugins/*/conformance.json` | keep per-rule + mandatory reason; add new UI rule ids |
| CI gate | `Makefile` `conformance` → `... conformance --all plugins --strict`; `.forgejo/workflows/test-suites.yml` runs `npm test` then `make conformance` | new rules ride the existing gate |
| Yoga-shaped horizontal overflow solver | `plugins/worktree-install/client/testing/flex-measure.ts` (copied from `plugins/uppidi-fleet`) | extract to shared |
| Scroll-container + height-clamp solver | `plugins/worktree-install/client/testing/scroll-measure.ts` | extract to shared |
| Host stubs + render helper | `plugins/worktree-install/client/testing/host.tsx` | extract to shared |
| Surface registry fixture pattern | `plugins/worktree-install/client/testing/fixtures.ts`, `plugins/uppidi-fleet/client/testing/*` | generalise into a per-plugin fixture contract |
| Top/telemetry + modal tests | `plugins/top/client/{telemetry-layout,pill-modal-scroll,theme-mode,host-collapsible}.test.tsx` | port onto the shared harness; keep as surface-specific cases |

`flex-measure.ts` already says out loud that a cross-plugin import is not
available and invites extraction (*"Keep the two copies in step, or move this
somewhere both can legitimately reach."*). That is the green light for §5.2.

---

## 4. Guard architecture

```
                         ┌─────────────────────────────────────────┐
  make conformance  ───▶ │ packages/paseo-plugin-helper            │
                         │   src/cli/rules.ts    (new static rules) │
                         │   src/cli/scanner.ts  (detect literals)  │
                         └─────────────────────────────────────────┘
                         ┌─────────────────────────────────────────┐
  npm test (per plugin) ▶ │ packages/paseo-plugin-ui-testing (NEW)  │
  ui-guard.test.ts       │   host stubs (react-native resolve hook) │
                         │   renderInSkin()                         │
                         │   findHorizontalOverflows()              │
                         │   scrollContainers() / heightClamps()    │
                         │   collectTextLeaves()                    │
                         └─────────────────────────────────────────┘
```

Two independent layers: static rules catch unambiguously-wrong text patterns
without running React; the render harness catches everything that depends on the
mounted tree. Either layer failing fails CI.

---

## 5. Deterministic guard design

### 5.1 Layer 1 — static conformance rules

Add to `AUDIT_RULES` and `UI_CONFORMANCE_RULES` in
`packages/paseo-plugin-helper/src/cli/`:

**`no-raw-color-literal` (severity: warn)**

- **Detects:** a color literal in `client/**` (`isClientFile` already gates this)
  in any of: `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb(`/`rgba(`/`hsl(` in a
  style value, or bare `white`/`black`/`red`/`green`/`blue`-style named colors
  assigned to `color`, `backgroundColor`, `borderColor`, `borderTopColor`, …,
  `tintColor`, `shadowColor`.
- **Exempts:** exactly one file per plugin — the local theme module
  (`client/host-ui.tsx`, or a file that declares `FALLBACK_COLORS` /
  `createContext<…Theme>`), configurable by a path allowlist in the rule. The
  fallback palette is the *only* place literals may live, and the render test
  proves nothing renders from it on a supplied host theme.
- **Rationale:** once literals are confined to the theme module, a "surface
  ignores light/dark" defect can only be a *missing provider*, which is
  precisely what the render test catches. This is the static half of Class B.
- **Avoids the existing trap:** the rule must **not** be exemptible via
  `conformance.json` in a way that hides the theme seam. Declared exemptions are
  per-rule; a plugin that could no-op this rule would restore the blind spot.
  Enforce by rejecting a `conformance.json` exemption for
  `no-raw-color-literal` (or by requiring the reason to name the theme module
  and asserting the file exists).

**`no-truncate-less-long-field` (severity: warn, narrow allowlist)**

- **Detects:** a `<Text>` whose literal child is a variable named/assigned from a
  known unbounded class (`sha`, `commit`, `hash`, `path`, `branch`, `worktree`,
  `model`, `agentId`, `serverId`, `id`) and which has neither `numberOfLines`
  nor a `truncate*` wrapper in the surrounding expression.
- This is intentionally a **heuristic**, narrower than "all long text", to keep
  false positives near zero. The authoritative check is §5.2's truncation
  invariant. The rule exists to catch the cop-out of adding no cap at all.

Do **not** add static rules for `width:"100%"`, single-scroller, or unbounded
flex (§2.3): they cannot be decided from file text and a noisy rule would be
exempted, recreating the original blind spot.

**Scanner integration points (already in place):**

- `isClientFile` — `scanner.ts` (path segment `client` or `*.client.*`).
- `isTestFile` / `isBuildOrToolFile` — only authored, non-test, non-tooling code
  is linted.
- `vendor/` and `dist/` are in `DEFAULT_IGNORED_DIRS`, so vendored helper copies
  are not double-flagged.
- Rule written to both `AUDIT_RULES` and `UI_CONFORMANCE_RULES`; the
  `conformance --all plugins --strict` gate already fails on warnings.

### 5.2 Layer 2 — shared render-level harness

**Package:** `packages/paseo-plugin-ui-testing` (private, dev-only, bundled
nowhere). Consumed by each plugin's test script as a workspace devDependency. It
contains no runtime code, so it does not violate the host plugin import
allowlist.

**Renderer / approach:** `react-test-renderer` (the exact library already used
by `plugins/top/client/*.test.tsx` and `plugins/worktree-install`). It produces
the real element tree and the real resolved style objects but **no layout pass**;
the shared `flex-measure.ts` / `scroll-measure.ts` supply the Yoga-shaped pass.
`react-native` and `@getpaseo/plugin/client/react-native` are aliased to
data-URL stubs via `module.registerHooks` (Node ≥ 22), because `react-native`
ships Flow syntax and the host SDK's react-native entry is `export {}` at
runtime. This is exactly what `plugins/worktree-install/client/testing/host.tsx`
does today and is proven in CI.

**Extracted API (stable surface):**

```ts
installHostStubs(): void                       // idempotent resolve hooks + act env
renderInSkin(element, { theme, layout }): Promise<RenderedSurface>
findHorizontalOverflows(tree, rootWidth): OverflowFinding[]
scrollContainers(tree): ScrollContainer[]      // hostOwned flag included
heightClamps(tree): HeightClamp[]
collectTextLeaves(tree): { text; lines; color? }[]
resolveStyle(node): StyleValue
```

**Per-plugin surface contract (the fixture the plugin owns):**

```ts
interface SurfaceCase {
  id: string;
  element: React.ReactElement;      // the real registered component
  press?: string[];                 // testIDs to press to reach stateful branches
  expectedScrollOwners: number;     // 1 for a surface, 0 for host-modal content
  outgrowing?: string;              // testID of the content that must sit under the scroller
}
```

Each plugin supplies `client/testing/ui-guard.fixtures.ts` (light + dark theme
palettes, `layout.compact` true/false, phone widths 320/360/390/430 and wide
1400). No per-plugin layout math is allowed in the test; the harness owns it.

**The four invariant assertions (one `ui-guard.test.ts` per plugin):**

1. **Containment.** For every surface, at compact and wide:
   `findHorizontalOverflows(tree, width)` reports **zero** findings above the
   6px glyph-estimate band. This is the class-A/G guard and generalises
   `plugins/uppidi-fleet/client/mobile-layout.test.ts`.
2. **Host theme only.** Render each surface twice with two *sentinel* palettes
   (a light palette whose every token is a unique value, and a dark one). Assert
   every color that appears on the tree is a value from the supplied palette;
   assert at least one surface color changed between the two runs. A static dark
   `FALLBACK_COLORS` value appearing under a sentinel palette **fails**. This is
   the deterministic form of "colors come from host theme" (Class B) and
   generalises `plugins/top/client/theme-mode.test.tsx`.
3. **Single scroll owner.** Using `scrollContainers`, assert the surface owns
   exactly `expectedScrollOwners` plugin scrollers (0 when the host owns it) and
   that the outgrowing content is enclosed by the owner; assert every flex
   ancestor between the modal body and the scroller has `flex:1, minHeight:0`.
   This generalises `pill-modal-scroll.test.tsx` and
   `mobile-scroll.test.ts`.
4. **Truncation.** Using `collectTextLeaves`, assert every text leaf whose
   measured `maxContent` exceeds its container has `numberOfLines` (tail
   ellipsis) **or** is wrapped in a `truncateMiddle`/`truncatePath` transform.
   `flex-measure.ts` already treats `numberOfLines` as the sole compressible-text
   case, so this falls straight out of the existing solver. Class D.

### 5.2.1 Two sentinel renders catch `theme.colors.x || "#fallback"`

The palette assertion above is necessary but not sufficient on its own. A
*single* render with a **complete** sentinel palette cannot see a fallback: if
the supplied palette defines every token, `theme.colors.border || "#334155"`
never evaluates the right-hand side, so the literal is dead code in that render.
The fallback only paints when a host supplies a *partial* theme (an older daemon,
a migrated surface, a context that forgot a token). #1057-A therefore adds the
**complete sentinel** render to every audited surface, and this section records
the second render that closes the fallback gap.

A surface is rendered **twice**, and `colorsOutsidePalette` must be empty on
both:

1. **Complete sentinel** — all eleven `ThemeColors` tokens are unique values
   that appear nowhere in the tree. This proves the surface paints from the
   host theme at all. This is the shape the #1057-A per-plugin tests use
   (`plugins/uppidi-fleet/client/ui-guard.test.ts`, plus the palette passes in
   `forges`, `twofado`, `wellbeing`, `plugin-updates`, `x-comms`).
2. **Partial sentinel** — a palette that omits the tokens whose fallbacks the
   census recorded (or, for a newly audited surface, every token with a known
   `|| "#…"` guard). The surface must still paint only allowed colors. Because
   #1057-B collapsed the per-surface `|| "#…"` guards into the helper's single
   `FALLBACK_COLORS` (`resolveHostColors` in
   `packages/paseo-plugin-helper/src/lifecycle/host-color.ts`), the allowed set
   for this render is `[...partialPalette, ...FALLBACK_COLORS]`: a missing token
   resolves to the helper fallback, and any color outside that union is a
   plugin-local literal the surface should not carry. Before #1057-B the render
   reports the surface's own hex (`plugins/uppidi-fleet/client/tree-view.tsx`,
   `plugins/plugin-updates/client/updates.tsx`,
   `plugins/forges/client/host-ui.tsx`, `plugins/x-comms/client/host-ui.tsx`);
   after, it is green.

The `addTheme` contribution is the one surface that is *supposed* to keep its
literal palette; it is exempted statically (see `docs/cli.md`), not by a palette
of its own. A sentinel palette is a list of unique values, not a light/dark
pair: the assertion is "every painted color is a value the host supplied", and
uniqueness is what makes a hardcoded literal distinguishable from a token.

**What the harness can and cannot do (feasibility, explicitly):**

| Deterministic under react-native-web + react-test-renderer | Not feasible — needs manual/visual |
| --- | --- |
| Element tree + resolved style props | Real font metrics / line breaks / wrapping pixels |
| Yoga-shaped **horizontal** overflow floor (`flexShrink`, `flex:1`, `minWidth`, `numberOfLines` compressibility) | Whether a design *looks* right (density, alignment, visual hierarchy) |
| Scroll-owner count + flex-bounded ancestor chain | Actual scroll gesture, momentum, nested-scroll **runtime** freeze |
| Height clamps (`height`/`maxHeight` shorter than content) | `onLayout` / real viewport measurement / virtualization windows |
| Color **values** emitted vs the supplied host palette | Contrast/legibility, anti-aliasing, images, icons |
| `layout.compact` + width/platform branch selection | Animations, press/hover styling, keyboard navigation, focus rings |
| Missing `HostThemeProvider` (via sentinel palette) | First-paint flash timing (#893's "brief flash") |
| | Live-daemon hangs / query storms (Class F) |

The estimates are deliberately one-sided: `findHorizontalOverflows` only reports
when demand exceeds available by more than a glyph-estimate margin, so it can
produce **false negatives on near-misses but not false positives**. A green guard
is necessary, not sufficient. State that in the test header so nobody over-claims.

### 5.3 CI wiring

- Static rules: already covered by `make conformance` in
  `.forgejo/workflows/test-suites.yml` (required check).
- Render harness: each plugin's existing `npm test` / `test:tsx` script runs
  `ui-guard.test.ts`. `npm test` is the first required step in the same job.
- No new workflow is required. Optionally add `make ui-guard` as an alias for
  discoverability, but do not create a second gate that can drift from `npm test`.

---

## 6. Implementation checklist (dispatchable as-is)

Ordered; each item is independently reviewable.

- [ ] **1. Extract the harness.** Create private `packages/paseo-plugin-ui-testing`
      with `installHostStubs`, `renderInSkin`, `findHorizontalOverflows`,
      `scrollContainers`, `heightClamps`, `collectTextLeaves`, `resolveStyle`,
      moving the code from `plugins/worktree-install/client/testing/` (which
      already carries the "move this somewhere both can reach" note) and the
      matching `plugins/uppidi-fleet/client/testing/flex-measure.ts`. Typecheck +
      unit-test the extraction against the existing worktree-install suite before
      changing any plugin.
- [ ] **2. Port `worktree-install` and `uppidi-fleet` tests** onto the shared
      package, delete the duplicated `flex-measure.ts`/`scroll-measure.ts`/
      `host.tsx` copies, and confirm their existing guards still pass and still
      fail on the original defect commits.
- [ ] **3. Define the fixture contract** (`SurfaceCase`) and author
      `client/testing/ui-guard.fixtures.ts` for each plugin with a rendered
      surface (`top`, `uppidi-fleet`, `worktree-install`, `forges`, `x-comms`,
      `twofado`, `plugin-updates`, `demo`, `slash`). Phone widths
      320/360/390/430 + wide, `compact:true/false`, light + dark sentinel
      palettes.
- [ ] **4. Write `client/ui-guard.test.ts` per plugin** with the four invariants
      in §5.2. Pin expected scroll owners per surface (0 for host-modal content,
      1 for hostless surfaces). Include the top `mcp` tab in `top`'s fixture so
      Class F's surface is at least swept once triaged.
- [ ] **5. Add static rule `no-raw-color-literal`** to `AUDIT_RULES` and
      `UI_CONFORMANCE_RULES`, with the per-plugin theme-module allowlist. Run
      `node packages/paseo-plugin-helper/bin/paseo-plugin-helper.js conformance
      --all plugins` and fix/where-legitimate-exempt each finding. Reject an
      exemption for this rule that names anything other than the theme module.
- [ ] **6. Add `no-truncate-less-long-field`** (narrow allowlist) to both maps.
      Keep the allowlist in the rule file, not per-plugin.
- [ ] **7. Rebuild + re-vendor.** `node scripts/vendor-sync.mjs` to rebuild the
      committed `packages/paseo-plugin-helper/dist/` and refresh every plugin's
      `vendor/paseo-plugin-helper/`; confirm `scripts/vendor-sync.mjs --check`
      is green (committed dist == src, no drift).
- [ ] **8. Docs.** Update `docs/plugin/ui/README.md`,
      `docs/plugin/ui/mobile-and-cross-platform.md` (its `ModalBody` examples are
      stale post-#938), `docs/plugin/ui/components-and-forms.md`, and
      `packages/paseo-plugin-helper/docs/client-migration.md` to name the four
      invariants and point at this doc + the harness. State the
      `numberOfLines`/`truncateMiddle` convention.
- [ ] **9. Prove the guard is a guard.** For each invariant, show at least one
      test that fails on the fix's parent commit and passes after (the #975
      pattern). A guard that was never red is not evidence.
- [ ] **10. `make check`** (typecheck + tests + conformance) green; `npm test`
      green; no new conformance exemptions except the documented theme modules.

Follow-ups (not this checklist): triage the MCP hang with a live daemon (§7);
land the [#976](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/976) shared
`packages/paseo-plugin-ui` and migrate adapters onto it, keeping every invariant
in §5.2 as the acceptance test for that migration.

---

## 7. What cannot be deterministically tested (manual / visual only)

Be explicit; do not let a green suite imply more than it proves.

1. **Visual quality** — density, alignment, spacing, hierarchy, whether the
   collapsed telemetry card (#1010) "used to be structured better". The #1010
   operator follow-up (*"this used to be structured much better"*) is a design
   judgement; screenshots or a live check are the only proof.
2. **Font metrics and real wrapping** — the harness estimates glyph widths and
   measures a floor. Near-miss overflow and ugly wraps are invisible to it.
3. **First-paint theme flash** (#893) — a timing artifact; react-test-renderer
   has no frame clock. Manual: toggle light/dark and open the surface.
4. **Runtime scroll behaviour** — momentum, gesture arbitration, the nested-scroll
   *freeze* on mobile sheets. The harness counts owners and bounds ancestors; it
   cannot simulate the pan recognizer.
5. **The MCP hang (Class F)** — a live-daemon/perf symptom. Must be reproduced
   against a running daemon; the guard can only cover the MCP list's layout once
   the hang is understood. Do not close it on a layout test.
6. **`onLayout`/`useWindowDimensions`/virtualized-list windowing** — no real
   layout engine, so these branches are not driven. If a surface reads
   `onLayout`, it needs a manual check.
7. **Animations, hover/press states, keyboard/focus, accessibility tree,
   images/icons** — no paint, no events, no fonts.
8. **Cross-device reality** — iOS/Android safe areas, Hermes/JSC quirks,
   bottom-sheet detents. `layout.platform` sweep is only a branch test.

Mitigation for these: the existing manual precedents remain valid — the
Chrome DevTools audit from [#874](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/874),
operator verification on a live reload, and screenshots attached to the ticket.
Automated CI stays honest by *not* claiming them.

---

## 8. Appendix — declared conformance exemptions (as of this doc)

Every plugin's `conformance.json` exempts the file that replaces the removed
helper kit. This is the blind spot that must not grow:

| Plugin | Exempted rule(s) | Exempted file / reason (short) |
| --- | --- | --- |
| top | `no-bespoke-react-native-interactions` | `client/host-ui.tsx` local composition (#937) |
| forges | `no-bespoke-react-native-interactions` | `client/host-ui.tsx` local composition |
| mcp-tools | `no-bespoke-react-native-interactions` | `client/host-ui.tsx` local presentation layer |
| slash, demo, plugin-updates, wellbeing | `no-bespoke-react-native-interactions` | local composition |
| x-comms | `no-bare-react-native-ui`, `no-bespoke-react-native-interactions` | local composition |
| twofado, uppidi-fleet, uppidi-forge | `no-bare-react-native-ui`, `no-bespoke-react-native-interactions` | local composition |
| worktree-install | `no-bare-react-native-ui`, `no-bespoke-react-native-interactions` | deliberate non-shared-kit proof (#684 era) |

Implication for the guard: because every plugin already owns a raw
`Pressable`/`StyleSheet` seam, a new rule that is easy to exempt will be
exempted. That is why the new `no-raw-color-literal` rule must be scoped to the
**theme module allowlist** rather than left blanket-exemptible, and why the
layout/scroll/truncation invariants live in the render harness, which
`conformance.json` cannot switch off.

---

## 9. Decision summary

- **Stop fixing symptoms per surface.** The four invariants (containment, host
  theme, single scroll owner, truncation) are the deliverable; the shared UI
  package (#976) is a later optimisation.
- **Enforce in two layers.** Static for unambiguous text patterns
  (`no-raw-color-literal`), render-level for everything context-dependent.
- **One shared harness**, extracted from the two existing copies, run at
  compact + wide for every plugin surface; impossible branches documented, not
  faked.
- **A guard is only real when it has been red.** Every invariant ships with a
  failing-on-parent-commit case.
- **The MCP hang is triaged live**, not guessed at and not papered over with a
  layout change.
