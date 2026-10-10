import React, { useState, useMemo, useCallback, useContext } from "react";
import { View, Text, Linking } from "react-native";
import { useWorkspace } from "@getpaseo/plugin/client";
import {
  Card,
  CardHeader,
  Badge,
  Button,
  SearchInput,
  Select,
  type SelectOption,
  EmptyState,
  Row,
  Stack,
  ModalBody,
  TicketLifecycleView,
  NewIssueComposer,
  MarkdownLite,
  CommentCard,
  AgentEnvelopeCard,
  ScopedLabelGroup,
  InteractiveRow,
  Icon,
} from "./host-ui.js";
import { useRpcQuery, getClientHost, getOptionalClientHost } from "paseo-plugin-helper/core";
import { useFleetTheme } from "./theme.js";
import { defineContract } from "paseo-plugin-helper/shared";
import { z } from "zod";
import { isRepoMatching } from "../shared/sort-filter.js";
import {
  canonicalRepoName,
  resolveCanonicalRepo,
  type CanonicalRepo,
} from "../shared/repo-identity.js";



export const forgeOpenIssuesContract = defineContract({
  name: "forge.open-issues",
  description: "List open forge issues for the repo backing a workspace directory",
  input: z.object({
    workspaceId: z.string().optional(),
    directory: z.string().optional(),
    remoteUrl: z.string().optional(),
    repo: z.string().optional(),
  }),
  output: z.object({
    repo: z.string().nullable().default(null),
    host: z.string().nullable().default(null),
    remoteUrl: z.string().nullable().default(null),
    repoPublic: z.boolean().default(false),
    tokenPresent: z.boolean().default(false),
    tokenValid: z.boolean().default(false),
    repoWritePermission: z.boolean().default(false),
    issues: z
      .array(
        z.object({
          number: z.number(),
          title: z.string(),
          body: z.string().default(""),
          state: z.string().default("open"),
          author: z.string().default(""),
          labels: z.array(z.string()).default([]),
          comments: z.number().default(0),
          url: z.string().default(""),
          updatedAt: z.string().default(""),
          isPullRequest: z.boolean().default(false),
          repo: z.string().optional(),
        }),
      )
      .default([]),
    totalOpenCount: z.number().default(0),
    error: z.string().optional(),
  }),
});

export const forgeContextContract = defineContract({
  name: "forge.context",
  description: "Workspace git-origin forge coordinates",
  input: z.object({
    directory: z.string().optional(),
  }),
  output: z.object({
    directory: z.string().nullable().default(null),
    derivedRemote: z.string().nullable().default(null),
    derivedHost: z.string().nullable().default(null),
    derivedRepo: z.string().nullable().default(null),
  }),
});

/**
 * HTTPS web URL for a canonical repo identity (#888). Every forge link is built
 * from the one canonical value rather than a hand-parsed remote.
 */
export function canonicalForgeUrl(repo: CanonicalRepo): string {
  return `https://${repo.key}`;
}

/**
 * Resolves a selector value to its canonical identity. Returns null for `all`
 * and for genuinely unresolvable input, so callers can render an explicit
 * invalid state instead of silently scoping to another repository.
 */
export function resolveForgeSelection(
  value: string | undefined | null,
  knownRepos: readonly string[] = [],
): CanonicalRepo | null {
  return resolveCanonicalRepo(value, { knownRepos });
}

// In Hermes / React Native bundles, if React.Component is missing or Babel loose
// inheritance is applied on an undefined superclass, `class ... extends React.Component`
// throws `TypeError: Cannot read properties of undefined (reading 'prototype')`.
// Provide a safe fallback boundary that verifies React?.Component before extending it.
const SafeWorkspaceBoundary: React.ComponentType<{ children: React.ReactNode }> =
  typeof (React as any)?.Component === "function"
    ? class SafeWorkspaceBoundaryInner extends React.Component<
        { children: React.ReactNode },
        { hasError: boolean }
      > {
        state = { hasError: false };
        static getDerivedStateFromError() {
          return { hasError: true };
        }
        componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
          console.error(
            `[uppidi-fleet] SafeWorkspaceBoundary caught an error (componentStack: ${errorInfo?.componentStack ?? "n/a"}): ${error?.message ?? String(error)}`,
          );
        }
        render() {
          if (this.state.hasError) return null;
          return this.props.children;
        }
      }
    : function FallbackWorkspaceBoundary({ children }: { children: React.ReactNode }) {
        return <>{children}</>;
      };

