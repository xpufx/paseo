import type { FleetAgent, FleetAgentTreeNode } from "../client/types.js";

export function buildAgentTree(agents: FleetAgent[]): FleetAgentTreeNode[] {
  const agentMap = new Map<string, FleetAgent>();
  const childrenMap = new Map<string, FleetAgent[]>();

  for (const agent of agents) {
    agentMap.set(agent.id, agent);
  }

  for (const agent of agents) {
    if (agent.parentId && agentMap.has(agent.parentId)) {
      const parent = agentMap.get(agent.parentId)!;
      agent.parentName = parent.name;
      agent.parentCategory = parent.category;
    }
  }

  const rootAgents: FleetAgent[] = [];

  for (const agent of agents) {
    const parentId = agent.parentId;
    if (parentId && agentMap.has(parentId) && parentId !== agent.id) {
      const list = childrenMap.get(parentId) || [];
      list.push(agent);
      childrenMap.set(parentId, list);
    } else {
      rootAgents.push(agent);
    }
  }

  function buildNode(agent: FleetAgent, depth: number, visited: Set<string>): FleetAgentTreeNode {
    visited.add(agent.id);
    const rawChildren = childrenMap.get(agent.id) || [];
    const children: FleetAgentTreeNode[] = [];

    for (const child of rawChildren) {
      if (!visited.has(child.id)) {
        children.push(buildNode(child, depth + 1, visited));
      }
    }

    return {
      agent,
      depth,
      children,
    };
  }

  const visited = new Set<string>();
  const tree: FleetAgentTreeNode[] = [];

  for (const root of rootAgents) {
    if (!visited.has(root.id)) {
      tree.push(buildNode(root, 0, visited));
    }
  }

  return tree;
}
