import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SERENA_MCP_PROFILE } from "../shared/contracts.js";
import {
  FLEET_ROLE_ENV_KEY,
  registerFleetMcpInjection,
  registerHookRouterEnvInjection,
  resolveActiveProfiles,
} from "./mcp-injection.js";

describe("Serena MCP profile shape (#1020)", () => {
  it("has all required fields", () => {
    assert.ok(SERENA_MCP_PROFILE.id);
    assert.ok(SERENA_MCP_PROFILE.label);
    assert.ok(SERENA_MCP_PROFILE.command);
    assert.ok(SERENA_MCP_PROFILE.description);
    assert.ok(SERENA_MCP_PROFILE.mcpCommand);
    assert.ok(Array.isArray(SERENA_MCP_PROFILE.mcpArgs));
    assert.equal(typeof SERENA_MCP_PROFILE.enabled, "boolean");
  });

  it("command matches operator directive", () => {
    assert.equal(
      SERENA_MCP_PROFILE.command,
      "serena start-mcp-server --project-from-cwd --context ide",
    );
  });

  it("label is Serena", () => {
    assert.equal(SERENA_MCP_PROFILE.label, "Serena");
  });

  it("id is serena", () => {
    assert.equal(SERENA_MCP_PROFILE.id, "serena");
  });

  it("is enabled by default", () => {
    assert.equal(SERENA_MCP_PROFILE.enabled, true);
  });
});

describe("resolveActiveProfiles", () => {
  it("returns empty when settings are disabled", () => {
    assert.deepEqual(resolveActiveProfiles(false, {}), []);
  });

  it("returns builtin profiles when enabled with empty overrides", () => {
    const active = resolveActiveProfiles(true, {});
    assert.equal(active.length, 1);
    assert.equal(active[0].id, "serena");
  });

  it("honors false override for serena", () => {
    assert.deepEqual(resolveActiveProfiles(true, { serena: false }), []);
  });
});

describe("registerFleetMcpInjection fleet scoping (#1313)", () => {
  function createStubServer() {
    const handlers: ((input: { request: any }) => any)[] = [];
    return {
      handlers,
      server: {
        before: (name: string, handler: (input: { request: any }) => any) => {
          if (name === "agent.create") {
            handlers.push(handler);
            return () => {
              const idx = handlers.indexOf(handler);
              if (idx >= 0) handlers.splice(idx, 1);
            };
          }
          return () => {};
        },
      },
      dispatch: (initialRequest: any) => {
        let current = initialRequest;
        for (const handler of [...handlers]) {
          const result = handler({ request: current });
          if (result !== undefined) {
            current = result;
          }
        }
        return current;
      },
    };
  }

  it("does not inject Serena for standard interactive agents", () => {
    const { server, dispatch } = createStubServer();
    const cleanup = registerFleetMcpInjection(server as any, {
      enabled: true,
      profiles: {},
    });

    const standardAgentRequest = {
      config: { provider: "claude", cwd: "/home/user/project" },
      env: { USER: "xpufx" },
    };

    const finalRequest = dispatch(standardAgentRequest);
    assert.equal(finalRequest.config.mcpServers?.["uppidi-mcp-serena"], undefined);
    assert.equal(finalRequest.env?.USER, "xpufx");

    cleanup();
  });

  it("injects Serena for fleet-managed agents via request.env and strips the marker", () => {
    const { server, dispatch } = createStubServer();
    const cleanup = registerFleetMcpInjection(server as any, {
      enabled: true,
      profiles: {},
    });

    const fleetAgentRequest = {
      config: { provider: "claude", cwd: "/home/user/project" },
      env: { USER: "xpufx", [FLEET_ROLE_ENV_KEY]: "worker" },
    };

    const finalRequest = dispatch(fleetAgentRequest);
    const serenaServer = finalRequest.config.mcpServers?.["uppidi-mcp-serena"];
    assert.ok(serenaServer, "Serena server should be injected");
    assert.equal(serenaServer.type, "stdio");
    assert.equal(serenaServer.command, SERENA_MCP_PROFILE.mcpCommand);
    // Role marker stripped from child env
    assert.equal(finalRequest.env?.[FLEET_ROLE_ENV_KEY], undefined);
    assert.equal(finalRequest.env?.USER, "xpufx");

    cleanup();
  });

  it("injects Serena for fleet-managed agents via config.env and strips the marker", () => {
    const { server, dispatch } = createStubServer();
    const cleanup = registerFleetMcpInjection(server as any, {
      enabled: true,
      profiles: {},
    });

    const fleetAgentRequest = {
      config: {
        provider: "claude",
        cwd: "/home/user/project",
        env: { [FLEET_ROLE_ENV_KEY]: "orchestrator" },
      },
      env: {},
    };

    const finalRequest = dispatch(fleetAgentRequest);
    const serenaServer = finalRequest.config.mcpServers?.["uppidi-mcp-serena"];
    assert.ok(serenaServer, "Serena server should be injected");
    assert.equal(finalRequest.config.env?.[FLEET_ROLE_ENV_KEY], undefined);

    cleanup();
  });

  it("does not inject Serena when mcpInjection setting is disabled", () => {
    const { server, dispatch } = createStubServer();
    const cleanup = registerFleetMcpInjection(server as any, {
      enabled: false,
      profiles: {},
    });

    const fleetAgentRequest = {
      config: { provider: "claude", cwd: "/home/user/project" },
      env: { [FLEET_ROLE_ENV_KEY]: "coding-agent" },
    };

    const finalRequest = dispatch(fleetAgentRequest);
    assert.equal(finalRequest.config.mcpServers?.["uppidi-mcp-serena"], undefined);

    cleanup();
  });

  it("cleanup function unregisters all hooks", () => {
    const { server, handlers } = createStubServer();
    const cleanup = registerFleetMcpInjection(server as any, {
      enabled: true,
      profiles: {},
    });

    assert.ok(handlers.length > 0);
    cleanup();
    assert.equal(handlers.length, 0);
  });
});

