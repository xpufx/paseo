# Plugin Updates

Plugin Updates monitors installed Paseo plugins for upstream git changes, tracks subdirectory monorepo scoping, and provides one-click in-place updates.

The plugin resolves each installed plugin to its backing git repository, compares local checkouts against upstream refs, flags outdated or diverging installs, and executes safe fast-forward updates.

## Features and Capabilities

- **Per-Plugin Git Status**: Classifies each plugin's status as `current`, `behind`, `pinned`, `no-upstream`, `missing`, `unpinned`, `not-a-repo`, or `error`.
- **Monorepo & Subdirectory Scoping**: Accurately tracks plugins installed from repository subpaths by computing subdirectory tree hashes, avoiding false update notifications from unrelated root commits.
- **One-Click Updates**: Updates individual plugins or executes batch updates (`Update all`) with automatic dependency reload. Supports forced updates for dirty checkouts when explicitly overridden.
- **Upstream Source Links**: Deep links directly to the plugin's upstream repository and subdirectory on GitHub, Forgejo, Gitea, or GitLab.
- **Orphan Directory Detection**: Identifies abandoned directories in Paseo's managed plugin directory left behind by uninstalled plugins.
- **Live Periodic Probing**: Performs background checks on a 30-second interval with on-demand refresh triggers.

## Surfaces and UI

- **Workspace Header Button**: Workspace header item with real-time status dot indicating update availability (green for up-to-date, amber for updates available or checking, red for errors).
- **Updates Popover**: Comprehensive list of installed plugins with resolved commit SHAs, tracking branches, diff status, and update action buttons.

## Setup and Requirements

- Requires Paseo 0.8.0 or later.
- Requires `git` installed and available on `PATH` on the daemon host.
