# forges

Work with forge issues from inside Paseo. The current implementation
concentrates on Issues only: listing, detail, search filter, labels,
comments, and timeline issue-link cards. Pull requests, releases,
actions, and everything else are out of scope for now.

No CLI dependency. All forge access goes through the embedded fetch API
client (`server/forge-client.ts`) against the Gitea-family `/api/v1`.
Tokens live in daemon-side plugin settings and never reach the client.

Supported forges (verified live, anonymous reads):

- Forge/Gitea-family hosts (including Forgejo, Gitea, and Codeberg)
- Gitea (e.g. gitea.com)

GitLab is future work and needs a separate API client.

Remote resolution: one effective remote per workspace. An explicit
settings remote wins absolutely and never falls back; git origin is only
derived from when nothing is set. An invalid explicit remote fails loudly
instead of silently deriving.

0.8 layout: `index.client.tsx` / `index.server.ts` entries, `client/` /
`server/` / `shared/` split, manifest declares
`requirements.paseo >= 0.8.0`.
