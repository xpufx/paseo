import { describe, expect, it } from "vitest";
import {
  createDiagnoseMcpHandler,
  createInspectProviderMcpHandler,
  createListMcpHandler,
} from "./mcp";
import {
  ProviderInjectionCapabilitySchema,
  diagnoseMcp,
  inspectProviderMcp,
  listMcp,
} from "../shared/mcp";

function createMockPluginContext(provider: string, agentId = "agent-mock-1", capabilities?: string[]) {
  const agent = {
    id: agentId,
    provider,
    cwd: "/mock/project",
    capabilities,
  };

  return {
    paseo: {
      agents: {
        ref: () => ({
          refresh: async () => ({ agent }),
          current: () => agent,
          timeline: {
            append: async () => {},
          },
        }),
      },
    },
  } as never;
}

describe("MCP Provider Injection Detection and RPC Contracts (#1384)", () => {
  describe("inspectProviderMcp RPC handler", () => {
    const inspectHandler = createInspectProviderMcpHandler();

    it("evaluates antigravity and passes ProviderInjectionCapabilitySchema", async () => {
      const result = await inspectHandler({ provider: "antigravity" });
      const parsed = ProviderInjectionCapabilitySchema.safeParse(result);
      expect(parsed.success).toBe(true);

      expect(result.provider).toBe("antigravity");
      expect(result.supportsMcpInjection).toBe(false);
      expect(result.supportsNativePaseoTools).toBe(false);
      expect(result.status).toBe("unsupported");
      expect(result.manualConfigPath).toContain(".gemini/config/mcp_config.json");
      expect(result.manualConfigSnippet).toContain('"gateway"');
      expect(result.warning).toContain("does not implement runtime MCP injection");
    });

    it("evaluates supported provider paseo and passes schema", async () => {
      const result = await inspectHandler({ provider: "paseo" });
      const parsed = ProviderInjectionCapabilitySchema.safeParse(result);
      expect(parsed.success).toBe(true);

      expect(result.supportsMcpInjection).toBe(true);
      expect(result.supportsNativePaseoTools).toBe(true);
      expect(result.status).toBe("supported");
      expect(result.warning).toBeNull();
    });

    it("evaluates provider capabilities (session.mcp)", async () => {
      const supported = await inspectHandler({
        provider: "custom-agent",
        capabilities: ["prompt.message", "session.mcp"],
      });
      expect(supported.supportsMcpInjection).toBe(true);
      expect(supported.status).toBe("supported");

      const unsupported = await inspectHandler({
        provider: "custom-agent",
        capabilities: ["prompt.message"],
      });
      expect(unsupported.supportsMcpInjection).toBe(false);
      expect(unsupported.status).toBe("unsupported");
    });
  });

  describe("mcp.list integration with provider capability inspection", () => {
    it("includes provider injection capability status in list response", async () => {
      const listHandler = createListMcpHandler();
      const ctx = createMockPluginContext("antigravity", "agent-ag-1");

      const res = await listHandler({ agentId: "agent-ag-1" }, ctx);
      expect(res.provider).toBe("antigravity");
      expect(res.supportsMcpInjection).toBe(false);
      expect(res.supportsNativePaseoTools).toBe(false);
      expect(res.manualConfigPath).toContain(".gemini/config/mcp_config.json");
      expect(res.manualConfigSnippet).toContain('"gateway"');
      expect(res.warning).toContain("does not implement runtime MCP injection");

      // Verify conforms to listMcp output schema
      const parsed = listMcp.output.safeParse(res);
      expect(parsed.success).toBe(true);
    });

    it("includes supported status for paseo in list response", async () => {
      const listHandler = createListMcpHandler();
      const ctx = createMockPluginContext("paseo", "agent-paseo-1");

      const res = await listHandler({ agentId: "agent-paseo-1" }, ctx);
      expect(res.provider).toBe("paseo");
      expect(res.supportsMcpInjection).toBe(true);
      expect(res.warning).toBeNull();

      const parsed = listMcp.output.safeParse(res);
      expect(parsed.success).toBe(true);
    });
  });

  describe("mcp.diagnose integration with provider injection capability step", () => {
    it("adds diagnostic step and capability fields for un-injected provider", async () => {
      const diagnoseHandler = createDiagnoseMcpHandler();
      const ctx = createMockPluginContext("antigravity", "agent-ag-diag");

      const res = await diagnoseHandler({ agentId: "agent-ag-diag" }, ctx);
      expect(res.provider).toBe("antigravity");
      expect(res.supportsMcpInjection).toBe(false);
      expect(res.supportsNativePaseoTools).toBe(false);
      expect(res.manualConfigPath).toContain(".gemini/config/mcp_config.json");
      expect(res.manualConfigSnippet).toContain('"gateway"');

      // Check steps for the injection capability step
      const injectionStep = res.steps.find((s) => s.target.includes("Provider MCP Injection"));
      expect(injectionStep).toBeDefined();
      expect(injectionStep?.status).toBe("missing");
      expect(injectionStep?.details).toContain("does not implement runtime MCP injection");
      expect(injectionStep?.contentPreview).toContain('"gateway"');

      // Conforms to diagnoseMcp schema
      const parsed = diagnoseMcp.output.safeParse(res);
      expect(parsed.success).toBe(true);
    });

    it("adds passing diagnostic step for supported provider", async () => {
      const diagnoseHandler = createDiagnoseMcpHandler();
      const ctx = createMockPluginContext("paseo", "agent-paseo-diag");

      const res = await diagnoseHandler({ agentId: "agent-paseo-diag" }, ctx);
      expect(res.supportsMcpInjection).toBe(true);

      const injectionStep = res.steps.find((s) => s.target.includes("Provider MCP Injection"));
      expect(injectionStep).toBeDefined();
      expect(injectionStep?.status).toBe("found");
      expect(injectionStep?.details).toContain("supports runtime MCP injection");

      const parsed = diagnoseMcp.output.safeParse(res);
      expect(parsed.success).toBe(true);
    });
  });
});
