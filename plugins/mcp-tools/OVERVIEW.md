# MCP Tools

MCP Tools provides an interactive inspector and runner for Model Context Protocol (MCP) servers and tools available across Paseo agent sessions.

The plugin dynamically discovers active MCP servers configured across supported agent providers, verifies their reachability with live probes, and provides auto-generated execution forms to run tools interactively without prompting the agent.

## Features and Capabilities

- **Cross-Provider Discovery**: Detects MCP servers across multiple agent CLI environments, including Paseo built-in tools, Google Antigravity, Claude, OpenCode, and Pi.
- **Built-in Control Plane Access**: Surfaces Paseo's native host MCP tools (`/mcp/agents`), exposing over 60 host capabilities covering workspaces, terminal execution, schedules, and agent orchestration.
- **Interactive Tool Execution**: Execute any discovered MCP tool directly from the UI with dynamically generated schema-driven input forms supporting required validation, nested objects, arrays, and primitive type coercion.
- **Real-Time Tool Search**: Instant fuzzy filtering across server tools by name and description to quickly locate specific utilities in large toolsets.
- **Live Health & Latency Probes**: Real-time status indicators, latency tracking, server instruction inspection, and diagnostic checklists to identify configuration drift or path errors.
- **Output Inspection**: Formatted display of tool execution results with one-click clipboard copying.

## Surfaces and UI

- **Composer Pill**: Shows live MCP server counts (`MCP n`) above the composer for the active session.
- **Server Inventory Modal**: Lists discovered MCP servers grouped by provider source with latency badges and status dots.
- **Server Details & Tool Runner**: Dedicated view detailing server instructions, full tool schemas, search, and the interactive execution form.
- **Diagnostic Panel**: System diagnostic checklist verifying configuration files, binary paths, socket permissions, and host agent records.

## Setup and Requirements

- Requires Paseo 0.8.0 or later.
- Discovers MCP configurations from standard user paths (`~/.gemini/config/mcp_config.json`, `~/.claude.json`, `~/.pi/.mcp.json`, etc.) and Paseo session state.
