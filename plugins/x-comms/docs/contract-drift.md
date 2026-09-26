# x-comms — documented/absent drift ledger

Every row here is a place where the shipped prose and the shipped code disagree,
in one direction or the other, found by reading the code and then reading the
docs against it. **The code is the authority in this repository.** Nothing in
this file is a defect report: a row is a documentation obligation, unless the
*Does* column says otherwise.

Scope of the sweep: `plugins/x-comms/README.md`,
`plugins/x-comms/mcp/README.md`, `plugins/x-comms/docs/mesh.md`,
`plugins/x-comms/skills/recipient-envelope/SKILL.md`, and the
`INSTRUCTIONS` / `RECIPIENT_INSTRUCTIONS` strings shipped inside the bundle.

The two contracts: [`contract-plugin.md`](contract-plugin.md),
[`contract-mcp.md`](contract-mcp.md).

---

## A. The one that matters most

### A1 · The two instruction surfaces give opposite advice on the same rule

| | |
|---|---|
| **Surface 1** | `mcp/paseo-x-comms.mjs:471` — the MCP `instructions` field: *"x_comms_send NEVER interrupts a running turn. If the target is mid-turn the message is queued (8 deep per target, 30 minute window) and delivered when the target goes idle. … **Do not call x_comms_wait first to avoid preemption — that is no longer required.** x_comms_wait is still the right tool when you need to WAIT for a result."* |
| **Surface 2** | `server/recipient-instructions.ts:33` — the standing instructions folded into `config.systemPrompt`: *"**Before messaging a potentially busy agent use x_comms_wait;** on a permission stall use x_comms_list_permissions then x_comms_allow_permission/x_comms_deny_permission, then wait again."* |
| **Surface 3** | `skills/recipient-envelope/SKILL.md:85` — repeats surface 2 verbatim. |
| **Asymmetry** | **Documented-and-current vs documented-and-stale, in the same bundle, about the same feature.** |

Which one reaches an agent: **surface 2.** The `instructions` field is the only
place the never-interrupt rule is stated correctly, and neither injection
transport has a slot for it — `McpStdioInjectionConfig` and its siblings are
`{ type, command|url, args?, headers?, env?, alwaysLoad? }` and
`AgentCreateInjectionConfig` is `{ mcpServers?, [key: string]: unknown }`
(`packages/paseo-plugin-helper/src/server/mcp-injection.ts:1-31`). The plugin
cannot forward it, so the text that lands in the system prompt is the stale one.

Why the stale advice is not merely redundant: `x_comms_wait` **blocks the caller's
own turn** until the target is idle. An agent that follows surface 2 synchronises
on every outbound message instead of queueing, so it converts a non-blocking
bounded queue back into a blocking wait — and it does so for *every* peer, not
only the busy one, because it cannot tell in advance.

The preemption-avoidance rationale in surface 2 is not wrong, it is **obsolete**:
the gate makes preemption impossible without any agent cooperation. The rest of
surface 2's reply guidance (`x_comms_send` to `sender.agentId` on
`sender.daemonServerId`, `x_comms_add_daemon` when the sender's daemon is
unknown, never emit the envelope into chat) is current and correct.

**Obligation.** Rewrite the REPLY paragraph of `RECIPIENT_INSTRUCTIONS` and
§5 of the SKILL to state the queue rule and keep `x_comms_wait` as the
blocking-wait tool rather than the pre-emption guard. The
`recipient-instructions.test.ts` suite pins several load-bearing phrases in that
paragraph but not this one, so a fix needs a new assertion, not just an edit.

---

## B. Documented but absent (or described as something it is not)

