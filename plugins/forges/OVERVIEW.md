# Forges

Forges brings Forgejo, Gitea, and Codeberg issue tracking, label governance, and agent collaboration directly into Paseo surfaces without requiring external browser tabs or CLI tools.

The plugin connects Paseo workspaces to their upstream git forge repository, providing in-app issue inspection, scoped label management, markdown comment rendering with agent envelopes, and full integration with autonomous agent workflows.

## Features and Capabilities

- **In-App Issue Management**: Browse, search, filter, and inspect issues for repositories associated with the current workspace. Read issue descriptions and full comment threads with markdown rendering.
- **Agent Envelopes**: Renders structured agent attribution envelopes (`<paseo-system>` and footer signatures) inside issue discussions, tracking agent session identity, model, branch, and commit SHAs.
- **Scoped Label Taxonomy**: Derives and manages scoped labels (e.g. `state/*`, `priority/*`, `attention/*`, `kind/*`) directly against the live forge vocabulary, ensuring clean single-select semantics within label scopes.
- **Issue Creation & Steering**: Author new issues and post comments directly from Paseo to steer running agents or collaborate with team members.
- **Embedded API Client**: Communicates directly with Gitea-family `/api/v1` endpoints via native Node `fetch`. Requires no external CLI dependencies (`tea`, `fgj`, or `git`).
- **Autonomous Fleet Orchestration**: Connects with webhook bridges to dispatch forge events (issues, comments, label changes) to orchestrator agents for automated triage, dispatch, and review.

## Surfaces and UI

- **Composer Pill**: Header pill indicating open repository issue counts and quick navigation to the issues modal.
- **Issue List Surface**: Filterable list of open and closed repository issues with search and label filtering.
- **Issue Detail Modal**: Full issue body, timeline comments, label editor, and comment composition box.
- **Kanban Board**: Drag-and-drop workflow board organized by scoped label columns.

## Configuration and Settings

- **Host Authentication**: Configure API tokens per forge host securely in daemon-side storage. Tokens are never exposed to the client interface.
- **Remote Mapping**: Automatically infers the repository from git remotes or supports explicit repository and host configuration.

## Setup and Requirements

- Requires Paseo 0.8.0 or later.
- Compatible with any Forgejo, Gitea, or Codeberg instance.
- Requires network reachability from the daemon to the target forge host.
