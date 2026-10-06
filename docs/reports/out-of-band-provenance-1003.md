# Out-of-band fleet provenance: SDK capability research (#1003)

Research only — no behavior change. Audited 2026-10-06 against:
- this repo at `9ea752d59c051b49701da3c58790198204e816c5` (`feat-1003-out-of-band-provenance-research`);
- `xpufx-org/paseo-upstream` app at `d30e99c858b93e0d469e22d1da7802318f22d5e3`;
- the installed Paseo host `@getpaseo/{cli,server,client,protocol}@0.11.0-beta.5`
  (`/usr/lib/node_modules/@getpaseo/cli/node_modules/...`) and the SDK floor this
  plugin declares/resolves, `@getpaseo/plugin@0.9.2` /
  `@getpaseo/client@0.9.2` / `@getpaseo/protocol@0.9.2`
  (`plugins/uppidi-fleet/node_modules/.pnpm/...`).

The question from the ticket: does the Paseo plugin/agent SDK support delivering
fleet provenance out-of-band — session metadata, system context, or a structured
message field — instead of prefixing the user message with an HTML comment?

## 1. Problem and constraints

`uppidi-fleet` wraps every process- and router-originated prompt in a hidden
JSON HTML comment:

- `formatFleetEnvelope` / `withFleetEnvelope` — `plugins/uppidi-fleet/server/hook-router.ts:742-750`;
- call sites at `hook-router.ts:860` (digest), `:2599` (webhook), `:3911`
  (stand-down), `:4004` (watchdog), `:5328`, `:5825`, `:5837`, `:7581`.

The comment at `hook-router.ts:700-702` states the intent: "fleet-originated
prompts carry a hidden JSON signature as an HTML comment so models can route
machine turns without cluttering the operator's rendered composer feed."

That assumption is wrong on the client. `UserMessage` renders the prompt text
raw, with no markdown or HTML parsing:

- `packages/app/src/components/message.tsx:545-547` (upstream `d30e99c85`):
  ```tsx
  <Text selectable style={userMessageStylesheet.text} dataSet={MESSAGE_TEXT_DATASET}>
    {message}
  </Text>
  ```

So the JSON payload is printed verbatim into the composer bubble.

Two constraints shape the fix:

1. **The envelope must stay model-visible.** There is no *production* parser of
   the `fleet` envelope in this repo or in `platform`; the only readers are test
   helpers (`plugins/uppidi-fleet/server/hook-router.test.ts:114`,
   `platform/scripts/forgejo-hook.test.mjs:2238`). The envelope is a signal for
   the model's own routing, so moving it somewhere the model never sees would
   silently break routing. This is the reason "strip it everywhere" is unsafe.
2. **A second machine payload also leaks.** `formatWebhookMessage`
   (`hook-router.ts:2594-2603`) prepends a plain-text `[forgejo-hook] {...}`
   line before the fleet comment. That line is a documented legacy contract
   (`plugins/uppidi-fleet/docs/router-architecture.md:131-132`) and is *not*
   fixed by HTML-comment stripping. Out of scope here, but do not silently
   delete it.

## 2. What the SDK/daemon actually support

### 2.1 Per-message send surface — no metadata or system-context field

`sendAgentMessage` serializes exactly these fields
(`@getpaseo/protocol@0.9.2` `messages.d.ts:1277`, `SendAgentMessageRequestSchema`):

```
text, messageId, activeTurnBehavior, images, attachments
```

The public handle mirrors that (`@getpaseo/client@0.9.2` `index.d.ts:196`
`PaseoAgentSendOptions`, `:289` `send`). There is **no** `metadata`, no
`systemPrompt`, and no arbitrary structured field on a send.

The runtime host (`0.11.0-beta.5`) widens the options to `SendMessageOptions`
(`.../client/dist/daemon-client.d.ts:149`), which *adds* `activeTurnBehavior`
and otherwise matches: `messageId`, `images`, `attachments`.

### 2.2 System context exists only at agent creation

`AgentSessionConfig.systemPrompt` (`@getpaseo/protocol` `agent-types.d.ts:454`)
is provider-agnostic developer/system instruction, but it is fixed when the
session is created. The plugin lifecycle `before("agent.create")` hook can
rewrite `config.systemPrompt` before creation
(`@getpaseo/plugin` `dist/server/lifecycle.d.ts`, `PluginBeforeRequests`).
It cannot be changed at runtime: `AgentConfigApply`
(`messages.d.ts:2747`) carries only `modelId`, `modeId`, `thinkingOptionId`,
`featureValues`.

