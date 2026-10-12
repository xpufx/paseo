import { describe, it, expect, afterEach } from "vitest";
import {
  parseGatewayPort,
  startGateway,
  stopGateway,
  getGatewayServer,
  getGatewayRouter,
} from "./gateway.js";
import type { McpToolsSettings } from "../shared/mcp.js";

describe("mcp-tools server gateway", () => {
  afterEach(async () => {
    await stopGateway();
  });

  it("parses gateway port from URL correctly", () => {
    expect(parseGatewayPort("http://127.0.0.1:37374/mcp")).toBe(37374);
    expect(parseGatewayPort("http://localhost:8080")).toBe(8080);
    expect(parseGatewayPort("http://127.0.0.1/mcp")).toBe(37374);
    expect(parseGatewayPort("not-a-valid-url")).toBe(37374);
  });

  it("starts and stops gateway based on settings", async () => {
    const disabledSettings: McpToolsSettings = {
      healthPollingRate: "30s",
      healthDigestRows: false,
      gatewayInject: false,
      gatewayUrl: "http://127.0.0.1:0/mcp",
    };

    const resDisabled = await startGateway(disabledSettings);
    expect(resDisabled).toBeUndefined();
    expect(getGatewayServer()).toBeUndefined();

    // Use port 0 for dynamic free port in test
    const enabledSettings: McpToolsSettings = {
      healthPollingRate: "30s",
      healthDigestRows: false,
      gatewayInject: true,
      gatewayUrl: "http://127.0.0.1:0/mcp",
    };

    const resEnabled = await startGateway(enabledSettings);
    expect(resEnabled).toBeDefined();
    expect(resEnabled!.port).toBeGreaterThan(0);
    expect(getGatewayServer()).toBeDefined();
    expect(getGatewayRouter()).toBeDefined();

    // Stopping gateway
    await stopGateway();
    expect(getGatewayServer()).toBeUndefined();
    expect(getGatewayRouter()).toBeUndefined();
  });
});
