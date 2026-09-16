/**
 * Text-run splitting for search highlighting, shared by every helper surface
 * that paints matched query text. The query is matched literally via
 * `indexOf` on lowercased strings — never compiled as a regular expression — so
 * user input cannot inject a pattern.
 */

export interface HighlightPart {
  /** The run's source text, in its original casing. */
  text: string;
  /** True when this run is an occurrence of the (trimmed) query. */
  matched: boolean;
}

/**
 * Split `text` into alternating unmatched/matched runs for every
 * case-insensitive, non-overlapping occurrence of `query`. Surrounding
 * whitespace on the query is ignored; an empty or whitespace-only query (or
 * empty text) yields the whole text as a single unmatched run.
 */
export function splitHighlightParts(text: string, query: string): HighlightPart[] {
  const needle = query.trim().toLowerCase();
  if (!needle || !text) return [{ text, matched: false }];
  const haystack = text.toLowerCase();
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

/** Whether `text` contains at least one occurrence of the trimmed `query`. */
export function hasHighlightMatch(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle.length > 0 && text.toLowerCase().includes(needle);
}
