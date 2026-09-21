import React, { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  ActionBar,
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  Grid,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  Row,
  SearchInput,
  Stack,
  StatusDot,
  Tabs,
  usePluginTheme,
} from "paseo-plugin-helper/client";
import type { AttentionLabel, ForgeIssue } from "../shared/types";
import { UppidiForgeStaticMockup } from "./static-mockup";

type Filter = "all" | "needs-you" | "in-flight" | "review";
type SurfaceTab = "dashboard" | "mockup";
type DashboardIssue = Pick<ForgeIssue, "number" | "title" | "labels" | "comments"> & {
  attention: AttentionLabel;
  status: "Backlog" | "In progress" | "Review";
  repo: string;
  branch?: string;
};

const issues: DashboardIssue[] = [
  { number: 42, title: "Add workspace dispatch controls", repo: "uppidi-forge", attention: "attention/1-agent", status: "In progress", branch: "feat/42-dispatch", comments: 3, labels: [] },
  { number: 38, title: "Confirm release verification checklist", repo: "paseo", attention: "attention/2-user", status: "Review", comments: 7, labels: [] },
  { number: 31, title: "Triage incoming repository hooks", repo: "uppidi-forge", attention: "attention/0-orchestrator", status: "Backlog", comments: 1, labels: [] },
  { number: 27, title: "Keep worktree activity in sync", repo: "paseo", attention: "attention/1-agent", status: "In progress", branch: "fix/27-worktree-sync", comments: 2, labels: [] },
];

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All work" },
  { id: "needs-you", label: "Needs you" },
  { id: "in-flight", label: "In flight" },
  { id: "review", label: "Review" },
];
const tabs = [
  { id: "dashboard", label: "Dashboard", shortLabel: "Dashboard", icon: "LayoutDashboard" },
  { id: "mockup", label: "Static mockup", shortLabel: "Mockup", icon: "PanelTop" },
];
const attention: Record<AttentionLabel, string> = {
  "attention/0-orchestrator": "Orchestrator",
  "attention/1-agent": "Agent",
  "attention/2-user": "You",
};

function statusVariant(status: DashboardIssue["status"]): "neutral" | "warning" | "info" {
  return status === "Review" ? "warning" : status === "In progress" ? "info" : "neutral";
}