describe("registerHookRouterEnvInjection (#1398)", () => {
  function createStubServer() {
    const handlers: ((input: { request: any }) => any)[] = [];
    return {
      handlers,
      server: {
        before: (name: string, handler: (input: { request: any }) => any) => {
          if (name === "agent.create") {
            handlers.push(handler);
            return () => {
              const idx = handlers.indexOf(handler);
              if (idx >= 0) handlers.splice(idx, 1);
            };
          }
          return () => {};
        },
      },
      dispatch: (initialRequest: any) => {
        let current = initialRequest;
        for (const handler of [...handlers]) {
          const result = handler({ request: current });
          if (result !== undefined) {
            current = result;
          }
        }
        return current;
      },
    };
  }

  it("injects HOOK_ROUTER_BASE_URL into request.config.env and request.env", () => {
    const { server, dispatch } = createStubServer();
    const cleanup = registerHookRouterEnvInjection(server as any, () => ({
      hookHost: "192.168.1.100",
      hookPort: 8123,
    } as any));

    const initialRequest = {
      config: { provider: "claude", cwd: "/test" },
      env: { USER: "xpufx" },
    };

    const finalRequest = dispatch(initialRequest);
    assert.equal(finalRequest.config.env?.HOOK_ROUTER_BASE_URL, "http://192.168.1.100:8123");
    assert.equal(finalRequest.env?.HOOK_ROUTER_BASE_URL, "http://192.168.1.100:8123");
    assert.equal(finalRequest.env?.USER, "xpufx");

    cleanup();
  });

  it("initializes missing config.env and env if undefined", () => {
    const { server, dispatch } = createStubServer();
    const cleanup = registerHookRouterEnvInjection(server as any, () => ({
      hookHost: "10.0.0.5",
      hookPort: 9000,
    } as any));

    const initialRequest = {};

    const finalRequest = dispatch(initialRequest);
    assert.equal(finalRequest.config.env?.HOOK_ROUTER_BASE_URL, "http://10.0.0.5:9000");
    assert.equal(finalRequest.env?.HOOK_ROUTER_BASE_URL, "http://10.0.0.5:9000");

    cleanup();
  });

  it("falls back to default host and port when settings fields are absent", () => {
    const { server, dispatch } = createStubServer();
    const cleanup = registerHookRouterEnvInjection(server as any, () => ({} as any));

    const initialRequest = { config: {}, env: {} };
    const finalRequest = dispatch(initialRequest);

    assert.equal(finalRequest.config.env?.HOOK_ROUTER_BASE_URL, "http://127.0.0.1:8099");
    assert.equal(finalRequest.env?.HOOK_ROUTER_BASE_URL, "http://127.0.0.1:8099");

    cleanup();
  });

  it("cleanup function unregisters the hook", () => {
    const { server, handlers, dispatch } = createStubServer();
    const cleanup = registerHookRouterEnvInjection(server as any, () => ({
      hookHost: "127.0.0.1",
      hookPort: 8099,
    } as any));

    assert.equal(handlers.length, 1);
    cleanup();
    assert.equal(handlers.length, 0);

    const initialRequest = { config: {}, env: {} };
    const finalRequest = dispatch(initialRequest);
    assert.equal(finalRequest.config.env?.HOOK_ROUTER_BASE_URL, undefined);
    assert.equal(finalRequest.env?.HOOK_ROUTER_BASE_URL, undefined);
  });
});

