import type { PluginUpdate } from "../shared/updates";

export interface OrphanEntry {
  name: string;
  path: string;
}

export interface OrphanSection {
  title: string;
  detail: string;
  items: OrphanEntry[];
}

function orphanName(id: string): string {
  const prefix = "orphaned:";
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

function orphanDetail(count: number): string {
  return count === 1
    ? "Leftover managed directory from an uninstalled or failed install — not probed"
    : "Leftover managed directories from uninstalled or failed installs — not probed";
}

export function partitionedRows(plugins: PluginUpdate[]): PluginUpdate[] {
  return plugins.filter((plugin) => plugin.status !== "orphaned");
}

export function buildOrphanSection(plugins: PluginUpdate[]): OrphanSection | null {
  const orphans = plugins.filter((plugin) => plugin.status === "orphaned");
  if (orphans.length === 0) return null;
  return {
    title: "Orphaned directories",
    detail: orphanDetail(orphans.length),
    items: orphans.map((plugin) => ({ name: orphanName(plugin.id), path: plugin.path })),
  };
}
