/**
 * Single source of truth for repository identity (#888).
 *
 * Every fleet surface resolves a repository through {@link resolveCanonicalRepo}
 * so a given repository has exactly one name: `host/owner/repo`. Callers must
 * never hand-parse a remote, invent an owner, or silently scope an unresolved
 * value to an unrelated repository.
 */

/** Forgejo host assumed for owner/repo inputs that omit a host. */
export const DEFAULT_FORGEJO_HOST = "forge.mrs.uppidi.com";

export function normalizeRepoKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.startsWith("remote:")) s = s.slice("remote:".length);
  s = s.replace(/^git@([^:]+):/, "$1/");
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^ssh:\/\/git@/, "");
  s = s.replace(/:\d+\//, "/");
  s = s.replace(/\.git$/, "");
  s = s.replace(/^\/+|\/+$/g, "");
  return s || null;
}

export function candidateRepoKeys(raw: string | null | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates: string[] = [];
  const pushUnique = (k: string | null | undefined) => {
    if (k && !candidates.includes(k)) candidates.push(k);
  };

  pushUnique(trimmed);

  const normalized = normalizeRepoKey(trimmed);
  if (normalized) {
    pushUnique(normalized);

    if (normalized.includes("/")) {
      const parts = normalized.split("/");
      if (parts[0].includes(".") || parts[0].includes(":")) {
        const withoutHost = parts.slice(1).join("/");
        pushUnique(withoutHost);
      } else {
        pushUnique(`${DEFAULT_FORGEJO_HOST}/${normalized}`);
      }
    }
  }

  return candidates;
}

export function canonicalRepoKey(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const normalized = normalizeRepoKey(raw) ?? raw.trim();
  if (!normalized) return null;
  if (!normalized.includes("/")) return normalized;
  const parts = normalized.split("/");
  if (parts[0].includes(".") || parts[0].includes(":")) {
    return normalized;
  }
  return `${DEFAULT_FORGEJO_HOST}/${normalized}`;
}

export interface RepoCoordinates {
  host: string;
  owner: string;
  repo: string;
}

export interface CanonicalRepo extends RepoCoordinates {
  /** Canonical identity: `${host}/${owner}/${repo}`. */
  key: string;
  /** Compact `${owner}/${repo}` form derived from {@link key}. */
  compact: string;
}

function toCanonical(coords: RepoCoordinates): CanonicalRepo {
  const host = coords.host.toLowerCase();
  return {
    host,
    owner: coords.owner,
    repo: coords.repo,
    key: `${host}/${coords.owner}/${coords.repo}`,
    compact: `${coords.owner}/${coords.repo}`,
  };
}

/**
 * Splits a fully-qualified input (host/owner/repo, owner/repo, URL, scp or
 * `.git` form) into coordinates. Returns null when the input carries no repo.
 */
export function repoCoordinates(input: string | null | undefined): RepoCoordinates | null {
  const normalized = normalizeRepoKey(input);
  if (!normalized) return null;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const first = segments[0];
  const hasHost = first.includes(".") || first.includes(":");
  const host = hasHost ? first : DEFAULT_FORGEJO_HOST;
  const rest = hasHost ? segments.slice(1) : segments;
  if (rest.length < 2) return null;
  return {
    host,
    owner: rest[rest.length - 2],
    repo: rest[rest.length - 1],
  };
}

export interface ResolveCanonicalRepoOptions {
  /**
   * Known repositories (in any accepted input form). Used to resolve a bare
   * repo name to its owning repository without inventing an owner.
   */
  knownRepos?: readonly string[] | null;
  /** Forgejo host assumed when an input omits it. */
  host?: string;
}

/**
 * Resolves any repository input to its single canonical identity.
 *
 * - `host/owner/repo`, `owner/repo`, full URLs, scp and `.git` forms all resolve
 *   to `host/owner/repo`.
 * - A bare repo name (`agent-mux`) resolves only when exactly one known repo
 *   matches it; otherwise it is unresolvable.
 * - A bare host, an empty value, or `"all"` resolve to null.
 */
export function resolveCanonicalRepo(
  input: string | null | undefined,
  options?: ResolveCanonicalRepoOptions,
): CanonicalRepo | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw || raw.toLowerCase() === "all") return null;

  const host = (options?.host ?? DEFAULT_FORGEJO_HOST).toLowerCase();
  const normalized = normalizeRepoKey(raw);
  if (!normalized) return null;

  const segments = normalized.split("/").filter(Boolean);
  const first = segments[0] ?? "";
  const hasHost = first.includes(".") || first.includes(":");
  const rest = hasHost ? segments.slice(1) : segments;

  if (rest.length >= 2) {
    return toCanonical({
      host: hasHost ? first : host,
      owner: rest[rest.length - 2],
      repo: rest[rest.length - 1],
    });
  }

  // rest.length < 2: a bare repo name or a bare host, neither of which names a
  // repository on its own. Match bare repo names against the known roster.
  if (rest.length !== 1) return null;
  const bare = rest[0];
  if (bare.includes(".") || bare.includes(":")) return null;

  const known = options?.knownRepos;
  if (!known || known.length === 0) return null;

  const matches = new Map<string, CanonicalRepo>();
  for (const candidate of known) {
    const coords = repoCoordinates(candidate);
    if (!coords) continue;
    if (coords.repo.toLowerCase() !== bare.toLowerCase()) continue;
    const canonical = toCanonical(coords);
    matches.set(canonical.key.toLowerCase(), canonical);
  }
  if (matches.size !== 1) return null;
  return [...matches.values()][0] ?? null;
}

/** Canonical `host/owner/repo` name, or null when unresolvable. */
export function canonicalRepoName(
  input: string | null | undefined,
  options?: ResolveCanonicalRepoOptions,
): string | null {
  return resolveCanonicalRepo(input, options)?.key ?? null;
}

/** Compact `owner/repo` form derived from the canonical identity, or null. */
export function compactRepoName(
  input: string | null | undefined,
  options?: ResolveCanonicalRepoOptions,
): string | null {
  return resolveCanonicalRepo(input, options)?.compact ?? null;
}

export {
  type ProjectIdentity,
  type FormattedProjectDisplay,
  formatProjectDisplay,
  formatProjectOptionLabel,
} from "@xpufx/backend-fleet/client";