This means system context can carry a *static* fleet identity (e.g. "you are
fleet agent `fleet-watchdog`") for agents the fleet spawns itself, but it cannot
carry per-event provenance (`repo`, `kind`, `ref`) that varies on every steer.

### 2.3 Session metadata is not model-visible

Agent `labels` (`Record<string,string>`) exist on creation/snapshot payloads
(e.g. `messages.d.ts:1144`, `:1232`) but are UI/registry metadata, not prompt
content. The fleet already stores `repo` in agent labels and reads it back for
routing (`agentRepoKey`, `hook-router.ts:772`), but the model never receives
those labels.

### 2.4 Attachments are the only structured, model-visible channel

`SendAgentMessageRequest.attachments` accepts a discriminated union; one arm is
a text attachment with an optional `contextKind` and `title`
(`messages.d.ts:761-800`, `TextAttachmentSchema`).

The daemon folds attachments into the provider prompt:

- `buildAgentPrompt(text, images, attachments)` — installed
  `@getpaseo/server/dist/server/server/agent/prompt-attachments.js`: text
  attachments with `contextKind === "chat_history"` are placed **before** the
  user text; all other text attachments are appended **after** the user text
  (and images) as text blocks.
- `renderPromptAttachmentAsText` returns `attachment.text` for a `text`
  attachment, so the model reads it.
- Call sites: `server/dist/server/server/session.js:6158` (wire send) and
  `:2816` (internal send).

On the client the same attachment is *not* printed as text. It becomes a pill:

- `message.tsx:526-541` renders each attachment through `AttachmentFrame` /
  `AttachmentLabel`;
- `packages/app/src/attachments/attachment-pill-content.tsx` renders a `text`
  attachment as title `attachment.title ?? t("...textAttachment")` and subtitle
  `"Previous conversation"` for `contextKind === "chat_history"`, otherwise the
  generic "Text" label.

So a text attachment is genuinely out-of-band with respect to the user bubble
while remaining in-band for the model. That is the closest thing the protocol
has to the ticket's "structured message field".

### 2.5 Other candidate channels (rejected)

- `PaseoAgentTimelineHandle.append` / `appendAgentTimelineItem`
  (`index.d.ts:245`, `PluginTimelineItem` in `agent-types.d.ts:290`) writes a
  UI timeline row. It is not part of prompt assembly and the model never sees it.
- Client plugin `addTimelineTransformer`
  (`@getpaseo/plugin` `dist/client/contracts.d.ts:107-118`) can only return
  `PluginTimelineItem[]` (`dist/contracts.d.ts:92`): `undefined` keeps a source
  item, `[]` hides it, `items` replaces it. It **cannot** mutate a
  `user_message` in place, so it cannot strip-and-keep the native bubble.

## 3. Options

### A. Client-side HTML-comment strip (upstream app)

Strip comments in the existing display projection
`presentUserMessage` (`packages/app/src/agent-stream/presentation.ts:55-69`),
which already projects `<spoken-input>` for voice. Fall back to a badge when the
stripped text is empty.

- Pro: one place, global — fixes every plugin that puts comments in prompts;
  preserves the raw text for the model and for rewind/copy; no protocol change.
- Pro: pure display transform, so no risk to routing.
- Con: lands in `xpufx-org/paseo-upstream`, a different repo; needs its own PR.
- Con: display-only — the raw JSON still exists in the timeline payload, and the
  `[forgejo-hook] {...}` line is untouched.

### B. Fleet sends provenance as a text attachment

Replace `withFleetEnvelope` in the delivery path with
`attachments: [{ type: "text", mimeType: "text/plain", contextKind: "fleet_envelope", title: "Fleet context", text: JSON.stringify(fleetEnvelope(fields)) }]`
and leave the human body in `text`.

- Pro: lives in this repo; new turns ship no raw JSON into the bubble at all.
- Pro: model still receives the envelope text (`renderPromptAttachmentAsText`).
- Con: non-`chat_history` attachments are appended *after* the body in the
  provider prompt (`prompt-attachments.js`), changing the current "envelope is
  first" ordering. Routing may depend on first-line detection.
- Con: the operator now sees a "Text" pill per machine turn instead of nothing.
- Open experiment: prove the model still routes off the attachment, and whether
  ordering matters (see §5). `contextKind: "chat_history"` restores first
  position but mislabels the pill "Previous conversation".

### C. Static system prompt at spawn + attachment for per-event data

Use `before("agent.create")` (or `PaseoAgentCreateOptions.config.systemPrompt`)
to nail the fleet identity into the session, and use B for per-event fields.

- Pro: identity becomes truly out-of-band (system channel).
- Con: only covers agents the fleet itself creates; does not help steers to
  human-spawned or pre-existing agents; system prompt is immutable thereafter.

### D. Hide the whole message with a timeline transformer

Register a client transformer for `itemType: "user_message"` that returns `[]`
for envelope-only prompts.

- Pro: no upstream renderer patch; can be shipped from a client plugin.
- Con: cannot mutate in place (§2.5); hiding a message that also contains human
  text is lossy, and re-rendering via a plugin item loses native rewind/copy.
  Only viable for purely-machine messages.

## 4. Recommendation

**Layer 1 (do first, global): A — client-side display strip.** It is the
smallest correct fix for the reported symptom and covers all plugins. Keep it in
`presentUserMessage` and add an empty-body fallback so an envelope-only prompt
does not render as a blank bubble.

**Layer 2 (target state, this repo): B — move per-turn provenance to a text
attachment.** It is the only structured, per-message, model-visible channel the
protocol offers, which is exactly the operator's ask. It removes the JSON from
new fleet turns while keeping the model informed. Do not remove the HTML-comment
form until §5's experiment passes; keep `withFleetEnvelope` available behind the
existing helper so call sites can be migrated incrementally.

**Layer 3 (related bug found while tracing): fix steering.** `deliverMessage`
passes `{ steer: shouldSteer }` (`hook-router.ts:3868-3869`), but the SDK never
forwards a `steer` key: `sendAgentMessage` only emits `activeTurnBehavior`
(`.../client/dist/daemon-client.js:2033-2050`), and the daemon defaults to
`"interrupt"` (`session.js:6172`, `:6184`). The SDK path therefore *interrupts*
even when the caller asked to steer, and the CLI `--steer` fallback never runs
because the SDK call succeeds. The correct option is
`activeTurnBehavior: shouldSteer ? "steer" : "interrupt"`. This is independent
of the envelope work but must be fixed in the same delivery helper.

Do **not** adopt C as the primary fix (static only), and do **not** adopt D
(lossy).

## 5. Unknowns / experiments required before promoting Layer 2

1. **Model actually reads an attached envelope.** Dispatch a scratch agent, send
   a body with `attachments: [{ type:"text", mimeType:"text/plain",
   contextKind:"fleet_envelope", title:"Fleet context", text:'{"fleet":{...}}' }]`,
   and ask the agent to echo `origin`/`repo`/`kind`. Proves
   `renderPromptAttachmentAsText` reaches the provider end to end.
2. **Ordering sensitivity.** Send the same envelope as (a) `contextKind:
   "chat_history"` (before body) and (b) `contextKind: "fleet_envelope"`
   (after body) and observe whether routing behavior differs. If it does, the
   upstream daemon needs a one-line ordering rule for `fleet_envelope`.
3. **Pill noise.** Confirm the operator accepts a per-turn attachment pill; if
   not, keep the envelope in `text` and rely on Layer 1 alone.
4. **Header comment strip regex.** Confirm `<!--[\s\S]*?-->` does not match
   legitimate user prose (quoted examples). `presentUserMessage` already leaves
   quoted `<spoken-input>` untouched; mirror that care.

## 6. Implementation checklist (dispatchable)

### Track 1 — upstream `xpufx-org/paseo-upstream` (client strip, global)

1. `packages/app/src/agent-stream/presentation.ts`: in `presentUserMessage`, add
   a display projection that removes HTML comments,
   `text.replace(/<!--[\s\S]*?-->/g, "").trim()`, preserving the existing
   `<spoken-input>` projection. Do not touch the stored item.
2. `packages/app/src/components/message.tsx`: if the projected text is empty but
   the source had text, render a neutral badge/pill instead of an empty bubble
   (reuse `AttachmentLabel`), keeping `testID="user-message"`.
3. Tests: extend `packages/app/src/agent-stream/presentation.test.ts` with
   (a) envelope + body → body only, (b) envelope only → empty projection,
   (c) quoted `<!-- ... -->` inside backticks is a decision to record. Update
   `packages/app/src/components/message.tsx` snapshots if any.
4. File the upstream issue/PR referencing this ticket and note the daemon
   ordering question from §5.

### Track 2 — this repo `plugins/uppidi-fleet` (out-of-band provenance)

5. Add `fleetEnvelopeAttachment(fields): AgentAttachment` beside
   `formatFleetEnvelope` in `server/hook-router.ts`, returning
   `{ type: "text", mimeType: "text/plain", contextKind: "fleet_envelope",
   title: "Fleet context", text: JSON.stringify(fleetEnvelope(fields)) }`.
6. Extend `deliverMessage` (`hook-router.ts:3859`) with an optional
   `attachments` parameter and forward it to `agentRef.send`; in the same edit
   replace `{ steer: shouldSteer } as any` with
   `{ activeTurnBehavior: shouldSteer ? "steer" : "interrupt" }`.
7. Migrate call sites in `hook-router.ts` (`:860`, `:2599`, `:3911`, `:4004`,
   `:5328`, `:5825`, `:5837`, `:7581`) to pass the envelope as an attachment and
   leave the human body as `text`, guarded by a single flag until §5.1/§5.2
   pass. Keep `withFleetEnvelope` exported and covered by existing tests.
8. Tests in `server/hook-router.test.ts`: assert the delivered payload carries a
   `fleet_envelope` text attachment instead of a leading comment, that
   `[forgejo-hook]` remains the first line of `formatWebhookMessage`, and that
   `deliverMessage` sends `activeTurnBehavior` (use the injectable `deliver`
   seam around `hook-router.test.ts:3488`).
9. Bump `plugins/uppidi-fleet` dev dependency `@getpaseo/plugin`/`client` toward
   the host line (`0.11.x`) so `activeTurnBehavior` is typed; until then keep the
   narrow cast with a comment.
10. Run `npm run typecheck` and `npm run test` in `plugins/uppidi-fleet/`.

### Track 3 — docs / follow-up

11. Cross-link `#1003` to the upstream client PR and to the daemon ordering
    question. Note the `[forgejo-hook] {...}` plain-text line as a separate,
    intentionally unchanged leak (legacy contract, `router-architecture.md:131`).
