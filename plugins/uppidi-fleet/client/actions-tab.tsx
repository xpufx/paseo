import React, { useMemo, useState } from "react";
import { View, Text, Linking } from "react-native";
import {
  Card,
  CardHeader,
  Badge,
  SearchInput,
  EmptyState,
  Row,
  Stack,
  ModalBodyScrollOwnerContext,
} from "./host-ui.js";
import { useRpcQuery } from "paseo-plugin-helper/core";
import { useFleetTheme } from "./theme.js";
import {
  forgeActionRunsContract,
  type ForgeActionRun,
  type ForgeActionRunsInput,
} from "../shared/contracts.js";
import { canonicalRepoName } from "../shared/repo-identity.js";

// ------------------------------------------------------------------ helpers ---

/**
 * Format a duration in ms to a human-readable string.
 */
function formatDurationMs(ms: number): string {
  if (ms <= 0) return "";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Compute elapsed duration for a run. Returns null if timing data is incomplete.
 */
function getElapsed(run: ForgeActionRun): number | null {
  const started = run.run_started_at ? new Date(run.run_started_at).getTime() : null;
  const ended = run.completed_at ? new Date(run.completed_at).getTime() : null;
  const now = new Date().getTime();

  if (!started) return null;

  const end = ended ?? now;
  return end - started;
}

/**
 * Short SHA (7 chars) for display.
 */
function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * Status badge configuration.
 */
const STATUS_CONFIG: Record<string, { label: string; variant: "success" | "danger" | "warning" | "neutral" }> = {
  completed: { label: "Completed", variant: "neutral" },
  in_progress: { label: "Running", variant: "warning" },
  queued: { label: "Queued", variant: "neutral" },
  pending: { label: "Pending", variant: "neutral" },
  waiting: { label: "Waiting", variant: "neutral" },
};

const CONCLUSION_CONFIG: Record<string, { label: string; variant: "success" | "danger" | "warning" | "neutral" }> = {
  success: { label: "Success", variant: "success" },
  failure: { label: "Failed", variant: "danger" },
  cancelled: { label: "Cancelled", variant: "warning" },
  skipped: { label: "Skipped", variant: "neutral" },
  timed_out: { label: "Timed out", variant: "danger" },
  requested: { label: "Requested", variant: "neutral" },
  in_progress: { label: "In progress", variant: "warning" },
  neutral: { label: "Neutral", variant: "neutral" },
};

const EVENT_CONFIG: Record<string, { label: string }> = {
  push: { label: "Push" },
  issue: { label: "Issue" },
  issues: { label: "Issues" },
  pull_request: { label: "PR" },
  pull_request_review: { label: "Review" },
  pull_request_review_comment: { label: "Review Comment" },
  commit_comment: { label: "Commit" },
  workflow_dispatch: { label: "Dispatch" },
  schedule: { label: "Schedule" },
  release: { label: "Release" },
  fork: { label: "Fork" },
  wiki: { label: "Wiki" },
  gollum: { label: "Gollum" },
  check_run: { label: "Check Run" },
  check_suite: { label: "Check Suite" },
  delete: { label: "Delete" },
  create: { label: "Create" },
  merge_group: { label: "Merge Group" },
};

const QUICK_FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "failed", label: "Failed" },
  { id: "succeeded", label: "Succeeded" },
];

// ---------------------------------------------------------------- component ---

