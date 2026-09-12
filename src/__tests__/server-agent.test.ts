import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as processModule from "../server/process.js";
import { getAgentIdentity } from "../server/agent.js";

const ENV_VARS = ["AGENT_ID", "AGENT_NAME", "AGENT_MODEL", "AGENT_PROVIDER", "PASEO_AGENT_ID"];
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_VARS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const k of ENV_VARS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

function mockExec(stdout: string, code = 0) {
  return vi.spyOn(processModule, "safeExec").mockResolvedValue({
    stdout,
    stderr: "",
    code,
    signal: null,
    durationMs: 1,
  });
}

describe("getAgentIdentity", () => {
  it("returns null when no env and CLI fails", async () => {
    vi.spyOn(processModule, "safeExec").mockRejectedValue(new Error("not found"));
    expect(await getAgentIdentity()).toBeNull();
  });

  it("returns env identity when CLI fails", async () => {
    process.env.AGENT_ID = "abc";
    process.env.AGENT_NAME = "test-agent";
    process.env.AGENT_MODEL = "gpt-5";
    process.env.AGENT_PROVIDER = "codex";
    vi.spyOn(processModule, "safeExec").mockRejectedValue(new Error("no cli"));
    expect(await getAgentIdentity()).toEqual({
      id: "abc",
      name: "test-agent",
      model: "gpt-5",
      provider: "codex",
    });
  });

  it("prefers PASEO_AGENT_ID over AGENT_ID", async () => {
    process.env.AGENT_ID = "a1";
    process.env.PASEO_AGENT_ID = "p9";
    vi.spyOn(processModule, "safeExec").mockRejectedValue(new Error("x"));
    const id = await getAgentIdentity();
    expect(id?.id).toBe("p9");
  });

  it("parses CLI JSON envelope when no env", async () => {
    mockExec(JSON.stringify({ id: "c1", name: "cli-agent", model: "m", provider: "p", repo: "r", branch: "b", envelopeText: "env" }));
    expect(await getAgentIdentity()).toEqual({
      id: "c1",
      name: "cli-agent",
      model: "m",
      provider: "p",
      repo: "r",
      branch: "b",
      envelopeText: "env",
    });
  });

  it("merges env over CLI, keeps CLI repo/branch", async () => {
    process.env.AGENT_ID = "env-id";
    mockExec(JSON.stringify({ id: "cli-id", name: "cli", repo: "myrepo", branch: "v8" }));
    const id = await getAgentIdentity();
    expect(id?.id).toBe("env-id");
    expect(id?.repo).toBe("myrepo");
    expect(id?.branch).toBe("v8");
  });

  it("returns env on non-zero exit code", async () => {
    process.env.AGENT_NAME = "n";
    mockExec("", 1);
    expect(await getAgentIdentity()).toMatchObject({ name: "n" });
  });

  it("returns env on invalid JSON", async () => {
    process.env.AGENT_NAME = "n";
    mockExec("not json{{{");
    expect(await getAgentIdentity()).toMatchObject({ name: "n" });
  });

  it("returns null on empty CLI output with no env", async () => {
    mockExec("");
    expect(await getAgentIdentity()).toBeNull();
  });

  it("passes timeoutMs and custom command through", async () => {
    const spy = mockExec(JSON.stringify({ id: "x" }));
    await getAgentIdentity({ timeoutMs: 123, envelopeCommand: "custom cmd" });
    expect(spy).toHaveBeenCalledWith("custom cmd", { timeoutMs: 123 });
  });
});
