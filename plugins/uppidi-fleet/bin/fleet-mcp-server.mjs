#!/usr/bin/env node
import { register } from "node:module";
import readline from "node:readline";

// Install TS-extension resolver hook so node can load .ts server modules directly
const hookUrl = new URL("../test/resolve-ts-hooks.mjs", import.meta.url);
register(hookUrl, import.meta.url);

const { FLEET_MCP_TOOLS, executeFleetTool } = await import("../server/mcp.ts");

const SERVER_NAME = "uppidi-fleet";
const SERVER_VERSION = "0.1.0";
const PROTOCOL_VERSION = "2024-11-05";

function sendResponse(id, result) {
  const payload = {
    jsonrpc: "2.0",
    id,
    result,
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function sendError(id, code, message, data) {
  const payload = {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data !== undefined ? { data } : {}),
    },
  };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;

  switch (method) {
    case "initialize": {
      sendResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
        instructions:
          "Autonomous fleet tools: fleet_check_board for issue triage ranking; fleet_watchdog_audit for agent health diagnostics and recovery.",
      });
      break;
    }

    case "notifications/initialized":
    case "initialized": {
      // Notification without response
      break;
    }

    case "ping": {
      sendResponse(id, {});
      break;
    }

    case "tools/list": {
      sendResponse(id, {
        tools: FLEET_MCP_TOOLS,
      });
      break;
    }

    case "tools/call": {
      if (!params || typeof params !== "object" || typeof params.name !== "string") {
        sendError(id, -32602, "Invalid params: name is required");
        break;
      }
      try {
        const result = await executeFleetTool(params.name, params.arguments ?? {});
        sendResponse(id, {
          content: result.content,
          isError: result.isError,
        });
      } catch (err) {
        sendResponse(id, {
          content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
          isError: true,
        });
      }
      break;
    }

    default: {
      if (id !== undefined && id !== null) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
      break;
    }
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("{")) return;
  try {
    const msg = JSON.parse(trimmed);
    void handleMessage(msg);
  } catch (err) {
    sendError(null, -32700, "Parse error");
  }
});
