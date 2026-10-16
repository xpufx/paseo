import React from "react";
import { View, Text } from "react-native";
import {
  Badge,
  Card,
  CodeBlock,
  EmptyState,
  KeyValue,
  KeyValueGroup,
  Row,
  SectionHeader,
  Stack,
  StatusDot,
  useHostTheme,
} from "../host-ui.js";
import type { ConfigPayload, WrapperInfo } from "../../shared/types.js";

export interface ConfigTabProps {
  configData: ConfigPayload | null | undefined;
  isLoading: boolean;
  onRefresh: () => void;
}

export function ConfigTab({ configData, isLoading, onRefresh }: ConfigTabProps) {
  const { colors } = useHostTheme();

  if (!configData && isLoading) {
    return <EmptyState title="Loading configuration..." description="Reading agent-mux config and wrappers" />;
  }

  if (!configData) {
    return (
      <EmptyState
        title="No Configuration Found"
        description="Could not load configuration from agent-mux."
        actionLabel="Retry"
        onAction={onRefresh}
      />
    );
  }

  const wrappers: WrapperInfo[] = configData.wrappers ?? [];

  return (
    <Stack gap={12}>
      <SectionHeader title="Global Configuration & Wrappers" />

      {/* Global Settings */}
      <Card variant="elevated">
        <Card.Header title="Routing & Supervisor Policy" subtitle={`File: ${configData.configFile}`} />
        <View style={{ padding: 12 }}>
          <KeyValueGroup>
            <KeyValue
              label="Routing Policy"
              value={
                `${configData.activeRoutingPolicy}${
                  configData.routingPolicyOverridden ? " (env override)" : ""
                }`
              }
            />
            <KeyValue
              label="Surface Account Mode"
              value={
                `${configData.activeSurfaceAccount}${
                  configData.surfaceAccountOverridden ? " (env override)" : ""
                }`
              }
            />
            <KeyValue label="Config Location" value={configData.configFile} />
          </KeyValueGroup>
        </View>
      </Card>

      {/* Wrappers Table */}
      <Card variant="elevated">
        <Card.Header
          title="CLI Binary Wrappers"
          subtitle="Transparent PATH wrappers intercepting CLI invocations"
        />
        <View style={{ padding: 12 }}>
          {wrappers.length === 0 ? (
            <EmptyState
              title="No Wrappers Detected"
              description="No CLI wrappers found on host PATH."
            />
          ) : (
            <Stack gap={8}>
              {wrappers.map((w) => {
                const isWrapped = w.status === "WRAPPED";
                const isUnwrapped = w.status === "UNWRAPPED";
                const badgeVariant = isWrapped ? "success" : isUnwrapped ? "warning" : "danger";

                return (
                  <View
                    key={w.binaryName}
                    style={{
                      padding: 10,
                      backgroundColor: colors.surface1,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Row align="center" justify="space-between">
                      <Row align="center" gap={8}>
                        <StatusDot variant={badgeVariant} size="md" />
                        <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                          {w.binaryName}
                        </Text>
                      </Row>
                      <Badge label={w.status} variant={badgeVariant} size="sm" />
                    </Row>

                    {w.sourcePath ? (
                      <View style={{ marginTop: 6 }}>
                        <Text style={{ color: colors.foregroundMuted, fontSize: 12, fontFamily: "monospace" }}>
                          {w.sourcePath}
                          {w.targetPath ? ` -> ${w.targetPath}` : ""}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Stack>
          )}
        </View>
      </Card>

      {/* Raw Config JSON */}
      <Card variant="elevated">
        <Card.Header title="Raw Config (config.json)" />
        <View style={{ padding: 12 }}>
          <CodeBlock
            code={JSON.stringify(configData.settings, null, 2)}
            language="json"
          />
        </View>
      </Card>
    </Stack>
  );
}