function WorkspaceDirectoryWatcher({
  workspaceId,
  onResolve,
}: {
  workspaceId: string;
  onResolve: (dir: string | undefined) => void;
}) {
  const dir = useWorkspace(
    workspaceId,
    (w: any) => w?.directory ?? w?.workspaceDirectory,
  ) as string | undefined;

  React.useEffect(() => {
    onResolve(dir);
  }, [dir, onResolve]);

  return null;
}

export interface ForgeIssuesViewProps {
  workspaceId?: string;
  agentId?: string;
  onClose?: () => void;
  directory?: string;
  enrolledRepos?: readonly string[] | string[];
  activeRepo?: string;
  selectedRepo?: string;
  onSelectRepo?: (repo: string) => void;
}

function ForgeIssuesViewInner({
  workspaceId = "",
  agentId: _agentId,
  onClose: _onClose,
  directory: propDirectory,
  enrolledRepos,
  activeRepo,
  selectedRepo: controlledSelectedRepo,
  onSelectRepo,
}: ForgeIssuesViewProps) {
  const { colors } = useFleetTheme();
  const [searchQuery, setSearchQuery] = useState("");

  const [watchedDirectory, setWatchedDirectory] = useState<string | undefined>();
  const directory = propDirectory ?? watchedDirectory;

  const contextQuery = useRpcQuery(forgeContextContract, {
    directory: directory ?? undefined,
  });

  const derivedActiveRepo =
    activeRepo ??
    contextQuery.data?.derivedRepo ??
    (directory ? directory.split("/").pop() : undefined);

  const [internalRepo, setInternalRepo] = useState<string>(() => {
    if (controlledSelectedRepo !== undefined) return controlledSelectedRepo;
    return derivedActiveRepo ?? "all";
  });

  const rawRepos = useMemo(() => {
    const set = new Set<string>();
    if (enrolledRepos) {
      for (const r of enrolledRepos) if (r) set.add(r);
    }
    if (activeRepo) set.add(activeRepo);
    if (contextQuery.data?.derivedRepo) set.add(contextQuery.data.derivedRepo);
    if (derivedActiveRepo) set.add(derivedActiveRepo);
    return Array.from(set);
  }, [enrolledRepos, activeRepo, contextQuery.data?.derivedRepo, derivedActiveRepo]);

  // One canonical identity per repository; any input that cannot be resolved is
  // dropped from the selector rather than shown as a second spelling (#888).
  const reposList = useMemo(() => {
    const set = new Set<string>();
    for (const r of rawRepos) {
      const canonical = canonicalRepoName(r, { knownRepos: rawRepos });
      if (canonical) set.add(canonical);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rawRepos]);

  const selectedValue =
    controlledSelectedRepo !== undefined ? controlledSelectedRepo : internalRepo;
  const selectedResolved =
    selectedValue === "all" ? null : resolveForgeSelection(selectedValue, rawRepos);
  const currentRepo =
    selectedValue === "all" ? "all" : selectedResolved?.key ?? selectedValue;

  const handleSelectRepo = useCallback(
    (repo: string) => {
      setInternalRepo(repo);
      onSelectRepo?.(repo);
    },
    [onSelectRepo],
  );

  const repoOptions = useMemo<SelectOption[]>(() => [
    { label: "All Enrolled Repositories", value: "all" },
    ...reposList.map((r) => ({
      label: r,
      value: r,
      display: resolveForgeSelection(r, rawRepos)?.compact ?? r,
    })),
  ], [reposList, rawRepos]);

  const issuesQuery = useRpcQuery(forgeOpenIssuesContract, {
    workspaceId: workspaceId || undefined,
    directory: directory ?? undefined,
    remoteUrl: selectedResolved ? canonicalForgeUrl(selectedResolved) : undefined,
    repo: selectedResolved?.compact,
  });

  const handleRefresh = useCallback(() => {
    void issuesQuery.refetch?.();
    void contextQuery.refetch?.();
  }, [issuesQuery, contextQuery]);

  const rawIssues = useMemo(() => {
    const list = issuesQuery.data?.issues ?? [];
    if (currentRepo === "all") return list;
    return list.filter(
      (i: any) =>
        !i.repo ||
        isRepoMatching(i.repo, currentRepo) ||
        String(i.repo).toLowerCase() === currentRepo.toLowerCase(),
    );
  }, [issuesQuery.data?.issues, currentRepo]);

  const filteredIssues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rawIssues;
    const digits = q.startsWith("#") ? q.slice(1) : q;
    return rawIssues.filter((issue) => {
      if (/^\d+$/.test(digits) && String(issue.number).startsWith(digits)) {
        return true;
      }
      return (
        issue.title.toLowerCase().includes(q) ||
        issue.labels.some((l) => l.toLowerCase().includes(q)) ||
        issue.author.toLowerCase().includes(q)
      );
    });
  }, [rawIssues, searchQuery]);

  const repoName =
    currentRepo !== "all"
      ? currentRepo
      : issuesQuery.data?.repo
      ? canonicalRepoName(issuesQuery.data.repo, { knownRepos: rawRepos }) ??
        issuesQuery.data.repo
      : contextQuery.data?.derivedRepo
      ? canonicalRepoName(contextQuery.data.derivedRepo, { knownRepos: rawRepos }) ??
        contextQuery.data.derivedRepo
      : "All Enrolled Repositories";

  const hostName =
    issuesQuery.data?.host || contextQuery.data?.derivedHost || null;

  const handleOpenUrl = (url: string) => {
    if (url) {
      void Linking.openURL(url);
    }
  };

  return (
    <ModalBody>
      {workspaceId && !propDirectory ? (
        <SafeWorkspaceBoundary>
          <WorkspaceDirectoryWatcher
            workspaceId={workspaceId}
            onResolve={setWatchedDirectory}
          />
        </SafeWorkspaceBoundary>
      ) : null}
      <Stack gap={4}>
        <Card variant="flat">
          <CardHeader
            title="Forge Issues"
            subtitle={
              currentRepo === "all"
                ? hostName
                  ? `All Enrolled Repositories on ${hostName}`
                  : "All Enrolled Repositories"
                : hostName
                ? `${repoName} on ${hostName}`
                : repoName
            }
            icon="GitPullRequest"
            action={
              <Row gap="sm" align="center">
                {issuesQuery.isFetching ? (
                  <Badge label="Syncing..." variant="accent" styleVariant="tinted" />
                ) : (
                  <Badge
                    label={`${filteredIssues.length} open`}
                    variant="neutral"
                    styleVariant="tinted"
                  />
                )}
                <Button
                  label="Refresh"
                  size="sm"
                  icon="RefreshCw"
                  variant="ghost"
                  onPress={handleRefresh}
                />
              </Row>
            }
          />
          <View style={styles.controlsContainer}>
            <Row gap="md" align="center" style={styles.controlsRow}>
              <View style={styles.selectWrapper}>
                <Select
                  label="Repository"
                  size="sm"
                  options={repoOptions}
                  value={currentRepo}
                  onValueChange={handleSelectRepo}
                />
              </View>
              <View style={styles.searchWrapper}>
                <SearchInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Filter by issue #, title, label, or author..."
                />
              </View>
            </Row>
          </View>
        </Card>

        {currentRepo !== "all" && !selectedResolved ? (
          <Card variant="tinted" style={{ borderColor: colors.statusWarning, borderWidth: 1 }}>
            <EmptyState
              icon="AlertCircle"
              title="Unknown repository"
              description={`"${selectedValue}" could not be resolved to a known repository. Pick an enrolled repository instead.`}
            />
          </Card>
        ) : issuesQuery.isLoading ? (
          <Card variant="flat">
            <EmptyState
              icon="RefreshCw"
              title="Loading forge issues..."
              description="Querying forge status for the active workspace."
            />
          </Card>
        ) : issuesQuery.isError || issuesQuery.data?.error ? (
          <Card variant="tinted" style={{ borderColor: colors.statusWarning, borderWidth: 1 }}>
            <EmptyState
              icon="AlertCircle"
              title="Forge issues unavailable"
              description={
                issuesQuery.data?.error ||
                issuesQuery.error?.message ||
                "Could not connect to forge plugin or daemon RPC. Verify that the forges plugin is running."
              }
            />
          </Card>
        ) : filteredIssues.length === 0 ? (
          <Card variant="flat">
            <EmptyState
              icon="CheckCircle2"
              title={searchQuery ? "No matching issues" : "No open issues"}
              description={
                searchQuery
                  ? `No open issues match "${searchQuery}".`
                  : currentRepo === "all"
                  ? "No open issues found across enrolled repositories."
                  : `No open issues found for ${currentRepo}.`
              }
            />
          </Card>
        ) : (
          <Stack gap={3}>
            {filteredIssues.map((issue) => (
              <Card key={issue.number} variant="flat">
                <Row gap="md" align="flex-start" justify="space-between">
                  <Stack gap={1} style={styles.issueMain}>
                    <Row gap="sm" align="center">
                      <Text style={[styles.issueNumber, { color: colors.foregroundMuted }]}>
                        #{issue.number}
                      </Text>
                      <Text style={[styles.issueTitle, { color: colors.foreground }]}>
                        {issue.title}
                      </Text>
                      {issue.isPullRequest && (
                        <Badge label="PR" variant="accent" styleVariant="tinted" />
                      )}
                    </Row>
                    <Row gap="sm" align="center" style={styles.metaRow}>
                      {issue.author ? (
                        <Text style={[styles.metaText, { color: colors.foregroundMuted }]}>
                          opened by {issue.author}
                        </Text>
                      ) : null}
                      {issue.comments > 0 && (
                        <Row gap="xs" align="center">
                          <Icon name="MessageSquare" size={12} color={colors.foregroundMuted} />
                          <Text style={[styles.metaText, { color: colors.foregroundMuted }]}>
                            {issue.comments}
                          </Text>
                        </Row>
                      )}
                    </Row>
                    {issue.labels.length > 0 && (
                      <Row gap="xs" align="center" wrap style={styles.labelRow}>
                        {issue.labels.map((label) => (
                          <Badge
                            key={label}
                            label={label}
                            variant={
                              label.startsWith("attention/")
                                ? "warning"
                                : label.startsWith("state/")
                                ? "accent"
                                : "neutral"
                            }
                            styleVariant="tinted"
                          />
                        ))}
                      </Row>
                    )}
                  </Stack>
                  {issue.url ? (
                    <InteractiveRow
                      onPress={() => handleOpenUrl(issue.url)}
                      style={[styles.openButton, { borderColor: colors.border }]}
                    >
                      <Icon name="ExternalLink" size={14} color={colors.accent} />
                    </InteractiveRow>
                  ) : null}
                </Row>
              </Card>
            ))}
          </Stack>
        )}
      </Stack>
    </ModalBody>
  );
}

export function ForgeIssuesView(props: ForgeIssuesViewProps) {
  return <ForgeIssuesViewInner {...props} />;
}

export const ForgesTabView = ForgeIssuesView;

const styles = {
  controlsContainer: {
    marginTop: 8,
  },
  controlsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  selectWrapper: {
    minWidth: 200,
    flexShrink: 0,
  },
  searchWrapper: {
    flex: 1,
    minWidth: 220,
  },
  searchContainer: {
    marginTop: 8,
  },
  issueMain: {
    flex: 1,
  },
  issueNumber: {
    fontSize: 14,
    fontWeight: "600",
  },
  issueTitle: {
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  metaRow: {
    marginTop: 2,
  },
  metaText: {
    fontSize: 12,
  },
  labelRow: {
    marginTop: 6,
  },
  openButton: {
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
} as const;

export {
  TicketLifecycleView,
  NewIssueComposer,
  MarkdownLite,
  CommentCard,
  AgentEnvelopeCard,
  ScopedLabelGroup,
};
