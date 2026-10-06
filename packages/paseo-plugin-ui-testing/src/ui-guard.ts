/**
 * Render-level UI guard harness — the four invariants from
 * `docs/ui-regression-guard.md`.
 *
 * `react-test-renderer` produces the real element tree and the real resolved
 * style objects but no layout pass. This module supplies the missing pass for
 * the questions that turn a layout defect into a checked property:
 *
 *   1. **Containment** — can a container's children be compressed to fit, or do
 *      they insist on more width than the viewport gives them? (`findHorizontalOverflows`)
 *   2. **Host theme only** — which color literals does the tree paint, and are
 *      they values the host supplied? (`collectColors` / `colorsOutsidePalette`)
 *   3. **Single scroll owner** — how many scroll boundaries does the tree carry,
 *      and which are the plugin's own versus the host's? (`scrollContainers`)
 *   4. **Truncation** — does text that cannot fit carry a `numberOfLines` cap,
 *      or is it an unbounded string demanding its intrinsic width? (`findUncappedText`)
 *
 * It is deliberately renderer-agnostic: it walks the plain JSON tree a renderer
 * hands back (`toJSON()`), so it works the same under vitest (with a local
 * react-native alias) and under `tsx --test` (with resolve hooks). It imports no
 * React and no react-native, so it is a pure measurement package and does not
 * pull a runtime surface into the plugins that consume it.
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
 * The *glyph metrics* are an estimate ({@link measureText} approximates advance
 * widths from a per-character-class table rather than a real font). Findings are
 * therefore reported only when the demanded width exceeds the available width —
 * a margin no plausible font correction could close — so the check cannot
 * produce false positives, only occasional false negatives on near-miss cases.
 * A green guard is necessary, not sufficient: it cannot see real font metrics,
 * animation, gesture handling, or first-paint timing. Do not over-claim it.
 */

export type StyleValue = Record<string, unknown>;

/** A container whose children cannot be compressed to fit its content box. */
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

/** A text leaf, with the line cap it was given, as the renderer saw it. */
export interface TextLeaf {
  text: string;
  /** `numberOfLines` from the prop or the resolved style, when present. */
  lines: number | undefined;
  /** The resolved `fontSize`/`fontFamily`/`letterSpacing` style, for measuring. */
  style: StyleValue;
  testID?: string;
}

/** A color value a rendered node paints, and the property it came from. */
export interface ColorUse {
  value: string;
  /** The style property, e.g. `backgroundColor`. */
  property: string;
  /** Slash-joined element types from the measured root. */
  path: string;
  testID?: string;
}

/** A scroll boundary in a rendered tree. */
export interface ScrollContainer {
  /** The node itself, for a test that wants its style. */
  readonly node: unknown;
  /** The `testID` on the scroller, when it carries one. */
  readonly testID?: string;
  /** True for the host's modal/popover body rather than a plugin `ScrollView`. */
  readonly hostOwned: boolean;
  /** Every `testID` inside this scroller, at any depth. */
  readonly encloses: string[];
}

/** How the harness recognises the plugin's and the host's scroll boundaries. */
export interface ScrollTypes {
  /** Element types a plugin `ScrollView`/`FlatList` renders to. */
  plugin?: readonly string[];
  /** Element types a host-owned modal/popover body renders to. */
  host?: readonly string[];
  /**
   * Element types the host SDK's sheet-gesture scroller renders to. That
   * `ScrollView` (from `@getpaseo/plugin/client/react-native`) wires the host's
   * bottom-sheet pan gestures; using it as the inner scroller inside a host
   * modal makes the two recognizers fight (the xpufx-org/paseo#219 class).
   */
  sheet?: readonly string[];
}

const DEFAULT_PLUGIN_SCROLL_TYPES = [
  "ScrollView",
  "mock-scroll",
  "host-scroll-view",
  "FlatList",
  "mock-flatlist",
] as const;

const DEFAULT_HOST_SCROLL_TYPES = ["mock-modal-content", "host-modal-content"] as const;

const DEFAULT_SHEET_SCROLL_TYPES = ["host-scroll-view"] as const;

