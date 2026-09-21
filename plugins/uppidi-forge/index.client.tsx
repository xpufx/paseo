import type { PluginClientContext } from "@getpaseo/plugin/client";
import { UppidiForgeSurface } from "./client/surface";

export default function contribute(client: PluginClientContext) {
  const removeSurface = client.addSurface("uppidi-forge", UppidiForgeSurface);
  const removeSidebar = client.addSidebarItem({
    id: "uppidi-forge",
    title: "Uppidi Forge",
    icon: "GitPullRequest",
    surface: "uppidi-forge",
  });

  return () => {
    removeSidebar?.();
    removeSurface?.();
  };
}
