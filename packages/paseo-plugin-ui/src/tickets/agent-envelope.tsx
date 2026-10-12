import React from "react";
import { Linking, type StyleProp, type ViewStyle } from "react-native";
import type { AgentEnvelope } from "@xpufx/backend-tickets/client";
import {
  HostBadge,
  HostButton,
  HostCard,
  HostCardHeader,
  HostCommandBox,
  HostKeyValue,
  HostKeyValueGroup,
  HostStack,
} from "../index.js";

export interface HostAgentEnvelopeCardProps {
  envelope: AgentEnvelope;
  style?: StyleProp<ViewStyle>;
  onOpenSession?: (url: string) => void;
}

export function HostAgentEnvelopeCard({
  envelope,
  style,
  onOpenSession,
}: HostAgentEnvelopeCardProps) {
  const openSession = () => {
    const link = envelope.paseoLinks[0];
    if (!link) return;
    if (onOpenSession) {
      onOpenSession(link);
    } else {
      Linking.openURL(link).catch(() => {});
    }
  };

  return (
    <HostCard variant="tinted" style={[{ marginTop: 6 }, style]}>
      <HostCardHeader
        title={envelope.sessionTitle}
        subtitle={envelope.postedAt ?? undefined}
        badge={<HostBadge variant="neutral" label={envelope.agentShortId} />}
        icon="Bot"
      />
      <HostKeyValueGroup columns={2}>
        <HostKeyValue label="Model" value={envelope.model ?? "-"} mono />
        <HostKeyValue
          label="Branch"
          value={envelope.branch ? `${envelope.repo ?? ""}:${envelope.branch}` : "-"}
          mono
          copyable={Boolean(envelope.branch)}
        />
      </HostKeyValueGroup>
      {envelope.commitShas.length > 0 ? (
        <HostStack gap="xxs" style={{ marginTop: 4 }}>
          {envelope.commitShas.map((sha) => (
            <HostCommandBox key={sha} command={sha} copyLabel={`Copy commit ${sha}`} />
          ))}
        </HostStack>
      ) : null}
      {envelope.paseoLinks.length > 0 ? (
        <HostButton
          size="sm"
          variant="ghost"
          icon="ExternalLink"
          label="Open agent session"
          onPress={openSession}
        />
      ) : null}
    </HostCard>
  );
}

export { HostAgentEnvelopeCard as AgentEnvelopeCard };