/** A host sheet-gesture scroller wrongly nested inside a host modal body. */
export interface SheetScrollerFinding {
  /** The `testID` on the offending scroller, when it carries one. */
  readonly testID?: string;
  /** Slash-joined element types from the measured root. */
  readonly path: string;
  /** The host modal body it sits inside, when that body carries a `testID`. */
  readonly modalTestID?: string;
}

/** A box that is shorter than its own content — the shape that clips. */
export interface HeightClamp {
  /** The `testID` of the box that clips, when it carries one. */
  readonly testID?: string;
  /** The height the box was given. */
  readonly declared: number;
  /** The height its children need, by the same floor. */
  readonly needed: number;
}

/** Options for {@link checkInvariants}. */
export interface InvariantOptions {
  /** The viewport width the root is measured against. */
  width: number;
  /**
   * Overflow below this many pixels is treated as glyph-estimation noise. The
   * real defects measured 35–200px, so the default keeps the guard from being
   * brittle without letting a genuine overlap through.
   */
  bandPx?: number;
  /**
   * The host theme's color values. When supplied, any color the tree paints that
   * is not in this set is reported by {@link colorsOutsidePalette}.
   */
  palette?: readonly string[];
  /**
   * Expected number of plugin-owned scroll boundaries. `0` means the host owns
   * the surface's scroll; `undefined` skips the count check.
   */
  expectedScrollOwners?: number;
  /** Overrides for how scroll boundaries are detected. */
  scrollTypes?: ScrollTypes;
}

/** The four invariants, as findings rather than a single boolean. */
export interface GuardReport {
  containment: OverflowFinding[];
  colors: ColorUse[];
  scroll: ScrollContainer[];
  truncation: TextLeaf[];
  /** Host sheet scrollers nested inside a host modal body. */
  sheetScrollers: SheetScrollerFinding[];
  /** True when every checked invariant is clean. */
  ok: boolean;
}

const TEXT_NODE = "Text";

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function num(value: unknown, fallback = 0): number {
  return isNum(value) ? value : fallback;
}

interface Padding {
  left: number;
  right: number;
}

