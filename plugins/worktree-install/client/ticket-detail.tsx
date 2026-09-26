import React from "react";
import { View } from "react-native";
import { Modal } from "@getpaseo/plugin/client/react-native";
import type { Ticket } from "../shared/contracts.js";
import { ownerLabel, relativeTime } from "../shared/derive.js";
import { Chip, Cluster, Field, Hairline, Press, Stack, Type, useSkin } from "./kit.js";

const STATUS_TONE = {
  Backlog: "muted",
  "In progress": "accent",
  Review: "warn",
  Done: "ok",
} as const;

/**
 * Line cap on the closing note. It is a 99-character sentence, so as unbounded
 * text it insists on a single 395px line and spills out of a 320px phone
 * viewport; a cap is what lets it break. Greedy word wrap puts it on two lines
 * at 320px and one line at 620px, so the cap is never reached anywhere in the
 * #684 sweep — no words are lost at any phone width, and the desktop layout
 * still renders it as the single line it always was.
 */
const FOOTER_LINES = 3;

/**
 * The full ticket record. On a wide surface this renders as a second pane
 * beside the list; on a narrow one it is a modal. The content is identical
 * either way — only the container changes.
 */
export function TicketDetail({
  ticket,
  onClose,
  onDispatch,
  onOpenExternal,
  embedded,
}: {
  ticket: Ticket;
  onClose: () => void;
  onDispatch: (ticket: Ticket) => void;
  onOpenExternal: (url: string) => void;
  embedded?: boolean;
}) {
  const { palette } = useSkin();

  const body = (
    <Stack gap={8} style={{ padding: embedded ? 10 : 14, flex: 1, minHeight: 0 }}>
      <Cluster gap={6} justify="between" align="start">
        <Cluster gap={5}>
          <Type size={10} weight="700" mono color={palette.accent} testID="ticket-detail-ref">
            {ticket.repo} #{ticket.number}
          </Type>
          <Chip
            testID="ticket-detail-status"
            label={ticket.status}
            tone={STATUS_TONE[ticket.status]}
            dot
            strong
          />
          <Chip testID="ticket-detail-owner" label={ownerLabel(ticket.attention)} tone="muted" />
          {ticket.comments > 0 ? (
            <Chip testID="ticket-detail-comments" label={`${ticket.comments} comments`} tone="muted" />
          ) : null}
        </Cluster>
        <Cluster gap={4} wrap={false}>
          {ticket.url ? (
            <Press
              testID="ticket-detail-open-external"
              tone="accent"
              onPress={() => onOpenExternal(ticket.url!)}
              accessibilityLabel="Open in Forgejo"
            >
              <Type size={10} weight="600" color={palette.accent}>
                open in forgejo
              </Type>
            </Press>
          ) : null}
          <Press
            testID="ticket-detail-dispatch"
            tone="accent"
            onPress={() => onDispatch(ticket)}
            accessibilityLabel={`Dispatch a worktree for #${ticket.number}`}
            style={{ paddingHorizontal: 8, paddingVertical: 4, backgroundColor: palette.accent, borderRadius: 3 }}
          >
            <Type size={10} weight="700" color={palette.accentText} upper>
              dispatch worktree
            </Type>
          </Press>
          <Press testID="ticket-detail-close" tone="muted" onPress={onClose} accessibilityLabel="Close ticket">
            <Type size={10} weight="600" color={palette.textDim}>
              close
            </Type>
          </Press>
        </Cluster>
      </Cluster>

      <Type size={14} weight="700" testID="ticket-detail-title">
        {ticket.title}
      </Type>

      <Cluster gap={10} align="start">
        <Field
          testID="ticket-detail-branch"
          label="worktree branch"
          value={ticket.branch ?? "no worktree dispatched yet"}
          mono
          copyable={Boolean(ticket.branch)}
        />
        <Field testID="ticket-detail-state" label="state" value={ticket.state} />
        <Field
          testID="ticket-detail-updated"
          label="updated"
          value={relativeTime(ticket.updatedAt) || ticket.updatedAt || "—"}
        />
        <Field
          testID="ticket-detail-comments-count"
          label="comments"
          value={String(ticket.comments)}
          mono
        />
      </Cluster>

      {ticket.labels.length > 0 ? (
        <Stack gap={4} testID="ticket-detail-labels">
          <Type size={9} weight="700" color={palette.textFaint} upper>
            labels · {ticket.labels.length}
          </Type>
          <Cluster gap={3}>
            {ticket.labels.map((label) => (
              <Chip key={label} label={label} tone="muted" mono size={9} />
            ))}
          </Cluster>
        </Stack>
      ) : null}

      <Hairline />
      <Type size={10} color={palette.textFaint} numberOfLines={FOOTER_LINES}>
        Dispatching tells the fleet to take the ticket; the daemon owns the worktree that follows.
      </Type>
    </Stack>
  );

  if (embedded) {
    return (
      <View
        testID="ticket-detail"
        style={{
          flex: 1,
          minWidth: 0,
          borderLeftWidth: 1,
          borderLeftColor: palette.rule,
          backgroundColor: palette.panel,
        }}
      >
        {body}
      </View>
    );
  }

  return (
    <Modal
      title={`#${ticket.number} · ${ticket.title}`}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Modal.Content scrollable>{body}</Modal.Content>
    </Modal>
  );
}
