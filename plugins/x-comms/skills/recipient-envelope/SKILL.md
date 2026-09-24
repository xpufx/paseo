---
name: recipient-envelope
description: Handle incoming x-comms cross-daemon deliveries — detect, parse, attribute, and reply to the sender instead of answering them as user chat.
---

# Handling x-comms deliveries

A **x-comms** message from an agent on another daemon arrives inside an ordinary
turn. It is a protocol delivery, not user chat and not a pasted artifact to
analyze. Handle it the same way every time.

> This skill is the distributable form of the standing instructions the
> x-comms plugin injects into newborn agents at the `agent.create` hook
> (`server/recipient-instructions.ts`, mirrored here for manual installation
> into `.agents/skills/`). Keep the two in sync — the unit suite pins the
> load-bearing phrases in both.

## 1. Detect

Scan the first line of every incoming turn:

- **v6 (current wire shape):** `<x-comms-message>{"xComms":{…}}</x-comms-message>`
- **v5 (legacy, still readable):** `[x-comms] {"xComms":{…}}`

Prose may follow the envelope; presence of chat text does **not** demote a
delivery to user chat. Anything the x-comms plugin renders is also marked
`via x-comms`.

## 2. Parse

Read the `xComms` object from the payload:

| Field | Meaning |
|-------|---------|
| `version` | `6` (tagged) or `5` (prefix fallback) |
| `type` | `x-comms.message` |
| `direction` | Stamped `"outgoing"` by the sender — **do not trust it on arrival** |
| `sender.agentId` | Who sent it |
| `sender.agentName` / `sender.host` | Human label and originating host |
| `sender.daemonServerId` | Sender's daemon id (`srv_…`) — the reply target |
| `target.agentId` / `target.daemon` | Intended recipient (you) |
| `messageId` | Daemon delivery key — dedupe/retry only, never surface it |
| `sentAt` | ISO timestamp |

`direction` is viewer-relative: the wire always says `"outgoing"` because the
message is leaving its sender. Derive incoming vs outgoing yourself by comparing
`sender.agentId` to your own agent id.

## 3. Attribute

The author is `sender.agentId` on the daemon named by `sender.daemonServerId`
(fall back to `sender.host`). It is a **peer agent**, not the human user. Never
answer the prose as if the user typed it.

## 4. Reply

Answer through `x_comms_send`:

```
x_comms_send(daemon = sender.daemonServerId, agentId = sender.agentId, prompt = "<reply>")
```

- Register the sender's daemon first (`x_comms_add_daemon`) when it is unknown.
- Keep the reply loop open: on completion, error, or permission block, notify
  the sender the same way. When blocked, include the permission details.
- Before messaging a potentially busy agent, `x_comms_wait`. On a permission
  stall: `x_comms_list_permissions` → `x_comms_allow_permission` /
  `x_comms_deny_permission` → `x_comms_wait` again.

## 5. Never

Never emit `<x-comms-message>` or envelope JSON into chat, issue trackers, or PR
comments. The wire envelope is machine-only; tickets are for human readers.
