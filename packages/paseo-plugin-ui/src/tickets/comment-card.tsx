import React from "react";
import { Linking, type StyleProp, type ViewStyle } from "react-native";
import {
  stripAgentEnvelopeFooter,
  type IssueComment,
} from "@xpufx/backend-tickets/client";
import {
  HostButton,
  HostCard,
  HostCardHeader,
  HostRow,
  HostStack,
} from "../index.js";
import { HostMarkdownLite } from "./markdown-lite.js";
import { HostAgentEnvelopeCard } from "./agent-envelope.js";

function formatTimestamp(value: string | undefined | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export interface HostCommentCardProps {
  comment: IssueComment;
  issueUrl?: string;
  query?: string;
  style?: StyleProp<ViewStyle>;
  onOpenComment?: (url: string) => void;
  onOpenSession?: (url: string) => void;
}

export function HostCommentCard({
  comment,
  issueUrl,
  query,
  style,
  onOpenComment,
  onOpenSession,
}: HostCommentCardProps) {
  const body = stripAgentEnvelopeFooter(comment.body) || comment.body;
  const target = comment.url || issueUrl || "";

  const handleOpen = () => {
    if (!target) return;
    if (onOpenComment) {
      onOpenComment(target);
    } else {
      Linking.openURL(target).catch(() => {});
    }
  };

  return (
    <HostCard variant="flat" style={[{ marginVertical: 4 }, style]}>
      <HostCardHeader
        title={comment.author}
        subtitle={formatTimestamp(comment.createdAt)}
        icon="MessageSquare"
      />
      <HostStack gap="xs" style={{ padding: 8 }}>
        <HostMarkdownLite body={body} query={query} />
        {target ? (
          <HostRow justify="flex-end" align="center" gap="xs">
            <HostButton
              size="sm"
              variant="ghost"
              icon="ExternalLink"
              label="Open comment"
              accessibilityLabel={`Open comment by ${comment.author}`}
              onPress={handleOpen}
            />
          </HostRow>
        ) : null}
      </HostStack>
      {comment.envelope ? (
        <HostAgentEnvelopeCard envelope={comment.envelope} onOpenSession={onOpenSession} />
      ) : null}
    </HostCard>
  );
}

export { HostCommentCard as CommentCard };
