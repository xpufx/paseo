import React, { useState, useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ComposerPillRegistrar, PluginCleanup } from "./host.js";
import { getClientHost } from "./host.js";
import { usePluginTheme } from "./theme/provider.js";
import { useResponsive } from "./theme/useResponsive.js";
import type { VisualFlair } from "./theme/flair.js";
import type { CustomPillState } from "../shared/custom-pills.js";
import { Badge } from "./components/Badge.js";
import { Button } from "./components/Button.js";
import { Card } from "./components/Card.js";
import { CodeBlock } from "./components/CodeBlock.js";
import { registerComposerPill } from "./pill.js";

export interface CustomPillBodyProps {
  state: CustomPillState;
}

/**
 * Standard pill body renderer for a custom metric pill in the composer trackbar.
 * Automatically adapts to responsive compact/mobile modes and shows threshold status.
 */
export function CustomPillBody({ state }: CustomPillBodyProps) {
  const { Icon } = getClientHost();
  const { colors } = usePluginTheme();
  const { isCompact } = useResponsive();

  const title = isCompact && state.compactTitle ? state.compactTitle : state.title;
  const icon = isCompact && state.compactIcon ? state.compactIcon : state.icon;

  return (
    <View style={styles.pillContainer}>
      {icon && <Icon name={icon} size={13} color={colors.foreground} />}
      {title ? (
        <Text style={[styles.pillTitle, { color: colors.foreground }]}>{title}</Text>
      ) : null}
      <Badge
        label={state.displayValue}
        variant={state.status}
        styleVariant="tinted"
        style={styles.pillBadge}
      />
    </View>
  );
}

export interface CustomPillModalContentProps {
  state: CustomPillState;
  onRefresh?: () => Promise<void> | void;
  isRefreshing?: boolean;
}

/**
 * Full modal inspection content for a custom metric pill.
 * Shows status, preformatted command output, last updated time, and quick actions.
 */
export function CustomPillModalContent({
  state,
  onRefresh,
  isRefreshing = false,
}: CustomPillModalContentProps) {
  const { colors, isCompact } = usePluginTheme();

  const displayText =
    state.modalOutput || state.rawValue || (state.error ? `Error: ${state.error}` : "No output");

  return (
    <View style={styles.modalContent}>
      <Card>
        <Card.Header
          title={state.modalTitle ?? state.title}
          subtitle={state.modalDescription}
          icon={state.icon}
          badge={<Badge label={state.displayValue} variant={state.status} />}
          action={
            onRefresh ? (
              <Button
                variant="secondary"
                size="sm"
                icon="RefreshCw"
                loading={isRefreshing}
                label={!isCompact ? "Refresh" : undefined}
                onPress={() => onRefresh()}
              />
            ) : undefined
          }
        />

        {/* Monospace Code & Output Box with Built-in Copy */}
        <CodeBlock
          code={displayText}
          title={state.modalTitle ?? state.title}
          maxHeight={280}
          copyable={true}
        />

        {/* Footer info */}
        <View style={styles.footerRow}>
          <Text style={[styles.timestampText, { color: colors.foregroundMuted }]}>
            Last updated: {new Date(state.lastUpdated).toLocaleTimeString()}
          </Text>
        </View>
      </Card>
    </View>
  );
}

export interface RegisterCustomPillsOptions {
  /**
   * The list of custom pill states or definitions.
   */
  pills: CustomPillState[];

  /**
   * Callback invoked when a pill needs a fresh refresh or modal command run.
   */
  onRefreshModal?: (pillId: string) => Promise<{ output?: string; error?: string }>;

  /**
   * Optional visual flair overrides.
   */
  flair?: Partial<VisualFlair>;
}

/**
 * Registers one or more declarative custom metric pills into Paseo's composer trackbar.
 * Automatically handles pill lifecycle, responsive layouts, and drill-down inspection modals.
 */
export function registerCustomPills(
  client: ComposerPillRegistrar,
  options: RegisterCustomPillsOptions,
): PluginCleanup {
  const cleanups: PluginCleanup[] = [];

  for (const pill of options.pills) {
    const cleanup = registerComposerPill(client, {
      id: pill.id,
      title: pill.title,
      compactTitle: pill.compactTitle,
      icon: pill.icon,
      compactIcon: pill.compactIcon,
      flair: options.flair,
      resolveLabel: () =>
        pill.displayValue ? `${pill.title} ${pill.displayValue}` : pill.title,
      renderPill: () => <CustomPillBody state={pill} />,
      renderModal: () => {
        const [refreshing, setRefreshing] = useState(false);
        const [currentOutput, setCurrentOutput] = useState<string | undefined>(
          pill.modalOutput,
        );

        const handleRefresh = useCallback(async () => {
          if (!options.onRefreshModal) return;
          setRefreshing(true);
          try {
            const res = await options.onRefreshModal(pill.id);
            if (res.output) {
              setCurrentOutput(res.output);
            }
          } finally {
            setRefreshing(false);
          }
        }, [pill.id]);

        const activeState: CustomPillState = {
          ...pill,
          modalOutput: currentOutput ?? pill.modalOutput,
        };

        return (
          <CustomPillModalContent
            state={activeState}
            onRefresh={options.onRefreshModal ? handleRefresh : undefined}
            isRefreshing={refreshing}
          />
        );
      },
    });

    cleanups.push(cleanup);
  }

  return () => {
    for (const dispose of cleanups) {
      dispose();
    }
  };
}

const styles = StyleSheet.create({
  modalContent: {
    width: "100%",
    padding: 12,
  },
  pillContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillTitle: {
    fontSize: 12,
    fontWeight: "500",
  },
  pillBadge: {
    paddingVertical: 1,
    paddingHorizontal: 5,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 8,
  },
  timestampText: {
    fontSize: 11,
  },
});
