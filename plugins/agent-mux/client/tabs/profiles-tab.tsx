import React from "react";
import { View, Text } from "react-native";
import {
  Badge,
  Card,
  EmptyState,
  FormRow,
  Row,
  SectionHeader,
  Stack,
  StatusDot,
  Toggle,
  useHostTheme,
} from "../host-ui.js";
import type { ProfilesPayload } from "../../shared/types.js";

export interface ProfilesTabProps {
  profilesData: ProfilesPayload | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  onToggleProfile: (provider: string, profile: string, enabled: boolean) => void;
  togglingKey?: string | null;
}

export function ProfilesTab({
  profilesData,
  isLoading,
  onRefresh,
  onToggleProfile,
  togglingKey,
}: ProfilesTabProps) {
  const { colors } = useHostTheme();

  if (!profilesData && isLoading) {
    return <EmptyState title="Loading profiles..." description="Listing configured accounts from agent-mux" />;
  }

  if (!profilesData) {
    return (
      <EmptyState
        title="No Profiles Available"
        description="Could not retrieve profile list from agent-mux."
        actionLabel="Retry"
        onAction={onRefresh}
      />
    );
  }

  return (
    <Stack gap={12}>
      {profilesData.sandboxedWarning ? (
        <View
          style={{
            padding: 10,
            borderRadius: 6,
            backgroundColor: colors.surface1,
            borderColor: colors.statusWarning,
            borderWidth: 1,
          }}
        >
          <Text style={{ color: colors.statusWarning, fontWeight: "600" }}>
            [!] Active Sandboxed Session Detected
          </Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 12, marginTop: 4 }}>
            Listing from a sandboxed session (tmpfs mounted over profile directories); results may be incomplete.
          </Text>
        </View>
      ) : null}

      <SectionHeader title={`Configured Account Profiles (${profilesData.isolationMode})`} />

      {profilesData.providers.map((prov) => (
        <Card key={prov.id} variant="elevated">
          <Card.Header
            title={prov.name}
            subtitle={`${prov.profiles.length} configured account profile(s)`}
          />
          <View style={{ padding: 12 }}>
            {prov.profiles.length === 0 ? (
              <EmptyState
                title="No Profiles Found"
                description={`No profiles configured for ${prov.name}. Use 'agent-mux profile add <name> --provider ${prov.id}' to scaffold.`}
              />
            ) : (
              <Stack gap={10}>
                {prov.profiles.map((prof) => {
                  const key = `${prov.id}:${prof.name}`;
                  const isToggling = togglingKey === key;
                  const isAuthed = prof.status.toLowerCase().includes("authenticated");
                  const isMissing = prof.status.toLowerCase().includes("missing");
                  const statusVariant = isAuthed ? "success" : isMissing ? "danger" : "warning";

                  return (
                    <View
                      key={prof.name}
                      style={{
                        padding: 12,
                        backgroundColor: colors.surface1,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <Row align="center" justify="space-between" wrap gap={8}>
                        <Row align="center" gap={8}>
                          <StatusDot variant={statusVariant} size="md" />
                          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>
                            {prof.name}
                          </Text>
                          {prof.accountIdentity ? (
                            <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>
                              ({prof.accountIdentity})
                            </Text>
                          ) : null}
                          {!prof.registered ? (
                            <Badge label="Unregistered" variant="neutral" size="sm" />
                          ) : null}
                        </Row>

                        <Row align="center" gap={10}>
                          <Badge label={prof.status} variant={statusVariant} size="sm" />
                          <FormRow label="" layout="stacked" style={{ margin: 0, padding: 0 }}>
                            <Toggle
                              value={prof.enabled}
                              disabled={isToggling}
                              onValueChange={(val) => onToggleProfile(prov.id, prof.name, val)}
                            />
                          </FormRow>
                        </Row>
                      </Row>

                      <View style={{ marginTop: 8 }}>
                        <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
                          Directory: {prof.directory}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </Stack>
            )}
          </View>
        </Card>
      ))}
    </Stack>
  );
}
