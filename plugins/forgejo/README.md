# paseo-forgejo

Work with Forgejo issues from inside Paseo, built on `fgjx` as the tool.

Tracks [issue #30](https://forge.mrs.aager.de/xpufx/paseo-plugin-helper/issues/30)
(checklist lives there). v8 layout: `index.client.tsx` / `index.server.ts`
entries, `client/` / `server/` / `shared/` split, manifest declares
`requirements.paseo >= 0.8.0`.

Status: pill with live open-issue count, issue modal, and timeline
issue-link cards implemented. Remaining: issue search tab, install on both
daemons, verify.
