/**
 * Generic workspace-scoped shared snapshot helpers.
 *
 * When several surfaces (composer pill, modal, dashboard) render different
 * views of one host snapshot, they must share a single React Query cache
 * identity per workspace. Field-specific query keys fragment that cache and
 * let every visible pill start its own poller, so build one stable key per
 * workspace scope and keep selective server-side field collection out of the
 * client cache key.
 *
 * The no-op guards here keep settings listeners and live-label caches from
 * emitting redundant updates: React Query hands out fresh object identities
 * on every refetch, even when values are unchanged.
 */

/** Normalized workspace scope: trimmed directory, or "" for host-wide. */
export function normalizeSnapshotScope(directory?: string | null): string {
  if (typeof directory !== "string") return "";
  return directory.trim();
}

/**
 * Stable shared cache key for one RPC snapshot in one workspace scope.
 * Scopes normalize so `undefined`, `null`, and `""` all map to the
 * host-wide entry instead of three separate caches.
 */
export function sharedSnapshotKey(
  contractName: string,
  directory?: string | null,
): readonly [string, { directory?: string }] {
  const scope = normalizeSnapshotScope(directory);
  return scope ? [contractName, { directory: scope }] : [contractName, {}];
}

/**
 * Shallow record equality for plain settings/snapshot objects.
 * Returns true when both sides hold the same keys with Object.is-equal
 * values. Nested objects compare by reference, which is enough to detect
 * refetch-fresh copies of unchanged flat settings.
 */
export function shallowEqualRecord(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * True when listeners should be notified: the snapshot reference changed
 * and its shallow contents differ. Suppresses the no-op fan-out that
 * otherwise fires on every background refetch.
 */
export function shouldEmitSnapshotUpdate(
  prev: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): boolean {
  if (Object.is(prev, next)) return false;
  return !shallowEqualRecord(prev, next);
}
