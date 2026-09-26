# x-comms MCP server — features contract

Derived from `plugins/x-comms/mcp/paseo-x-comms.mjs` as it stands, not from what
it was designed to do. Every row below was read out of the source named in its
*Where* cell. Where the shipped docs and the code disagree, the code wins and
the disagreement is recorded in [`contract-drift.md`](contract-drift.md).

The companion contract for the plugin that embeds and injects this server is
[`contract-plugin.md`](contract-plugin.md).

## What this process is

A single-file, dependency-light Node ≥18 stdio MCP server. It is a **client** of
Paseo daemons: it never runs a daemon, and it only talks to agents. Every daemon
interaction is an `execFile("paseo", [...])` shell-out, so `--host` is an opaque
string that Paseo classifies: a value containing `#offer=` is a relay connection
(E2EE), anything else is a direct host target.

It ships two ways:

* **Standalone**, via `npm install -g @xpufx/paseo-x-comms`, which puts
  `paseo-x-comms` (→ `mcp/paseo-x-comms.mjs`) on `PATH`.
* **Embedded**, as the artifact `mcp/paseo-x-comms.bundled.mjs`. **Nobody runs
  the unbundled source in production**: `server/injection.ts` copies the bundle
  to a stable path and the daemon injects that into every newborn agent. The
  committed bundle is guarded by a byte-identity test against a fresh build with
  the pinned esbuild, so a source fix that does not reach the bundle fails CI
  rather than shipping (#600).

## How to read this

Each feature states **Does** / **I/O** / **Fails** / **Depends on**, where
*Depends on* is `local` (decides in this process), `peer` (needs a live peer
daemon), or `fs`. "Deterministic" means the same input and the same local state
give the same output — no network, clock, or filesystem-race dependence.
Everything marked `peer` is a sample of a remote daemon's state at one instant.

## Inventory

| Surface | Count | Where |
|---|---:|---|
| Tools | 11 | `mcp/paseo-x-comms.mjs:983-1185` |
| Server capabilities beyond tools | 14 | see below |
| **Total** | **25** | |

Capability list: C1 envelope stamping and signing · C2 sender identity
resolution · C3 self-message guard · C4 busy gate · C5 defer queue · C6
delivery notices · C7 registry I/O · C8 configured-hosts merge · C9 target
preflight and unknown-daemon diagnostic · C10 offer redaction · C11 extension
host · C12 paseo shell-out with cancellation · C13 result envelope · C14
`instructions` handshake.

---

## 1. Tools (11)

All names are `x_comms_*`. A client may surface them under a registration
prefix (`paseo_cross_daemon_*` in pi, for example), so match the names actually
in the client's tool list.

Every result is built by `result()`: a `content: [{ type: "text", text }]` block
for every client, plus `structuredContent` **only when the payload is a plain
record** — arrays are not wrapped into one, matching Paseo's own
`ensureValidJson({ … })` convention.

### 1.1 `x_comms_list_daemons`

* **Does** — lists the merged daemon set. Names only by default; with
  `detailed: true`, one object per daemon: `{ name, target, status, serverId, source }`.
* **I/O** — in `{ detailed?: boolean }` → `string[]` or `Record[]`.
* **Fails** — a corrupt `registry.json` throws
  `cannot read daemons registry at <path> (corrupt JSON?)`. A corrupt
  `hosts.json` is swallowed and treated as no configured hosts.
* **Depends on** — fs.

Three things a caller must know:

* **`status` is the literal `"online"` for every entry, always.** The tool does
  not probe. It is a placeholder, not a liveness answer; use `x_comms_inspect`
  or the plugin's `peer.status` for that.
* **`serverId` is derived from the raw target value even though `target` is
  redacted**, so identity resolution is unaffected by the redaction.
* **`source` is `"registry"` or `"configured-host"`**, and configured hosts
  override nothing: the merge is `{ ...configured, ...manual }`, so a manual entry
  with the same name wins.

### 1.2 `x_comms_add_daemon`

* **Does** — writes `manual[input.name] = input.offer` into the registry file and
  returns the resulting name list.
* **I/O** — in `{ name, offer }` → `{ ok: true, daemons: string[] }`.
* **Fails** — a corrupt registry throws. Nothing else: no host-form validation, no
  duplicate check. An existing name is **silently overwritten**. A direct
  `tcp://…` or relay offer is stored verbatim.
* **Depends on** — fs.

This is the tool-facing twin of the plugin's `daemon.add` RPC, and it is
**materially weaker**: the plugin validates the name charset, rejects duplicates,
rejects a registry where two names share one host, and refuses to write when any
entry is invalid. The MCP write path does none of that.

### 1.3 `x_comms_remove_daemon`

* **Does** — deletes a manual entry.
* **I/O** — in `{ name }` → `{ ok: true, daemons: string[] }`.
* **Fails** — throws `unknown daemon '<name>'`, or, for a name that exists only in
  `~/.paseo/hosts.json`, a distinct error saying so explicitly: the daemon is
  managed via configured hosts and cannot be removed from here.
* **Depends on** — fs.

### 1.4 `x_comms_list_agents`

* **Does** — `paseo ls --host <target> --json`.
* **I/O** — in `{ daemon }` → the CLI's JSON, verbatim.
* **Fails** — an unknown alias throws the unknown-daemon diagnostic **before** any
  Paseo attempt. A transport failure throws the redacted first line of stderr.
* **Depends on** — peer.

### 1.5 `x_comms_inspect`

* **Does** — `paseo inspect <agentId> --host <target> --json`.
* **I/O** — in `{ daemon, agentId }` → the CLI's JSON, verbatim.
* **Fails** — as above.
* **Depends on** — peer.

### 1.6 `x_comms_send`

* **Does** — the whole send contract. Detailed in [§3](#3-the-send-path).
* **I/O** — in `{ daemon, agentId, prompt, fromAgentId?, fromAgentName?, messageId?, notifyOnFinish? }` → on dispatch, the CLI's own JSON payload; on queue, a synthesized `{ delivery: "queued", daemon, agentId, reason, queueDepth, expiresAt, messageId }`; on refusal, `{ error, delivery: "dropped", daemon, agentId }`.
* **Fails** — `isError` for an unknown alias, a self-message, a full queue, or a
  transport failure.
* **Depends on** — peer + fs.

### 1.7 `x_comms_logs`

* **Does** — `paseo logs <agentId> --host <target> --json`.
* **I/O** — in `{ daemon, agentId }` → the CLI's JSON, verbatim.
* **Fails** — as `list_agents`.
* **Depends on** — peer.

### 1.8 `x_comms_wait`

* **Does** — `paseo wait <agentId> [--timeout N] --host <target> --json`.
* **I/O** — in `{ daemon, agentId, timeoutSeconds? }` → `{ status: "idle" | "permission" | "timeout" | … }` as the CLI reports it.
* **Fails** — an unknown alias throws. A remote `permission` status is a normal
  return, not an error.
* **Depends on** — peer.

`timeoutSeconds` maps to the CLI's `--timeout` and is passed through unclamped
beyond `z.number().int().positive()`.

### 1.9 `x_comms_list_permissions`

* **Does** — `paseo permit ls --host <target> --json`.
* **I/O** — in `{ daemon }` → the CLI's JSON, verbatim.
* **Fails / Depends on** — as `list_agents` / peer.

### 1.10 `x_comms_allow_permission`

* **Does** — `paseo permit allow <agentId> [reqId] [--all] [--input <json>] --host <target> --json`.
* **I/O** — in `{ daemon, agentId, reqId?, all?, input? }` → the CLI's JSON.
* **Fails** — throws `provide reqId or all=true` when neither is given.
* **Depends on** — peer.

### 1.11 `x_comms_deny_permission`

* **Does** — `paseo permit deny <agentId> [reqId] [--all] [--message M] [--interrupt] --host <target> --json`.
* **I/O** — in `{ daemon, agentId, reqId?, all?, message?, interrupt? }` → the CLI's JSON.
* **Fails** — throws `provide reqId or all=true` when neither is given.
* **Depends on** — peer.

---

## 2. Capabilities (14)

### C1 · Envelope stamping and signing

Stamps `<x-comms-message>{"xComms":{…}}</x-comms-message>` — version **6**,
`type: "x-comms.message"`, `direction: "outgoing"` — then `\n\n` and the caller's
prose. Field-for-field identical to the plugin's
`buildSenderEnvelope` / `senderMetaBlock`; the two producers are byte-compatible
and both feed the same `parseEnvelope`.

`auth` is an ed25519 signature over a canonical, field-ordered payload: the
context line `x-comms/envelope-auth/v1` then one line each for `version`, `type`,
`sender.agentId`, `sender.agentName`, `sender.host`, `sender.daemonServerId`,
`sender.cwd`, `target.daemon`, `target.agentId`, `messageId`, `sentAt`. Eleven
fields, in that order and that spelling, duplicated here because the key is
`PASEO_X_COMMS_MESH_KEY` and the file layout is not importable. `direction` and
the prose are excluded: this authenticates who sent, not what they said.

* **Fails** — if the mesh key is missing or unreadable, the send still goes out
  **unsigned**. That is legal on the wire and never trusted by a receiver; it
  degrades to "unattributable", never to a lost message. A key file whose
  `keyId` does not match the fingerprint of its own public key is treated as
  absent — the fingerprint is re-derived from the DER bytes on every load, so a
  hand-edited `keyId` cannot vouch for other bytes.
* **Depends on** — local.

### C2 · Sender identity resolution

`gatherSenderMeta()` builds the `sender` block from sources the agent cannot
forge: `agentId` and `cwd` from the daemon-injected environment
(`PASEO_AGENT_ID`, `PASEO_AGENT_CWD`), `host` and `daemonServerId` from
`paseo daemon status --json` (15 s), `agentName` from
`paseo inspect <agentId> --json` (15 s). OS hostname is the fallback for `host`
when the status probe fails; an id-only identity is accepted when the inspect
probe fails. The result is memoised for the life of the process.

**`inAgentSession()` is the trust boundary.** True when `PASEO_AGENT_ID` is
present. In an agent session, any `fromAgentId` / `fromAgentName` the caller
passed is **ignored** and the daemon-injected id is stamped instead. The
boundary exists because an agent cannot set its own environment, whereas honouring
the argument would let any agent have the trusted server stamp a sender block
claiming somebody else — the same forgery as hand-writing the tag, one call
cheaper (#594).

* **Depends on** — local (with two local CLI probes).

### C3 · Self-message guard

Sending to your own agent is almost always a mistake, and the envelope tells the
recipient it is from itself. Refused with the fixed, greppable label
`x-comms self-message: target agentId '<id>' is your own agent — choose a
different agent.`

The guard is evaluated on the **same precedence as the stamp**: an agent
session's `fromAgentId` is ignored, so judging the guard on it would let a
caller pass one to skip the check. Same-daemon-but-a-different-agent is a
locality rule, not self, and is still open (#9).

* **Depends on** — local.

### C4 · Busy gate

Paseo's daemon sends with `replaceRunning: true`, so dispatching into a running
target **replaces its turn**. A send therefore reads the target's lifecycle
first: `paseo inspect <agentId> --host <target> --json` with a 5 s timeout.

* **Busy is a deny-list:** `initializing`, `running`, `busy`, `permission`,
  `awaiting_permission`, `waiting_permission`. `error` and `closed` are
  deliberately *not* busy — nothing is running to replace, and treating them as
  busy would pin a queue against an agent that has already crashed, with no turn
  ever coming to drain it.
* **Casing is inconsistent** across daemons, so the probe result is read through
  `Status`, `status`, `lifecycle`, `Lifecycle` and lowercased.
* **Fails open.** A probe that errors or reports an unreadable state **dispatches**,
  and the send then fails loudly if the target is genuinely unreachable. The
  alternative turns "cannot tell" into a silently swallowed message, which is the
  worse failure.
* **Depends on** — peer.

There is no verdict cache in this process. Every send re-probes. That is safe
here because the plugin server, which does cache and does call `noteDispatched`,
is the one that shares this queue — see [§5](#5-two-drainers-one-blind).

### C5 · Defer queue

A held send lives in its own file under `<registry dir>/pending/`: `.json`
waiting, `.sending` claimed. One file per item so this process and the plugin
server can both write with no lock and no cross-process read-modify-write.

| Property | Value |
|---|---|
| Depth per target | **8** — overflow evicts the **oldest waiting** item |
| Fleet-wide | **200** — at the ceiling the **new** item is refused (`dropped`) |
| Expiry | **30 min** |
| Targets per drain pass | **3** |
| Claim | `rename .json → .sending`; succeeds for exactly one drainer |
| Delivery | `paseo send <id> --host <target> --message-id <id> --json --no-wait <bytes>`; `LOCAL_DAEMON` (`"local"`) omits `--host` |

* The directory is derived from the registry path, so `PASEO_X_COMMS_REMOTES`
  moves the queue with it and a test never touches the operator's real one.
* Enqueue is a fresh uniquely-named file and never reads the queue, so it can
  neither clobber nor be clobbered.
* A `.sending` file present at the start of a later pass is a claim whose process
  died mid-send: the target may already have the message, so it is counted as
  `unknown` and dropped, never replayed.
* A failed (not crashed) delivery renames the claim back and retries later.
* Unreadable item files are left in place and age out on their own expiry.
* Eviction is logged per item.

The bounds, directory name and claim mechanics are pinned against
`server/defer-queue.ts` by a test that reads both files, so the two copies cannot
drift on the numbers or the rename.

* **Depends on** — fs (the decision is peer).

### C6 · Delivery notices

`notifyOnFinish` defaults to **true**. A notice is a `kind: "notice"` item in the
same queue, addressed to the local sender, and it carries **no `fromAgentId` of
its own** — an x-comms sender is always an agent on this daemon, so a notice back
to the sender needs no registry name to route.

The notice is queued rather than sent because Paseo's own notify-on-finish path
*steers* the caller's turn, which would reintroduce the preemption the queue
exists to remove, in the other direction. A notice is only queued if a sender
`agentId` is known; without one there is nothing to address it to.

Text: `[x-comms] delivery notice: your message to '<daemon>/<agentId>' landed at
<ts> (messageId <id>). The target read it at the start of a turn of its own;
nothing was interrupted.`

That text is **not an envelope** — it has a `[x-comms] ` prefix but no JSON, so
`parseEnvelope` returns `null` for it. A notice is local prose and deliberately
not an attributable delivery.

* **Depends on** — local.

### C7 · Registry I/O

`~/.paseo/paseo-x-comms/registry.json`, a flat `{ name: "<opaque --host>" }`
object, overridable with `PASEO_X_COMMS_REMOTES`.

* A missing file is `{}`, not an error.
* A corrupt file **throws** — `cannot read daemons registry at <path> (corrupt
  JSON?)` — rather than silently treating every daemon as unknown.
* A write is `mkdir -p` + `JSON.stringify(daemons, null, 2)` + a trailing newline.
  Mode is the process default, not `0600`; the plugin's own registry writes do
  set `0600`. The file holds live pairing offers, so the two write paths do not
  have the same protection.
* The registry maps a **name** to an opaque `--host` string. The name is the
  registry key, the value is passed to Paseo untouched — no wrapping, no legacy
  formats.

* **Depends on** — fs.

### C8 · Configured-hosts merge

`~/.paseo/hosts.json` (overridable with `PASEO_HOSTS_FILE`) is read and merged
under the manual registry. Accepted shapes: an array, an object with a `hosts`
array, or a flat name→endpoint object. Endpoint keys tried in order:
`endpoint`, `target`, `url`, `offer`, or the string itself. Name keys tried in
order: `label`, `name`, `serverId`, or the id decoded from an embedded offer.

Configured hosts are **read-only** from this server's point of view; see
`x_comms_remove_daemon`.

* **Depends on** — fs.

### C9 · Target preflight and the unknown-daemon diagnostic

`hostTargetFor()` resolves the alias **before** any Paseo attempt, so a miss
fails fast with the exact name and the real reason:

```
unknown daemon '<name>' — no registry entry for that name: register a direct
host (host:port, tcp://…, unix://…, bare port) via x_comms_add_daemon, or a
relay pairing offer from `paseo daemon pair`; list the registered names with
x_comms_list_daemons (registry: <path>)
```

This is **not** a pairing requirement, and the hint is careful about that: pairing
is only one of the ways to create a registry entry, and a direct `--host` needs no
offer at all. Earlier wording told the reader pairing was required *and* pointed
at `x_comms_add_daemon` — the non-pairing route — which sent people into an
E2EE setup for what was a registry lookup. Two tests hold the current wording,
including one against a registry that contains only direct hosts.

An empty (but present) host value gets its own error: `daemon '<name>' has an
empty host value`.

* **Depends on** — fs.

### C10 · Offer redaction

Two distinct mechanisms, both required, and both applied on the error path as
well as the normal one.

**Tool results — `redactDaemonTarget`.** Replaces everything from `#offer=`
onward with `[REDACTED]`, keeping the surrounding URL so a result still says
*which* relay this is. Keyed on the `#offer=` marker rather than on the
`app.paseo.sh` host, because a pairing URL is accepted on any https host and a
self-hosted relay must not be the exemption that leaks. A direct
`tcp://host:port` target is returned in full because it contains no token. A
trailing path cannot smuggle the token past the match: everything from the marker
goes.

**Error and log paths — `redactSecrets`.** Applied to:

* the first line of `stderr` on a failed `paseo` call — `paseo` quotes the
  `--host` value back on a failed relay handshake, and for a relay daemon that
  value *is* the pairing offer, a control token that must not reach the agent as
  a tool error (#597);
* every extension log line, including a hook's or a load failure's error text, so
  a throwing extension cannot smuggle an offer into the server log;
* an extension block reason surfaced as a tool error.

`redactSecrets` also redacts `Bearer …` tokens, `user:password@` in URLs, and any
object key whose normalised name contains one of 15 sensitive substrings. It is
a **hand-maintained mirror** of the plugin helper's canonical TypeScript
implementation, because this server is a standalone single-file bin on Node ≥18
and cannot load the helper's TypeScript at runtime. A test asserts the mirror and
the canonical implementation produce identical output, so a helper-side change
fails the suite instead of letting the copy go stale.

* **Depends on** — local.

### C11 · Extension host

> **Trusted, unsandboxed server-tier code.** An extension is a `.mjs` file in the
> extension dir that runs in *this* process with full Node privileges —
> filesystem, network, child processes — exactly like the server itself and like
> any installed Paseo plugin. There is no sandbox, no permission prompt, and no
> isolation boundary. Only drop in extensions you would run yourself.

Dir: `~/.paseo/paseo-x-comms/extensions`, overridable with
`PASEO_X_COMMS_EXTENSIONS`. `*.mjs` only, loaded in filename order at startup,
each expected to export `register(api)` as default or named.

API, version **1** (bump on any breaking change):

| Member | Contract |
|---|---|
| `api.version` | `1` |
| `api.onSend(fn)` | outbound message filter: `{ daemon, agentId, prompt, fromAgentId, fromAgentName, messageId, notifyOnFinish }` |
| `api.onReceive(fn)` | a response from a daemon, with `{ tool, daemon, agentId }` |
| `api.onToolCall(fn)` | every tool invocation's raw args, `{ tool }` |
| `api.registerTool(name, cfg, fn)` | registers on this same `McpServer` |
| `api.log(msg)` | stderr, redacted |

Filter outcome: `undefined` / `null` / `{ action: "pass" }` → passthrough; any
other value → transform (becomes the new payload); `{ action: "transform", value }`
→ transform; `{ action: "block", reason }` → block, stopping the chain, with the
reason surfaced as the tool error. An unknown `action` is logged and passed
through.

Isolation guarantees: a hook that throws is logged and treated as passthrough; a
file that fails to import or register is skipped; one bad extension cannot take
down the server or the other extensions.

Two ordering details that are not in the shipped docs:

* **`onToolCall` wraps every tool, including extension-registered ones**, because
  `registerTool` is the single registration chokepoint.
* **`onReceive` does not wrap extension-registered tools.** It is applied by the
  built-ins' `callPaseo` helper, so an extension tool that talks to a daemon
  itself is not covered by the receive filter.

* **Depends on** — local.

### C12 · Paseo shell-out with cancellation

`runPaseo()` wraps `execFile` with a per-call timeout (default **120 000 ms**,
`PASEO_X_COMMS_TIMEOUT_MS`), a 16 MB `maxBuffer`, and MCP cancellation wiring.

* On success: stdout is `JSON.parse`d, falling back to the trimmed string when it
  is not JSON — so a tool can return either shape.
* On abort: the child is killed with `SIGTERM` and the promise rejects with
  `request cancelled` and `code: "CANCELLED"`. A cancellation in flight when
  stdin closes still resolves or rejects normally; the process does not exit out
  from under a call.
* On timeout: `paseo <cmd> timed out after <n>ms`.
* Otherwise: the **first line** of stderr, redacted. One line only, so a long
  multi-line CLI error cannot push anything past it.

Two calls use a shorter 15 s budget and are not the default: the two
`gatherSenderMeta` probes. The busy probe uses 5 s.

* **Depends on** — local (the shell-out), peer (the result).

### C13 · Result envelope

`result(data)` emits `content: [{ type: "text", text }]` for every client, where
`text` is `JSON.stringify(data, null, 2)` for an object and the raw string
otherwise, plus `structuredContent: data` **only when `data` is a plain record**.
Arrays and strings get text only, so `structuredContent` stays a record.

* **Depends on** — local.

### C14 · `instructions` handshake

The server advertises its behavioural contract through the MCP `instructions`
field on the initialize result: scope boundaries (do not use `x_comms_*` for
same-daemon agents; never emit `<x-comms-message>` into chat or tickets), the
envelope-authenticity rule, the never-interrupt rule and its four outcomes, and
`notifyOnFinish`.

**The plugin cannot forward this into an agent's configuration.** Neither
injection transport has an `instructions` field — `McpStdioInjectionConfig` and
its siblings are `{ type, command|url, args?, headers?, env?, alwaysLoad? }`, and
`AgentCreateInjectionConfig` is `{ mcpServers?, [key: string]: unknown }` — so
the plugin's `agent.create` hook has no slot to put it in. That is the structural
reason the recipient contract also ships as standing instructions folded into
`config.systemPrompt`. See [`contract-plugin.md` §2.2](contract-plugin.md#22-agentcreate-hooks-2-registered-by-one-call).

* **Depends on** — local.

---

## 3. The send path

```
x_comms_send(daemon, agentId, prompt, fromAgentId?, fromAgentName?, messageId?, notifyOnFinish?)
  │
  ├─ onSend filter chain                ── block ─▶ isError (reason, redacted)
  │                                          transform ─▶ the message below is the transformed one
  ├─ hostTargetFor(daemon)               ── unknown ─▶ throw (diagnostic, C9)
  ├─ assertNotSelfMessage()              ── self    ─▶ throw (fixed label, C3)
  ├─ void deferDrain({ exclude: this target })      background, errors swallowed
  │     excluded so a drain cannot race the dispatch below and preempt the
  │     very turn this send is about to start
  ├─ stamp the envelope (C1)            ── BEFORE the busy check, so a queued item
  │                                        carries the exact bytes it will deliver:
  │                                        same signature, same inputs, made earlier
  ├─ busy probe (C4)  ── busy ─▶ deferEnqueue ─▶ delivery:"queued" (+ depth, expiresAt)
  │                                     └─ at a bound ─▶ delivery:"dropped" (isError)
  └─ callPaseo("send", …)  ── throw ─▶ isError
                              └─ ok    ─▶ queue a delivery notice, return the CLI's JSON
```

* **Stamping before queueing is the load-bearing ordering.** A queued item carries
  the exact bytes it will deliver, signature and all, so nothing re-stamps it
  later — re-stamping would move `sentAt` and invalidate the signature.
* **`messageId`** defaults to a fresh `randomUUID()` and is passed to
  `paseo send --message-id`, so the daemon can discard a duplicate before the
  target agent sees it. It is retained across every retry.
* **`fromAgentId` is ignored in an agent session** (C2). It is honoured only for
  the plugin server's own subprocess, which runs without `PASEO_AGENT_ID`.

### 3.1 What the caller is told

| `delivery` | Meaning | Is it `isError`? |
|---|---|---|
| *(absent)* | Dispatched. The result is the CLI's own JSON payload. | no |
| `queued` | Target is mid-turn; held. `queueDepth` is the position (1 = next up), `expiresAt` is when it gives up, and `reason` says why. | no |
| `dropped` | A bound was hit and this message was refused. `error` says which. | yes |

**The tool's own description claims the result reports
`delivery=dispatched | queued`.** It does not: `delivery: "dispatched"` is never
emitted by this tool. The dispatched path returns the CLI's payload verbatim, so
a caller has to infer dispatch from the *absence* of `delivery`. The four-state
vocabulary (`dispatched | queued | outbox | dropped`) is the plugin's
`conversation.send` result, which is a different entry point. `dropped` here also
has no `outbox` counterpart: this process has no outbox; a transport failure is
an `isError`, and the plugin server's outbox is what holds it on the other route.

* **Depends on** — peer.

---

## 4. Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PASEO_X_COMMS_REMOTES` | `~/.paseo/paseo-x-comms/registry.json` | registry file path; the defer queue directory is derived from it, so it moves with it |
| `PASEO_X_COMMS_MESH_KEY` | `~/.paseo/paseo-x-comms/mesh-key.json` | this daemon's signing key for `xComms.auth`; the plugin passes it by absolute path |
| `PASEO_X_COMMS_PASEO` | `paseo` | the `paseo` binary |
| `PASEO_X_COMMS_TIMEOUT_MS` | `120000` | per-`paseo`-call timeout |
| `PASEO_X_COMMS_EXTENSIONS` | `~/.paseo/paseo-x-comms/extensions` | extension dir (trusted, unsandboxed) |
| `PASEO_HOSTS_FILE` | `~/.paseo/hosts.json` | configured-hosts file, read-only |

`PASEO_X_COMMS_MCP_SERVER` is **not** read here — it is a plugin-side override for
locating this server's bundle.

---

## 5. Two drainers, one blind

The defer queue has two independent drainers on the same directory.

| | Plugin server | This MCP process |
|---|---|---|
| Drain trigger | 15 s poll, plus an immediate targeted drain on `agent.turn_ended` | one opportunistic pass at the start of each `x_comms_send`, for the *other* targets |
| Verdict cache | yes, 5 s, with `noteDispatched` after every successful send | none; re-probes every pass |
| Targets per pass | 3 | 3 |
| Items it will deliver | `stamped: false` **and** `stamped: true` | **`stamped: true` only** |
| Notices it delivers | yes (local SDK send) | yes (`paseo send` with no `--host`) |

An item this process enqueues is always `stamped: true`, and an item the plugin
server enqueues is always `stamped: false`. So the split is clean by
construction rather than by negotiation: each side delivers only what it can
deliver correctly, and neither re-stamps (which would change `sentAt`) nor sends
an unstamped prompt (which would drop the attribution the signature exists to
provide).

The consequence to be aware of: a `stamped: true` item this process enqueued for
a target that never goes idle is only re-offered when some agent on this daemon
calls `x_comms_send` again. There is no timer in this process. The item still
expires on its own 30-minute window, and the queue is shared, so the plugin
server's 15 s poll will see it and skip it as `stamped`, leaving it to this
process.

---

## 6. Asymmetries for this surface

Full ledger in [`contract-drift.md`](contract-drift.md). The three that matter
most:

1. **`x_comms_send`'s description promises a `delivery` value the dispatched
   path never returns** (see [§3.1](#31-what-the-caller-is-told)).
2. **`x_comms_list_daemons` reports `status: "online"` for every daemon without
   probing.** A caller reading that field as liveness gets a confident wrong
   answer for every unreachable peer.
3. **`x_comms_add_daemon` silently overwrites and does not validate a host form**,
   while the plugin's `daemon.add` refuses duplicates, validates the name
   charset, and refuses to write a file where two names share one host.

The fourth, the two instruction surfaces contradicting each other on the
never-interrupt rule, was **fixed in #709**: the injected recipient
instructions and `skills/recipient-envelope/SKILL.md` now state the queue rule
this surface already stated, and `instruction-surfaces.test.ts` pins all three
against each other. The remaining risk on this surface is the one the fix cannot
reach — `instructions` has no field in either injection transport, so a correct
string here still does not reach an agent's system prompt on its own.
