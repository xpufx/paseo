/**
 * Yoga-shaped horizontal layout measurement for rendered plugin trees.
 *
 * Copied verbatim from `uppidi-fleet`'s `client/testing/flex-measure.ts`, which
 * is where #621 wrote it. A cross-plugin import is not available: this plugin's
 * `client/entry.test.ts` asserts every relative import stays inside the plugin
 * directory, and nothing may be shared through `paseo-plugin-helper` without a
 * re-vendor and a restamp. Keep the two copies in step, or move this somewhere
 * both can legitimately reach.
 *
 * `react-test-renderer` produces the real element tree and the real resolved
 * style objects, but no layout pass. This module supplies the missing pass for
 * the one question mobile overlap turns on: can a container's children be given
 * enough width to avoid spilling past its content box?
 *
 * ## What is exact and what is estimated
 *
 * The *flex semantics* are modelled exactly, per React Native / react-native-web
 * (Yoga):
 *   - `flexShrink` defaults to 0, so a flex item keeps its content size and
 *     pushes the row wider than its container.
 *   - `flex: 1` sets `flexBasis: 0`, so the item's size is driven by the space
 *     it is given, floored by `minWidth`.
 *   - `flexWrap: "wrap"` lets a row break lines, but only helps items that can
 *     themselves compress; a single item wider than the line still overflows.
 *   - `<Text numberOfLines={n}>` can compress to zero width and ellipsize; a
 *     `<Text>` without it cannot, so it overflows any box narrower than its
 *     intrinsic text width.
 *
 * The *glyph metrics* are an estimate: `measureText` approximates advance widths
 * from a per-character-class table rather than a real font. Findings are
 * therefore reported only when the demanded width exceeds the available width —
 * a margin no plausible font correction could close — so the check cannot
 * produce false positives, only occasional false negatives on near-miss cases.
 *
 * Because a finding means "no flexbox resolution can make this fit", the guard
 * is a floor, not a full layout engine: passing it is necessary, not sufficient,
 * for a clean narrow-width render.
 */

export type StyleValue = Record<string, unknown>;

export interface OverflowFinding {
  /** Slash-joined element types from the measured root, for locating the site. */
  path: string;
  /** The container that could not fit its children. */
  type: string;
  /** Content-box width the container had to distribute. */
  available: number;
  /** Width its children insisted on. */
  demanded: number;
  excess: number;
  /** Human-readable summary of what refused to compress. */
  culprits: string[];
  /** Nearest descendant text, to identify the offending row. */
  label: string;
  /** Nearest `testID` on or above the finding, for locating the source site. */
  testID?: string;
}

interface Padding {
  left: number;
  right: number;
}

interface Metrics {
  /**
   * Narrowest width the subtree can occupy without spilling out of itself.
   * Unshrinkable children (no `flexShrink`, `minWidth` floors, multi-line-safe
   * text) keep their full demand here; shrinkable children bottom out at 0.
   */
  minContent: number;
  /** Width the subtree wants at unbounded available space. */
  maxContent: number;
}

const TEXT_NODE = "Text";

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function num(value: unknown, fallback = 0): number {
  return isNum(value) ? value : fallback;
}

/**
 * Flattens a React Native style prop into a single object. Style props arrive
 * as arrays of objects (RN `StyleSheet.create` is identity under the stub), and
 * later entries win, exactly as RN composes them.
 */
export function resolveStyle(node: any): StyleValue {
  const out: StyleValue = {};
  const visit = (value: unknown): void => {
    if (!value) return;
    // `Pressable` accepts `style` as a callback of the interaction state. The
    // resolved resting style is the one that governs layout width, so evaluate
    // it rather than silently measuring the button as unstyled.
    if (typeof value === "function") {
      try {
        visit((value as (state: unknown) => unknown)({ pressed: false, hovered: false }));
      } catch {
        // A state callback that needs more than the press flag cannot be
        // resolved; treat the node as unstyled rather than throwing.
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, val] of Object.entries(value as StyleValue)) {
      if (key === "shadowOffset") continue;
      // Animated values arrive wrapped as `{ value }`; unwrap the primitives
      // that participate in sizing and ignore the rest.
      if (val && typeof val === "object" && "value" in (val as StyleValue)) {
        const inner = (val as StyleValue).value;
        if (isNum(inner) || typeof inner === "string") out[key] = inner;
        continue;
      }
      out[key] = val;
    }
  };
  visit(node?.props?.style);
  return out;
}

