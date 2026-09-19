import type { McpProbe } from "../discovery/types";
import * as catalog from "./catalog";

export const probes: McpProbe[] = Object.values(catalog);

export function probeForProvider(provider: string, ...labels: Array<string | null | undefined>): McpProbe | null {
  const candidates = [provider, ...labels].filter((c): c is string => typeof c === "string" && c.length > 0);
  return probes.find((p) => candidates.some((c) => p.matches(c))) ?? null;
}

export * from "./catalog";
