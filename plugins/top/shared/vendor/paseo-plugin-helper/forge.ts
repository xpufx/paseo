/**
 * Shared forge brand-mark resolution.
 *
 * One host/kind -> mark table for every plugin that shows forge iconography,
 * so plugins never carry their own per-forge icon maps. The client-side
 * `<ForgeIcon>` renders this descriptor; server/shared code can consume the
 * pure resolver without pulling in React.
 *
 * GitHub and GitLab resolve to their Lucide marks; Codeberg, Forgejo and Gitea
 * have no Lucide equivalent and resolve to helper-drawn official mono marks.
 */

export type ForgeKind =
  | "github"
  | "gitlab"
  | "codeberg"
  | "forgejo"
  | "gitea"
  | "generic";

export interface ResolvedForgeMark {
  /** Stable forge identity. */
  kind: ForgeKind;
  /** Human-readable forge name for labels and accessibility. */
  label: string;
  /** Host Lucide icon name; the exact mark on hosts with SVG support, the closest fallback otherwise. */
  lucideName: string;
  /** True when `<ForgeIcon>` draws the official mark instead of delegating to the host icon set. */
  custom: boolean;
}

export interface ForgeMarkInput {
  /** Forge hostname, e.g. `codeberg.org` or `forge.mrs.aager.de`. */
  host?: string | null;
  /** Explicit forge identity; wins over host detection when it names a known forge. */
  kind?: ForgeKind | string | null;
}

const FORGE_MARKS: Record<ForgeKind, ResolvedForgeMark> = {
  github: { kind: "github", label: "GitHub", lucideName: "Github", custom: false },
  gitlab: { kind: "gitlab", label: "GitLab", lucideName: "Gitlab", custom: false },
  codeberg: { kind: "codeberg", label: "Codeberg", lucideName: "Mountain", custom: true },
  forgejo: { kind: "forgejo", label: "Forgejo", lucideName: "Hammer", custom: true },
  gitea: { kind: "gitea", label: "Gitea", lucideName: "Coffee", custom: true },
  generic: { kind: "generic", label: "Git forge", lucideName: "Globe", custom: false },
};

const FORGE_KINDS: ForgeKind[] = [
  "github",
  "gitlab",
  "codeberg",
  "forgejo",
  "gitea",
  "generic",
];

/**
 * Reduce a remote URL, `owner/repo` slug or bare hostname to a lowercase
 * hostname without scheme, userinfo, port, path or a leading `www.`.
 */
export function normalizeForgeHost(host: string | null | undefined): string | null {
  if (!host || typeof host !== "string") return null;
  let value = host.trim().toLowerCase();
  if (!value) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^[^@/]+@/, "");
  value = value.split("/")[0]!.split("?")[0]!.split("#")[0]!;
  // Cuts both `host:port` and SCP-style `host:owner/repo` tails.
  value = value.split(":")[0]!;
  value = value.replace(/^www\./, "").replace(/\.$/, "");
  return value || null;
}

// Ordered: the first match wins. Self-hosted instances routinely carry the
// project name in their hostname (e.g. `forgejo.example.com`); everything else
// is an unknown forge and gets the generic fallback.
const HOST_KIND_RULES: Array<{ matches: (host: string) => boolean; kind: ForgeKind }> = [
  { matches: (h) => h === "github.com" || h.endsWith(".github.com"), kind: "github" },
  { matches: (h) => h === "gitlab.com" || h.endsWith(".gitlab.com"), kind: "gitlab" },
  { matches: (h) => h === "codeberg.org" || h.endsWith(".codeberg.org"), kind: "codeberg" },
  { matches: (h) => h === "forgejo.org" || h.endsWith(".forgejo.org") || h.includes("forgejo"), kind: "forgejo" },
  { matches: (h) => h === "gitea.com" || h === "gitea.io" || h.includes("gitea"), kind: "gitea" },
];

export function isForgeKind(value: unknown): value is ForgeKind {
  return typeof value === "string" && FORGE_KINDS.includes(value as ForgeKind);
}

export function forgeKindFromHost(host: string | null | undefined): ForgeKind {
  const normalized = normalizeForgeHost(host);
  if (!normalized) return "generic";
  for (const rule of HOST_KIND_RULES) {
    if (rule.matches(normalized)) return rule.kind;
  }
  return "generic";
}

/**
 * Resolve a forge descriptor from a hostname and/or explicit kind. Accepts a
 * bare host string for the common host-only case.
 */
export function resolveForgeMark(
  input: ForgeMarkInput | string | null | undefined,
): ResolvedForgeMark {
  const { host, kind } =
    input !== null && typeof input === "object" ? input : { host: input, kind: null };
  const explicit = typeof kind === "string" ? kind.trim().toLowerCase() : null;
  const resolved = isForgeKind(explicit) ? explicit : forgeKindFromHost(host);
  return FORGE_MARKS[resolved];
}
