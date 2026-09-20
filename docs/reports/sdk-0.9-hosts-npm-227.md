# SDK 0.9.0-beta.2 multi-host and npm audit (#227)

Audited 2026-09-20 against the checked-out Paseo upstream release commit
`e9d32a17d` (`0.9.0-beta.2`) and this repository's mainline commit
`072b42fd`. This is an integration assessment, not a production change.

## Result

`useHosts()` plus `getPaseoClient(serverId)` make an explicit, UI-driven
multi-host view practical. They do **not** provide a server-plugin transport,
durable delivery, discovery beyond the application's configured hosts, or a
replacement for x-comms' authenticated peer links. The suitable next work is
therefore three bounded implementation tracks: x-comms client-side host
discovery/routing, top fan-out and aggregate presentation, and a clean npm
install matrix. Native plugin updating already supersedes the updater's
install/reload mechanism for managed npm and Git sources; `plugin-updates`
should not introduce a second mutation path.

## SDK evidence and contract

Upstream `packages/plugin/src/client/index.ts` declares:

```ts
useHosts(): readonly PluginHostSummary[]
getPaseoClient(serverId: string): PaseoApi
// PluginHostSummary = { serverId, label, status }
```

The upstream `plugin-examples/hosts/client/hosts.tsx` demonstrates the
intended shape: enumerate `useHosts()`, then call
`getPaseoClient(serverId).agents.list()` from a client surface. The app bridge
in `packages/app/src/plugins/hosts/index.ts` adds constraints that callers
must handle:

- only configured hosts appear; an offline configured host remains in the
  list with a status;
- `getPaseoClient` throws for an unknown or non-`online` host;
- a borrowed API is tied to the plugin installation and is released if the
  plugin stops, the connection changes, or the host disappears. A caller must
  reacquire it after those events and must not cache it as durable state.

The exports live in `@getpaseo/plugin/client`, so this is a React/client
surface API. `PluginServerContext` does not expose `useHosts` or a host-targeted
client factory. Code that starts on the plugin server, a scheduled worker, or
an MCP process cannot call it.

## x-comms: viable path and limits

### Existing behavior

`plugins/x-comms/server/handlers.ts` sends locally through
`context.paseo.agents.ref(id).send()`. For remote registry entries it starts
the bundled MCP server, whose peer channel uses `DaemonClient` plus relay offer
or direct endpoint configuration (`server/peer-channel.ts`). This path checks
relay-offer `serverId` identity, carries x-comms envelopes, writes failed
messages to the outbox, supports presence, and is available without a mounted
client UI.

`server/local-send.ts` is deliberately local-only: `PaseoApi.send` is bound to
one daemon. Its comment predates this client-only multi-host API, but its
server-side conclusion still holds: no host-targeted server SDK factory is
available in this release.

### Bounded integration path

1. In an x-comms client surface, call `useHosts()` and render only `online`
   entries as selectable native destinations (show offline/error rows as
   unavailable rather than silently omitting them).
2. On selection, acquire `getPaseoClient(serverId)`, call `agents.list()`, and
   key every result by `(serverId, agentId)`; agent IDs are not a fleet-global
   identity.
3. For an interactive send, reacquire the target handle immediately before
   `agents.ref(agentId).send(envelopedPrompt)`. Retain the existing x-comms
   envelope so attribution and thread parsing remain compatible.
4. Keep the current relay/direct-peer path as the only route for background
   sends, retries/outbox, presence/injection, non-configured peers, and MCP
   agents. Do not migrate registry names to `serverId` until an identity and
   configuration migration is designed.

Important limits: this reaches only hosts already connected in the *current
app*; it does not pair hosts, discover peers, establish an E2EE/relay channel,
or make a client API callable from an agent/MCP invocation. Native send has no
x-comms retry/outbox semantics. A UI implementation must catch disconnect and
handle-released errors, never broadcast implicitly, and obtain user intent for
each target host.

## top: multi-host aggregation

Top currently obtains `top.system-resources` with local `useRpcQuery` in
`plugins/top/client/resources-query.ts`; the server handler reads the daemon
on which that plugin instance runs. Thus present resource, custom-pill,
settings, and turn/timeline values are per-daemon, not fleet totals.

