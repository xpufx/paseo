import { safeExec } from "./process.js";

export interface AgentIdentity {
  id?: string;
  name?: string;
  model?: string;
  provider?: string;
  repo?: string;
  branch?: string;
  envelopeText?: string;
}

export interface AgentIdentityOptions {
  timeoutMs?: number;
  envelopeCommand?: string;
}

const ENV_KEYS = [
  "AGENT_ID",
  "AGENT_NAME",
  "AGENT_MODEL",
  "AGENT_PROVIDER",
  "PASEO_AGENT_ID",
] as const;

function readEnvIdentity(env: NodeJS.ProcessEnv = process.env): AgentIdentity | null {
  const id = env.PASEO_AGENT_ID || env.AGENT_ID || undefined;
  const name = env.AGENT_NAME || undefined;
  const model = env.AGENT_MODEL || undefined;
  const provider = env.AGENT_PROVIDER || undefined;
  if (!id && !name && !model && !provider) return null;
  return { id, name, model, provider };
}

function normalizeEnvelopeJson(raw: unknown): AgentIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const identity: AgentIdentity = {
    id: str(o.id) ?? str(o.agentId),
    name: str(o.name) ?? str(o.agentName),
    model: str(o.model),
    provider: str(o.provider),
    repo: str(o.repo) ?? str(o.workspace),
    branch: str(o.branch),
    envelopeText: str(o.envelopeText) ?? str(o.envelope),
  };
  if (!identity.id && !identity.name && !identity.model && !identity.provider && !identity.repo && !identity.branch) return null;
  return identity;
}

export async function getAgentIdentity(
  options: AgentIdentityOptions = {},
): Promise<AgentIdentity | null> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const command = options.envelopeCommand ?? "xpufx-tool envelope --format json";
  const envIdentity = readEnvIdentity();
  void ENV_KEYS;
  try {
    const result = await safeExec(command, { timeoutMs });
    if (result.code !== 0) return envIdentity;
    const text = result.stdout.trim();
    if (!text) return envIdentity;
    try {
      const parsed: unknown = JSON.parse(text);
      const cliIdentity = normalizeEnvelopeJson(parsed);
      if (!cliIdentity) return envIdentity;
      if (!envIdentity) return cliIdentity;
      return {
        id: envIdentity.id ?? cliIdentity.id,
        name: envIdentity.name ?? cliIdentity.name,
        model: envIdentity.model ?? cliIdentity.model,
        provider: envIdentity.provider ?? cliIdentity.provider,
        repo: cliIdentity.repo,
        branch: cliIdentity.branch,
        envelopeText: cliIdentity.envelopeText,
      };
    } catch {
      return envIdentity;
    }
  } catch {
    return envIdentity;
  }
}