| # | Doc claim | What the code does | Where |
|---|---|---|---|
| B1 | "Key scheme `x-comms.<serverId>`" | `x-comms_<serverId>` — underscore, and there is a test that pins the real ACP constraint and explains why (a dotted name fails Gemini's `session/new` with JSON-RPC `-32602` and breaks every newborn Antigravity agent, #243). The documented form is the one that is known to break. | `docs/mesh.md:111` vs `server/injection.ts:30-31` |
| B2 | "Both producers stamp the identical **version-4** envelope" | Both stamp **version 6**. | `docs/mesh.md:149` vs `shared/envelope.ts:232`, `mcp/paseo-x-comms.mjs:363` |
| B3 | "carries it in the **version-5** envelope" | Version 6. v5 is only the legacy *read* path. | `docs/mesh.md:150` vs `shared/envelope.ts:290-322` |
| B4 | "Implemented on this branch" | It is on `main`; "this branch" is a leftover from the original PR description. | `docs/mesh.md:107` |
| B5 | "Stdio config uses `process.execPath` plus the runtime-resolved bundled server path, so it works from git checkouts on foreign hosts" | Two corrections. The command is `resolveNodeCommand(process.execPath)`, which returns the literal `"node"` unless the basename looks like `node`/`bun`/`deno` — under Electron `process.execPath` is the GUI binary. And the path is *not* the checkout path: `syncStableServer()` copies the bundle to `~/.paseo/paseo-x-comms/bin/paseo-x-comms.bundled.mjs` and injects that, because plugin checkouts are content-addressed and replaced on every update. The injected env also carries one variable, `PASEO_X_COMMS_MESH_KEY`, as an absolute path, which the doc does not mention at all. | `docs/mesh.md:113-114` vs `server/injection.ts:57-107,114-120` |
| B6 | "Layer 3: Visibility — **Not implemented.**" | Half implemented now. `conversations.json` is a real thread snapshot with unread counts, written on every send and on every timeline reconcile, pruned on retract, detached on archive, capped at 200, and its shared zod contract is explicitly "for cross-plugin readers (top, mcp-tools)". What is still not implemented is the narrower thing the paragraph goes on to describe — "injection snapshot plus diff against live session configs". The doc under-claims, which is the safer direction but still wrong. | `docs/mesh.md:125-127` vs `server/conversations-snapshot.ts`, `shared/conversations-snapshot.ts` |
| B7 | "The plugin's conversation/panel UI wraps `send`/`logs`/`wait`/permissions for interactive use." | The client calls **exactly one** send RPC. There is no wrapper for `x_comms_logs`, `x_comms_wait`, `x_comms_list_permissions`, `x_comms_allow_permission` or `x_comms_deny_permission` anywhere under `client/`. Outside `mcp/`, those five names appear exactly twice in the whole plugin: in the recipient *instruction prose* (`server/recipient-instructions.ts:33`, text handed to an agent) and in a historical code comment (`index.server.ts:89`). Neither is a UI wrapper. The UI's other RPCs are registry/health/introspect/prefs/snapshot/dump/identity/server-status/probe/introduce/peer-status — none of them wraps a tool. | `README.md:89` vs `index.client.tsx`, `client/main.tsx`, `client/x-comms-conversation.tsx` |
| B8 | "Key distribution rides the same channel as presence, and a presence handler has no link context, so **pairing remains the trust root**." | Still true of *pairing*, but the stated mechanism is out of date and reads as a live limitation. Key distribution has its own RPC, `mesh.key`, whose handler **does** have link context: it is invoked over `invokePeerRpc`, which checks the handshake `serverId` against the pairing offer before any payload is sent, and the caller overwrites the response's `serverId` with the link's own verified identity. The stated limit is closed. | `mcp/README.md:183-187`, echoed at `docs/mesh.md:66-69` vs `server/peer-channel.ts:128-142,181-207` |
| B9 | "Only these canonical forms are accepted." | True of the **plugin's** save path (`validateDaemonHost`, and `mutateRegistry` refuses to write when any entry fails). False of the **MCP** path: `x_comms_add_daemon` performs no validation at all, and `hostTargetFor` on the read path only checks that the name exists and the value is non-empty. So the same registry is strict on one write path and permissive on the other. | `mcp/README.md:225` vs `server/registry.ts:191-224,317-397` and `mcp/paseo-x-comms.mjs:229-237,1021-1026` |
| B10 | Tool table: `x_comms_list_daemons` — "List registered daemons (names only)". | The `detailed: true` mode and the `source` field are described in prose in a later section, but the **configured-hosts merge** is not described at all: the tool returns Paseo's `~/.paseo/hosts.json` entries too, not just the manual registry, and reports which is which as `source: "registry" \| "configured-host"`. A reader takes "registered daemons" to mean the file the tool writes. | `mcp/README.md:104` vs `mcp/paseo-x-comms.mjs:166-211` |
| B11 | Tool table: `x_comms_send` — "Queues it if the target is mid-turn (`delivery`, `queueDepth`, `expiresAt`)" | Reads as though `delivery` is always present. On the dispatched path it is **absent**: the tool returns the `paseo send` CLI's own JSON verbatim. A caller that switches on `delivery` gets `undefined` for the common case. | `mcp/README.md:109` and the tool's own `description` at `mcp/paseo-x-comms.mjs:1091` vs `:980` |
| B12 | Install: `paseo plugin add <owner>/paseo-x-comms`, and "paseo runs a single `npm install` at the repo root, which pulls both the plugin dependencies and the embedded server's dependencies into one `node_modules`. The server is spawned from `./mcp`". | The shipped install forms are `paseo plugin add npm:@xpufx/paseo-x-comms` and `paseo plugin add xpufx/paseo --path plugins/x-comms`. The manifest has an explicit production dependency-install build (`npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-workspaces`), and the injected server is **never** spawned from `./mcp` — it is the committed `paseo-x-comms.bundled.mjs` copied to a stable path in the state dir. `mcp/README.md:59-61` describes a build that no longer exists. | `mcp/README.md:46-61` vs `paseo-plugin.json`, `server/injection.ts:78-107` |
| B13 | "the 'Inject MCP into context' system-prompt toggle" | No surface is labelled that any more. The composer pill says **"MCP injection"**; the prototype settings surface says **"Agent introduction injection"**. The same toggle has three names across the code and the docs. | `mcp/README.md:50` vs `client/x-comms-pill.tsx:87-89`, `client/settings-prototype.tsx:379-382` |
| B14 | Configuration table lists five env vars. | Two more are read: `PASEO_HOSTS_FILE` (by both the plugin registry and this server) and `PASEO_X_COMMS_MCP_SERVER` (by the plugin, as the bundled-server path override). | `mcp/README.md:287-293` vs `mcp/paseo-x-comms.mjs:46-48`, `server/registry.ts:33-37`, `server/server-status.ts:18-21` |
| B15 | Extensions: filters are documented, `api.version` is documented. | Not documented: that `onToolCall` wraps extension-registered tools too (because `registerTool` is the single registration chokepoint), and that `onReceive` does **not** (it is applied by the built-ins' own `callPaseo` helper, so an extension tool that dials a daemon is outside the receive filter). Also not documented: every extension log line and every block reason is passed through `redactSecrets`, so a hook cannot write a pairing offer into the server log. | `mcp/README.md:230-268` vs `mcp/paseo-x-comms.mjs:517-626` |

---

## C. Absent but undocumented (real code, no prose anywhere)

| # | Feature | Why it matters | Where |
|---|---|---|---|
| C1 | **`daemonEnabled` is enforced in target resolution.** `resolveDaemonEnabled` existed from the start and *nothing called it*, so the per-daemon toggle persisted, round-tripped through its RPC and changed nothing — the control was asserting something false. It is now applied in `targetRegistryEntry`, so it gates the busy gate, the drain and the pre-stamped send together, and in `validPeerTargets`, so a disabled daemon is not dialled for presence either. Matching is by registry **name**, with a `serverId` caller folded to its alias first, so both spellings of one daemon are filtered identically. | This is the fix for a control that lied. Nothing in the READMEs or in `mesh.md` mentions the toggle, so an operator reading the docs has no way to know that switching a daemon off now stops chat **and** presence fan-out to it. | `server/handlers.ts:685-703,1045-1060`, `server/settings.ts:41-43` |
| C2 | **Two independent drainers, one of them blind.** The MCP server drains only `stamped: true` items; the plugin server drains both. So an item the MCP enqueued is re-offered only when some agent on this daemon next calls `x_comms_send` — there is no timer in that process. The queue is shared and the item still expires on its own window. | A consequence an operator cannot derive from either contract: under sustained idleness an MCP-queued message can sit for most of its 30 minutes. | `mcp/paseo-x-comms.mjs:827-892` vs `server/handlers.ts:1587-1607` |
| C3 | **`x_comms_list_daemons` reports `status: "online"` for every daemon, unconditionally.** The tool does not probe. `serverId` is still derived from the *raw* value, so identity survives the redaction of `target`. | A caller reading that field as liveness gets a confident wrong answer for every unreachable peer. Undocumented, and the field name invites exactly that reading. | `mcp/paseo-x-comms.mjs:1004` |
| C4 | **Registry writes differ in file mode.** The plugin writes `registry.json` `0600`; the MCP server's `saveManualDaemons` uses the process default. The file holds live pairing offers — daemon control tokens. | Two write paths to the same credential file with different protection. | `server/registry.ts:387` vs `mcp/paseo-x-comms.mjs:213-216` |
| C5 | **`daemon.add` refuses a registry where two names share one host value**, and **the name charset is `^[A-Za-z0-9._-]+$`** on add, update and remove alike. | The duplicate-value rule is a real write refusal with a real error string, and nothing documents it. It exists because a duplicate is almost always a copy bug rather than an intentional alias. | `server/registry.ts:260-267,366-380` |
| C6 | **`daemon.update` supports rename and value; no MCP tool can do either.** `x_comms_add_daemon` silently overwrites a name; the plugin's `daemon.update` is the only way to rename an entry, and it is exposed only through the Current tab of the Main surface. | The two surfaces have different write capabilities against the same file, in opposite directions: the tool can destroy an entry's identity, the UI is the only thing that can rename one. | `server/handlers.ts:105-133` vs `mcp/paseo-x-comms.mjs:1021-1026` |
| C7 | **`directHostMismatch`** — a pure advisory that flags a direct host whose entered name does not resemble its URL host, rendered inline as a form error. Advisory, not a rejection, because a name may legitimately differ from an IP. | Present in `shared/registry.ts` next to the RPC contracts and used by two client surfaces. Documented nowhere. | `shared/registry.ts:399-410` |
| C8 | **`snapshot.refresh` has three side effects beyond refreshing a cache**: it records per-peer reachability (which can trigger an immediate outbox retry), it **pins peer verify keys** (rate-limited to once per 5 min, with a 5 s whole-pass deadline), and it **reconciles local agent timelines into the conversations snapshot**. | A user-visible button with a security-relevant side effect and a 5-minute rate limit attached, described in the docs only as "refresh (identity + snapshot)". | `server/handlers.ts:764-770,1085-1132` |
| C9 | **`daemon.dump` probes six CLI surfaces in parallel** and unwraps several of Paseo's historical response shapes (`{data:[…]}`, `{schedules:[…]}`, `{terminals:[…]}`, nested `{data:{…}}` for status). | It is the plugin's only deep remote-inspection surface and its leniency is deliberate version-tolerance, not sloppiness. Undocumented. | `server/handlers.ts:842-942,806-836` |
| C10 | **`daemon.dump.permissions` is always `[]`.** The field is required by the zod contract and has no implementation behind it. | A client schema field that always reports "no permissions" on a daemon that may well have some. | `server/handlers.ts:838-839,930` |
| C11 | **The PeerStatus RPC reads a peer's `getHubStatus`** and surfaces `hubState`, `hubDaemonId`, `hubOrigin`, `hubLastError`. A peer without hub support stays null and the field is skipped silently. | The Peers tab renders it; nothing explains where it comes from or that it is best-effort. | `server/peer-status.ts:100-112,209-213` |
| C12 | **Three version identities are in flight.** The npm package version is `0.3.2` in both manifests and is parity-guarded by a test. But the MCP server's own reported version is the hardcoded `VERSION = "0.3.0"` in the initialize result, the composer pill's About section says `0.3.0`, `McpStdioClient`'s `clientInfo` says `0.3.0`, and both `DaemonClient` constructions send `appVersion: "paseo-x-comms/0.3.0"`. A fourth number, `PLUGIN_VERSION = "0.3.1+b174c243"`, is the auto-generated git stamp in `shared/version.ts`. | A peer reading the initialize result sees 0.3.0 while the installed package is 0.3.2. The parity guard only covers the two manifests, because that was the drift it was written for (#604). | `mcp/paseo-x-comms.mjs:37`, `client/x-comms-pill.tsx:141`, `server/mcp-client.ts:17`, `server/peer-channel.ts:190`, `server/peer-status.ts:159`, `shared/version.ts:2` |
| C13 | **Two independent mesh-key loaders.** The plugin's `server/mesh-identity.ts` and a standalone copy inside the MCP bin. Both re-derive the `keyId` fingerprint from the DER bytes on load and reject a mismatch; the plugin additionally writes `0600` and atomically, and pins peer keys permanently. The MCP copy is what the agent-facing tool actually uses. | Both are correct, and the duplication is load-bearing (the MCP server is a standalone `engines.node >=18` bin and cannot import the plugin's TypeScript). But the standalone copy is the one in production for agent sends, and it is the one with no `0600` guarantee on an existing file. | `mcp/paseo-x-comms.mjs:122-151` vs `server/mesh-identity.ts:81-140` |
| C14 | **The bundled server path is resolved by a five-tier search**: `PASEO_X_COMMS_MCP_SERVER` → the install path the daemon records in `~/.paseo/config.json` (this plugin's own entries first, so a sibling install cannot shadow it) → the managed `~/.paseo/plugins/<id>/<commit>/checkout/mcp/` layout → `import.meta.url` → cwd. | A plugin server is bundled and inlined before it runs, so neither `import.meta.url` nor `process.cwd()` identifies the checkout (#214). The dependable locator is the recorded install path. Undocumented, and the reason a misconfigured install is hard to diagnose. | `server/server-status.ts:1-138` |
| C15 | **The per-daemon enable toggle is only reachable from the Prototype tab**, not from the composer pill's Settings tab (which has presence and injection only) and not from the Current tab. | The control that stops chat to a daemon is behind a tab labelled `Prototype` / `new`. | `client/settings-prototype.tsx:286-299` vs `client/x-comms-pill.tsx:71-102` |
| C16 | **The composer pill's header button is registered for existing agents by a one-shot `agents.list()` at startup**, not only by the `agents.subscribe` upsert handler. Without the list the icon is missing after a Paseo restart until the next agent event. | A small, correct fix with no prose behind it. Recorded so a future reader does not "simplify" the list call away. | `index.client.tsx:48-69` |
| C17 | **The two drain directories agree by construction, not by configuration.** The MCP server derives `pending/` from `dirname(PASEO_X_COMMS_REMOTES)`, so overriding the registry path moves the queue with it. A test reads both files and asserts the five constants and the rename line agree, because the MCP copy cannot import the plugin's TypeScript. | The duplication is intentional and guarded. Worth recording that the guard exists and what it pins, so nobody treats the two implementations as independent. | `mcp/paseo-x-comms.mjs:645-655,1146-1166` |
| C18 | **Notices are local prose, not envelopes.** The delivery-notice text carries a `[x-comms] ` prefix but no JSON, so `parseEnvelope` returns `null` for it. | Deliberate and load-bearing: if a notice parsed as an envelope it would enter the conversation derive and `reconcileTimelines` as an attributable delivery. Undocumented as an invariant, so it looks like an oversight. | `server/defer-queue.ts:343-349`, `mcp/paseo-x-comms.mjs:894-896` |
| C19 | **A configured host is addressable by `serverId` because `findDaemonByRef` matches name *or* `serverId`.** Without that pass, a labelled host's registry name is not its `serverId` and every lookup misses — which the busy gate reads as "not busy" and dispatches, re-opening the preemption the gate exists to prevent. | The reason a Desktop-addressed host is gated at all. | `server/registry.ts:39-52` |
| C20 | **The unknown-daemon diagnostic is dependency-free on purpose.** `handlers.ts` pulls in the vendored helper, whose TypeScript parameter properties Node's strip-only loader cannot parse, so a test cannot import the diagnostic from there. | Explains why the string is duplicated in `server/unknown-daemon.ts` and in the MCP bin rather than shared. Anyone "deduplicating" it will break a test and should not. | `server/unknown-daemon.ts:11-17` |
| C21 | **The mesh-key pass shares one in-flight promise across concurrent refreshes** and resolves either way, because a rejected promise there would reject every reconcile that shared it. | Explains a shape that looks wrong at a glance. | `server/handlers.ts:1085-1122` |

---

## D. Claims in the shipped docs that are correct and worth keeping

Recorded so a future respec does not re-open them. Each was checked against the
code, not assumed.

* The delivery contract's four states, the three bounds (8 / 200 / 30 min), the
  crash behaviour (stale claim reported, never replayed), and the fail-open
  gate — all match `server/busy.ts`, `server/defer-queue.ts` and
  `server/outbox.ts` exactly.
* "Every route is covered" — true. `conversation.send` is the only gated entry
  point, and both the registry/relay path and the Desktop configured-host path go
  through it. The client no longer borrows a `PaseoApi` to send anything
  (`client/configured-hosts.ts:52-56`).
* The envelope field list, the 11 signed fields, and the exclusion of `direction`
  and the body — match `shared/envelope.ts` and the two producers.
* "You cannot forge your own sender" — `inAgentSession()` really does ignore
  `fromAgentId` inside an agent session, and the self-message guard is evaluated
  on the same precedence, so passing one cannot skip it either.
* "The registry holds live pairing offers: it is credentials" — and the
  redaction rationale (`#offer=` keyed rather than host-keyed, so a self-hosted
  relay is not the exemption that leaks) matches `mcp/daemon-target.mjs`.
* The recipient-instructions content tests pin the load-bearing phrases, and
  `index.server.test.ts` pins the wiring — so the "the injection is live"
  claim is asserted, not just asserted-about.