export function ActionsTabView({
  workspaceId,
  selectedRepo,
  onSelectRepo,
  enrolledRepos,
}: {
  workspaceId: string;
  selectedRepo: string;
  onSelectRepo: (repo: string) => void;
  enrolledRepos: readonly string[];
}) {
  const { colors, typography } = useFleetTheme();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Resolve the repo parameter for the RPC call.
  const rpcRepo = useMemo(() => {
    if (selectedRepo === "all") return undefined;
    return selectedRepo;
  }, [selectedRepo]);

  // Build input for the RPC query.
  const rpcInput: ForgeActionRunsInput = useMemo(
    () => ({
      repo: rpcRepo,
      status: statusFilter as "all" | "running" | "failed" | "succeeded",
      limit: 50,
    }),
    [rpcRepo, statusFilter],
  );

  // Fetch action runs via RPC.
  const { data: rpcData, isLoading } = useRpcQuery(forgeActionRunsContract, rpcInput, {
    refetchInterval: 30_000, // live telemetry: refresh every 30s
    enabled: true,
  });

  const runs = rpcData?.runs ?? [];

  // Client-side search filtering across all searchable fields.
  const filteredRuns = useMemo(() => {
    if (!searchQuery.trim()) return runs;
    const q = searchQuery.trim().toLowerCase();
    return runs.filter((run: ForgeActionRun) => {
      const haystack = [
        run.name,
        run.workflow_id,
        run.head_commit.message,
        run.ref,
        run.branch ?? "",
        run.head_commit.sha,
        run.user.login,
        run.event,
        run.repo,
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [runs, searchQuery]);

  // Render a single run card.
  function renderRunCard(run: ForgeActionRun) {
    const statusCfg = STATUS_CONFIG[run.status] ?? { label: run.status, variant: "neutral" as const };
    const conclusionCfg = run.conclusion ? CONCLUSION_CONFIG[run.conclusion] ?? { label: run.conclusion, variant: "neutral" as const } : null;
    const eventCfg = EVENT_CONFIG[run.event] ?? { label: run.event };
    const elapsed = getElapsed(run);

    return (
      <Card
        key={run.id}
        variant="flat"
        style={{
          marginBottom: 4,
          borderColor: colors.border,
        }}
      >
        {/* Header row: repo pill + status/conclusion badges + external link */}
        <Row justify="space-between" align="center" wrap gap="xs">
          <Stack gap="xxs" style={{ flex: 1 }}>
            <Row align="center" gap="xs" wrap>
              {/* Repo pill (only meaningful in "all" mode) */}
              {!rpcRepo && run.repo && (
                <Badge
                  label={canonicalRepoName(run.repo) ?? run.repo}
                  variant="info"
                  size="sm"
                />
              )}
              {/* Workflow name */}
              <Text
                style={{
                  color: colors.foreground,
                  ...typography.body,
                  fontWeight: 600,
                  flexShrink: 1,
                }}
                numberOfLines={1}
              >
                {run.name}
              </Text>
            </Row>
            {/* Head commit message */}
            {run.head_commit.message && (
              <Text
                style={{
                  color: colors.foregroundMuted,
                  ...typography.caption,
                  fontSize: 12,
                }}
                numberOfLines={2}
              >
                {run.head_commit.message}
              </Text>
            )}
          </Stack>
        </Row>

        {/* Second row: status, conclusion, branch, SHA, user, event, timing */}
        <Row align="center" gap="xs" wrap style={{ marginTop: 4 }}>
          {/* Status badge */}
          <Badge label={statusCfg.label} variant={statusCfg.variant} size="sm" />

          {/* Conclusion badge (for completed runs) */}
          {conclusionCfg && (
            <Badge label={conclusionCfg.label} variant={conclusionCfg.variant} size="sm" />
          )}

          {/* Branch badge */}
          {run.branch && (
            <Badge label={`🌿 ${run.branch}`} variant="neutral" size="sm" />
          )}

          {/* Short SHA */}
          {run.head_commit.sha && (
            <Badge
              label={shortSha(run.head_commit.sha)}
              variant="neutral"
              size="sm"
            />
          )}

          {/* User username */}
          {run.user.login && (
            <Row align="center" gap="xs">
              {run.user.avatar_url && (
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    overflow: "hidden",
                    backgroundColor: colors.surface0,
                  }}
                >
                  <View
                    style={{
                      flex: 1,
                      backgroundColor: colors.accent,
                    }}
                  />
                </View>
              )}
              <Text
                style={{
                  color: colors.foregroundMuted,
                  ...typography.caption,
                  fontSize: 11,
                }}
              >
                {run.user.login}
              </Text>
            </Row>
          )}

          {/* Event type pill */}
          <Badge label={eventCfg.label} variant="neutral" size="sm" />

          {/* Timing / elapsed duration */}
          {elapsed !== null && (
            <Text
              style={{
                color: colors.foregroundMuted,
                ...typography.caption,
                fontSize: 11,
              }}
            >
              ⏱ {formatDurationMs(elapsed)}
            </Text>
          )}
        </Row>
      </Card>
    );
  }

  return (
    <ModalBodyScrollOwnerContext.Provider value="host">
      <Stack gap={6}>
        {/* Search bar + quick-filter chips */}
        <Stack gap={4}>
          <SearchInput
            placeholder="Search workflows, commits, branches, users…"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onClear={() => setSearchQuery("")}
          />
          <Row align="center" gap="xs" wrap>
            {QUICK_FILTERS.map((filter) => (
              <Badge
                key={filter.id}
                label={filter.label}
                variant={statusFilter === filter.id ? "info" : "neutral"}
                size="sm"
              />
            ))}
          </Row>
        </Stack>

        {/* Results count */}
        <Text
          style={{
            color: colors.foregroundMuted,
            ...typography.caption,
            fontSize: 12,
          }}
        >
          {filteredRuns.length} run{filteredRuns.length !== 1 ? "s" : ""}
          {isLoading && " (loading…)"}
        </Text>

        {/* Action runs list */}
        {filteredRuns.length === 0 && !isLoading ? (
          <EmptyState
            icon="PlayCircleOff"
            title="No action runs found"
            description={
              searchQuery
                ? "Try adjusting your search query or filters."
                : "No CI/CD workflows have been triggered yet."
            }
          />
        ) : (
          <Stack gap={2}>{filteredRuns.map(renderRunCard)}</Stack>
        )}
      </Stack>
    </ModalBodyScrollOwnerContext.Provider>
  );
}