function textChildren(node: any): string {
  const children = Array.isArray(node?.children) ? node.children : [];
  let out = "";
  for (const child of children) {
    if (typeof child === "string" || typeof child === "number") out += String(child);
    else if (child && typeof child === "object") out += textChildren(child);
  }
  return out;
}

function isTextLeaf(node: any): boolean {
  return node?.type === TEXT_NODE || typeof node?.type !== "string";
}

/**
 * Approximate advance width per character, as a fraction of `fontSize`.
 * Narrow glyphs (i/l/./,) are well under the mean, wide ones (W/M/uppercase)
 * over it, and anything non-ASCII (emoji, box-drawing, CJK) is treated as a
 * full-width cell — which is what these surfaces actually render in their
 * status chips.
 */
function charRatio(ch: string): number {
  if (ch.codePointAt(0)! > 0x2000) return 1.1;
  if ("iljtfrI.,;:'`|!()[]{} ".includes(ch)) return 0.3;
  if ("mwMW@%".includes(ch)) return 0.85;
  if (ch >= "A" && ch <= "Z") return 0.68;
  if (ch >= "0" && ch <= "9") return 0.55;
  if (ch === " ") return 0.28;
  return 0.53;
}

export function measureText(text: string, style: StyleValue): number {
  const fontSize = num(style.fontSize, 14);
  const mono = typeof style.fontFamily === "string" && /mono|Menlo|monospace/i.test(style.fontFamily);
  const letterSpacing = num(style.letterSpacing, 0);
  let width = 0;
  for (const ch of text) {
    width += mono ? fontSize * 0.6 : fontSize * charRatio(ch);
  }
  return width + letterSpacing * text.length;
}

function paddingOf(style: StyleValue): Padding {
  const left = num(style.paddingLeft, num(style.paddingHorizontal, 0));
  const right = num(style.paddingRight, num(style.paddingHorizontal, 0));
  return { left, right };
}

function borderSides(style: StyleValue): number {
  const l = num(style.borderLeftWidth, num(style.borderWidth, 0));
  const r = num(style.borderRightWidth, num(style.borderWidth, 0));
  return l + r;
}

function gapOf(style: StyleValue): number {
  return num(style.gap, 0);
}

function childNodes(node: any): any[] {
  return (Array.isArray(node?.children) ? node.children : []).filter(
    (c: unknown) => c && typeof c === "object",
  );
}

function textNodes(node: any): any[] {
  return (Array.isArray(node?.children) ? node.children : []).filter(
    (c: unknown) => typeof c === "string" || typeof c === "number",
  );
}

/** `flex: 1` expands to `1 1 0%`; an omitted `flex` leaves the Yoga defaults. */
function flexBasisIsZero(style: StyleValue): boolean {
  if (style.flexBasis === 0 || style.flexBasis === "0%") return true;
  return style.flex === 1 || style.flex === "1 1 0%" || style.flex === "1 1";
}

function flexShrinkOf(style: StyleValue): number {
  if (isNum(style.flexShrink)) return style.flexShrink;
  if (typeof style.flex === "number") return style.flex === 0 ? 0 : 1;
  if (typeof style.flex === "string" && style.flex !== "none") {
    const parts = style.flex.trim().split(/\s+/);
    return parts.length >= 2 && !isNaN(Number(parts[1])) ? Number(parts[1]) : 1;
  }
  return 0;
}

function clampByStyle(value: number, style: StyleValue): number {
  let out = value;
  if (isNum(style.minWidth)) out = Math.max(out, style.minWidth);
  if (isNum(style.maxWidth)) out = Math.min(out, style.maxWidth);
  return out;
}

/**
 * Core solver. Walks the tree computing the `minContent` width each subtree
 * insists on, honouring Yoga's no-shrink-by-default rule and the
 * `numberOfLines` escape hatch for compressible text.
 */