export function UppidiForgeSurface(props: PluginSurfaceProps) {
  const { colors, typography } = usePluginTheme();
  const [activeTab, setActiveTab] = useState<SurfaceTab>("dashboard");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selectedNumber, setSelectedNumber] = useState(42);
  const [notice, setNotice] = useState("Everything is ready to orchestrate.");

  const visible = useMemo(() => issues.filter((issue) => {
    const matchesFilter = filter === "all"
      || (filter === "needs-you" && issue.attention === "attention/2-user")
      || (filter === "in-flight" && issue.status === "In progress")
      || (filter === "review" && issue.status === "Review");
    const search = query.trim().toLowerCase();
    return matchesFilter && (!search || `${issue.repo} ${issue.number} ${issue.title}`.toLowerCase().includes(search));
  }), [filter, query]);
  const selected = issues.find((issue) => issue.number === selectedNumber) ?? visible[0] ?? issues[0];

  return (
    <ModalBody
      headerMode="pinned"
      header={<Tabs tabs={tabs} activeTab={activeTab} onTabChange={(id) => setActiveTab(id as SurfaceTab)} />}
      headerStyle={{ backgroundColor: colors.surface0, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 }}
      contentContainerStyle={{ gap: 12, paddingHorizontal: 12, paddingTop: 6 }}
    >
      {activeTab === "mockup" ? <UppidiForgeStaticMockup {...props} /> : <Stack gap={12}>
        <Row justify="space-between" align="center" wrap gap="sm">
          <Stack gap="xxs" style={{ flex: 1 }}>
            <Row align="center" gap="sm">
              <StatusDot variant="success" pulse />
              <Text style={{ color: colors.foreground, ...typography.title }}>Uppidi Forge</Text>
              <Badge label="Connected" variant="success" size="sm" dot />
            </Row>
            <Text style={{ color: colors.foregroundMuted, ...typography.body }}>One place for triage, active work, and review decisions.</Text>
          </Stack>
          <Button label="Refresh" icon="RefreshCw" variant="secondary" onPress={() => setNotice("Dashboard refreshed. Forgejo RPC data can replace this local snapshot without changing the surface.")} />
        </Row>

        <ActionBar align="space-between">
          <Row wrap gap="xs">
            {filters.map(({ id, label }) => <Button key={id} label={label} size="sm" variant={filter === id ? "primary" : "ghost"} onPress={() => setFilter(id)} />)}
          </Row>
          <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>Updated just now</Text>
        </ActionBar>

        <Grid columns={4} minColumnWidth={160} gap="sm">
          <Metric label="Open issues" value="12" detail="across 2 repos" icon="CircleDot" />
          <Metric label="Active agents" value="3" detail="2 worktrees running" icon="Bot" />
          <Metric label="Awaiting review" value="2" detail="1 needs your signoff" icon="GitPullRequest" />
          <Metric label="Verified today" value="8" detail="last run 4 min ago" icon="CheckCircle2" />
        </Grid>

        <Grid columns={3} minColumnWidth={280} gap="md">
          <Stack gap={12} style={{ flex: 2 }}>
            <Card variant="elevated">
              <CardHeader title="Work queue" subtitle={`${visible.length} matching items`} icon="ListTodo" action={<Button label="Dispatch work" size="sm" icon="ArrowRight" iconPosition="right" variant="ghost" onPress={() => setNotice("Dispatch queued for the selected issue. Connect the RPC handler to start a real worktree.")} />} />
              <SearchInput value={query} onChangeText={setQuery} onClear={() => setQuery("")} placeholder="Filter issue title, repository, or number" />
              <DataTable
                data={visible}
                keyExtractor={(issue) => String(issue.number)}
                emptyState={<EmptyState title="No work matches this filter" description="Try another queue filter or clear the search." actionLabel="Clear filters" onAction={() => { setFilter("all"); setQuery(""); }} />}
                columns={[
                  { key: "issue", header: "Issue", flex: 3, render: (issue) => <Button label={`${issue.repo} #${issue.number} · ${issue.title}`} variant="ghost" size="sm" onPress={() => setSelectedNumber(issue.number)} /> },
                  { key: "status", header: "Status", flex: 1, render: (issue) => <Badge label={issue.status} variant={statusVariant(issue.status)} size="sm" /> },
                  { key: "attention", header: "Owner", flex: 1, render: (issue) => <Text style={{ color: colors.foregroundMuted, ...typography.caption }}>{attention[issue.attention]}</Text> },
                ]}
              />
            </Card>
            <Card variant="elevated">
              <CardHeader title="Active worktrees" icon="FolderGit2" />
              <KeyValueGroup>
                <KeyValue label="feat/42-dispatch" value="uppidi-forge · forge-orchestrator · Running verification" />
                <KeyValue label="fix/27-worktree-sync" value="paseo · worker-27 · Awaiting agent turn" />
              </KeyValueGroup>
            </Card>
          </Stack>
          <Stack gap={12} style={{ flex: 1 }}>
            <Card variant="elevated">
              <CardHeader title="Selected work" icon="PanelRightOpen" />
              <Stack gap="sm">
                <Text style={{ color: colors.accent, ...typography.caption }}>{selected.repo} #{selected.number}</Text>
                <Text style={{ color: colors.foreground, ...typography.heading }}>{selected.title}</Text>
                <Row wrap gap="xs"><Badge label={selected.status} variant={statusVariant(selected.status)} /><Badge label={attention[selected.attention]} variant="neutral" /></Row>
                <KeyValue label="Worktree" value={selected.branch ?? "No worktree dispatched yet"} copyable={!!selected.branch} />
                <Button label="Inspect in place" icon="PanelRightOpen" variant="primary" onPress={() => setNotice(`Opened inline inspection for ${selected.repo} #${selected.number}.`)} />
              </Stack>
            </Card>
            <Card variant="elevated">
              <CardHeader title="Review radar" icon="GitPullRequest" />
              <KeyValueGroup>
                <KeyValue label="feat: dispatch worktree jobs" value="uppidi-forge · Checks passing" />
                <KeyValue label="fix: synchronize worktree events" value="paseo · 1 approval needed" />
              </KeyValueGroup>
            </Card>
            <Card><Text style={{ color: colors.foregroundMuted, ...typography.caption }}>{notice}</Text></Card>
          </Stack>
        </Grid>
      </Stack>}
    </ModalBody>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: string }) {
  const { colors, typography } = usePluginTheme();
  return <Card variant="elevated"><CardHeader title={label} value={value} icon={icon} /><Text style={{ color: colors.foregroundMuted, ...typography.caption }}>{detail}</Text></Card>;
}
