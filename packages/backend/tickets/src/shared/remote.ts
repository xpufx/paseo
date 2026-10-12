export interface ForgeRemote {
  host: string;
  owner: string;
  repo: string;
}

export function parseForgeRemote(url: string | undefined | null): ForgeRemote | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim().replace(/\/+$/, "");
  const scp = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  let host: string | undefined;
  let pathPart: string | undefined;
  if (scp && !trimmed.includes("://")) {
    host = scp[1];
    pathPart = scp[2];
  } else {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
      ? trimmed
      : `ssh://${trimmed}`;
    try {
      const parsed = new URL(withScheme);
      host = parsed.hostname || undefined;
      pathPart = parsed.pathname.replace(/^\/+/, "") || undefined;
    } catch {
      return null;
    }
  }
  if (!host || !pathPart) return null;
  const segments = pathPart.replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const repo = segments.pop() as string;
  const owner = segments.pop() as string;
  return { host, owner, repo };
}

export const BARE_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type ForgeTargetResolution =
  | { ok: true; host: string; repo: string; source: "explicit" | "derived" }
  | { ok: false; error: string };

export function resolveForgeTarget(
  explicitTarget: string | undefined | null,
  gitRemoteUrl: string | undefined | null,
): ForgeTargetResolution {
  const explicit = typeof explicitTarget === "string" ? explicitTarget.trim() : "";
  const git = parseForgeRemote(gitRemoteUrl);
  if (explicit) {
    const parsed = parseForgeRemote(explicit);
    if (parsed) {
      return { ok: true, host: parsed.host, repo: `${parsed.owner}/${parsed.repo}`, source: "explicit" };
    }
    if (BARE_REPO_PATTERN.test(explicit)) {
      if (git) return { ok: true, host: git.host, repo: explicit, source: "explicit" };
      return { ok: false, error: `Selected forge "${explicit}" needs a git origin remote to supply its host` };
    }
    return { ok: false, error: `Selected forge "${explicit}" is not a valid forge remote or owner/repo` };
  }
  if (!git) return { ok: false, error: "No forge repo found for this workspace" };
  return { ok: true, host: git.host, repo: `${git.owner}/${git.repo}`, source: "derived" };
}

export function isValidForgeTarget(target: string | undefined | null): boolean {
  const value = typeof target === "string" ? target.trim() : "";
  if (!value) return false;
  return Boolean(parseForgeRemote(value)) || BARE_REPO_PATTERN.test(value);
}

export function forgeCapabilityFromRepo(payload: unknown): boolean | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const permissions = record.permissions;
  if (permissions && typeof permissions === "object") {
    const perms = permissions as Record<string, unknown>;
    if (typeof perms.push === "boolean" || typeof perms.admin === "boolean") {
      return perms.push === true || perms.admin === true;
    }
  }
  const accessLevel = record.access_level ?? record.accessLevel;
  if (typeof accessLevel === "number") return accessLevel >= 30;
  return null;
}

export function activeForgeForDirectory(
  settings:
    | {
        activeForgeByDirectory?: Record<string, string>;
        remotesByDirectory?: Record<string, string>;
        forgesByDirectory?: Record<string, string[]>;
      }
    | undefined
    | null,
  directory: string | undefined | null,
): string | null {
  const dir = typeof directory === "string" ? directory.trim() : "";
  if (!dir) return null;
  const activeMap = settings?.activeForgeByDirectory;
  if (activeMap && Object.prototype.hasOwnProperty.call(activeMap, dir)) {
    const active = activeMap[dir];
    return typeof active === "string" && active.trim() ? active.trim() : null;
  }
  const remotesMap = settings?.remotesByDirectory;
  if (remotesMap && Object.prototype.hasOwnProperty.call(remotesMap, dir)) {
    const legacy = remotesMap[dir];
    return typeof legacy === "string" && legacy.trim() ? legacy.trim() : null;
  }
  return null;
}

export interface ForgeRepoIdentity {
  host: string;
  owner: string;
  repo: string;
}

export type ForgeVisibility = "public" | "private" | "unknown";
export type ForgeAuthState =
  | "authenticated"
  | "lacks-write-scope"
  | "invalid-token"
  | "anonymous"
  | "unknown";

export interface ForgeAccessState {
  visibility: ForgeVisibility;
  auth: ForgeAuthState;
  canEdit: boolean;
  visibilityLabel: string | null;
  authLabel: string;
  authIcon: string;
  authVariant: "success" | "warning" | "danger" | "neutral";
  summary: string;
  requiredScopes: string;
}

export interface ForgeAccessInput {
  repoPublic?: boolean | null;
  tokenPresent?: boolean | null;
  tokenValid?: boolean | null;
  repoWritePermission?: boolean | null;
}

export function forgeWriteScopeList(): string {
  return "repo, write:issue (or issues:write)";
}

export function deriveForgeAccess(input: ForgeAccessInput = {}): ForgeAccessState {
  const visibility: ForgeVisibility =
    input.repoPublic === true
      ? "public"
      : input.repoPublic === false
        ? "private"
        : "unknown";

  let auth: ForgeAuthState;
  if (input.tokenValid === true) {
    auth = input.repoWritePermission === false ? "lacks-write-scope" : "authenticated";
  } else if (input.tokenPresent !== true) auth = "anonymous";
  else if (input.tokenValid === false) auth = "invalid-token";
  else auth = "unknown";

  const canEdit = auth === "authenticated";
  const visibilityLabel = visibility === "unknown" ? null : visibility;

  let authLabel: string;
  let authIcon: string;
  let authVariant: ForgeAccessState["authVariant"];
  if (auth === "authenticated") {
    authLabel = "Authenticated";
    authIcon = "KeyRound";
    authVariant = "success";
  } else if (auth === "lacks-write-scope") {
    authLabel = "Token lacks write scope";
    authIcon = "ShieldAlert";
    authVariant = "warning";
  } else if (auth === "invalid-token") {
    authLabel = "Token rejected";
    authIcon = "AlertTriangle";
    authVariant = "danger";
  } else if (auth === "anonymous") {
    authLabel = "No token";
    authIcon = "User";
    authVariant = "neutral";
  } else {
    authLabel = "Token unverified";
    authIcon = "AlertCircle";
    authVariant = "warning";
  }

  const scopeHint = `required scopes: ${forgeWriteScopeList()}.`;
  const authClause =
    auth === "authenticated"
      ? "Token accepted with write scope — reads and edits enabled."
      : auth === "lacks-write-scope"
        ? `Token accepted but it cannot push — edits disabled; ${scopeHint}`
        : auth === "invalid-token"
          ? "Saved token was rejected — edits disabled."
          : auth === "anonymous"
            ? "No token saved — edits disabled."
            : "Token state unverified — edits disabled.";

  const summary =
    visibility === "public"
      ? `Public repo — anonymous reads work. ${authClause}`
      : visibility === "private"
        ? `Private repo — a valid token is required for reads. ${authClause}`
        : `Repo visibility unknown (could not reach host). ${authClause}`;

  return {
    visibility,
    auth,
    canEdit,
    visibilityLabel,
    authLabel,
    authIcon,
    authVariant,
    summary,
    requiredScopes: forgeWriteScopeList(),
  };
}

export function writeGateNotice(access: ForgeAccessState, capability: string): string {
  if (access.auth === "lacks-write-scope") {
    return `Read-only — this token cannot ${capability}; it lacks write scope. Add a token with ${access.requiredScopes}.`;
  }
  return `Read-only — ${capability} needs a valid token. ${access.summary}`;
}
