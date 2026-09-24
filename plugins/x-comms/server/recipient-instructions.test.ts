import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  AgentCreateInjectionRequest,
  McpInjectionHookHandler,
  McpInjectionServer,
} from "paseo-plugin-helper/server";
import { ENVELOPE_OPEN, META_PREFIX, parseEnvelope } from "../shared/envelope.ts";
import {
  RECIPIENT_INSTRUCTION_MARKER,
  RECIPIENT_INSTRUCTIONS,
  composeSystemPrompt,
  injectRecipientInstructions,
  registerRecipientInstructions,
} from "./recipient-instructions.ts";
import { maybeRegisterInjection } from "./injection.ts";

/**
 * Multi-handler stub that chains like the daemon's lifecycle runtime: each
 * registered `agent.create` handler receives the previous handler's output.
 * The plain injection.test.ts stub keys by name, which cannot express two
 * handlers on one hook; this one keeps an ordered list.
 */
interface ChainedServer extends McpInjectionServer {
  handlers: McpInjectionHookHandler[];
}

function createChainedServer(): ChainedServer {
  const handlers: McpInjectionHookHandler[] = [];
  return {
    handlers,
    before(name: string, handler: McpInjectionHookHandler): () => void {
      assert.equal(name, "agent.create");
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      };
    },
  };
}

// Run every registered handler in order, exactly as validateBeforeResult chaining
// in the daemon's plugin runtime does.
function runChain(
  server: ChainedServer,
  request: AgentCreateInjectionRequest,
): AgentCreateInjectionRequest {
  let current = request;
  for (const handler of server.handlers) {
    const next = handler({ request: current });
    if (next) current = next as AgentCreateInjectionRequest;
  }
  return current;
}

const CONFIG = {
  type: "stdio" as const,
  command: process.execPath,
  args: ["/plugins/x-comms/mcp/paseo-x-comms.bundled.mjs"],
};

// The helper's AgentCreateInjectionConfig types non-MCP keys as unknown; the
// prompt is the field under test, so narrow it once here.
function promptOf(request: AgentCreateInjectionRequest): string {
  const value = request.config.systemPrompt;
  return typeof value === "string" ? value : "";
}

function requestWithUserPrompt(): AgentCreateInjectionRequest {
  return {
    config: {
      provider: "opencode",
      cwd: "/work",
      systemPrompt: "You are a helpful coding agent.",
    },
  };
}

describe("recipient standing instructions content", () => {
  it("names the v6 and v5 envelope shapes", () => {
    assert.ok(RECIPIENT_INSTRUCTIONS.includes(ENVELOPE_OPEN));
    assert.ok(RECIPIENT_INSTRUCTIONS.includes(META_PREFIX.trimEnd()));
  });

  it("covers parse, attribute, and reply phases", () => {
    for (const loadBearing of [
      "sender.agentId",
      "sender.daemonServerId",
      "target.agentId",
      "messageId",
      "x_comms_send",
      "not the human user",
    ]) {
      assert.ok(
        RECIPIENT_INSTRUCTIONS.includes(loadBearing),
        `instructions must mention ${loadBearing}`,
      );
    }
  });

  it("warns that direction is sender-stamped and must not be trusted on arrival", () => {
    assert.match(RECIPIENT_INSTRUCTIONS, /direction .*outgoing.*sender/i);
  });

  it("carries a stable dedupe marker", () => {
    assert.ok(RECIPIENT_INSTRUCTIONS.startsWith(RECIPIENT_INSTRUCTION_MARKER));
  });
});

describe("composeSystemPrompt", () => {
  it("appends to an existing prompt without clobbering it", () => {
    const merged = composeSystemPrompt("existing rules");
    assert.ok(merged.startsWith("existing rules\n\n"));
    assert.ok(merged.endsWith(RECIPIENT_INSTRUCTIONS));
  });

  it("returns the instructions alone when there is no base prompt", () => {
    assert.equal(composeSystemPrompt(undefined), RECIPIENT_INSTRUCTIONS);
    assert.equal(composeSystemPrompt(""), RECIPIENT_INSTRUCTIONS);
    assert.equal(composeSystemPrompt("   "), RECIPIENT_INSTRUCTIONS);
  });

  it("is idempotent: a prompt already carrying the marker is unchanged", () => {
    const once = composeSystemPrompt("base");
    assert.equal(composeSystemPrompt(once), once);
    assert.equal(composeSystemPrompt(RECIPIENT_INSTRUCTIONS), RECIPIENT_INSTRUCTIONS);
  });

  it("tolerates a non-string stored prompt", () => {
    assert.equal(composeSystemPrompt(42 as unknown as string), RECIPIENT_INSTRUCTIONS);
  });
});

