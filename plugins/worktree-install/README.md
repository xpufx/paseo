# Worktree Install

**A second, independent fleet surface for Paseo. Same information, different design.**

`worktree-install` renders three things — **Fleet**, **Queue**, **Tickets** — for an
operator running a board-driven agent fleet. It exists because
[`uppidi-fleet`](https://forge.mrs.uppidi.com/xpufx-org/paseo/tree/main/plugins/uppidi-fleet)
deserves a second opinion on presentation, and because the shared plugin-helper
UI kit is not the only way to build a Paseo surface.

> The two plugins are independent. `uppidi-fleet` is untouched and stays working.
> This one neither imports it nor is imported by it.

---

## What "independent" means here

Three constraints shape every decision in this plugin.

**1. It shows the same things.** The brief for
[#629](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/629) said *do not lose any
currently provided information, but layout and presentation is completely up to you*.
[`docs/INVENTORY.md`](docs/INVENTORY.md) enumerates every field, status, action, and count
the legacy surface renders, marks where each one landed here, and lists the eight
things deliberately left behind. `client/render.test.ts` is the executable half of
that file: it drives the real components with a realistic payload and asserts each
element is in the tree. A row that loses its element fails the build.

**2. It is not built on the shared UI kit.** `client/kit.tsx` is ~40 primitives written
against plain `react-native` and the host's own `Icon`/`TextInput`/`copyText`. Nothing
from `paseo-plugin-helper/client` is imported — not `Badge`, not `Button`, not
`DataTable`, not `SectionHeader`. Registration goes through the host's own
`addSidebarItem`/`addSurface`/`addWorkspacePanel` rather than a helper registrar,
because those registrars wrap a surface in the shared kit's chrome.

**3. Theming is one switch.** `client/theme.ts` holds two palette literals and picks one
from the luminance of the background the host resolved. Light or dark. That is the
entire theming requirement, and there is no third mode, no scale, and no token tier.

---

## Dependency resolution

`uppidi-fleet` imports the bare specifier `paseo-plugin-helper/client`, declares no
dependency on it, and resolves it only through a tsconfig `paths` alias into
`../../packages/paseo-plugin-helper/src`. That works in this monorepo and nowhere else,
and nothing in CI can catch the failure (see [#630](https://forge.mrs.uppidi.com/xpufx-org/paseo/issues/630)).

This plugin sidesteps the class of bug rather than fixing an instance of it: it has **no
dependency on the shared helper at all**. Its only runtime packages are `@getpaseo/plugin`,
`react`, `react-native`, `@tanstack/react-query`, and `zod` — all declared, all resolvable
from the plugin directory with no tsconfig in the picture, and nothing to vendor or
re-sync.

`client/entry.test.ts` enforces all of that as checked properties: no helper import, no
`vendor/` tree, no `paths` alias, every external specifier declared, every one resolvable,
and every relative import staying inside the plugin directory.

---

## Layout

Desktop first, mobile supported. The shell is one sticky header and one content region;
what changes is how much the content region can afford to show.

| | Wide (≥ 900px) | Narrow (≤ 620px) |
| --- | --- | --- |
| Fleet | full rows: worktree, model, provider, age, labels, gauge | dense rows: identity, state, dot, gauge, archive |
| Queue | 3 message previews per repo | 2 previews per repo |
| Tickets | list **and** detail side by side | list, detail in a modal |

Both are the same components; the skin hands down `wide`/`narrow` and the views drop
their secondary fields rather than wrapping into an unreadable column.

### The three views

- **Fleet** — the agent roster as a repository-grouped tree. Counts rail, state filters,
  search, a blocked-agent banner, a singleton liaison card, one block per repository with
   its orchestrators and workers, a detached/local bucket, and a bucket for orphaned
   liaison sessions. Every agent row carries a health gauge that expands to a full
   metrics sheet.
- **Queue** — the per-repository webhook message queues, plus a read-only router read-out
  and per-queue pause/resume/drain.
- **Tickets** — the board, with preset filters, search, five sort fields, a repository
  scope, and a detail pane carrying every label, the dispatched branch, and the counts.

---

## Data sources

| Data | Source |
| --- | --- |
| Agents | the daemon's own `context.paseo.agents.list()`, enriched from `~/.paseo/agents/*/*.json` for the fields the listing omits, falling back to `paseo ls --json` |
| Repository per agent | `~/.paseo/projects/{projects,workspaces}.json`, then agent labels, then parent inheritance. Never from a title or cwd heuristic |
| Tickets | the Forgejo API |
| Queues and router health | the Forgejo webhook router over HTTP, endpoint resolved from an explicit override → `FORGE_HOOK_URL` → loopback |

The router is a daemon **owned by `uppidi-fleet`**. This plugin is a read-mostly client to
it: it reads status and queues and sends pause/resume/drain, and it does not start, stop,
or reconfigure the router. A second plugin silently reconfiguring another plugin's daemon
is not a thing a surface should be able to do. The one exception is per-repository muting,
which this plugin stores in its own state directory (`~/.paseo/plugin-state/worktree-install/`)
rather than writing into another plugin's files.

An unreachable router is reported as unreachable, never as an empty queue. Those are
different facts and the surface renders them differently on purpose.

### Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `FORGEJO_HOST` | board host | `forge.mrs.uppidi.com` |
| `FORGEJO_REPO` | board repository | `xpufx-org/paseo` |
| `FORGEJO_TOKEN` / `GITEA_TOKEN` | board token; falls back to the `tea` CLI config | — |
| `FORGE_HOOK_URL` | webhook router endpoint | `http://127.0.0.1:8099` |
| `WORKTREE_INSTALL_ENROLLED_REPOS` | comma-separated repos to treat as enrolled | discovered from the roster |
| `WORKTREE_INSTALL_WORKSPACE` | checkout a spawned liaison or orchestrator runs in | — |
| `WORKTREE_INSTALL_MODEL` | model for a spawned session | — |
| `WORKTREE_INSTALL_PROVIDER` | provider for a spawned session | `opencode` |

---

## Development

```bash
npm install                        # from the repo root
npm run typecheck  --workspace=@xpufx/paseo-worktree-install
npm test           --workspace=@xpufx/paseo-worktree-install
```

105 tests: the derivation layer is unit-tested exhaustively because it is where the
inventory contract actually lives; the three views are render-tested against a realistic
payload; the server projections are tested against the messy partial payloads a real
daemon produces; and the resolution properties above are asserted directly.

## License

MIT. See [LICENSE](LICENSE).
