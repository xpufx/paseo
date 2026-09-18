import { useRpc } from "@getpaseo/plugin/client";
import type {
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import {
  AttentionBeacon,
  Badge,
  Button,
  Card,
  CodeBlock,
  Collapsible,
  CommandBox,
  EmptyState,
  KeyValue,
  KeyValueGroup,
  ModalBody,
  PluginThemeProvider,
  StatusDot,
  Tabs,
  TextInput,
  copyToClipboard,
  usePluginSettings,
  usePluginTheme,
} from "paseo-plugin-helper/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Easing, Text, View } from "react-native";
import { ErrorBoundary } from "./error-boundary";
import {
  approvalAck,
  approvalSettings,
  approvalStatus,
  approvalTelegramInfo,
  daemonHealth,
  pendingList,
  policyAddRule,
  recentList,
  verdict,
} from "../shared/approval";

const LIST_KEY = ["twofado", "pending"];
const RECENT_KEY = ["twofado", "recent"];
const POLL_MS = 3000;
const RECENT_POLL_MS = 5000;
// The plugin SDK only takes a label string (the host owns the Text), so the
// header marquee must step the store instead of animating client-side.
const HEADER_MARQUEE_MS = 1000;
const RECENT_LIMIT = 10;
const OUTPUT_PREVIEW = 2000;
const EXPIRY_URGENT_S = 30;

// Keep the approvals surface a readable centered column instead of stretching
// edge-to-edge on large viewports. The cap lives in the helper
// (`ModalBody maxContentWidth`); this is the only place the surface picks
// the value.
const TWOFADO_CONTENT_MAX_WIDTH = 600;

const seenIds = new Set<string>();
const SEEN_IDS_CAP = 500;

function useNewPendingToast(
  items: Array<{ id: string; step?: "initial" | "confirm" }> | undefined,
) {
  const toast = useToast();
  useEffect(() => {
    const fresh = (items ?? []).filter((item) => !seenIds.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) seenIds.add(item.id);
    while (seenIds.size > SEEN_IDS_CAP) {
      const oldest = seenIds.values().next();
      if (oldest.done) break;
      seenIds.delete(oldest.value);
    }
    const hasConfirm = fresh.some((item) => item.step === "confirm");
    if (hasConfirm) {
      toast.show("⚠️ Are you sure? 2fado confirmation required", { variant: "warning", durationMs: 15_000 });
    } else {
      toast.show(
        fresh.length === 1 ? "2fado approval needed" : `${fresh.length} 2fado approvals needed`,
        { variant: "warning", durationMs: 10_000 },
      );
    }
  }, [items, toast]);
}
const headerRegistry = new Map<string, PluginButtonRegistration>();

export function trackHeaderButton(workspaceId: string, registration: PluginButtonRegistration) {
  headerRegistry.get(workspaceId)?.remove();
  headerRegistry.set(workspaceId, registration);
}

export function untrackHeaderButton(workspaceId: string) {
  headerRegistry.get(workspaceId)?.remove();
  headerRegistry.delete(workspaceId);
}

export function useSocketPath(): string | undefined {
  const { settings } = usePluginSettings(approvalSettings);
  const trimmed = settings.socketPath.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function usePendingList() {
  const list = useRpc(pendingList);
  const socketPath = useSocketPath();
  return useQuery({
    queryKey: [...LIST_KEY, socketPath ?? ""],
    queryFn: () => list({ socketPath }),
    refetchInterval: POLL_MS,
    retry: false,
  });
}

export function useRecentList() {
  const recent = useRpc(recentList);
  const socketPath = useSocketPath();
  return useQuery({
    queryKey: [...RECENT_KEY, socketPath ?? ""],
    queryFn: () => recent({ socketPath, limit: RECENT_LIMIT }),
    refetchInterval: RECENT_POLL_MS,
    retry: false,
  });
}

const TELEGRAM_KEY = ["twofado", "telegram"];
const HEALTH_KEY = ["twofado", "health"];

export function useTelegramInfo() {
  const getTelegram = useRpc(approvalTelegramInfo);
  const socketPath = useSocketPath();
  return useQuery({
    queryKey: [...TELEGRAM_KEY, socketPath ?? ""],
    queryFn: () => getTelegram({ socketPath }),
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useDaemonHealth() {
  const probe = useRpc(daemonHealth);
  const socketPath = useSocketPath();
  return useQuery({
    queryKey: [...HEALTH_KEY, socketPath ?? ""],
    queryFn: async () => {
      try {
        return await probe({ socketPath });
      } catch {
        return { reachable: false as const };
      }
    },
    refetchInterval: POLL_MS,
    retry: false,
  });
}

function ApprovalHeaderIconInner(props: PluginButtonIconProps) {
  const { theme } = props;
  const workspaceId = props.workspaceId;
  const size = props.size;
  const color = props.color;
  const { data } = usePendingList();
  const health = useDaemonHealth();
  const down = health.data ? !health.data.reachable : health.isError;
  const count = data?.items.length ?? 0;
  const hasConfirm = data?.items.some((item) => item.step === "confirm") ?? false;

  useNewPendingToast(data?.items);

  const prevCountRef = useRef<number | null>(null);
  const prevDownRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (prevCountRef.current === count && prevDownRef.current === down) return;
    prevCountRef.current = count;
    prevDownRef.current = down;
    // Defer the button store update out of the render/commit phase
    let interval: ReturnType<typeof setInterval> | undefined;
    const timer = setTimeout(() => {
      const reg = headerRegistry.get(workspaceId);
      if (!reg) return;
      // Dedupe consecutive identical publishes, but always publish the first
      // label of an effect run. Clearing the badge calls `show(undefined)`;
      // with `last` starting `undefined`, a plain equality guard would treat
      // that clear as a no-op and leave the stale `Pending (N)` label pinned
      // after the queue drains (xpufx-org/paseo#238).
      let last: string | undefined;
      let published = false;
      const show = (label: string | undefined) => {
        if (published && label === last) return;
        published = true;
        last = label;
        try {
          reg.update({ label });
        } catch (err) {
          console.warn("[2fado] Failed to update header button label:", err);
        }
      };
      if (down) {
        show("2fadod down");
        return;
      }
      if (count === 0) {
        show(undefined);
        return;
      }
      const unit = `Pending (${count})  •  2fado  •  `;
      const track = unit.repeat(3);
      const width = unit.length;
      let offset = 0;
      show(unit);
      interval = setInterval(() => {
        offset = (offset + 1) % unit.length;
        show(track.slice(offset, offset + width));
      }, HEADER_MARQUEE_MS);
    }, 0);
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [workspaceId, count, down]);

  const activeColor = down
    ? theme.colors.statusDanger || "#ef4444"
    : count > 0
    ? hasConfirm
      ? theme.colors.statusDanger || "#ef4444"
      : theme.colors.statusWarning || "#f59e0b"
    : color;

  return (
    <PluginThemeProvider theme={{ colors: theme.colors }}>
      <AttentionBeacon
        mode="pulse"
        tone={down || hasConfirm ? "danger" : "warning"}
        active={!down && count > 0}
        easing={Easing.inOut(Easing.ease)}
        accessibilityLabel={count > 0 ? `${count} pending approvals` : "No pending approvals"}
      >
        <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
          <Icon
            name="ShieldCheck"
            size={size}
            color={activeColor}
          />
        </View>
      </AttentionBeacon>
    </PluginThemeProvider>
  );
}

export function ApprovalHeaderIcon(props: PluginButtonIconProps) {
  const { size, color } = props;
  return (
    <ErrorBoundary
      label="ApprovalHeaderIcon"
      fallback={<Icon name="ShieldCheck" size={size} color={color} />}
    >
      <ApprovalHeaderIconInner {...props} />
    </ErrorBoundary>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  const { colors } = usePluginTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, marginBottom: 2 }}>
      <Text
        style={{
          color: colors.foregroundMuted,
          fontSize: 11,
          fontWeight: "700",
          textTransform: "uppercase",
          letterSpacing: 0.8,
        }}
      >
        {title}
      </Text>
      {count !== undefined ? (
        <Badge
          label={String(count)}
          variant={count > 0 ? "warning" : "neutral"}
          styleVariant={count > 0 ? "solid" : "tinted"}
        />
      ) : null}
    </View>
  );
}

function ApprovalItem({
  item,
  deciding,
  onDecide,
  onAlways,
}: {
  item: {
    id: string;
    argv: string[];
    host: string;
    caller: string;
    cwd: string;
    expiresIn: number;
    step?: "initial" | "confirm";
    confirmOf?: string;
    preview?: {
      resolvedBinary?: string;
      targetCwd?: string;
      affectedCount?: number;
      samplePaths?: string[];
      riskLevel?: "low" | "medium" | "high" | "critical";
      riskReason?: string;
    };
  };
  deciding?: "approve" | "deny";
  onDecide(item: { id: string; argv: string[]; cwd: string }, decision: "approve" | "deny"): void;
  onAlways(item: { id: string; argv: string[]; cwd: string; preview?: { resolvedBinary?: string } }, target: "whitelist" | "blacklist"): void;
}) {
  const { colors, fonts } = usePluginTheme();
  const [program] = item.argv;
  const isConfirm = item.step === "confirm";
  const urgent = item.expiresIn <= EXPIRY_URGENT_S;
  const fontFamily = fonts.mono;
  const isDeciding = Boolean(deciding);

  return (
    <Card
      variant="elevated"
      style={{
        borderLeftWidth: 4,
        borderLeftColor: isConfirm || urgent ? colors.statusDanger : colors.statusWarning,
        gap: 8,
        padding: 12,
      }}
    >
      {isConfirm ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: colors.statusDanger + "15",
            borderColor: colors.statusDanger + "40",
            borderWidth: 1,
            borderRadius: 6,
            paddingVertical: 6,
            paddingHorizontal: 10,
          }}
        >
          <Icon name="AlertTriangle" size={14} color={colors.statusDanger} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.statusDanger, fontSize: 12, fontWeight: "700" }}>
              ARE YOU SURE? Tap again to run
            </Text>
            <Text style={{ color: colors.foregroundMuted, fontSize: 10 }}>
              Step 2 of 2: High-security confirmation required
            </Text>
          </View>
          <Badge label="2-step" variant="danger" styleVariant="solid" />
        </View>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              backgroundColor: isConfirm || urgent ? colors.statusDanger : colors.statusWarning,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={isConfirm ? "AlertTriangle" : "Terminal"} size={12} color="#ffffff" />
          </View>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700", flex: 1 }}>
            {program ?? "(empty)"}
          </Text>
        </View>
        <Badge
          label={urgent ? `expires in ${item.expiresIn}s` : `${item.expiresIn}s left`}
          variant={urgent || isConfirm ? "danger" : "warning"}
          styleVariant="solid"
          icon="Timer"
        />
      </View>

      <CommandBox argv={item.argv} />

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Icon name="User" size={11} color={colors.foregroundMuted} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            Caller <Text style={{ color: colors.foreground, fontWeight: "600" }}>{item.caller}</Text> on{" "}
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>{item.host}</Text>
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 280 }}>
          <Icon name="Folder" size={11} color={colors.foregroundMuted} />
          <Text
            numberOfLines={1}
            ellipsizeMode="middle"
            style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily }}
          >
            {item.cwd}
          </Text>
        </View>
      </View>

      <Collapsible
        title={
          item.preview?.riskLevel === "critical" || item.preview?.riskLevel === "high"
            ? `Impact Preview · ${item.preview.riskLevel.toUpperCase()} RISK`
            : "Impact Preview"
        }
        icon={
          item.preview?.riskLevel === "critical" || item.preview?.riskLevel === "high"
            ? "AlertTriangle"
            : "Terminal"
        }
        initiallyExpanded={item.preview?.riskLevel === "critical" || item.preview?.riskLevel === "high"}
      >
        <View style={{ gap: 6, paddingTop: 4 }}>
          {item.preview?.riskReason ? (
            <View
              style={{
                backgroundColor: colors.statusDanger + "15",
                borderColor: colors.statusDanger + "40",
                borderWidth: 1,
                borderRadius: 6,
                padding: 8,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon name="AlertTriangle" size={13} color={colors.statusDanger} />
              <Text style={{ color: colors.statusDanger, fontSize: 11, fontWeight: "600", flex: 1 }}>
                {item.preview.riskReason}
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Resolved Binary</Text>
            <Text style={{ color: colors.foreground, fontSize: 11, fontFamily, fontWeight: "600" }}>
              {item.preview?.resolvedBinary ?? `/usr/bin/${program ?? "command"}`}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Target Directory</Text>
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={{ color: colors.foreground, fontSize: 11, fontFamily, maxWidth: 220 }}
            >
              {item.preview?.targetCwd ?? item.cwd}
            </Text>
          </View>

          {item.preview?.affectedCount !== undefined ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>Affected Files</Text>
              <Badge
                label={`${item.preview.affectedCount} target${item.preview.affectedCount === 1 ? "" : "s"}`}
                variant={item.preview.affectedCount > 10 ? "warning" : "neutral"}
                styleVariant="tinted"
              />
            </View>
          ) : null}

          {item.preview?.samplePaths && item.preview.samplePaths.length > 0 ? (
            <View style={{ gap: 2, marginTop: 4 }}>
              <Text style={{ color: colors.foregroundMuted, fontSize: 10, fontWeight: "600" }}>
                Target Samples:
              </Text>
              {item.preview.samplePaths.slice(0, 3).map((p, idx) => (
                <Text
                  key={idx}
                  numberOfLines={1}
                  ellipsizeMode="middle"
                  style={{ color: colors.foregroundMuted, fontSize: 10, fontFamily }}
                >
                  • {p}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </Collapsible>

      <View style={{ flexDirection: "row", gap: 8, paddingTop: 2 }}>
        <View style={{ flex: 1 }}>
          <Button
            label={isConfirm ? "Confirm & Run" : "Approve"}
            variant={isConfirm ? "danger" : "primary"}
            size="sm"
            icon={isConfirm ? "AlertTriangle" : "Check"}
            accessibilityLabel={`${isConfirm ? "Confirm" : "Approve"} ${item.id}`}
            loading={deciding === "approve"}
            disabled={isDeciding}
            onPress={() => onDecide(item, "approve")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={isConfirm ? "Cancel & Deny" : "Deny"}
            variant={isConfirm ? "secondary" : "danger"}
            size="sm"
            icon="X"
            accessibilityLabel={`Deny ${item.id}`}
            loading={deciding === "deny"}
            disabled={isDeciding}
            onPress={() => onDecide(item, "deny")}
          />
        </View>
      </View>
      <Collapsible title="Policy shortcuts" icon="Settings" initiallyExpanded={false}>
        <View style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Always approve"
              variant="secondary"
              size="sm"
              icon="Check"
              accessibilityLabel={`Always approve ${item.id}`}
              disabled={isDeciding}
              onPress={() => onAlways(item, "whitelist")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Always deny"
              variant="secondary"
              size="sm"
              icon="X"
              accessibilityLabel={`Always deny ${item.id}`}
              disabled={isDeciding}
              onPress={() => onAlways(item, "blacklist")}
            />
          </View>
        </View>
      </Collapsible>

    </Card>
  );
}

function NotifyItem({
  item,
  acking,
  onAck,
}: {
  item: {
    id: string;
    link?: string;
    summary?: string;
    host: string;
    caller: string;
    expiresIn: number;
  };
  acking?: boolean;
  onAck(item: { id: string }): void;
}) {
  const { colors, fonts } = usePluginTheme();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const urgent = item.expiresIn <= EXPIRY_URGENT_S;
  const fontFamily = fonts.mono;

  const handleCopyLink = async () => {
    if (!item.link) return;
    const ok = await copyToClipboard(item.link, { toast, toastMessage: "Link" });
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card
      variant="elevated"
      style={{
        borderLeftWidth: 4,
        borderLeftColor: urgent ? colors.statusDanger : colors.accent,
        gap: 8,
        padding: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              backgroundColor: urgent ? colors.statusDanger : colors.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="Bell" size={12} color="#ffffff" />
          </View>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700", flex: 1 }}>
            Action needed
          </Text>
        </View>
        <Badge
          label={urgent ? `expires in ${item.expiresIn}s` : `${item.expiresIn}s left`}
          variant={urgent ? "danger" : "accent"}
          styleVariant="solid"
          icon="Timer"
        />
      </View>

      {item.summary ? (
        <Text style={{ color: colors.foreground, fontSize: 13 }}>{item.summary}</Text>
      ) : null}

      {item.link ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: colors.surface2,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 6,
            paddingHorizontal: 10,
            paddingVertical: 6,
            gap: 8,
          }}
        >
          <Text
            selectable
            numberOfLines={2}
            style={{ color: colors.accent, fontFamily, fontSize: 12, flex: 1 }}
          >
            {item.link}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            icon={copied ? "Check" : "Copy"}
            accessibilityLabel="Copy link"
            onPress={() => void handleCopyLink()}
          />
        </View>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Icon name="User" size={11} color={colors.foregroundMuted} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            From <Text style={{ color: colors.foreground, fontWeight: "600" }}>{item.caller}</Text> on{" "}
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>{item.host}</Text>
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 8, paddingTop: 2 }}>
        <View style={{ flex: 1 }}>
          <Button
            label="Ack"
            variant="primary"
            size="sm"
            icon="Check"
            accessibilityLabel={`Acknowledge ${item.id}`}
            loading={acking}
            disabled={acking}
            onPress={() => onAck(item)}
          />
        </View>
      </View>
    </Card>
  );
}

function ExecutingItem({  item,
}: {
  item: {
    id: string;
    argv?: string[];
    cwd?: string;
    status: string;
    exit?: number;
    output?: string;
  };
}) {
  const { colors, fonts } = usePluginTheme();
  const [program] = item.argv ?? ["(command)"];
  const isConfirming = item.status === "confirming";
  const isCompleted = item.status === "completed";
  const isFailed = isCompleted && item.exit !== 0;
  const isSuccess = isCompleted && item.exit === 0;

  const statusColor = isSuccess
    ? colors.statusSuccess
    : isFailed || isConfirming
      ? colors.statusWarning
      : colors.accent;

  const fontFamily = fonts.mono;

  return (
    <Card
      variant="elevated"
      style={{
        borderLeftWidth: 4,
        borderLeftColor: statusColor,
        gap: 8,
        padding: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 4,
              backgroundColor: statusColor,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              name={isSuccess ? "Check" : isFailed || isConfirming ? "AlertTriangle" : "Activity"}
              size={12}
              color="#ffffff"
            />
          </View>
          <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700", flex: 1 }}>
            {program}
          </Text>
        </View>
        <Badge
          label={
            isSuccess
              ? `exit ${item.exit}`
              : isFailed
                ? `exit ${item.exit}`
                : isConfirming
                  ? "confirming…"
                  : "running…"
          }
          variant={isSuccess ? "success" : isFailed || isConfirming ? "warning" : "accent"}
          styleVariant="solid"
          icon={isSuccess ? "Check" : isFailed || isConfirming ? "AlertTriangle" : "Activity"}
        />
      </View>

      {item.argv && item.argv.length > 0 ? <CommandBox argv={item.argv} /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        {item.cwd ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, maxWidth: 280 }}>
            <Icon name="Folder" size={11} color={colors.foregroundMuted} />
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={{ color: colors.foregroundMuted, fontSize: 11, fontFamily }}
            >
              {item.cwd}
            </Text>
          </View>
        ) : null}
        <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
          {isCompleted
            ? isSuccess
              ? "Executed successfully"
              : `Failed with exit ${item.exit}`
            : isConfirming
              ? "Step 1 approved · Awaiting 2nd confirmation…"
              : "Executing on host…"}
        </Text>
      </View>
    </Card>
  );
}

function RecentItem({
  item,
}: {
  item: {
    id: string;
    argv: string[];
    cwd: string;
    decision: string;
    by: string;
    exit: number;
    output: string;
    step?: "initial" | "confirm";
    confirmOf?: string;
    kind?: string;
    link?: string;
    summary?: string;
  };
}) {
  const { colors, fonts } = usePluginTheme();
  const isNotify = item.kind === "notify";
  const acked = item.decision === "ack";
  const approved = item.decision === "approve" || acked;
  const executed = item.exit >= 0;
  const failed = executed && item.exit !== 0;
  const isTwoStep = item.step === "confirm" || Boolean(item.confirmOf);
  const preview =
    item.output.length > OUTPUT_PREVIEW
      ? `${item.output.slice(0, OUTPUT_PREVIEW)}\n…[truncated]`
      : item.output;
  const [program] = item.argv;
  const statusColor = !approved
    ? colors.statusDanger
    : failed
      ? colors.statusWarning
      : colors.statusSuccess;

  const fontFamily = fonts.mono;

  return (
    <Card
      style={{
        borderLeftWidth: 3,
        borderLeftColor: statusColor,
        gap: 6,
        padding: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
          <Icon
            name={approved ? (failed ? "AlertTriangle" : "Check") : "X"}
            size={13}
            color={statusColor}
          />
          <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>
            {isNotify ? (item.summary ?? "(notify)") : (program ?? "(empty)")}
          </Text>
          <Text style={{ color: colors.foregroundMuted, fontSize: 11 }}>
            · {item.by ? `by ${item.by}` : "local"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {isTwoStep ? (
            <Badge label="2-step" variant="danger" styleVariant="tinted" />
          ) : null}
          <Badge
            label={
              acked ? "acked" : approved ? (executed ? `exit ${item.exit}` : "approved") : "denied"
            }
            variant={approved ? (failed ? "warning" : "success") : "danger"}
            styleVariant="tinted"
          />
        </View>
      </View>

      {isNotify && item.link ? (
        <Text
          selectable
          numberOfLines={2}
          style={{ color: colors.accent, fontSize: 11, fontFamily }}
        >
          {item.link}
        </Text>
      ) : null}

      {!isNotify ? <CommandBox argv={item.argv} /> : null}

      <KeyValueGroup columns={2}>
        <KeyValue label="By" value={item.by || "local"} />
        <KeyValue label="CWD" value={item.cwd} mono stackOnCompact />
      </KeyValueGroup>

      {executed && preview.trim().length > 0 ? (
        <Collapsible
          title={failed ? `Output · exit ${item.exit}` : "Output"}
          icon="ScrollText"
          initiallyExpanded={false}
        >
          <CodeBlock code={preview} maxHeight={180} />
        </Collapsible>
      ) : null}
    </Card>
  );
}

function TelegramStatusBar() {
  const { colors } = usePluginTheme();
  const tg = useTelegramInfo();
  const info = tg.data;

  if (tg.isPending && !info) return null;

  const isConnected = info?.status === "connected" || Boolean(info?.configured);
  const badgeVariant = isConnected ? "success" : info?.status === "error" ? "danger" : "neutral";

  return (
    <Card variant="flat" style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <StatusDot variant={badgeVariant} size="md" pulse={isConnected} />
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>
            Telegram {isConnected ? "Active" : "Fallback"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Badge
            label={isConnected ? "connected" : "unconfigured"}
            variant={badgeVariant}
            styleVariant="tinted"
          />
        </View>
      </View>
      {(info?.botUsername || info?.chatId) ? (
        <KeyValueGroup columns={2}>
          {info?.botUsername ? (
            <KeyValue label="Bot" value={`@${info.botUsername}`} mono />
          ) : null}
          {info?.chatId ? (
            <KeyValue label="Chat ID" value={info.chatId} mono copyable />
          ) : null}
        </KeyValueGroup>
      ) : null}
    </Card>
  );
}

function ApprovalSurfaceInner({
  theme,
  layout,
}: PluginSurfaceProps) {
  const toast = useToast();
  const query = usePendingList();
  const recent = useRecentList();
  const socketPath = useSocketPath();
  const decide = useRpc(verdict);
  const ackNotify = useRpc(approvalAck);
  const getStatus = useRpc(approvalStatus);
  const addRule = useRpc(policyAddRule);
  const queryClient = useQueryClient();
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [decidingMap, setDecidingMap] = useState<Record<string, "approve" | "deny">>({});
  const [ackingMap, setAckingMap] = useState<Record<string, boolean>>({});
  const [policyDialog, setPolicyDialog] = useState<{
    item: { id: string; argv: string[]; cwd: string; preview?: { resolvedBinary?: string } };
    target: "whitelist" | "blacklist";
  } | null>(null);
  const [policyScope, setPolicyScope] = useState<"exact" | "base" | "custom">("exact");
  const [customPattern, setCustomPattern] = useState("");
  const [policySaving, setPolicySaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [activeExecutions, setActiveExecutions] = useState<
    Record<
      string,
      {
        id: string;
        decision: "approve" | "deny";
        status:
          | "running"
          | "confirming"
          | "completed"
          | "denied"
          | "timeout"
          | "not_found"
          | "client_aborted"
          | "confirmation_timeout";
        argv?: string[];
        cwd?: string;
        exit?: number;
        output?: string;
      }
    >
  >({});

  const handleDecide = async (
    item: { id: string; argv: string[]; cwd: string },
    decision: "approve" | "deny",
  ) => {
    const { id } = item;
    setDecidingMap((prev) => ({ ...prev, [id]: decision }));

    try {
      const res = await decide({ id, decision, socketPath });
      if (!isMountedRef.current) return;

      if (!res.recorded) {
        setDecidingMap((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        toast.error("Already decided or 2fadod unreachable.");
        void queryClient.invalidateQueries({ queryKey: LIST_KEY });
        void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
        return;
      }

      setDecidingMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });

      if (decision === "deny") {
        toast.show("Denied command", { variant: "default" });
        void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
        return;
      }

      // If approved, track in activeExecutions and poll status
      setActiveExecutions((prev) => ({
        ...prev,
        [id]: {
          id,
          decision: "approve",
          status: "running",
          argv: item.argv,
          cwd: item.cwd,
        },
      }));

      // Start targeted polling for this request
      void (async () => {
        await new Promise((r) => setTimeout(r, 250));
        const maxAttempts = 60; // 60 * 350ms ~ 21s
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (!isMountedRef.current) return;
          try {
            const statusRes = await getStatus({ id, socketPath });
            if (!isMountedRef.current) return;

            if (statusRes.status === "confirming") {
              setActiveExecutions((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
              });
              void queryClient.invalidateQueries({ queryKey: LIST_KEY });
              void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
              return;
            }

            if (statusRes.status === "completed") {
              setActiveExecutions((prev) => ({
                ...prev,
                [id]: {
                  id,
                  decision: "approve",
                  status: "completed",
                  argv: statusRes.argv ?? item.argv,
                  cwd: statusRes.cwd ?? item.cwd,
                  exit: statusRes.exit,
                  output: statusRes.output,
                },
              }));
              void queryClient.invalidateQueries({ queryKey: RECENT_KEY });

              const prog = statusRes.argv?.[0] ?? item.argv[0] ?? "Command";
              if (statusRes.exit === 0) {
                toast.show(`${prog} completed (exit 0)`, { variant: "success" });
              } else {
                toast.show(`${prog} failed (exit ${statusRes.exit})`, { variant: "warning" });
              }

              // Keep card visible briefly to show final exit badge, then clean up
              setTimeout(() => {
                if (!isMountedRef.current) return;
                setActiveExecutions((prev) => {
                  const next = { ...prev };
                  delete next[id];
                  return next;
                });
              }, 800);
              return;
            }

            if (
              statusRes.status === "denied" ||
              statusRes.status === "timeout" ||
              statusRes.status === "not_found" ||
              statusRes.status === "client_aborted" ||
              statusRes.status === "confirmation_timeout"
            ) {
              void queryClient.invalidateQueries({ queryKey: LIST_KEY });
              void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
              setActiveExecutions((prev) => {
                const next = { ...prev };
                delete next[id];
                return next;
              });
              if (statusRes.status === "confirmation_timeout") {
                toast.error("Confirmation timed out — command cancelled");
              } else if (statusRes.status === "client_aborted") {
                toast.error("Calling process aborted command");
              } else if (statusRes.status === "timeout") {
                toast.error("Execution timed out");
              }
              return;
            }
          } catch {
            // Transient error; continue polling
          }
          await new Promise((r) => setTimeout(r, 350));
        }

        // Timeout polling fallback
        if (isMountedRef.current) {
          void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
          setActiveExecutions((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      })();
    } catch (err) {
      if (!isMountedRef.current) return;
      setDecidingMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      console.warn("[2fado] Verdict RPC failed:", err);
      toast.error("Verdict failed — 2fadod unreachable.");
    }
  };

  const handleAck = async (item: { id: string }) => {
    const { id } = item;
    setAckingMap((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await ackNotify({ id, socketPath });
      if (!isMountedRef.current) return;
      setAckingMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (!res.acked) {
        toast.error("Already acked, expired, or 2fadod unreachable.");
      } else {
        toast.show("Acknowledged", { variant: "success" });
      }
      void queryClient.invalidateQueries({ queryKey: LIST_KEY });
      void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
    } catch (err) {
      if (!isMountedRef.current) return;
      setAckingMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      console.warn("[2fado] Ack RPC failed:", err);
      toast.error("Ack failed — 2fadod unreachable.");
    }
  };

  useNewPendingToast(query.data?.items);

  const items = query.data?.items ?? [];
  const notifyItems = items.filter((i) => i.kind === "notify");
  const execItems = items.filter((i) => i.kind !== "notify");
  const rawRecentItems = recent.data?.items ?? [];

  // When a 2-step confirmation is in progress, the second approval replaces the first one:
  // 1. Hide approved 1st step from Recent while its 2nd step confirmation is active in Pending.
  // 2. Hide approved 1st step from Recent if the completed 2nd step confirmation is already in Recent.
  const pendingConfirmOfSet = new Set(
    items.map((i) => i.confirmOf).filter((c): c is string => Boolean(c)),
  );
  const recentConfirmOfSet = new Set(
    rawRecentItems.map((i) => i.confirmOf).filter((c): c is string => Boolean(c)),
  );

  const recentItems = rawRecentItems.filter(
    (item) => !pendingConfirmOfSet.has(item.id) && !recentConfirmOfSet.has(item.id),
  );
  const activeList = Object.values(activeExecutions);

  const openPolicyDialog = (
    item: { id: string; argv: string[]; cwd: string; preview?: { resolvedBinary?: string } },
    target: "whitelist" | "blacklist",
  ) => {
    setPolicyScope("exact");
    setCustomPattern(item.argv.join(" "));
    setPolicyDialog({ item, target });
  };

  const submitPolicyRule = async () => {
    if (!policyDialog || policySaving) return;
    const { item, target } = policyDialog;
    const base = item.preview?.resolvedBinary || item.argv[0] || "";
    const pattern =
      policyScope === "exact"
        ? item.argv
        : policyScope === "base"
          ? [base]
          : customPattern.split(/\s+/).filter(Boolean);
    if (pattern.length === 0) {
      toast.error("Pattern must not be empty.");
      return;
    }
    setPolicySaving(true);
    try {
      const res = await addRule({
        target,
        match_type: policyScope,
        pattern,
        socketPath,
      });
      if (!res.success) {
        toast.error(`Rule save failed: ${res.error ?? "unknown error"}`);
        return;
      }
      toast.show(
        `Rule saved (${res.rules_count ?? "?"} total) — ${target === "whitelist" ? "approving" : "denying"}`,
        { variant: "success" },
      );
      setPolicyDialog(null);
      await handleDecide(item, target === "whitelist" ? "approve" : "deny");
    } catch (err) {
      console.warn("[2fado] Policy rule save failed:", err);
      toast.error("Rule save failed — 2fadod unreachable.");
    } finally {
      if (isMountedRef.current) setPolicySaving(false);
    }
  };

  const policyBase = policyDialog
    ? policyDialog.item.preview?.resolvedBinary || policyDialog.item.argv[0] || ""
    : "";
  const policyExact = policyDialog ? policyDialog.item.argv.join(" ") : "";

  return (
    <PluginThemeProvider theme={{ colors: theme.colors }} layout={layout}>
      <ModalBody
        size="large"
        maxContentWidth={TWOFADO_CONTENT_MAX_WIDTH}
        style={{ backgroundColor: theme.colors.surface0 }}
        contentContainerStyle={{
          paddingHorizontal: layout.compact ? 12 : 20,
          paddingTop: layout.compact ? 12 : 20,
        }}
      >
        <View style={{ width: "100%", gap: 10 }}>
          <Card.Header
            title="2fado approvals"
            subtitle="Privileged command gating"
            icon="ShieldCheck"
          />

          <TelegramStatusBar />

          <Tabs
            tabs={[
              {
                id: "pending",
                label: "Pending",
                icon: "ShieldCheck",
                badge: items.length > 0 ? items.length : undefined,
              },
              {
                id: "history",
                label: "History",
                icon: "History",
              },
            ]}
            activeTab={activeTab}
            onTabChange={(id) => setActiveTab(id as "pending" | "history")}
          />

          {activeTab === "pending" ? (
            <>
              {query.isPending ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Loading…</Text>
              ) : null}
              {query.isError ? (
                <Card style={{ borderLeftWidth: 3, borderLeftColor: theme.colors.statusDanger }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Icon name="CloudOff" size={16} color={theme.colors.statusDanger} />
                    <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
                      2fadod unreachable
                    </Text>
                  </View>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 }}>
                    Check the 2fadod socket path in daemon config.
                  </Text>
                </Card>
              ) : null}
              {!query.isPending && !query.isError && items.length === 0 && activeList.length === 0 ? (
                <EmptyState
                  icon="ShieldCheck"
                  title="All clear"
                  description="No commands waiting for authorization."
                />
              ) : null}
              {notifyItems.map((item) => (
                <NotifyItem
                  key={item.id}
                  item={item}
                  acking={ackingMap[item.id]}
                  onAck={(target) => void handleAck(target)}
                />
              ))}
              {execItems.map((item) => (
                <ApprovalItem
                  key={item.id}
                  item={item}
                  deciding={decidingMap[item.id]}
                  onDecide={(target, decision) => handleDecide(target, decision)}
                  onAlways={(target, decision) => openPolicyDialog(target, decision)}
                />
              ))}
              {policyDialog ? (
                <Card
                  style={{
                    borderLeftWidth: 3,
                    borderLeftColor: theme.colors.accent,
                    gap: 8,
                    padding: 12,
                  }}
                >
                  <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700" }}>
                    {policyDialog.target === "whitelist" ? "Always approve" : "Always deny"} — pick scope
                  </Text>
                  <Tabs
                    tabs={[
                      { id: "exact", label: "Exact match", icon: "Check" },
                      { id: "base", label: "Base binary", icon: "Terminal" },
                      { id: "custom", label: "Custom pattern", icon: "Edit" },
                    ]}
                    activeTab={policyScope}
                    onTabChange={(id) => setPolicyScope(id as "exact" | "base" | "custom")}
                  />
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                    {policyScope === "exact"
                      ? policyExact
                      : policyScope === "base"
                        ? policyBase
                        : "Edit arguments below"}
                  </Text>
                  {policyScope === "custom" ? (
                    <TextInput
                      value={customPattern}
                      onChangeText={setCustomPattern}
                      placeholder="command arguments"
                      mono
                    />
                  ) : null}
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Cancel"
                        variant="secondary"
                        size="sm"
                        onPress={() => setPolicyDialog(null)}
                        disabled={policySaving}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        label={policyDialog.target === "whitelist" ? "Save & approve" : "Save & deny"}
                        variant="primary"
                        size="sm"
                        icon="Check"
                        onPress={() => void submitPolicyRule()}
                        loading={policySaving}
                        disabled={policySaving}
                      />
                    </View>
                  </View>
                </Card>
              ) : null}

              {activeList.length > 0 ? (
                <>
                  <SectionHeader title="In flight" count={activeList.length} />
                  {activeList.map((item) => (
                    <ExecutingItem key={item.id} item={item} />
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <>
              {recent.isPending ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Loading…</Text>
              ) : null}
              {!recent.isPending && recentItems.length === 0 ? (
                <EmptyState
                  icon="History"
                  title="No history yet"
                  description="Decided requests will appear here with execution status and output."
                />
              ) : null}
              {recentItems.map((item) => (
                <RecentItem key={item.id} item={item} />
              ))}
            </>
          )}

        </View>
      </ModalBody>
    </PluginThemeProvider>
  );
}

export function ApprovalSurface(props: PluginSurfaceProps) {
  const { theme, layout } = props;
  return (
    <ErrorBoundary
      label="ApprovalSurface"
      fallback={
        <PluginThemeProvider theme={{ colors: theme.colors }} layout={layout}>
          <ModalBody
            maxContentWidth={TWOFADO_CONTENT_MAX_WIDTH}
            style={{ backgroundColor: theme.colors.surface0 }}
            contentContainerStyle={{ padding: 20 }}
          >
            <View style={{ width: "100%", gap: 10 }}>
              <Card style={{ borderLeftWidth: 3, borderLeftColor: theme.colors.statusDanger }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="CloudOff" size={16} color={theme.colors.statusDanger} />
                  <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
                    2fado panel hit a render error
                  </Text>
                </View>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 }}>
                  Details are in the plugin logs. Re-open the panel to retry.
                </Text>
              </Card>
            </View>
          </ModalBody>
        </PluginThemeProvider>
      }
    >
      <ApprovalSurfaceInner {...props} />
    </ErrorBoundary>
  );
}
