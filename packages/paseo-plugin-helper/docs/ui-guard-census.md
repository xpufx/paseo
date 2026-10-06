# UI Regression Guard — First Census

> **Ticket:** [xpufx-org/paseo#1043](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/1043) (umbrella).
> **Design:** `packages/paseo-plugin-helper/docs/ui-regression-guard.md`.
> **Harness:** `packages/paseo-plugin-ui-testing/src/ui-guard.ts` (exported as
> `paseo-plugin-ui-testing`).
> **Status:** the shared render harness and its first census. This is a finding
> report, not a claim that every surface is clean.

The census applies the harness to the surfaces the design doc names as
known-risk, at a compact and a wide width, and records what fails. A green
suite is necessary, not sufficient: the harness measures a horizontal overflow
floor and a scroll-owner count with an estimated glyph table, and cannot see
font metrics, gestures, animation, or first-paint timing.

## The harness

`paseo-plugin-ui-testing` exports the pure measurement layer plus the
invariant facade:

- `findHorizontalOverflows(tree, width)` — Class A, Yoga-shaped containment.
- `collectColors` / `colorsOutsidePalette(tree, palette)` — Class B, host-theme
  literals (palette tokens with an appended alpha channel are accepted).
- `scrollContainers(tree)` — Class C, plugin vs host-owned scroll boundaries.
- `sheetScrollersInsideModal(tree)` — the #219 class: a host SDK
  sheet-gesture `ScrollView` used as the inner scroller of a host modal body.
  The inner scroller must be a plain React Native `ScrollView`.
- `findUncappedText(tree, width)` / `collectTextLeaves` — Class D, truncation.
- `heightClamps` / `contentHeightFloor` — the vertical floor.
- `checkInvariants(tree, options)` — all of the above at once.

It walks the plain JSON tree a renderer returns and imports no React or
react-native, so it works under both vitest (with a local react-native alias)
and `tsx --test` (with resolve hooks). The duplicated `flex-measure.ts` copies
were deleted from `plugins/worktree-install` and `plugins/uppidi-fleet`; both
now import this module.

## Census results

| Surface | Invariants checked | Result | Test |
| --- | --- | --- | --- |
| `mcp-tools` pill modal | scroll owner, sheet scroller, bounded chain | **defect fixed** — was the host sheet scroller; now a plain RN `ScrollView` | `plugins/mcp-tools/client/pill-modal-scroll.test.tsx` |
| `top` pill modal | scroll owner, sheet scroller, fluid content | **defect fixed** — host-owned single scroller (`hostScroll: true`, no plugin scroller) | `plugins/top/client/pill-modal-scroll.test.tsx` |
| `top` telemetry card | containment, colors, truncation, sheet, owners | clean at 390px + 1400px | `plugins/top/client/ui-guard.test.tsx` |
| `top` Fleet tab (`FleetView`) | renders without host multi-host primitives | **defect fixed** — crashed with `useHosts is not a function`; now an unavailable state | `plugins/top/client/fleet-view.test.tsx` |
| `top` `HostMetricGauge` (native) | value is an arc, not a filled disc | **defect fixed** — drew a solid disc; now a no-SVG ring arc | `plugins/top/client/host-gauge.test.tsx` |
| `uppidi-fleet` agent switcher | containment, truncation, scroll owner, sheet | clean at 390px | `plugins/uppidi-fleet/client/ui-guard.test.ts` |
| `worktree-install` fleet/queue/tickets/ticket-detail | containment, colors, truncation, scroll owner, sheet | clean at 390px + 1400px | `plugins/worktree-install/client/ui-guard.test.ts` |

### Finding 1 — mcp-tools modal inner scroller (fixed)

`mcp-tools/client/host-ui.tsx`'s `HostScroll` used
`ScrollView as HostScrollView` from `@getpaseo/plugin/client/react-native`,
whose own doc says it carries *"the host's sheet gestures when rendered inside a
sheet."* As the one scroller inside `<Modal.Content scrollable={false}>` it handed
the same pan gesture to the plugin and the modal. The fix imports the plain
React Native `ScrollView`; the host content stays `scrollable={false}` and the
plugin stays the single owner. The regression test fails on the parent commit
(it asserts a plain `ScrollView` and zero host sheet scrollers) and passes now.

This necessarily trips the static `no-bare-react-native-ui` rule (it flags a
bare `ScrollView` import), so mcp-tools now declares that rule exempt for
`client/host-ui.tsx`. That is the repo's designed escape hatch, and it is the
same exemption `x-comms` already carries for the identical reason ("the host
sheet-gesture scroller must not be used", #219). The layout/scroll invariant is
still enforced by the render tests, which `conformance.json` cannot switch off.

**Red → green (strict TDD).** With the pre-fix `host-ui.tsx` restored and the
new test in place:

```
$ npx vitest run --config client/vitest.config.ts client/pill-modal-scroll.test.tsx
 × owns the scroll with a plain React Native scroller, not the host sheet
   → expected [] to have a length of 1 but got +0
 × carries no host sheet scroller inside the modal body (harness invariant)
   → expected [ { testID: undefined, …(2) } ] to deeply equal []
     path: "View/host-modal-content/View/View/View/host-scroll-view"
 Tests  2 failed (2)
```

After the import is changed to the plain React Native `ScrollView`:

```
$ npx vitest run --config client/vitest.config.ts client/pill-modal-scroll.test.tsx
 ✓ client/pill-modal-scroll.test.tsx (2 tests) 59ms
 Tests  2 passed (2)
```

### Finding 2 — top pill modal (fixed)

The same two-recognizer defect was present in `plugins/top/client/host-ui.tsx`:
its `HostScroll` used the host SDK `ScrollView`, and `plugins/top/client/pill.tsx`
rendered it inside the host modal body. Unlike mcp-tools, top's `HostScroll` is
shared with the full-page `surface.tsx` and `turn-panel.tsx`, where the host
sheet scroller is intended, so #1043 pinned it as a reviewed split rather than
swapping the import.

#1056 then gave the modal its own `HostModalScroll` (plain React Native
`ScrollView`) while `HostScroll` kept the host sheet-gesture scroller for page
surfaces, with the host modal content left `scrollable={false}`. That removed
the two-recognizer fight but not the deeper problem: `<Modal.Content
scrollable={false}>` does not hand the plugin body a bounded viewport on native,
so the inner `flex: 1` scroller had no scroll range and the modal froze. The
supported single-owner model is the helper's `hostScroll: true` (already used by
`demo`): the plugin registers the pill with `hostScroll: true`, the host renders
`<Modal.Content scrollable={true}>` as the ONLY scroller, and the plugin body is
fluid (no nested scroller, no `flex: 1` / `minHeight: 0` clamp). #1056's
`HostModalScroll` and the `no-bare-react-native-ui` exemption it needed are both
gone; `surface.tsx` and `turn-panel.tsx` still use `HostScroll`.

