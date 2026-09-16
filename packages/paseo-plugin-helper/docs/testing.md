# Testing Module (`paseo-plugin-helper/testing`)

The `testing` module provides in-memory mock harnesses for testing Paseo plugins with Vitest, Jest, or Mocha without needing to start a live Paseo daemon or client interface.

---

## 1. Client Testing: `createMockClientContext()`

Simulates `PluginClientContext` for testing composer pills, panels, and dynamic agent arrival/removal.

### API
- `mockClient.registeredPills`: Array of pills registered by the plugin.
- `mockClient.simulateAgentAdded(agentData)`: Fires the Paseo agent subscriber event with a new or updated agent.
- `mockClient.simulateAgentRemoved(agentId)`: Fires an agent removal event.
- `mockClient.paseo.agents.list()`: Returns the mock in-memory agent list.

### Example
```ts
import { describe, it, expect } from "vitest";
import { createMockClientContext } from "paseo-plugin-helper/testing";
import { contributeClient } from "./client.js";

describe("Plugin Client", () => {
  it("registers pills when agents connect", () => {
    const mock = createMockClientContext();
    const cleanup = contributeClient(mock);

    mock.simulateAgentAdded({
      id: "agent-1",
      workspaceId: "ws-main",
    });

    expect(mock.registeredPills).toHaveLength(1);
    expect(mock.registeredPills[0].agentId).toBe("agent-1");

    cleanup();
  });
});
```

---

## 2. Server Testing: `createMockServerContext()`

Simulates `PluginContext` for verifying server RPC handlers, input parsing, and command execution.

### API
- `mockServer.handle(contract, handler)`: Registers an RPC handler.
- `mockServer.callRpc(contract, input)`: Simulates an RPC call to a registered handler, executing validation and returning the typed result.
- `mockServer.handlers`: Map of registered handlers.

### Example
```ts
import { describe, it, expect } from "vitest";
import { createMockServerContext } from "paseo-plugin-helper/testing";
import { contributePlugin } from "./server.js";
import { myStatusContract } from "./contracts.js";

describe("Plugin Server", () => {
  it("handles status rpc requests", async () => {
    const mock = createMockServerContext();
    contributePlugin(mock);

    const result = await mock.callRpc(myStatusContract, { agentId: "agent-123" });
    expect(result.status).toBe("online");
  });
});
```
