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

Forge selection: each workspace watches one active forge at a time. The
Settings tab lists forge remotes for the workspace (any `parseForgejoRemote`
form plus bare `owner/repo`) and a dropdown picks the active one; the choice
persists per workspace in daemon-side plugin settings. Issue list, search
filter, detail, labels, and comments all follow the active forge.

Explicit selection wins absolutely and never falls back to git derivation; git
origin is only consulted when the selection is Auto, or to supply the host for
a bare `owner/repo`. An invalid or unreachable selected forge fails loudly with
a notice instead of silently deriving.

0.8 layout: `index.client.tsx` / `index.server.ts` entries, `client/` /
`server/` / `shared/` split, manifest declares
`requirements.paseo >= 0.8.0`.
