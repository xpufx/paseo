import React, { type ReactNode } from "react";
import { getClientHost } from "../host";
import { ModalBody, type ModalBodyProps } from "./ModalBody";

export interface ModalContentProps extends Omit<ModalBodyProps, "scrollMode"> {
  children: ReactNode;
}

/**
 * Helper-owned modal body for plugins that open their own host `<Modal>`.
 *
 * Use this instead of the raw host `<Modal.Content>`: it wraps the host content
 * view AND the shared `ModalBody` contract in one element, so a plugin cannot
 * accidentally end up content-sized.
 *
 * Why the raw host `Modal.Content` resizes: Paseo maps
 * `<Modal.Content scrollable={true}>` (the host default) to a desktop card with
 * no explicit height, so the dialog grows/shrinks with its children on every
 * data change. This wrapper always passes `scrollable={false}`, which makes the
 * host allocate a bounded dialog (`desktopHeight: "85%"`). Because that host
 * content view then supplies no scroller, the wrapper also forces
 * `ModalBody scrollMode="always"`, so the helper owns the one scroll region on
 * every surface and the bounded dialog scrolls instead of clipping.
 *
 * The size contract is `ModalBody`'s: it takes the host-allocated dialog size
 * and is fluid within it; `size?: "default" | "large"` is the only size escape
 * hatch. Do not add per-plugin width/minWidth/height literals around it.
 *
 * ```tsx
 * <Modal title="…" open={open} onOpenChange={setOpen}>
 *   <ModalContent size="default">
 *     …cards, controls, rows; content never drives the dialog frame…
 *   </ModalContent>
 * </Modal>
 * ```
 *
 * Accepts every `ModalBody` prop (header, headerMode, refreshing, onRefresh,
 * stickToEnd, scrollRef, debugTag, style, contentContainerStyle, …).
 */
export function ModalContent({ children, ...bodyProps }: ModalContentProps) {
  const { Modal } = getClientHost();
  return (
    <Modal.Content scrollable={false}>
      <ModalBody scrollMode="always" {...bodyProps}>
        {children}
      </ModalBody>
    </Modal.Content>
  );
}
