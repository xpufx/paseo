export type AttentionLabel =
  | "attention/0-orchestrator"
  | "attention/1-agent"
  | "attention/2-user";

export type StateLabel =
  | "state/0-backlog"
  | "state/1-spec"
  | "state/2-wip"
  | "state/3-verify"
  | "state/4-done";

export interface ForgeIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: Array<{
    id: number;
    name: string;
    color: string;
  }>;
  user: {
    login: string;
    full_name?: string;
    avatar_url?: string;
  };
  assignee?: {
    login: string;
  } | null;
  comments: number;
  created_at: string;
  updated_at: string;
  pull_request?: {
    merged: boolean;
    draft: boolean;
    html_url: string;
  } | null;
}

export interface ForgeRepoInfo {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  orchestratorAgentId?: string | null;
  activeWorktreesCount?: number;
}
