import type { PluginClientContext } from "@getpaseo/plugin/client";

export default function contribute(_client: PluginClientContext): () => void {
  // TODO(#30): register composer pill with open issue count (fgjx issue list).
  return () => {};
}
