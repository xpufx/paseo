export type KanbanKeyboardIntentType =
  | "select-next"
  | "select-prev"
  | "open"
  | "move"
  | "close"
  | "none";

export interface KanbanKeyboardIntent {
  type: KanbanKeyboardIntentType;
  /** Zero-based target column for `move` intents (digit `1` -> `0`). */
  columnIndex?: number;
}

const NEXT_KEYS = new Set(["j", "J", "ArrowDown"]);
const PREV_KEYS = new Set(["k", "K", "ArrowUp"]);

/**
 * Maps a raw keydown key to a board intent. Pure and platform-free so the
 * dispatch logic is unit-testable without a DOM.
 */
export function resolveKanbanKeyboardIntent(
  key: string,
  columnCount = 4,
): KanbanKeyboardIntent {
  if (NEXT_KEYS.has(key)) return { type: "select-next" };
  if (PREV_KEYS.has(key)) return { type: "select-prev" };
  if (key === "Enter") return { type: "open" };
  if (key === "Escape") return { type: "close" };
  if (/^[1-9]$/.test(key)) {
    const columnIndex = Number(key) - 1;
    if (columnIndex < columnCount) return { type: "move", columnIndex };
  }
  return { type: "none" };
}

export interface KanbanKeyboardEventLike {
  key?: string;
  target?: unknown;
  preventDefault?: () => void;
}

export type KanbanKeydownListener = (event: KanbanKeyboardEventLike) => void;

export interface KanbanKeydownTarget {
  addEventListener: (type: string, listener: KanbanKeydownListener) => void;
  removeEventListener: (type: string, listener: KanbanKeydownListener) => void;
}

/**
 * Returns the DOM keydown target when one exists. Uses `globalThis` so the
 * package stays DOM-lib-free for hosts that compile the source without `lib.dom`.
 */
export function getKanbanKeydownTarget(): KanbanKeydownTarget | null {
  const candidate = (globalThis as { window?: unknown }).window;
  if (!candidate || typeof candidate !== "object") return null;
  const target = candidate as Partial<KanbanKeydownTarget>;
  if (
    typeof target.addEventListener !== "function" ||
    typeof target.removeEventListener !== "function"
  ) {
    return null;
  }
  return target as KanbanKeydownTarget;
}

/** True when the event originates from a text field and should keep native editing. */
export function isEditableKeyboardTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as { tagName?: string; isContentEditable?: boolean };
  const tag = (node.tagName ?? "").toUpperCase();
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    node.isContentEditable === true
  );
}