The integration point is client-only: use the online hosts list, invoke the
existing `getSystemResourcesRpc` through a newly acquired client per host, and
keep result state keyed by `serverId`. The first iteration should show a
per-host table plus partial-failure/staleness state. Aggregate only metrics
with explicit meanings: counts can be summed; CPU, memory, disk, uptime,
provider versions, and custom commands need documented aggregation rules or
must remain per-host. Polling requires a bounded concurrency limit, one
in-flight request per host, cancellation/disposal on host changes, and a
slower cadence than the local five-second query.

This excludes server-side fan-out: top's server has no access to the app host
registry, and forwarding arbitrary custom-pill commands to every host would
broaden the execution/security model.

## plugin-updates versus native update

Upstream CLI `packages/cli/src/commands/plugin/update.ts` implements a
preview/proposal/apply transaction through `previewPluginUpdates` and
`applyPluginUpdates`. It supports both Git refs and npm versions. Its managed
source implementation resolves npm artifacts, records integrity, compares the
installed revision, and re-acquires a reviewed artifact before applying.

`plugins/plugin-updates/server/updates.ts` instead independently inspects Git
repositories and spawns `paseo plugin update`; it intentionally skips reloading
itself. That remains useful only as a Git-install status/detail surface while
native lifecycle metadata is not exposed to plugin client surfaces. It must
not claim npm coverage: its own README and code classify non-Git installs as
`not-a-repo` and do not offer an update.

Recommended direction: retain read-only Git diagnostics (subdirectory scope,
pinned refs, dirty/diverged explanations) and move update actions to the
native reviewed workflow as soon as a supported plugin-client API exists. Do
not invoke a nested CLI from a plugin server as a substitute for native UI: it
can target the wrong host and duplicates native confirmation, integrity, and
reload ownership. `useHosts` does not solve that missing lifecycle API.

## npm distribution metadata

Focused `npm pack --dry-run` checks succeeded for:

| Package | Version | Manifest in pack | Current metadata verdict |
| --- | --- | --- | --- |
| `@xpufx/paseo-x-comms` | `0.3.0` | yes | Publishable package layout; its manifest has an explicit production dependency-install build. |
| `@xpufx/paseo-top` | `0.4.0` | yes | Publishable package layout, but requires a clean native-install smoke test before claiming npm support. |
| `@xpufx/paseo-plugin-updates` | `0.1.0` | yes | Same clean-install gate; current capability is Git-source-specific. |

All three are non-private packages with `name`, `version`, `license`,
repository metadata, `files`, and `paseo-plugin.json` included. Upstream npm
acquisition uses `npm install --include=prod --omit=dev --ignore-scripts` and
then runs only manifest-declared `build` commands. Consequently no manifest
schema change is needed to opt in, but each package must prove that its packed
production dependency closure and declared build work under that exact flow.
Top and plugin-updates have no build command while declaring the Paseo plugin
SDK only in `devDependencies`; this is a compatibility question for a clean
native install, not evidence that changing dependencies or manifests is safe
without a test. Any feature importing `useHosts` must raise its manifest
minimum from `>=0.8.0` to `>=0.9.0-beta.2` (or a later stable floor) before
publication.

## Follow-up issue criteria

The resulting targeted child issues are:

- #298 — x-comms configured-host picker and interactive native send;
- #299 — top bounded multi-host resource presentation;
- #300 — plugin-updates delegation to the native reviewed lifecycle; and
- #301 — exact native npm-acquisition smoke matrix.

Each must include a two-host integration test where applicable,
offline/reconnect behavior, and an explicit compatibility floor. No child
issue is justified for server-side use of `useHosts`, automatic host pairing,
unconditional broadcast, or speculative manifest-field additions: the audited
API does not support those designs.

## Verification performed

- Inspected upstream release commit `e9d32a17d` and its host example, plugin
  client declarations, host bridge, CLI update flow, npm acquisition, and
  manifest parser.
- Inspected the x-comms local/remote delivery, peer channel, top query, and
  plugin-updates update paths in this mainline checkout.
- Ran `npm pack --dry-run --workspace=plugins/x-comms`, `top`, and
  `plugin-updates`; each completed successfully and included its manifest.
- Attempted `npm run test --workspace=plugins/x-comms`. The checkout lacks
  installed workspace dependencies (`@getpaseo/plugin`, `zod`,
  `@getpaseo/client`, `@modelcontextprotocol/sdk`, and
  `paseo-plugin-helper`); 22 assertions in dependency-free suites passed and
  10 test files failed at module resolution. No install was performed because
  this documentation-only audit must not churn the lockfile or manufacture a
  passing environment.

Implementation tests are intentionally deferred to their child issues because
this report does not modify runtime behavior.
