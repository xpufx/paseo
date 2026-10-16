import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  WorktreeInstallPanel,
  WorktreeInstallRoot,
  WorktreeInstallSurface,
} from "./client/surface.js";

type CompatibleClientContext = PluginClientContext & {
  addScreen?: (screen: {
    id: string;
    title: string;
    Component: React.ComponentType<PluginSurfaceProps>;
  }) => any;
  addSidebarHeaderItem?: (item: {
    id: string;
    title: string;
    icon: string;
    screen?: string;
  }) => any;
};

/**
 * Host contributions.
 *
 * Registration goes through the host's own `addSidebarHeaderItem` / `addScreen`
 * (with fallback to `addSidebarItem` / `addSurface`) and `addWorkspacePanel`
 * rather than a helper registrar, because those registrars wrap the surface
 * in the shared kit's chrome — which is exactly the constraint #629 lifted.
 */
export default function contribute(rawClient: PluginClientContext) {
  const client = rawClient as CompatibleClientContext;
  const Themed: React.ComponentType<PluginSurfaceProps> = (props) => (
    <WorktreeInstallRoot theme={props.theme} layout={props.layout}>
      <WorktreeInstallSurface {...props} />
    </WorktreeInstallRoot>
  );
  const ThemedPanel: React.ComponentType<PluginWorkspacePanelProps> = (props) => (
    <WorktreeInstallPanel {...props} />
  );

  let removeSurface: any;
  let removeSidebar: any;

  if (
    typeof client.addScreen === "function" &&
    typeof client.addSidebarHeaderItem === "function"
  ) {
    removeSurface = client.addScreen({
      id: "worktree-install",
      title: "Worktree Install",
      Component: Themed,
    });
    removeSidebar = client.addSidebarHeaderItem({
      id: "worktree-install",
      title: "Worktree Install",
      icon: "GitPullRequest",
      screen: "worktree-install",
    });
  } else {
    removeSurface = client.addSurface("worktree-install", Themed);
    removeSidebar = client.addSidebarItem({
      id: "worktree-install",
      title: "Worktree Install",
      icon: "GitPullRequest",
      surface: "worktree-install",
    });
  }
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