interface Metrics {
  minContent: number;
  maxContent: number;
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

function isTextLeaf(node: any): boolean {
  return node?.type === TEXT_NODE || typeof node?.type !== "string";
}

/** A renderer's `toJSON()` may return one root or an array of sibling roots. */
function toRoots(root: unknown): any[] {
  return Array.isArray(root) ? root : [root];
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

function leafText(node: any): string {
  const strings = textNodes(node);
  return strings.length ? strings.map(String).join("") : textChildren(node);
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

function lineCapOf(node: any, style: StyleValue): number | undefined {
  const prop = node?.props?.numberOfLines;
  if (typeof prop === "number") return prop;
  if (typeof style.numberOfLines === "number") return style.numberOfLines;
  return undefined;
}

/**
 * Core solver. Walks the tree computing the `minContent` width each subtree
 * insists on, honouring Yoga's no-shrink-by-default rule and the
 * `numberOfLines` escape hatch for compressible text.
 */
function measureNode(node: any): Metrics {
  const style = resolveStyle(node);
  const children = childNodes(node);

  if (isTextLeaf(node)) {
    const text = leafText(node);
    const width = measureText(text, style);
    // A multi-line-clamped text is bounded by its parent, so it can compress;
    // an unbounded text keeps its intrinsic width and overflows instead.
    const canCompress = lineCapOf(node, style) !== undefined;
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
  const children = childNodes(node);

  if (isTextLeaf(node)) {
    const text = leafText(node);
    const width = measureText(text, style);
    const natural = lineCapOf(node, style) !== undefined ? 0 : width;
    if (flexBasisIsZero(style) || flexShrinkOf(style) > 0) {
      // Explicitly shrinkable: bottoms out at its floor, not its text width.
      return clampByStyle(
        Math.min(natural, Math.max(0, isNum(style.minWidth) ? style.minWidth : 0)),
        style,
      );
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
      if (lineCapOf(n, style) === undefined && flexShrinkOf(style) === 0 && !flexBasisIsZero(style)) {
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

  for (const entry of toRoots(root)) walk(entry, rootWidth, []);
  return findings;
}

/**
 * Text leaves whose measured width exceeds the width they are given on screen
 * and which carry no `numberOfLines` cap.
 *
 * `numberOfLines` is the only escape hatch the Yoga model has for compressed
 * text (see the module header), so an uncapped leaf that demands more than its
 * box is the Class-D defect: it spills instead of ellipsizing, or it forces the
 * row wider and becomes a Class-A overflow. The measurement is the same
 * estimated glyph pass as {@link findHorizontalOverflows}, so a finding is a
 * floor, never a false positive.
 */
export function findUncappedText(root: any, rootWidth: number, bandPx = 6): TextLeaf[] {
  const findings: TextLeaf[] = [];

  const walk = (node: any, available: number, testID?: string): void => {
    if (!node || typeof node !== "object") return;
    const style = resolveStyle(node);
    const ownTestID = typeof node?.props?.testID === "string" ? node.props.testID : undefined;
    const inheritedTestID = ownTestID ?? testID;
    const pad = paddingOf(style);
    const contentWidth = Math.max(0, available - pad.left - pad.right - borderSides(style));

    if (isTextLeaf(node)) {
      const text = leafText(node).replace(/\s+/g, " ").trim();
      if (!text) return;
      const lines = lineCapOf(node, style);
      if (lines !== undefined) return;
      if (measureText(text, style) > contentWidth + bandPx) {
        findings.push({ text, lines, style, testID: inheritedTestID });
      }
      return;
    }

    const children = childNodes(node);
    const isRow = style.flexDirection === "row";
    const wraps = style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse";
    const childCount = children.length;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      const childStyle = resolveStyle(child);
      if (isNum(childStyle.width)) {
        walk(child, childStyle.width, inheritedTestID);
        continue;
      }
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
      walk(child, childAvailable, inheritedTestID);
    }
  };

  for (const entry of toRoots(root)) walk(entry, rootWidth);
  return findings;
}

/** Every text leaf in the tree, flattened and whitespace-normalised. */
export function collectTextLeaves(root: any): TextLeaf[] {
  const found: TextLeaf[] = [];
  const walk = (node: any, testID?: string): void => {
    if (!node || typeof node !== "object") return;
    const ownTestID = typeof node?.props?.testID === "string" ? node.props.testID : undefined;
    const inheritedTestID = ownTestID ?? testID;
    if (isTextLeaf(node)) {
      const text = leafText(node).replace(/\s+/g, " ").trim();
      if (text) {
        const style = resolveStyle(node);
        found.push({ text, lines: lineCapOf(node, style), style, testID: inheritedTestID });
      }
      return;
    }
    for (const child of childNodes(node)) walk(child, inheritedTestID);
  };
  for (const entry of toRoots(root)) walk(entry);
  return found;
}

const COLOR_PROPERTIES = [
  "color",
  "backgroundColor",
  "borderColor",
  "borderTopColor",
  "borderBottomColor",
  "borderLeftColor",
  "borderRightColor",
  "borderStartColor",
  "borderEndColor",
  "tintColor",
  "shadowColor",
  "textDecorationColor",
  "outlineColor",
];

/**
 * Every color value the tree paints, with the property and node it came from.
 * Style props are resolved with the same flattening as layout, so an array
 * style contributes each of its color properties once.
 */
export function collectColors(root: any): ColorUse[] {
  const found: ColorUse[] = [];
  const walk = (node: any, path: string[], testID?: string): void => {
    if (!node || typeof node !== "object") return;
    const style = resolveStyle(node);
    const ownTestID = typeof node?.props?.testID === "string" ? node.props.testID : undefined;
    const inheritedTestID = ownTestID ?? testID;
    const nodePath = [...path, String(node.type)];
    for (const property of COLOR_PROPERTIES) {
      const value = style[property];
      if (typeof value === "string" && value) {
        found.push({ value, property, path: nodePath.join("/"), testID: inheritedTestID });
      }
    }
    for (const child of childNodes(node)) walk(child, nodePath, inheritedTestID);
  };
  for (const entry of toRoots(root)) walk(entry, []);
  return found;
}

/** Colors that are deliberately not from the theme, so they are never flagged. */
const COLOR_ESCAPES = new Set(["transparent", "none", "inherit", "currentcolor", "unset"]);

/** Hex is case-insensitive; compare lowercase with the leading `#` preserved. */
function normaliseColor(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Is `value` a palette token, or a palette token with an alpha channel?
 *
 * React Native spells a translucent color as `#rrggbbaa`, and surfaces build
 * tone washes by appending an alpha byte to a palette hex (`#5aa2ff2e`). Those
 * are still theme-derived, so they must not be reported as raw literals. Solid
 * `#rrggbb`, `#rgb`, and the alpha forms of each are accepted.
 */
function isPaletteColor(value: string, known: Set<string>): boolean {
  const v = normaliseColor(value);
  if (known.has(v)) return true;
  if (/^#[0-9a-f]{8}$/.test(v) && known.has(v.slice(0, 7))) return true;
  if (/^#[0-9a-f]{4}$/.test(v)) {
    const [r, g, b] = [v[1], v[2], v[3]];
    return known.has(`#${r}${r}${g}${g}${b}${b}`);
  }
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return known.has(`#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`);
  }
  return false;
}

/**
 * Colors the tree paints that are not values from the supplied host palette.
 *
 * This is the render-level half of the host-theme invariant: if a surface reads
 * only `theme.colors.*`, every color it emits is a palette value. A hardcoded
 * dark fallback shows up here as a value the palette does not contain. Pair it
 * with a second render under a sentinel palette so a surface that never changes
 * color between light and dark is caught too — a static dark tree under a light
 * host fails this check on its own because the fallback is not in the palette.
 */
export function colorsOutsidePalette(root: any, palette: readonly string[]): ColorUse[] {
  const known = new Set(palette.map(normaliseColor));
  return collectColors(root).filter(
    (use) => !COLOR_ESCAPES.has(normaliseColor(use.value)) && !isPaletteColor(use.value, known),
  );
}

/** Every scroll boundary in the tree, outermost first. */
export function scrollContainers(root: any, types: ScrollTypes = {}): ScrollContainer[] {
  const pluginTypes = new Set(types.plugin ?? DEFAULT_PLUGIN_SCROLL_TYPES);
  const hostTypes = new Set(types.host ?? DEFAULT_HOST_SCROLL_TYPES);
  const found: ScrollContainer[] = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    const type = typeof node.type === "string" ? node.type : undefined;
    const hostOwned = type !== undefined && hostTypes.has(type) && node.props?.scrollable === true;
    if ((type !== undefined && pluginTypes.has(type)) || hostOwned) {
      const encloses: string[] = [];
      for (const child of Array.isArray(node.children) ? node.children : []) {
        collectTestIDs(child, encloses);
      }
      found.push({
        node,
        testID: typeof node.props?.testID === "string" ? node.props.testID : undefined,
        hostOwned,
        encloses,
      });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) walk(child);
  };
  for (const entry of toRoots(root)) walk(entry);
  return found;
}

/**
 * Host sheet-gesture scrollers rendered inside a host modal body.
 *
 * The host SDK's `ScrollView` is deliberately gesture-aware ("the host's sheet
 * gestures when rendered inside a sheet"). When the plugin is the scroll owner
 * inside a host modal body (`<Modal.Content scrollable={false}>`), that scroller
 * fights the modal's own pan recognizer — the xpufx-org/paseo#219 class the
 * operator hit on the MCP pill. The inner scroller must be a plain React Native
 * `ScrollView` instead.
 *
 * Detection is by element type, so the plugin's test host must render the host
 * SDK scroller as a distinct element from plain RN. When a host stub folds both
 * onto one type the check cannot see the difference and reports nothing; that is
 * a known blind spot, documented rather than faked.
 */
export function sheetScrollersInsideModal(
  root: any,
  types: ScrollTypes = {},
): SheetScrollerFinding[] {
  const hostTypes = new Set(types.host ?? DEFAULT_HOST_SCROLL_TYPES);
  const sheetTypes = new Set(types.sheet ?? DEFAULT_SHEET_SCROLL_TYPES);
  const found: SheetScrollerFinding[] = [];
  const walk = (node: any, path: string[], insideModal: boolean, modalTestID: string | undefined): void => {
    if (!node || typeof node !== "object") return;
    const type = typeof node.type === "string" ? node.type : undefined;
    const ownTestID = typeof node.props?.testID === "string" ? node.props.testID : undefined;
    const nodePath = [...path, String(node.type)];
    const isModal = type !== undefined && hostTypes.has(type);
    const inModal = isModal || insideModal;
    if (inModal && type !== undefined && sheetTypes.has(type)) {
      found.push({ testID: ownTestID, path: nodePath.join("/"), modalTestID });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      walk(child, nodePath, inModal, isModal ? ownTestID : modalTestID);
    }
  };
  for (const entry of toRoots(root)) walk(entry, [], false, undefined);
  return found;
}

function collectTestIDs(node: unknown, out: string[]): void {
  if (!node || typeof node !== "object") return;
  const typed = node as { props?: Record<string, unknown>; children?: unknown };
  if (typeof typed.props?.testID === "string") out.push(typed.props.testID);
  for (const child of Array.isArray(typed.children) ? typed.children : []) collectTestIDs(child, out);
}

function childrenFloor(node: any, style: StyleValue): number {
  const children = childNodes(node);
  if (children.length === 0) return 0;
  const heights = children.map(floorHeight);
  if (style.flexDirection === "row") return Math.max(...heights);
  return heights.reduce((a, b) => a + b, 0) + num(style.gap, 0) * (children.length - 1);
}

/** Height of one rendered node, as a floor (one line per text leaf). */
function floorHeight(node: any): number {
  const style = resolveStyle(node);

  if (isTextLeaf(node)) {
    return Math.max(0, num(style.fontSize, 14));
  }

  const composed = childrenFloor(node, style);
  const vertical = num(style.paddingVertical, 0);
  const top = num(style.paddingTop, vertical);
  const bottom = num(style.paddingBottom, vertical);
  const borders = num(style.borderTopWidth, num(style.borderWidth, 0)) + num(style.borderBottomWidth, 0);
  const margins = num(style.marginTop, 0) + num(style.marginBottom, num(style.marginVertical, 0));
  const natural = composed + top + bottom + borders + margins;
  const declared = Math.max(num(style.height, 0), num(style.minHeight, 0));
  return Math.max(natural, declared);
}

/**
 * The fewest pixels of height `root` can occupy, ignoring how far its text
 * wraps. A floor: it can only under-report, so a floor that exceeds a pane is
 * sound proof that the content does not fit.
 */
export function contentHeightFloor(root: unknown): number {
  if (!root || typeof root !== "object") return 0;
  return Math.round(floorHeight(root));
}

/**
 * Boxes that are shorter than their own content — the shape that clips instead
 * of scrolling. The floor under-counts wrapped text, so this can only miss a
 * clamp, never invent one.
 */
export function heightClamps(root: unknown): HeightClamp[] {
  const found: HeightClamp[] = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== "object" || isTextLeaf(node)) return;
    if (childNodes(node).length > 0) {
      const style = resolveStyle(node);
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
  for (const entry of toRoots(root)) walk(entry);
  return found;
}

/**
 * Runs the four invariants over a rendered tree and returns every finding at
 * once, so a census sees all of them rather than the first one that fails.
 *
 * `ok` is the conjunction: containment clean, no colors outside the palette
 * (when one is supplied), truncation clean, and the plugin scroll-owner count
 * matching (when one is supplied).
 */
export function checkInvariants(root: any, options: InvariantOptions): GuardReport {
  const band = options.bandPx ?? 6;
  const containment = findHorizontalOverflows(root, options.width).filter((f) => f.excess > band);
  const colors = options.palette ? colorsOutsidePalette(root, options.palette) : [];
  const scroll = scrollContainers(root, options.scrollTypes);
  const truncation = findUncappedText(root, options.width, band);
  const sheetScrollers = sheetScrollersInsideModal(root, options.scrollTypes);
  const owners = scroll.filter((container) => !container.hostOwned);
  const scrollOk = options.expectedScrollOwners === undefined || owners.length === options.expectedScrollOwners;
  return {
    containment,
    colors,
    scroll,
    truncation,
    sheetScrollers,
    ok:
      containment.length === 0 &&
      colors.length === 0 &&
      truncation.length === 0 &&
      sheetScrollers.length === 0 &&
      scrollOk,
  };
}
