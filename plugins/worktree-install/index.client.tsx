import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  WorktreeInstallPanel,
  WorktreeInstallRoot,
  WorktreeInstallSurface,
} from "./client/surface.js";

/**
 * Host contributions.
 *
 * Registration goes through the host's own `addSidebarItem` / `addSurface` /
 * `addWorkspacePanel` rather than a helper registrar, because those registrars
 * wrap the surface in the shared kit's chrome — which is exactly the constraint
 * #629 lifted.
 */
export default function contribute(client: PluginClientContext) {
  const Themed: React.ComponentType<PluginSurfaceProps> = (props) => (
    <WorktreeInstallRoot theme={props.theme} layout={props.layout}>
      <WorktreeInstallSurface {...props} />
    </WorktreeInstallRoot>
  );
  const ThemedPanel: React.ComponentType<PluginWorkspacePanelProps> = (props) => (
    <WorktreeInstallPanel {...props} />
  );

  const removeSurface = client.addSurface("worktree-install", Themed);
  const removeSidebar = client.addSidebarItem({
    id: "worktree-install",
    title: "Worktree Install",
    icon: "GitPullRequest",
    surface: "worktree-install",
  });
  const removePanel = client.addWorkspacePanel({
    id: "worktree-install",
    title: "Worktree Install",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: ThemedPanel,
  });

  return () => {
    for (const removal of [removeSidebar, removeSurface, removePanel]) {
      if (typeof removal === "function") removal();
      else (removal as { remove?: () => void })?.remove?.();
    }
  };
}

export { WorktreeInstallSurface, WorktreeInstallPanel, WorktreeInstallRoot };
