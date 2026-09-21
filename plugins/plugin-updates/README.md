# plugin-updates

Read-only Git-source update monitor for [Paseo](https://github.com/getpaseo/paseo) plugins.

<table align="center">
  <tr>
    <td align="center"><strong>main</strong><br><img src="screenshots/plugin-updates-main.jpg" alt="Plugin updates — main view" width="300"></td>
    <td align="center"><strong>updating</strong><br><img src="screenshots/plugin-updates-action.jpg" alt="Plugin updates — updating" width="300"></td>
  </tr>
</table>

Adds a header button to every workspace that opens a popover listing the installed plugins. Each row reports whether the plugin's installed git source is current, behind, pinned, missing, or has no upstream.

Built on [paseo-plugin-helper](https://github.com/xpufx/paseo/tree/main/packages/paseo-plugin-helper), the shared Paseo plugin runtime.

> [!NOTE]
> **Prerequisites & Platform Support**:
> - The system `git` CLI must be available, because update checks shell out to `git`.
> - Developed and tested primarily on **Linux**.

## Core Capabilities

### 1. Workspace Header Button
- Registers a header button once per workspace, titled **Plugin updates**, that opens a popover listing every installed plugin.
- The button shows a refresh glyph while a check is running, and a status dot in the corner: green when everything is fresh, amber while checking or when an update is available, and red when a check fails.

### 2. Per-plugin Git Status
Each row resolves the plugin to its git repository root, ref, and subdirectory, then probes the remote to classify the install:

- **current**: the local commit or subdirectory tree matches the tracked ref, or the local checkout is ahead of the remote.
- **behind**: the remote ref has commits the local checkout does not, so an update is available.
- **pinned**: the install is pinned to a fixed tag or commit. Pinned installs are report only; nothing is ever pulled for them.
- **no-upstream**: no upstream remote is configured, or the tracked branch or tag no longer exists on the remote.
- **missing**: the remote is reachable but the plugin subdirectory does not exist at the tracked ref.
- **unpinned**: a detached HEAD, or a managed install with no recorded ref. Report only.
- **not-a-repo**: the plugin is not a git checkout, so no git update is possible.
- **error**: the check itself failed, for example because the remote was unreachable.

### 3. Per-subdirectory Scoping
- Plugins installed from a monorepo subpath track only that subdirectory tree. A commit that touches other paths in the same repository does not register as an update.
- The row shows the resolved **Subdir** (`(repo root)` when the plugin is the repository root), alongside the local and remote tree hashes and the tracked ref.

### 4. Source Links
- Each row resolves a browsable source URL from the remote the plugin was installed from, falling back to `package.json` `repository` and `homepage` metadata when no install remote exists.
- GitHub, GitLab, and unknown forges get an appropriate glyph, and links deep-link into the subdirectory for GitHub (`/tree/<ref>/<subdir>`) and Forgejo/Gitea-style (`/src/branch/<ref>/<subdir>`) hosts.
- A `dirty` badge appears on a directory install when the plugin scope has uncommitted changes.

### 5. Native lifecycle blocker

The daemon client has native plugin preview/proposal/apply/reload methods, but they are not exposed through the plugin-facing `PaseoApi` returned by `getPaseoClient(serverId)`. The server lifecycle API is limited to agent/workspace events. Consequently this plugin deliberately has no update action for managed Git or npm sources, local directories, or self-update: it never spawns `paseo plugin update`, pulls, or reloads another plugin.

`useHosts()` is not an update lifecycle API. Choosing a configured host could operate on a different daemon than the installation being displayed, so it is never used as a targeting substitute. Use the host's own plugin management UI/CLI to review and apply updates. The Git diagnostics remain available because native source metadata does not expose their per-subdirectory tree/ref comparison.

### 6. Orphaned Directory Flagging
- Directories left behind in Paseo's managed plugin location by an uninstalled or failed install are listed in a separate **Orphaned directories** section with a name and path.
- Orphans are reported only; they are never probed or updated.

### 7. Live Refresh
- The popover re-checks on a 30 second interval and on demand through the refresh button, and reports the available update count in its header.

## Installation

Install from npm:

```sh
paseo plugin add npm:@xpufx/paseo-plugin-updates
```

Or install directly from the Git repository:

```sh
paseo plugin add xpufx/paseo --path plugins/plugin-updates
```

> [!NOTE]
> Bare `owner/repo` shorthand resolves against **GitHub** only. For another forge, pass the full Git URL instead, for example `https://git.example.com/owner/repo`.

For local development, clone the repository and add the plugin directory:

```sh
git clone https://github.com/xpufx/paseo.git
cd paseo
paseo plugin add ./plugins/plugin-updates
```

## Usage & Configuration

- No settings are required. The header button registers automatically in each workspace that has an agent session.
- Open the button to see installed plugins, their status, and detected remote changes. Review and apply updates in the owning Paseo host.
- Checks run against the plugin's install remote only, so a fork or mirror installed as the source is what gets compared.

## Limitations

- **Local git installs are report-only.** With no upstream remote or recorded ref, there is nothing to compare against or pull, so no **Update** button is offered for them. Use a git remote + subpath to get updates.

## Development

```sh
# Typecheck
npm run typecheck --workspace=plugins/plugin-updates

# Typecheck plus the test suite (tsx --test)
npm run test --workspace=plugins/plugin-updates

# Reload in a running Paseo daemon
paseo plugin reload plugin-updates
paseo plugin logs plugin-updates
```

## License

MIT
