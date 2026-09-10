import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(_server: PluginServerContext): () => void {
  // TODO(#30): register issue query handlers (fgjx under the hood).
  return () => {};
}