The censused contract is host ownership: `<Modal.Content>` is `scrollable`,
there is exactly one scroll boundary and it is host-owned, no plugin scroller
(plain or host sheet) sits inside, and the fluid `HostModalSection` extends the
host's scroll range instead of clamping to the viewport.

**Red → green (strict TDD).** On the #1056 tree the new assertions fail:

```
$ npx vitest run --config client/vitest.config.ts client/pill-modal-scroll.test.tsx
 × delegates the single scroll to the host and renders no nested scroller
   → expected false to be true
 × keeps the host-scrolled section fluid instead of clamping it to the viewport
   → HostModalSection must not flex-fill under host scroll: expected 1 to be undefined
 Tests  2 failed | 1 passed (3)
```

After switching the pill to `hostScroll: true` and dropping the inner scroller:

```
$ npx vitest run --config client/vitest.config.ts client/pill-modal-scroll.test.tsx
 ✓ client/pill-modal-scroll.test.tsx (3 tests) 64ms
 Tests  3 passed (3)
```

### Finding 3 — worktree-install color palette (by design)

Worktree-install deliberately composes its own two-palette theme
(`client/theme.ts`) as the #684 "no shared kit" proof. Its colors are not host
SDK token names, so the census passes its own declared palette (the allowed
theme module) rather than `theme.colors`. The alpha-suffixed tone washes
(`#5aa2ff2e`) are accepted as palette-derived. This is a documented exception,
not a hole: the harness's static counterpart (`no-raw-color-literal`, shipped in
#1057-C, see `docs/cli.md`) is what confines those literals to the theme module.