function measureNode(node: any): Metrics {
  const style = resolveStyle(node);
  const strings = textNodes(node);
  const children = childNodes(node);

  if (isTextLeaf(node)) {
    const text = strings.length ? strings.map(String).join("") : textChildren(node);
    const width = measureText(text, style);
    const lines = num(style.numberOfLines, num(node?.props?.numberOfLines, 0));
    // A multi-line-clamped text is bounded by its parent, so it can compress;
    // an unbounded text keeps its intrinsic width and overflows instead.
    const canCompress = lines >= 1;
    return { minContent: canCompress ? 0 : width, maxContent: width };
  }

  const pad = paddingOf(style);
  const borders = borderSides(style);
  const gap = gapOf(style);
  const isRow = style.flexDirection === "row";
  const wraps = style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse";
  const horizontalInset = pad.left + pad.right + borders;

  const childMetrics = children.map(measureNode);
  const declaredWidth = isNum(style.width) ? style.width : undefined;

  let inner: { min: number; max: number };
  if (childMetrics.length === 0) {
    inner = { min: 0, max: 0 };
  } else if (isRow) {
    const totalGap = gap * Math.max(0, childMetrics.length - 1);
    if (wraps) {
      // Lines break, so the row only needs to fit its widest child — but a
      // child that cannot compress still spills over the line.
      inner = {
        min: Math.max(...childMetrics.map((m) => m.minContent)),
        max: Math.max(...childMetrics.map((m) => m.maxContent)),
      };
    } else {
      inner = {
        min: childMetrics.reduce((acc, m) => acc + m.minContent, 0) + totalGap,
        max: childMetrics.reduce((acc, m) => acc + m.maxContent, 0) + totalGap,
      };
    }
  } else {
    inner = {
      min: Math.max(...childMetrics.map((m) => m.minContent)),
      max: Math.max(...childMetrics.map((m) => m.maxContent)),
    };
  }

  const natural = { min: inner.min + horizontalInset, max: inner.max + horizontalInset };
  const minContent = clampByStyle(
    declaredWidth !== undefined ? declaredWidth : natural.min,
    style,
  );
  const maxContent = clampByStyle(
    declaredWidth !== undefined ? declaredWidth : natural.max,
    style,
  );
  return { minContent, maxContent };
}

/**
 * The width a subtree refuses to give up: `minContent` for anything that can
 * compress, and full `maxContent` once an unshrinkable descendant is in play.
 * A parent's overflow is driven by this, not by its own `minContent`, because
 * a single unshrinkable leaf inside a shrinkable wrapper still paints outside.
 */
function insistWidth(node: any): number {
  const style = resolveStyle(node);
  const strings = textNodes(node);
  const children = childNodes(node);

  if (isTextLeaf(node)) {
    const text = strings.length ? strings.map(String).join("") : textChildren(node);
    const width = measureText(text, style);
    const lines = num(style.numberOfLines, num(node?.props?.numberOfLines, 0));
    const natural = lines >= 1 ? 0 : width;
    if (flexBasisIsZero(style) || flexShrinkOf(style) > 0) {
      // Explicitly shrinkable: bottoms out at its floor, not its text width.
      return clampByStyle(Math.min(natural, Math.max(0, isNum(style.minWidth) ? style.minWidth : 0)), style);
    }
    return clampByStyle(natural, style);
  }

  const pad = paddingOf(style);
  const borders = borderSides(style);
  const gap = gapOf(style);
  const isRow = style.flexDirection === "row";
  const wraps = style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse";
  const horizontalInset = pad.left + pad.right + borders;
  const childDemands = children.map(insistWidth);
  const totalGap = gap * Math.max(0, childDemands.length - 1);

  let demand: number;
  if (childDemands.length === 0) {
    demand = 0;
  } else if (isRow && !wraps) {
    demand = childDemands.reduce((a, b) => a + b, 0) + totalGap;
  } else {
    demand = Math.max(...childDemands) + (isRow ? totalGap : 0);
  }

  const declared = isNum(style.width) ? style.width : demand + horizontalInset;
  return clampByStyle(declared, style);
}

