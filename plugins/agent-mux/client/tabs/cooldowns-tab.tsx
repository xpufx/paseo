import React, { useEffect, useState } from "react";
import { View, Text } from "react-native";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  KeyValue,
  KeyValueGroup,
  Row,
  SectionHeader,
  Stack,
  StatusDot,
  useHostTheme,
} from "../host-ui.js";
import type { CooldownItem, CooldownsPayload } from "../../shared/types.js";

export interface CooldownsTabProps {
  cooldownsData: CooldownsPayload | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  onClearCooldown: (provider?: string, profile?: string, pool?: string) => void;
  isClearing?: boolean;
  showLiveCountdown?: boolean;
}

function formatRemainingTime(resetAtIso: string): string {
  const targetTime = new Date(resetAtIso).getTime();
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((targetTime - now) / 1000));
  if (diffSec === 0) return "Expired (ready)";

  const hours = Math.floor(diffSec / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  return `${hours}h ${mins}m ${secs}s`;
}

export function CooldownsTab({
  cooldownsData,
  isLoading,
  onRefresh,
  onClearCooldown,
  isClearing,
  showLiveCountdown = true,
}: CooldownsTabProps) {
  const { colors } = useHostTheme();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!showLiveCountdown) return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [showLiveCountdown]);

  if (!cooldownsData && isLoading) {
    return <EmptyState title="Loading cooldowns..." description="Reading rate-limit locks from agent-mux" />;
  }

  const items = cooldownsData?.cooldowns ?? [];

  return (
    <Stack gap={12}>
      <Row align="center" justify="space-between">
        <SectionHeader title={`Active Quota Cooldown Locks (${items.length})`} />
        {items.length > 0 ? (
          <Button
            label={isClearing ? "Clearing..." : "Clear All"}
            variant="danger"
            size="sm"
            disabled={isClearing}
            onPress={() => onClearCooldown()}
          />
        ) : null}
      </Row>

      {items.length === 0 ? (
        <Card variant="elevated">
          <View style={{ padding: 24 }}>
            <EmptyState
              title="All Accounts Healthy"
              description="No active cooldown locks. All configured profiles are ready for automatic routing."
              actionLabel="Refresh"
              onAction={onRefresh}
            />
          </View>
        </Card>
      ) : (
        <Stack gap={10}>
          {items.map((item: CooldownItem) => {
            const displayTime = showLiveCountdown
              ? formatRemainingTime(item.resetAt)
              : item.remainingDisplay;

            return (
              <Card key={`${item.provider}:${item.profile}:${item.pool}`} variant="elevated">
                <Card.Header
                  title={`${item.provider}:${item.profile}`}
                  subtitle={`Pool: ${item.pool}`}
                  action={
                    <Button
                      label="Clear Lock"
                      size="sm"
                      variant="secondary"
                      disabled={isClearing}
                      onPress={() => onClearCooldown(item.provider, item.profile, item.pool)}
                    />
                  }
                />
                <View style={{ padding: 12 }}>
                  <Row align="center" justify="space-between" style={{ marginBottom: 10 }}>
                    <Row align="center" gap={8}>
                      <StatusDot variant="danger" size="md" />
                      <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>
                        Remaining Timer:
                      </Text>
                    </Row>
                    <Badge label={displayTime} variant="danger" size="md" />
                  </Row>

                  <KeyValueGroup>
                    <KeyValue label="Reason" value={item.reason} />
                    <KeyValue label="Reset At" value={new Date(item.resetAt).toLocaleString()} />
                  </KeyValueGroup>
                </View>
              </Card>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
