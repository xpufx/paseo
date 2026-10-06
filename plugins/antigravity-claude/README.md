# Antigravity Claude Provider for Paseo

Paseo plugin that registers `antigravity-claude` as a separate provider alongside the default `antigravity` provider.

## What it does

Google Antigravity tracks quota for Gemini models and partner models (Claude and GPT) in separate pools. This plugin exposes the Claude and GPT models under their own provider name in Paseo, so partner-model sessions keep working while the Gemini pool is unavailable. It sets `claude-sonnet-5-5-medium` as the default model.

## How it works

1. It registers provider ID `antigravity-claude`.
2. It queries `agy models` at startup and filters the list down to model IDs starting with `claude` or `gpt`. Any new Claude/GPT models added upstream appear automatically.
3. It launches the `agy` CLI with the Claude partner-model pool selected.

## Installation

Install from npm:

```sh
paseo plugin add npm:@xpufx/paseo-antigravity-claude
```

Or install directly from the Git repository:

```sh
paseo plugin add xpufx/paseo --path plugins/antigravity-claude
```

Or add it manually to `~/.paseo/config.json`:

```json
{
  "plugins": {
    "antigravity-claude": {
      "source": "directory",
      "path": "/path/to/paseo/plugins/antigravity-claude",
      "enabled": true
    }
  }
}
```

Then restart the daemon:

```bash
paseo daemon restart
```

## agent-mux integration

The plugin always sets `AGY_TARGET_POOL=claude` in the child environment before launching `agy`. If [agent-mux](https://forge.mrs.uppidi.com/xpufx-org/agent-mux) is installed, its `agy` wrapper reads that variable and routes the session to an account with Claude quota available; with a plain `agy` binary the variable has no effect.

## Verification

Check that the provider is recognized and ready:

```bash
paseo provider ls
paseo provider models antigravity-claude
```
