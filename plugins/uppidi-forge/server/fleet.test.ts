import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { categorizeAgent, normalizeRawAgent, handleUppidiAgents } from "./agents.js";
import { DEFAULT_ROLE_MODELS, handleUppidiRoleModels, handleUppidiSetRoleModel } from "./role-models.js";
import { handleUppidiRunners } from "./runners.js";

describe("fleet and agents classification", () => {
  it("categorizes agent names accurately", () => {
    assert.equal(categorizeAgent("Front Desk"), "front-desk");
    assert.equal(categorizeAgent("frontdesk"), "front-desk");
    assert.equal(categorizeAgent("Orchestrator · xpufx-org/paseo"), "orchestrator");
    assert.equal(categorizeAgent("Orchestrator · xpufx/platform"), "orchestrator");
    assert.equal(categorizeAgent("feat-367-worker"), "worker");
    assert.equal(categorizeAgent("platform #99 caller"), "worker");
  });

  it("normalizes raw agent records with defaults", () => {
    const agent = normalizeRawAgent({
      id: "64d89202-acaa-4071-b658-90db710875bd",
      name: "Front Desk",
      status: "idle",
      provider: "antigravity-acp/gemini-3.8-flash-low",
      cwd: "~/code/meta",
    });

    assert.equal(agent.id, "64d89202-acaa-4071-b658-90db710875bd");
    assert.equal(agent.shortId, "64d8920");
    assert.equal(agent.category, "front-desk");
    assert.equal(agent.status, "idle");
  });

  it("groups agents by hierarchy and calculates health totals", async () => {
    const mockContext: any = {
      paseo: {
        agents: {
          list: async () => ({
            entries: [
              { agent: { id: "fd-1", name: "Front Desk", status: "idle" } },
              { agent: { id: "orch-1", name: "Orchestrator · test", status: "running" } },
              { agent: { id: "orch-2", name: "Orchestrator · platform", status: "idle" } },
              { agent: { id: "w-1", name: "Worker fix 1", status: "error" } },
            ],
          }),
        },
      },
    };

    const res = await handleUppidiAgents({}, mockContext);
    assert.equal(res.ok, true);
    assert.equal(res.frontDesk.length, 1);
    assert.equal(res.orchestrators.length, 2);
    assert.equal(res.workers.length, 1);
    assert.equal(res.totalCount, 4);
    assert.equal(res.runningCount, 1);
    assert.equal(res.idleCount, 2);
    assert.equal(res.errorCount, 1);
  });
});

describe("role models configuration", () => {
  it("provides default role mappings", async () => {
    const res = await handleUppidiRoleModels({}, {} as any);
    assert.equal(res.ok, true);
    assert.ok(res.roles["front-desk"]);
    assert.ok(res.roles["orchestrator"]);
    assert.ok(res.roles["coding-agent"]);
    assert.ok(res.availableModels.length > 0);
  });

  it("updates role model mapping", async () => {
    const updateRes = await handleUppidiSetRoleModel(
      {
        role: "orchestrator",
        primaryModel: "antigravity-acp/gemini-3.8-flash-low",
        fallbackGroup: ["antigravity-acp/gemini-3.8-flash-low", "codex/gpt-5.6-luna"],
      },
      {} as any
    );
    assert.equal(updateRes.ok, true);
  });
});

describe("runner fleet status", () => {
  it("returns known runner list", async () => {
    const res = await handleUppidiRunners({}, {} as any);
    assert.equal(res.ok, true);
    assert.ok(res.runners.length > 0);
    assert.ok(res.onlineCount >= 0);
  });
});
