/**
 * Text-run splitting for search highlighting, shared by every helper surface
 * that paints matched query text and by the forges search surfaces that scroll
 * to a match. A query is matched literally via `indexOf` on lowercased strings —
 * never compiled as a regular expression — so user input cannot inject a
 * pattern.
 *
 * Remote forge search is fuzzy: a returned issue may match a query it does not
 * contain verbatim. When the literal query is absent the splitter highlights
 * the query's multi-character tokens at word starts, so a fuzzy result still
 * reads. Callers on a single primary label may additionally opt into marking
 * the whole field when not even a token hits (`fallbackToWholeField`); callers
 * that paint many small runs leave it off. `hasFuzzyHighlight` is the
 * whole-surface test for go-to-match.
 */

export interface HighlightPart {
  /** The run's source text, in its original casing. */
  text: string;
  /** True when this run is an occurrence of the (trimmed) query. */
  matched: boolean;
}

const TOKEN_PATTERN = /[^\p{L}\p{N}]+/u;

export interface HighlightOptions {
  /**
   * When true and neither a literal nor a token hit exists, the whole text is
   * returned as a single matched run so a fuzzy search result is still visibly
   * marked. Off by default: callers that paint many small runs (label chips,
   * markdown spans) must not light every one of them up.
   */
  fallbackToWholeField?: boolean;
}

/**
 * Query pieces used for the token fallback. A query with no literal hit is
 * split on non-alphanumeric boundaries; single-character tokens are dropped so
 * a fuzzy query cannot paint a stray letter in every result.
 */
function queryTokens(needle: string): string[] {
  return needle.split(TOKEN_PATTERN).filter((token) => token.length >= 2);
}

/** True when `index` begins a word (a word-start query token may prefix it). */
function isWordStartAt(haystack: string, index: number): boolean {
  return index === 0 || TOKEN_PATTERN.test(haystack[index - 1]);
}

/** Earliest word-start occurrence of `token` in `haystack` at or after `from`. */
function firstTokenStart(haystack: string, token: string, from: number): number {
  let index = haystack.indexOf(token, from);
  while (index !== -1) {
    if (isWordStartAt(haystack, index)) return index;
    index = haystack.indexOf(token, index + 1);
  }
  return -1;
}

/**
 * Split `text` into alternating unmatched/matched runs for every
 * case-insensitive occurrence of `query`. Surrounding whitespace on the query
 * is ignored; an empty or whitespace-only query (or empty text) yields the
 * whole text as a single unmatched run.
 *
 * When the literal query is absent the splitter highlights the query's
 * multi-character tokens at word starts. If no token hits either, the text is
 * left unmatched unless the caller opted into `fallbackToWholeField`, which
 * marks the whole field so a fuzzy result is never silently unmarked.
 */
export function splitHighlightParts(
  text: string,
  query: string,
  options: HighlightOptions = {},
): HighlightPart[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return [{ text, matched: false }];
  const haystack = text.toLowerCase();
  if (haystack.includes(needle)) return splitLiteralParts(text, haystack, needle);
  const tokens = queryTokens(needle);
  const tokenParts = tokens.length ? splitTokenParts(text, haystack, tokens) : null;
  if (tokenParts) return tokenParts;
  // Whole-field fallback: a fuzzy result may match on text the query never
  // contains, so paint the field rather than leave the row unmarked.
  return options.fallbackToWholeField ? [{ text, matched: true }] : [{ text, matched: false }];
}

/** Runs for every non-overlapping literal occurrence of `needle`. */
function splitLiteralParts(text: string, haystack: string, needle: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const hit = haystack.indexOf(needle, cursor);
    if (hit === -1) {
      parts.push({ text: text.slice(cursor), matched: false });
      break;
    }
    if (hit > cursor) parts.push({ text: text.slice(cursor, hit), matched: false });
    parts.push({ text: text.slice(hit, hit + needle.length), matched: true });
    cursor = hit + needle.length;
  }
  return parts.length > 0 ? parts : [{ text, matched: false }];
}

/**
 * Runs matching any `token` beginning at a word boundary, so a fuzzy query
 * paints the token that prefixes a word (`meta` inside `metadata`) and never a
 * fragment mid-word (`eta` inside `metadata`). The longest token wins a shared
 * start; ties fall to the earliest occurrence. Returns null when no token is
 * found, letting the caller apply its whole-field policy.
 */
function splitTokenParts(
  text: string,
  haystack: string,
  tokens: string[],
): HighlightPart[] | null {
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  const parts: HighlightPart[] = [];
  let matchedAny = false;
  let cursor = 0;
  while (cursor < text.length) {
    let best: { index: number; token: string } | null = null;
    for (const token of sorted) {
      const index = firstTokenStart(haystack, token, cursor);
      if (index === -1) continue;
      if (best === null || index < best.index) best = { index, token };
    }
    if (best === null) {
      parts.push({ text: text.slice(cursor), matched: false });
      break;
    }
    if (best.index > cursor) parts.push({ text: text.slice(cursor, best.index), matched: false });
    parts.push({ text: text.slice(best.index, best.index + best.token.length), matched: true });
    matchedAny = true;
    cursor = best.index + best.token.length;
  }
  return matchedAny ? parts : null;
}

/**
 * Whether `text` contains the literal trimmed query (case-insensitively) —
 * the precise, pre-fuzzy test callers use to tell a true hit from the token
 * fallback.
 */
export function hasHighlightMatch(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle.length > 0 && text.toLowerCase().includes(needle);
}

/**
 * Whether `text` highlights at all for the trimmed `query`: a literal hit or,
 * failing that, a word-start hit for any of the query's multi-character tokens.
 * Unlike `splitHighlightParts` this never reports the whole-field fallback, so
 * it pinpoints the result/section that genuinely mentions a fuzzy query rather
 * than every field.
 */
export function hasFuzzyHighlight(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return false;
  const haystack = text.toLowerCase();
  if (haystack.includes(needle)) return true;
  return queryTokens(needle).some((token) => firstTokenStart(haystack, token, 0) !== -1);
}
