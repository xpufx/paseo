import React, { type ReactNode } from "react";
import { getClientHost } from "../host.js";
import { ModalBody, ModalBodyScrollOwnerContext, type ModalBodyProps } from "./ModalBody.js";

export interface ModalContentProps extends Omit<ModalBodyProps, "scrollMode"> {
  children: ReactNode;
  /**
   * Whether the host owns the outer scroll container.
   * Defaults to `true` so host desktop mouse wheel, trackpad, and mobile bottom
   * sheet gestures scroll natively without fighting an inner scroller.
   * Set to `false` only if the modal contains a custom internal scroller
   * (e.g. virtualized list or canvas).
   */
  scrollable?: boolean;
}

/**
 * Helper-owned modal body for plugins that open their own host `<Modal>`.
 *
 * Delegates scroll ownership to the host `<Modal.Content>` (scrollable by default)
 * so desktop mouse wheel, trackpad, and mobile bottom sheet gestures scroll
 * natively under Paseo host rules without fighting an inner scroller.
 *
 * Sizing stays fluid within the host-allocated modal frame, respecting
 * `size?: "default" | "large"`.
 *
 * ```tsx
 * <Modal title="…" open={open} onOpenChange={setOpen}>
 *   <ModalContent size="default">
 *     …cards, controls, rows…
 *   </ModalContent>
 * </Modal>
 * ```
 *
 * Accepts every `ModalBody` prop (header, headerMode, refreshing, onRefresh,
 * stickToEnd, scrollRef, debugTag, style, contentContainerStyle, …).
 */
export function ModalContent({
  children,
  scrollable = true,
  ...bodyProps
}: ModalContentProps) {
  const { Modal } = getClientHost();
  return (
    <Modal.Content scrollable={scrollable}>
      <ModalBodyScrollOwnerContext.Provider value={scrollable ? "host" : "required"}>
        <ModalBody {...bodyProps}>{children}</ModalBody>
      </ModalBodyScrollOwnerContext.Provider>
    </Modal.Content>
  );
}
