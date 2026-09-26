/**
 * A lower bound on the vertical height a rendered tree demands.
 *
 * `flex-measure.ts` answers the horizontal question (#688): can this row be
 * given enough width to fit? This answers the vertical one (#684): is there
 * more of it than a pane can show, so that a surface without a scroll container
 * is not merely unpolished but unreachable?
 *
 * ## Why a floor and not a layout
 *
 * Every height in these surfaces derives from text lines plus padding, gaps and
 * borders, so the column/row composition below is exact *given* a line count.
 * The line count is the one thing that needs a width, and this pass has no
 * width pass to ask. So each text leaf is counted as a single line however much
 * of it wraps, which can only under-report. That direction is the one that makes
 * the result usable: a floor that exceeds a pane is sound proof that the content
 * does not fit, whatever the text does, while a floor that fits proves nothing.
 * The suite therefore reports this number per run and pins nothing, and asserts
 * only what the floor can carry (see `heightClamps`).
 */
import { resolveStyle, type StyleValue } from "./flex-measure.js";

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function childNodes(node: any): any[] {
  return (Array.isArray(node?.children) ? node.children : []).filter(
    (child: unknown) => child && typeof child === "object",
  );
}

/** React Native's default body text size, used when a leaf declares none. */
const DEFAULT_FONT_SIZE = 14;

function isTextLeaf(node: any): boolean {
  return node?.type === "Text" || typeof node?.type !== "string";
}

function insets(style: StyleValue): { top: number; bottom: number } {
  const vertical = num(style.paddingVertical, 0);
  return {
    top: num(style.paddingTop, vertical),
    bottom: num(style.paddingBottom, vertical),
  };
}

/**
 * The height a node's children need, before the node's own insets: a column
 * stacks them, a row takes the tallest, because that is what Yoga does.
 */
function childrenFloor(node: any, style: StyleValue): number {
  const children = childNodes(node);
  if (children.length === 0) return 0;
  const heights = children.map(floorHeight);
  if (style.flexDirection === "row") return Math.max(...heights);
  return heights.reduce((a, b) => a + b, 0) + num(style.gap, 0) * (children.length - 1);
}

/** Height of one rendered node, as a floor. */
function floorHeight(node: any): number {
  const style = resolveStyle(node);

  if (isTextLeaf(node)) {
    // One line, whatever it wraps to. `fontSize` is a floor: line height is at
    // least the font size, and a leaf with no text is a dot or a rule.
    return Math.max(0, num(style.fontSize, DEFAULT_FONT_SIZE));
  }

  const composed = childrenFloor(node, style);
  const { top, bottom } = insets(style);
  const borders = num(style.borderTopWidth, num(style.borderWidth, 0)) + num(style.borderBottomWidth, 0);
  const margins = num(style.marginTop, 0) + num(style.marginBottom, num(style.marginVertical, 0));
  const natural = composed + top + bottom + borders + margins;
  // A declared height or a floor on one is a real minimum, so it can raise the
  // answer but never lower it below what the children already demand.
  const declared = Math.max(num(style.height, 0), num(style.minHeight, 0));
  return Math.max(natural, declared);
}

/**
 * The fewest pixels of height `root` can occupy, ignoring how far its text
 * wraps. Compare it with the pane it has to fit in: the surface needs a scroll
 * container when the floor exceeds the pane.
 */
export function contentHeightFloor(root: unknown): number {
  if (!root || typeof root !== "object") return 0;
  return Math.round(floorHeight(root));
}

export interface HeightClamp {
  /** The `testID` of the box that clips, when it carries one. */
  readonly testID?: string;
  /** The height the box was given. */
  readonly declared: number;
  /** The height its children need, by the same floor. */
  readonly needed: number;
}

/**
 * Boxes that are shorter than their own content — the shape that clips instead
 * of scrolling.
 *
 * A scroller is only a fix if nothing inside it takes a bite out of the
 * overflow. A fixed `height` on a box that has children is fine when the
 * children fit (a gauge, a clock face), and a clip when they do not, so the
 * test is the comparison rather than the presence of a number: a hairline
 * carries `height: 1` and is not a clamp, and neither is anything that asks for
 * more than it holds. The floor under-counts wrapped text, so a box it calls
 * sufficient may still be a clip in practice — this can only miss a clamp, never
 * invent one.
 */
export function heightClamps(root: unknown): HeightClamp[] {
  const found: HeightClamp[] = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== "object" || isTextLeaf(node)) return;
    if (childNodes(node).length > 0) {
      const style = resolveStyle(node);
      // A percentage cannot be compared without a layout pass, so only the
      // numeric forms are in scope.
      const declared = Math.max(num(style.height, 0), num(style.maxHeight, 0));
      const needed = childrenFloor(node, style);
      if (declared > 0 && declared + 0.5 < needed) {
        found.push({
          testID: typeof node.props?.testID === "string" ? node.props.testID : undefined,
          declared: Math.round(declared),
          needed: Math.round(needed),
        });
      }
    }
    for (const child of childNodes(node)) walk(child);
  };
  walk(root);
  return found;
}
