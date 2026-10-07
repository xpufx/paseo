S/ash allows users to define custom slash commands for the Paseo composer and manage them from a dedicated sidebar console. Commands can interpolate chat arguments into prompt templates sent to the active agent, navigate to installed plugin surfaces, or execute backend operations on the daemon host with output appended directly to the session timeline.

A configurable command prefix (defaulting to `slash-`, or empty for bare command names) applies across all registered commands. Enabled commands can be exported and imported as versioned JSON bundles to share configurations across machines. Shipped seed commands include prompt review, opening the console, ping, querying active agent identity (`whoami`, `who-are-you`), orchestrator role handover, and commands for the `agent-mux` CLI.

## Setup

- The plugin runs on the Paseo daemon and requires Paseo 0.8.0 or later.
- Commands utilizing `agent-mux` (`/agent-mux`, `/agent-mux-status`, `/agent-mux-probe`, `/agent-mux-cooldowns`) require the [agent-mux](https://github.com/xpufx/agent-mux) executable installed on the daemon machine, either in `~/.local/bin` or available on `PATH`.
- For `slash.orchestrate`, the plugin communicates with a local or remote hook server such as [Uppidi Fleet](https://fleet.uppidi.com/). The endpoint URL can be set in plugin settings, through `PASEO_FORGEJO_HOOK_URL`, or defaults to `http://127.0.0.1:8099`. An optional bearer secret can be provided via a secret file path in settings, `PASEO_FORGEJO_HOOK_SECRET_FILE`, `~/.paseo/forgejo-hook.secret`, or the `FORGEJO_WEBHOOK_SECRET` environment variable as a fallback.

## Capabilities and Data Access

- **Local Primitives**: `slash.ping` returns plugin metadata; `slash.echo` reflects parameters; `slash.agent.identity` queries the active session and returns deterministic details including agent title, provider, model, mode, working directory, and workspace ID.
- **Process Execution**: The `slash.agent-mux` primitive executes `agent-mux` using Node's `execFile`. Command arguments provided in chat are parsed into an argument array and passed directly to the binary without shell evaluation. Command output and exit statuses are appended to the caller agent's timeline.
- **HTTP Operations**: Users can declare custom HTTP operations in settings specifying method (GET/POST), target URL, optional headers, and allowed body parameters. HTTP targets are restricted to `http:` and `https:` schemes, capped at 64KB response bodies with a 10-second timeout. Header values for authorization, cookie, and proxy-authorization are redacted in logs and previews.
- **Network Access**: Outbound network requests only occur when executing configured HTTP operation bindings or the orchestrator hook.
