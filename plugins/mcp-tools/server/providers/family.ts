const AFFIX_SEPS = ["-", "_", ":", "/"];

function norm(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesFamily(provider: string, family: string): boolean {
  const p = norm(provider);
  const f = norm(family);
  if (!p || !f) return false;
  if (p === f) return true;
  return AFFIX_SEPS.some((sep) => p.startsWith(f + sep) || p.endsWith(sep + f));
}

export function matchesAnyFamily(provider: string, families: string[]): boolean {
  return families.some((family) => matchesFamily(provider, family));
}

export const OPENCODE_FORK_IDS = ["example-fork", "sample-fork"];

export function matchesOpencodeFamily(provider: string): boolean {
  const p = norm(provider);
  return matchesFamily(p, "opencode") || OPENCODE_FORK_IDS.includes(p);
}