### Finding 4 — Fleet tab crash on mobile (fixed)

`useFleetPolling` called `useHosts()` and `getPaseoClient()` unconditionally.
`@getPaseo/plugin/client` declares both in its type surface, but the runtime JS
exports neither (they are "supplied by the app's client bundle loader"), and the
mobile bundle does not supply them — so the named imports bind `undefined` and
the whole Fleet tab crashed. The hook now feature-detects the primitives
(`multiHostSupported()`), skips polling when they are absent, and `FleetView`
renders "Multi-host fleet unavailable" instead of throwing.

Red → green with the final test:

```
# pre-fix multi-host.ts + multi-host-view.tsx
$ npx vitest run --config client/vitest.config.ts client/fleet-view.test.tsx
 × renders the unavailable state instead of throwing
   → TypeError: (0 , __vite_ssr_import_0__.useHosts) is not a function
 Tests  1 failed (1)

# after the guard
 ✓ client/fleet-view.test.tsx (1 test) 6ms
 Tests  1 passed (1)
```

### Finding 5 — native `HostMetricGauge` drew a solid disc (fixed)

`HostMetricGauge`'s non-web branch rendered the full track ring **plus** a
filled inner circle whose opacity scaled with the value (`styles.gaugeFill`), so
on a phone the gauge read as a solid disc instead of an arc. The native branch
now draws a proportional ring arc with two clipped half-rings and a rotation
(the no-SVG technique; the host runtime does not bundle `react-native-svg`),
while the web branch keeps its `conic-gradient` sweep. The targeted test pins
no value-colored fill, the arc's border colors, and the rotation sweep
(30% → 108°, 75% → 270°, 100% → 360°).

Red → green:

```
# pre-fix host-ui.tsx
$ npx vitest run --config client/vitest.config.ts client/host-gauge.test.tsx
 × draws an arc ring for native and never a filled value disc
   → the gauge must not paint the value as a solid disc: expected [ Array(2) ] to deeply equal []
 × sweeps the native arc in proportion to the value
   → no arc ring carries testID=gauge-arc-right
 Tests  3 failed | 1 passed (4)

# after the no-SVG arc
 ✓ client/host-gauge.test.tsx (4 tests) 10ms
 Tests  4 passed (4)
```

The disc-vs-arc shape is **not** one of the four render invariants: it is a
visual/proportion property the tree walk cannot decide. It is pinned by a
targeted surface test, not claimed by `checkInvariants`.

## What this census does not cover

- **mcp-tools colors and truncation** — the fixed modal is asserted for scroll
  ownership, sheet scroller, and bounded ancestors only. A full
  `checkInvariants` pass on the modal (colors against the host theme,
  truncation of long server/model rows) is a follow-up.
- **top modal containment/colors/truncation** — the existing #975 test covers
  the scroll chain; the other invariants are not yet asserted for the modal.
- **uppidi-fleet panel/tree surfaces** — covered for containment and scroll by
  `mobile-layout.test.ts`, but not yet run through `checkInvariants`.
- **Everything the design doc §7 lists** — real font metrics, wrapping, runtime
  gesture freeze, first-paint theme flash, `onLayout`/virtualization, and the
  MCP hang (Class F, live-daemon only). The census does not claim them.
