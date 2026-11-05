# Antigravity Claude

Antigravity Claude registers a dedicated `antigravity-claude` provider in Paseo alongside the default `antigravity` provider, exposing Claude and GPT models with quota-aware routing.

The plugin simplifies model selection by isolating Claude and GPT partner models into their own provider namespace and automatically routing sessions through account pools with available quota.

## Features and Capabilities

- **Dedicated Provider Namespace**: Exposes Claude and GPT partner models under the `antigravity-claude` provider identifier for focused model picker menus.
- **Dynamic Model Discovery**: Queries the upstream `agy models` CLI at startup and filters dynamically for model identifiers prefixed with `claude` or `gpt`. Any newly supported Claude or GPT models appear automatically without plugin updates.
- **Quota-Aware Routing**: Sets `AGY_TARGET_POOL=claude` in child environments when launching CLI sessions. When paired with `agent-mux`, sessions automatically route to accounts with remaining Claude quota; with a standard `agy` binary, the variable passes through gracefully.

## Surfaces and Usage

- **Provider Selection**: Appears directly in Paseo's provider dropdowns, composer settings, and session launch contracts.
- **CLI Verification**: List providers and discover available models via `paseo provider ls` and `paseo provider models antigravity-claude`.

## Setup and Requirements

- Requires Paseo 0.9.0 or later.
- Requires Google Antigravity CLI (`agy`) installed and authenticated on the daemon host.
- Optional integration with `agent-mux` for automatic multi-account quota routing.
