import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type {
  RoleModelConfig,
  UppidiRoleModelsOutput,
  UppidiSetRoleModelInput,
  UppidiSetRoleModelOutput,
} from "../shared/contracts.js";

const execFileAsync = promisify(execFile);

const CONFIG_PATH = join(homedir(), ".paseo", "uppidi-forge-role-models.json");

export const DEFAULT_ROLE_MODELS: Record<string, RoleModelConfig> = {
  "front-desk": {
    role: "front-desk",
    primaryModel: "antigravity-acp/gemini-3.8-flash-low",
    fallbackGroup: [
      "antigravity-acp/gemini-3.8-flash-low",
      "pufaysokt/opencode-go/deepseek-v4.1-flash",
      "opencode/ollama-cloud/deepseek-v4.1-flash",
    ],
  },
  orchestrator: {
    role: "orchestrator",
    primaryModel: "antigravity-acp/gemini-3.8-flash-low",
    fallbackGroup: [
      "antigravity-acp/gemini-3.8-flash-low",
      "codex/gpt-5.6-luna",
      "pufaysokt/opencode-go/deepseek-v4.1-flash",
    ],
  },
  "coding-agent": {
    role: "coding-agent",
    primaryModel: "codex/gpt-5.6-terra",
    fallbackGroup: [
      "codex/gpt-5.6-terra",
      "codex/gpt-5.6-luna",
      "pufaysokt/opencode-go/deepseek-v4.1-flash",
    ],
  },
  auditor: {
    role: "auditor",
    primaryModel: "pufaysokt/opencode-go/muse-spark-1.3-contributor",
    fallbackGroup: [
      "pufaysokt/opencode-go/muse-spark-1.3-contributor",
      "opencode/opencode/muse-spark-1.3-contributor-free",
    ],
  },
};

export function loadSavedRoleModels(): Record<string, RoleModelConfig> {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        return { ...DEFAULT_ROLE_MODELS, ...parsed };
      }
    }
  } catch {
    // Ignore read errors and fallback to defaults
  }
  return { ...DEFAULT_ROLE_MODELS };
}

export function saveRoleModels(roles: Record<string, RoleModelConfig>): void {
  try {
    const dir = join(homedir(), ".paseo");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CONFIG_PATH, JSON.stringify(roles, null, 2), "utf-8");
  } catch {
    // Ignore write errors if permission denied
  }
}

export async function discoverAvailableModels(
  context?: PluginHandlerContext
): Promise<string[]> {
  const models = new Set<string>([
    "antigravity-acp/gemini-3.8-flash-low",
    "antigravity-acp/gemini-3.8-flash-medium",
    "codex/gpt-5.6-terra",
    "codex/gpt-5.6-luna",
    "pufaysokt/opencode-go/deepseek-v4.1-flash",
    "opencode/ollama-cloud/deepseek-v4.1-flash",
    "pufaysokt/opencode-go/muse-spark-1.3-contributor",
    "opencode/opencode/muse-spark-1.3-contributor-free",
  ]);

  try {
    const { stdout } = await execFileAsync("paseo", ["provider", "list", "--json"], {
      timeout: 5000,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) {
      for (const p of parsed) {
        if (typeof p?.id === "string") models.add(p.id);
      }
    }
  } catch {
    // Provider list fallback
  }

  return Array.from(models);
}

export async function handleUppidiRoleModels(
  _input: Record<string, never>,
  context: PluginHandlerContext
): Promise<UppidiRoleModelsOutput> {
  try {
    const roles = loadSavedRoleModels();
    const availableModels = await discoverAvailableModels(context);
    return {
      ok: true,
      roles,
      availableModels,
    };
  } catch (err: any) {
    return {
      ok: false,
      roles: DEFAULT_ROLE_MODELS,
      availableModels: [],
      error: err?.message || String(err),
    };
  }
}

export async function handleUppidiSetRoleModel(
  input: UppidiSetRoleModelInput,
  _context: PluginHandlerContext
): Promise<UppidiSetRoleModelOutput> {
  try {
    const roles = loadSavedRoleModels();
    const existing = roles[input.role] || {
      role: input.role,
      primaryModel: input.primaryModel,
      fallbackGroup: [input.primaryModel],
    };

    roles[input.role] = {
      ...existing,
      primaryModel: input.primaryModel,
      fallbackGroup: input.fallbackGroup || existing.fallbackGroup || [input.primaryModel],
    };

    saveRoleModels(roles);

    return {
      ok: true,
      message: `Updated model for role ${input.role} to ${input.primaryModel}`,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || String(err),
    };
  }
}
