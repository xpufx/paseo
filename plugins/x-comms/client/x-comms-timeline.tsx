import { z } from "zod";
import { type PluginTimelineItemProps, type PluginTimelineTransformerContribution, type PluginTimelineRendererContribution } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { cardRecipe, InlineButton } from "./vendor/paseo-plugin-helper/index";
import { EnvelopeSchema, cardSignal, isOverflowing, parseEnvelope, type CrossDaemonEnvelope } from "../shared/envelope";
import {
  OUTBOX_NOTICE_KIND,
  OUTBOX_NOTICE_VERSION,
  OutboxNoticeSchema,
  type OutboxNotice,
} from "../shared/outbox";
import { formatPeerDisplay, usePeerAlias } from "./peer-label";
import { ViaXComms } from "./via-x-comms";

export { parseEnvelope, type CrossDaemonEnvelope };

const ItemSchema = z.object({
  envelope: EnvelopeSchema,
  body: z.string(),
});

function senderLabel(env: CrossDaemonEnvelope, alias: string | null): string {
  const s = env.xComms.sender;
  const name = s.agentName ?? s.agentId ?? "unknown agent";
  return `${name} @ ${formatPeerDisplay(alias, s.daemonServerId)}`;
}

function MessageBody({ theme, body }: { theme: PluginTheme; body: string }) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const onTextLayout = useCallback(
    (e: { nativeEvent: { lines: unknown[] } }) => {
      const next = isOverflowing(e.nativeEvent.lines.length);
      setOverflows((prev) => (prev === next ? prev : next));
    },
    [],
  );
  const copy = useCallback(() => {
    copyText(body).then(
      () => toast.show("Copied", { variant: "success" }),
      () => toast.error("Copy failed"),
    );
  }, [body, toast]);
  if (!expanded) {
    return (
      <View>
        <Text
          style={{ color: theme.colors.foreground, fontSize: 13 }}
          numberOfLines={3}
          ellipsizeMode="tail"
          onTextLayout={onTextLayout}
        >
          {body}
        </Text>
        {overflows ? (
          <InlineButton
            label="Show more"
            onPress={() => setExpanded(true)}
            style={{ marginTop: 2 }}
          />
        ) : null}
      </View>
    );
  }
  return (
    <View
      style={{
        ...cardRecipe(theme, { variant: "flat", compact: true }),
        marginTop: 2,
        flexDirection: "row",
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 13, flexShrink: 1, flexGrow: 1 }} selectable>
        {body}
      </Text>
      <View style={{ flexDirection: "column", gap: 8, marginLeft: 8 }}>
        <InlineButton
          label="⧉"
          accessibilityLabel="Copy message"
          onPress={copy}
          textStyle={{ fontSize: 14 }}
        />
        <InlineButton
          label="Less"
          onPress={() => setExpanded(false)}
        />
      </View>
    </View>
  );
}

function CrossDaemonMessage({ theme, agentId, item }: PluginTimelineItemProps<z.infer<typeof ItemSchema>>) {
  const alias = usePeerAlias(item.data.envelope.xComms.sender.daemonServerId);
  const label = useMemo(
    () => senderLabel(item.data.envelope, alias),
    [item.data.envelope, alias],
  );
  const { direction, userSent } = cardSignal(item.data.envelope, agentId);
  const incoming = direction === "incoming";
  // An incoming envelope with no auth block means the claimed sender is
  // unverified: any agent that can write to a timeline can type the tag (#594).
  // The plugin server is the authority and refuses to attribute these; the card
  // just stops implying the sender was checked. Scoped to incoming because the
  // Desktop client stamps envelopes itself and cannot sign them — flagging our
  // own outgoing messages would be noise, not a warning.
  const unverified = incoming && item.data.envelope.xComms.auth === undefined;
  const signalColor = unverified
    ? theme.colors.statusWarning
    : userSent
      ? theme.colors.statusDanger
      : theme.colors.foregroundMuted;
  return (
    <View style={{ paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Icon
          name={incoming ? "PhoneIncoming" : "PhoneOutgoing"}
          size={14}
          color={signalColor}
        />
        <Text style={{ color: signalColor, fontSize: 12, fontWeight: "600" as const }}>
          x-comms · {incoming ? "Incoming" : "Outgoing"}
          {unverified ? " · unsigned sender" : ""} · {label}
        </Text>
      </View>
      {item.data.body.length > 0 ? (
        <MessageBody theme={theme} body={item.data.body} />
      ) : null}
      <ViaXComms theme={theme} />
    </View>
  );
}

/**
 * Timeline transformer: paseo calls this for every user_message. If the text
 * carries our meta envelope, we emit a plugin-typed item our renderer draws
 * distinctly. The envelope is the only discriminator.
 */
export const crossDaemonTransformer: PluginTimelineTransformerContribution<"user_message"> = {
  id: "x-comms-message",
  query: { itemType: "user_message" },
  transform({ item }) {
    const parsed = parseEnvelope(item.text);
    if (!parsed) return undefined;
    return {
      items: [
        {
          type: "plugin",
          kind: "x-comms-message",
          version: 1,
          data: { envelope: parsed.envelope, body: parsed.body },
        },
      ],
    };
  },
};

export const crossDaemonRenderer: PluginTimelineRendererContribution<typeof ItemSchema> = {
  kind: "x-comms-message",
  version: 1,
  schema: ItemSchema,
  Component: CrossDaemonMessage,
};

/**
 * Expiry notice for a message the outbox gave up on. Local to the sender's
 * timeline; never part of the wire envelope.
 */
function OutboxNoticeCard({ theme, item }: PluginTimelineItemProps<OutboxNotice>) {
  return (
    <View style={{ paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Icon name="AlertTriangle" size={14} color={theme.colors.statusWarning} />
        <Text style={{ color: theme.colors.statusWarning, fontSize: 12, fontWeight: "600" as const }}>
          x-comms · Delivery failed
        </Text>
      </View>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{item.data.reason}</Text>
      <ViaXComms theme={theme} />
    </View>
  );
}

export const outboxNoticeRenderer: PluginTimelineRendererContribution<typeof OutboxNoticeSchema> = {
  kind: OUTBOX_NOTICE_KIND,
  version: OUTBOX_NOTICE_VERSION,
  schema: OutboxNoticeSchema,
  Component: OutboxNoticeCard,
};
