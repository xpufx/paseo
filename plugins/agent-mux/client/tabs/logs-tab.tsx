import React from "react";
import { View, Text } from "react-native";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Row,
  SectionHeader,
  Stack,
  useHostTheme,
} from "../host-ui.js";
import type { LogEntry, LogsPayload } from "../../shared/types.js";

export interface LogsTabProps {
  logsData: LogsPayload | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
  tailDepth: number;
  onChangeTailDepth: (depth: number) => void;
  filterType: string;
  onChangeFilterType: (filter: string) => void;
}

const FILTER_OPTIONS = ["ALL", "SUPERVISOR", "ROUTER", "ERROR"];
const TAIL_OPTIONS = [25, 50, 100];

export function LogsTab({
  logsData,
  isLoading,
  onRefresh,
  tailDepth,
  onChangeTailDepth,
  filterType,
  onChangeFilterType,
}: LogsTabProps) {
  const { colors } = useHostTheme();

  const entries: LogEntry[] = logsData?.entries ?? [];

  return (
    <Stack gap={12}>
      <SectionHeader title="Routing & Failover Logs" />

      {/* Filter and Depth Controls */}
      <Card variant="elevated">
        <View style={{ padding: 12 }}>
          <Row align="center" justify="space-between" wrap gap={10}>
            {/* Filter buttons */}
            <Row align="center" gap={6}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 13, marginRight: 4 }}>
                Filter:
              </Text>
              {FILTER_OPTIONS.map((opt) => (
                <Button
                  key={opt}
                  label={opt}
                  size="sm"
                  variant={filterType === opt ? "primary" : "ghost"}
                  onPress={() => onChangeFilterType(opt)}
                />
              ))}
            </Row>

            {/* Depth buttons */}
            <Row align="center" gap={6}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 13, marginRight: 4 }}>
                Tail:
              </Text>
              {TAIL_OPTIONS.map((count) => (
                <Button
                  key={count}
                  label={String(count)}
                  size="sm"
                  variant={tailDepth === count ? "secondary" : "ghost"}
                  onPress={() => onChangeTailDepth(count)}
                />
              ))}
              <Button label="Refresh" size="sm" variant="ghost" onPress={onRefresh} />
            </Row>
          </Row>
        </View>
      </Card>

      {/* Log Entries */}
      {entries.length === 0 ? (
        <Card variant="elevated">
          <View style={{ padding: 24 }}>
            <EmptyState
              title={isLoading ? "Loading logs..." : "No Log Entries Found"}
              description="No routing or failover events matching current filter."
            />
          </View>
        </Card>
      ) : (
        <Card variant="elevated">
          <View style={{ padding: 8 }}>
            <Stack gap={6}>
              {entries.map((entry, idx) => {
                const level = entry.level ?? "INFO";
                const badgeVariant =
                  level === "ERROR"
                    ? "danger"
                    : level === "SUPERVISOR"
                      ? "info"
                      : level === "ROUTER"
                        ? "warning"
                        : "neutral";

                return (
                  <View
                    key={idx}
                    style={{
                      padding: 8,
                      borderRadius: 4,
                      backgroundColor: colors.surface1,
                      borderLeftWidth: 3,
                      borderLeftColor:
                        badgeVariant === "danger"
                          ? colors.statusDanger
                          : badgeVariant === "info"
                            ? colors.accent
                            : badgeVariant === "warning"
                              ? colors.statusWarning
                              : colors.border,
                    }}
                  >
                    <Row align="center" justify="space-between" style={{ marginBottom: 4 }}>
                      <Badge label={level} variant={badgeVariant} size="sm" />
                      {entry.timestamp ? (
                        <Text style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily: "monospace" }}>
                          {entry.timestamp}
                        </Text>
                      ) : null}
                    </Row>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontSize: 12,
                        fontFamily: "monospace",
                        lineHeight: 16,
                      }}
                    >
                      {entry.message}
                    </Text>
                  </View>
                );
              })}
            </Stack>
          </View>
        </Card>
      )}
    </Stack>
  );
}
