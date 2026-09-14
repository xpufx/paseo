# paseo-forgejo

Work with Forgejo issues from inside Paseo via the embedded fetch API client
(`server/forgejo-client.ts`, token from daemon-side plugin settings). `fgjx`
remains the human/CLI path.

Tracks [issue #30](https://forge.mrs.aager.de/xpufx/paseo-plugin-helper/issues/30)
(checklist lives there). 0.8 layout: `index.client.tsx` / `index.server.ts`
entries, `client/` / `server/` / `shared/` split, manifest declares
`requirements.paseo >= 0.8.0`.

Status: pill with live open-issue count, issue modal, and timeline
issue-link cards implemented. Remaining: issue search tab, install on both
daemons, verify.
