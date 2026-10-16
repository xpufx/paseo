import React from "react";
import { View, Text } from "react-native";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Grid,
  KeyValue,
  KeyValueGroup,
  Row,
  SectionHeader,
  Stack,
  StatusDot,
  useHostTheme,
} from "../host-ui.js";
import type { ProbePayload, SystemStatus } from "../../shared/types.js";

export interface DashboardTabProps {
  status: SystemStatus | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  onProbeProvider: (providerId: string) => void;
  onNavigateTab: (tabId: string) => void;
  probingProviderId?: string | null;
  probeResults?: Record<string, ProbePayload>;
}

export function DashboardTab({
  status,
  isLoading,
  onRefresh,
  onProbeProvider,
  onNavigateTab,
  probingProviderId,
  probeResults,
}: DashboardTabProps) {
  const { colors } = useHostTheme();

  if (!status && isLoading) {
    return <EmptyState title="Loading status..." description="Querying agent-mux CLI for provider and quota health" />;
  }

  if (!status) {
    return (
      <EmptyState
        title="No Status Available"
        description="Could not retrieve agent-mux status. Ensure agent-mux is installed."
        actionLabel="Retry"
        onAction={onRefresh}
      />
    );
  }

  const totalProfiles = status.providers.reduce((acc, p) => acc + p.profiles.length, 0);
  const healthVariant =
    status.quotaHealth === "green"
      ? "success"
      : status.quotaHealth === "yellow"
        ? "warning"
        : "danger";

  const healthLabel =
    status.quotaHealth === "green"
      ? "Healthy"
      : status.quotaHealth === "yellow"
        ? "Partial Cooldown"
        : "All Exhausted";

  return (
    <Stack gap={12}>
      {/* Overview Grid */}
      <Grid columns={2} gap={8}>
        <Card variant="elevated">
          <Card.Header
            title="Quota Health"
            subtitle={`${status.activeCooldownsCount} active cooldown lock(s)`}
          />
          <Row align="center" gap={8} style={{ padding: 12 }}>
            <StatusDot variant={healthVariant} size="lg" />
            <Badge label={healthLabel} variant={healthVariant} />
          </Row>
        </Card>

        <Card variant="elevated">
          <Card.Header
            title="Isolation Mode"
            subtitle={status.bwrapVersion ? `Bubblewrap ${status.bwrapVersion}` : "Host unisolated"}
          />
          <Row align="center" gap={8} style={{ padding: 12 }}>
            <Badge
              label={status.isolationMode.toUpperCase()}
              variant={status.isolationMode === "scoped" ? "info" : "neutral"}
            />
            {status.profileOverride ? (
              <Badge label={`Override: ${status.profileOverride}`} variant="warning" />
            ) : null}
          </Row>
        </Card>

        <Card variant="elevated">
          <Card.Header
            title="Configured Accounts"
            subtitle={`${status.providers.length} provider(s) detected`}
          />
          <Row align="center" justify="space-between" style={{ padding: 12 }}>
            <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "700" }}>
              {totalProfiles} Profiles
            </Text>
            <Button
              label="View Profiles"
              size="sm"
              variant="ghost"
              onPress={() => onNavigateTab("profiles")}
            />
          </Row>
        </Card>

        <Card variant="elevated">
          <Card.Header
            title="Active Cooldowns"
            subtitle="Rate-limit locks with timers"
          />
          <Row align="center" justify="space-between" style={{ padding: 12 }}>
            <Text
              style={{
                color: status.activeCooldownsCount > 0 ? colors.statusWarning : colors.foreground,
                fontSize: 20,
                fontWeight: "700",
              }}
            >
              {status.activeCooldownsCount} Locks
            </Text>
            <Button
              label="View Cooldowns"
              size="sm"
              variant="ghost"
              onPress={() => onNavigateTab("cooldowns")}
            />
          </Row>
        </Card>
      </Grid>

      {/* Providers Section */}
      <SectionHeader title="Providers & Pool Status" />

      {status.providers.map((prov) => {
        const isProbing = probingProviderId === prov.id;
        const probeData = probeResults?.[prov.id];

        return (
          <Card key={prov.id} variant="elevated">
            <Card.Header
              title={prov.name}
              subtitle={`Identifier: ${prov.id}`}
              action={
                <Button
                  label={isProbing ? "Probing..." : "Probe"}
                  size="sm"
                  variant="secondary"
                  disabled={isProbing}
                  onPress={() => onProbeProvider(prov.id)}
                />
              }
            />

            <View style={{ padding: 12 }}>
              {prov.profiles.length === 0 ? (
                <EmptyState
                  title="No Profiles Configured"
                  description={`No account profiles found for ${prov.name}.`}
                />
              ) : (
                <Stack gap={10}>
                  {prov.profiles.map((prof) => (
                    <View
                      key={prof.profile}
                      style={{
                        padding: 10,
                        backgroundColor: colors.surface1,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <Row align="center" justify="space-between" wrap>
                        <Row align="center" gap={8}>
                          <StatusDot
                            variant={prof.authenticated ? "success" : "warning"}
                            size="md"
                          />
                          <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                            {prof.profile}
                          </Text>
                          {prof.accountIdentity ? (
                            <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>
                              ({prof.accountIdentity})
                            </Text>
                          ) : null}
                        </Row>
                        <Badge
                          label={prof.authenticated ? "Authenticated" : "Pending Login"}
                          variant={prof.authenticated ? "success" : "warning"}
                          size="sm"
                        />
                      </Row>

                      {prof.pools.length > 0 ? (
                        <Row align="center" gap={6} wrap style={{ marginTop: 8 }}>
                          {prof.pools.map((pl) => {
                            const isCooldown =
                              pl.state.includes("COOLDOWN") ||
                              pl.state.includes("EXHAUSTED") ||
                              pl.state.includes("429");
                            const isHealthy = pl.state === "HEALTHY" || pl.state === "OK";
                            const poolVariant = isHealthy
                              ? "success"
                              : isCooldown
                                ? "danger"
                                : "warning";

                            const poolText = pl.details
                              ? `${pl.pool}: ${pl.state} (${pl.details})`
                              : `${pl.pool}: ${pl.state}`;

                            return (
                              <Badge
                                key={pl.pool}
                                label={poolText}
                                variant={poolVariant}
                                size="sm"
                              />
                            );
                          })}
                        </Row>
                      ) : null}
                    </View>
                  ))}
                </Stack>
              )}

              {/* Probe Result Details */}
              {probeData && probeData.results.length > 0 ? (
                <View
                  style={{
                    marginTop: 10,
                    padding: 8,
                    borderRadius: 6,
                    backgroundColor: colors.surface0,
                    borderColor: colors.border,
                    borderWidth: 1,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: "600", marginBottom: 6 }}>
                    Live Probe Connectivity:
                  </Text>
                  <KeyValueGroup>
                    {probeData.results.map((r, idx) => (
                      <KeyValue
                        key={`${r.profile}-${r.pool ?? idx}`}
                        label={`${r.profile} ${r.pool ? `(${r.pool})` : ""}`}
                        value={`${r.state} - ${r.details}`}
                      />
                    ))}
                  </KeyValueGroup>
                </View>
              ) : null}
            </View>
          </Card>
        );
      })}
    </Stack>
  );
}
