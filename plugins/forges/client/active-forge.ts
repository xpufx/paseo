import { useMemo } from "react";
import { useAgent, useWorkspace } from "@getpaseo/plugin/client";
import type { PluginWorkspaceSnapshot } from "@getpaseo/plugin";
import {
  activeForgeForDirectory,
  forgeContextContract,
  forgeSettingsContract,
  resolveForgeTarget,
  type ForgeRepoIdentity,
} from "../shared/issues.js";
import { usePluginSettings, useRpcQuery } from "./vendor/paseo-plugin-helper/index.ts";

/** Workspace directory backing an agent, or undefined while it cannot resolve. */
export function useAgentDirectory(agentId: string): string | undefined {
  const workspaceId = useAgent(agentId, (agent: { workspaceId: string }) => agent?.workspaceId) as
    | string
    | null;
  return (
    useWorkspace(workspaceId ?? "", (workspace: PluginWorkspaceSnapshot) => workspace?.directory) ??
    undefined
  );
}

/**
 * Active forge identity for a workspace directory, mirroring the server's
 * resolution: an explicit selection wins absolutely, otherwise the git origin
 * remote is derived via `forgeContextContract`. The git-context query is
 * cache-keyed, so per-item callers share one request. Null when nothing
 * resolves, which callers treat as "every link is foreign".
 */
export function useActiveForgeIdentity(
  directory: string | undefined | null,
): ForgeRepoIdentity | null {
  const { settings } = usePluginSettings(forgeSettingsContract);
  const context = useRpcQuery(forgeContextContract, { directory: directory ?? undefined });
  const target = activeForgeForDirectory(settings, directory) ?? "";
  const derivedRemote = context.data?.derivedRemote ?? null;
  return useMemo(() => {
    const resolved = resolveForgeTarget(target, derivedRemote);
    return resolved.ok ? { host: resolved.host, repo: resolved.repo } : null;
  }, [target, derivedRemote]);
}

/** Active forge identity for the workspace backing a timeline agent. */
export function useActiveForgeIdentityForAgent(agentId: string): ForgeRepoIdentity | null {
  return useActiveForgeIdentity(useAgentDirectory(agentId));
}