function nearestLabel(node: any, depth = 0): string {
  if (depth > 6) return "";
  const own = textNodes(node).map(String).join("").trim();
  if (own) return own.slice(0, 70);
  for (const child of childNodes(node)) {
    const found = nearestLabel(child, depth + 1);
    if (found) return found;
  }
  return "";
}

function describeCulprits(node: any, limit = 4): string[] {
  const out: string[] = [];
  const visit = (n: any, depth: number): void => {
    if (out.length >= limit || depth > 8) return;
    const style = resolveStyle(n);
    const strings = textNodes(n).map(String).join("").trim();
    if (isTextLeaf(n) && strings) {
      const lines = num(style.numberOfLines, num(n?.props?.numberOfLines, 0));
      if (lines < 1 && flexShrinkOf(style) === 0 && !flexBasisIsZero(style)) {
        out.push(`text "${strings.slice(0, 40)}" (no numberOfLines, flexShrink:0)`);
      }
      return;
    }
    if (isNum(style.minWidth) && style.minWidth > 0) {
      out.push(`minWidth:${style.minWidth}`);
    }
    if (isNum(style.width)) {
      out.push(`width:${style.width}`);
    }
    for (const child of childNodes(n)) visit(child, depth + 1);
  };
  for (const child of childNodes(node)) visit(child, 0);
  return out;
}

/**
 * Walks the rendered tree and reports every container whose children cannot be
 * compressed to fit inside `availableWidth`.
 *
 * `rootWidth` is the viewport the host allocates to the surface; the root
 * element is measured as if it were stretched to that width, which is how a
 * host-owned scroller hands width down to plugin content.
 */
export function findHorizontalOverflows(root: any, rootWidth: number): OverflowFinding[] {
  const findings: OverflowFinding[] = [];

  const walk = (node: any, available: number, path: string[], testID?: string): void => {
    if (!node || typeof node !== "object") return;
    const style = resolveStyle(node);
    const children = childNodes(node);
    const isRow = style.flexDirection === "row";
    const wraps = style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse";
    const pad = paddingOf(style);
    const horizontalInset = pad.left + pad.right + borderSides(style);
    const ownTestID = typeof node?.props?.testID === "string" ? node.props.testID : undefined;
    const inheritedTestID = ownTestID ?? testID;

    // The width this box actually offers its children, after its own insets.
    const contentWidth = Math.max(0, available - horizontalInset);

    if (children.length > 0) {
      const childDemands = children.map(insistWidth);
      const gap = gapOf(style) * Math.max(0, children.length - 1);
      // A non-wrapping row must fit every child side by side; a wrapping row (or
      // a column) only has to fit the single widest child.
      const demanded =
        isRow && !wraps
          ? childDemands.reduce((a, b) => a + b, 0) + gap
          : Math.max(...childDemands) + (isRow ? gap : 0);

      if (demanded > contentWidth + 0.5) {
        findings.push({
          path: path.join("/"),
          type: node.type,
          available: Math.round(contentWidth),
          demanded: Math.round(demanded),
          excess: Math.round(demanded - contentWidth),
          culprits: describeCulprits(node),
          label: nearestLabel(node),
          testID: inheritedTestID,
        });
      }
    }

    // Distribute what is left. A wrapping row packs children onto lines, so each
    // child is offered the full line width and only breaks if it cannot fit
    // alone. A non-wrapping row shares the line, weighted by how much each
    // child wants. A column hands every child the full width.
    const childCount = children.length;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      const childStyle = resolveStyle(child);
      if (isNum(childStyle.width)) continue;
      let childAvailable = contentWidth;
      if (isRow && childCount > 1 && !wraps) {
        const gaps = gapOf(style) * (childCount - 1);
        const free = Math.max(0, contentWidth - gaps);
        const weights = children.map(insistWidth);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        const share = totalWeight > 0 ? (weights[i]! / totalWeight) * free : free / childCount;
        childAvailable = flexBasisIsZero(childStyle) || flexShrinkOf(childStyle) > 0
          ? share
          : Math.max(weights[i]!, share);
      }
      walk(child, childAvailable, [...path, String(node.type)], inheritedTestID);
    }
  };

  walk(root, rootWidth, []);
  return findings;
}