describe("injectRecipientInstructions", () => {
  it("folds instructions into config.systemPrompt", () => {
    const result = injectRecipientInstructions(requestWithUserPrompt());
    assert.ok(promptOf(result).startsWith("You are a helpful coding agent."));
    assert.ok(promptOf(result).includes(RECIPIENT_INSTRUCTION_MARKER));
  });

  it("never mutates the incoming request", () => {
    const request = requestWithUserPrompt();
    const snapshot = JSON.parse(JSON.stringify(request));
    injectRecipientInstructions(request);
    assert.deepEqual(request, snapshot);
  });

  it("creates systemPrompt when the request has none", () => {
    const result = injectRecipientInstructions({
      config: { provider: "opencode", cwd: "/w" },
    });
    assert.equal(promptOf(result), RECIPIENT_INSTRUCTIONS);
  });
});

describe("registerRecipientInstructions", () => {
  it("registers and removes an agent.create hook", () => {
    const server = createChainedServer();
    const remove = registerRecipientInstructions(server);
    assert.equal(server.handlers.length, 1);
    const result = runChain(server, requestWithUserPrompt());
    assert.ok(promptOf(result).includes(RECIPIENT_INSTRUCTION_MARKER));
    remove();
    assert.equal(server.handlers.length, 0);
  });
});

describe("agent.create injection gate wires tools and instructions together", () => {
  it("injects both the MCP server and the recipient instructions", () => {
    const server = createChainedServer();
    maybeRegisterInjection(server, { enabled: true }, { serverName: "x-comms_srv_test", config: CONFIG });
    assert.equal(server.handlers.length, 2);
    const result = runChain(server, requestWithUserPrompt());
    assert.deepEqual(result.config.mcpServers?.["x-comms_srv_test"], CONFIG);
    assert.ok(promptOf(result).includes(RECIPIENT_INSTRUCTION_MARKER));
    assert.ok(promptOf(result).startsWith("You are a helpful coding agent."));
  });

  it("registers nothing when the toggle is off", () => {
    const server = createChainedServer();
    const remove = maybeRegisterInjection(server, { enabled: false }, { serverName: "x-comms_srv_test", config: CONFIG });
    assert.equal(server.handlers.length, 0);
    remove();
  });

  it("removes both hooks together", () => {
    const server = createChainedServer();
    const remove = maybeRegisterInjection(server, { enabled: true }, { serverName: "x-comms_srv_test", config: CONFIG });
    remove();
    assert.equal(server.handlers.length, 0);
  });
});

describe("envelope recognition inside a turn that also contains chat prose", () => {
  const v6 = `${ENVELOPE_OPEN}${JSON.stringify({
    xComms: {
      version: 6,
      type: "x-comms.message",
      direction: "outgoing",
      sender: {
        agentId: "peer-agent",
        agentName: "Peer Agent",
        host: "peer-host",
        daemonServerId: "srv_peer",
        cwd: "/work/peer",
      },
      target: { daemon: "srv_local", agentId: "self-agent" },
      messageId: "msg-1",
      sentAt: "2026-09-23T00:00:00.000Z",
    },
  })}</x-comms-message>\n\nCan you take a look at the failing test?`;

  it("recognizes a v6 delivery preceded by the tagged envelope", () => {
    const parsed = parseEnvelope(v6);
    assert.ok(parsed, "turn with envelope + prose must parse");
    assert.equal(parsed.envelope.xComms.sender.agentId, "peer-agent");
    assert.equal(parsed.envelope.xComms.sender.daemonServerId, "srv_peer");
    assert.equal(parsed.envelope.xComms.target.agentId, "self-agent");
    assert.equal(parsed.envelope.xComms.messageId, "msg-1");
    assert.equal(parsed.body, "Can you take a look at the failing test?");
  });

  it("recognizes the legacy v5 shape with prose", () => {
    const v5 = `${META_PREFIX}${JSON.stringify({
      xComms: {
        version: 5,
        type: "x-comms.message",
        direction: "outgoing",
        sender: {
          agentId: "peer-agent",
          agentName: "Peer Agent",
          host: "peer-host",
          daemonServerId: "srv_peer",
          cwd: null,
        },
        target: { daemon: "srv_local", agentId: "self-agent" },
        messageId: "msg-2",
        sentAt: "2026-09-23T00:00:00.000Z",
      },
    })}\n\ntesting something`;
    const parsed = parseEnvelope(v5);
    assert.ok(parsed);
    assert.equal(parsed.envelope.xComms.sender.agentId, "peer-agent");
    assert.equal(parsed.body, "testing something");
  });

  it("does not treat ordinary prose as a delivery", () => {
    assert.equal(parseEnvelope("Can you take a look at the failing test?"), null);
    assert.equal(parseEnvelope(`A user pasted ${ENVELOPE_OPEN} mid-sentence`), null);
  });
});
