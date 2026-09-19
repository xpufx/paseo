import { describe, it, expect } from "vitest";
import {
  hasFuzzyHighlight,
  hasHighlightMatch,
  normalizeSearchQuery,
  splitHighlightParts,
} from "../shared/highlight.js";

describe("splitHighlightParts", () => {
  it("splits every case-insensitive occurrence and preserves source casing", () => {
    expect(splitHighlightParts("Fix Fixer FIX", "fix")).toEqual([
      { text: "Fix", matched: true },
      { text: " ", matched: false },
      { text: "Fix", matched: true },
      { text: "er ", matched: false },
      { text: "FIX", matched: true },
    ]);
  });

  it("matches adjacent occurrences without dropping a run", () => {
    expect(splitHighlightParts("aaaa", "aa")).toEqual([
      { text: "aa", matched: true },
      { text: "aa", matched: true },
    ]);
  });

  it("treats the query literally, never as a regular expression", () => {
    expect(splitHighlightParts("a.b axb", "a.b")).toEqual([
      { text: "a.b", matched: true },
      { text: " axb", matched: false },
    ]);
    expect(splitHighlightParts("cost is $5 (net)", "$5 (")).toEqual([
      { text: "cost is ", matched: false },
      { text: "$5 (", matched: true },
      { text: "net)", matched: false },
    ]);
  });

  it("returns the whole text unmatched for an empty or whitespace query", () => {
    expect(splitHighlightParts("hello", "")).toEqual([{ text: "hello", matched: false }]);
    expect(splitHighlightParts("hello", "   ")).toEqual([{ text: "hello", matched: false }]);
  });

  it("trims the query and handles empty text", () => {
    expect(splitHighlightParts("Bug", " bug ")).toEqual([{ text: "Bug", matched: true }]);
    expect(splitHighlightParts("", "bug")).toEqual([{ text: "", matched: false }]);
  });

  it("highlights word-start tokens when the literal query is absent", () => {
    // The phrase `meta-analysis` is not a literal substring of the text, but
    // both tokens start words, so each is painted.
    expect(splitHighlightParts("metadata analysis", "meta-analysis")).toEqual([
      { text: "meta", matched: true },
      { text: "data ", matched: false },
      { text: "analysis", matched: true },
    ]);
  });

  it("highlights a token that fills the whole field", () => {
    // A single matched run must not be mistaken for "no match".
    expect(splitHighlightParts("analysis", "meta-analysis")).toEqual([
      { text: "analysis", matched: true },
    ]);
  });

  it("leaves the text unmatched when nothing tokenizes to a hit", () => {
    // Default: small fields (label chips, body spans) must not all light up.
    // `eta` occurs only mid-word and `zzz` is absent, so nothing is painted.
    expect(splitHighlightParts("metadata", "eta-zzz")).toEqual([
      { text: "metadata", matched: false },
    ]);
    expect(splitHighlightParts("Bug", "feature")).toEqual([
      { text: "Bug", matched: false },
    ]);
  });

  it("strips surrounding quotes so quoted and unquoted queries match alike", () => {
    expect(splitHighlightParts("read the metadata now", '"meta"')).toEqual([
      { text: "read the ", matched: false },
      { text: "meta", matched: true },
      { text: "data now", matched: false },
    ]);
    expect(splitHighlightParts("read the metadata now", "'meta'")).toEqual(
      splitHighlightParts("read the metadata now", "meta"),
    );
    expect(splitHighlightParts("Fix the Fixer", ' "fix" ')).toEqual([
      { text: "Fix", matched: true },
      { text: " the ", matched: false },
      { text: "Fix", matched: true },
      { text: "er", matched: false },
    ]);
  });

  it("falls back to the whole field only when opted in", () => {
    // A fuzzy result may match on text the query never contains; the primary
    // label opts in so the row still reads as matched.
    expect(splitHighlightParts("Bug", "feature", { fallbackToWholeField: true })).toEqual([
      { text: "Bug", matched: true },
    ]);
    expect(splitHighlightParts("café", "xyz", { fallbackToWholeField: true })).toEqual([
      { text: "café", matched: true },
    ]);
  });
});

describe("hasHighlightMatch", () => {
  it("keeps the literal, case-insensitive contract", () => {
    expect(hasHighlightMatch("Fix the FIXER", "fix")).toBe(true);
    expect(hasHighlightMatch("a.b", "a.b")).toBe(true);
    expect(hasHighlightMatch("axb", "a.b")).toBe(false);
    expect(hasHighlightMatch("anything", "  ")).toBe(false);
    // A fuzzy token hit is not a literal substring.
    expect(hasHighlightMatch("bug report", "bug-typo")).toBe(false);
    // Surrounding quotes are stripped for the local literal test.
    expect(hasHighlightMatch("read the metadata", '"meta"')).toBe(true);
    expect(hasHighlightMatch("read the metadata", "'meta'")).toBe(true);
  });
});

describe("normalizeSearchQuery", () => {
  it("trims and peels matching surrounding quotes", () => {
    expect(normalizeSearchQuery('  "meta"  ')).toBe("meta");
    expect(normalizeSearchQuery("'meta'")).toBe("meta");
    expect(normalizeSearchQuery('""meta""')).toBe("meta");
    expect(normalizeSearchQuery("meta")).toBe("meta");
    expect(normalizeSearchQuery("  ")).toBe("");
  });

  it("leaves lone quotes, mismatched pairs, and inner quotes intact", () => {
    expect(normalizeSearchQuery('"meta')).toBe('"meta');
    expect(normalizeSearchQuery("meta'")).toBe("meta'");
    expect(normalizeSearchQuery("\"me'ta\"")).toBe("me'ta");
  });
});

describe("hasFuzzyHighlight", () => {
  it("matches a token at a word start but not mid-word", () => {
    expect(hasFuzzyHighlight("metadata analysis", "meta-analysis")).toBe(true);
    expect(hasFuzzyHighlight("metadata", "eta-zzz")).toBe(false);
  });

  it("treats a quoted query like its unquoted form", () => {
    expect(hasFuzzyHighlight("metadata", '"meta"')).toBe(true);
    expect(hasFuzzyHighlight("metadata", "'meta'")).toBe(true);
    expect(hasFuzzyHighlight("metadata", '"zzz"')).toBe(false);
  });

  it("prefers a literal hit and ignores whole-field fallback", () => {
    expect(hasFuzzyHighlight("a.b", "a.b")).toBe(true);
    expect(hasFuzzyHighlight("Bug", "feature")).toBe(false);
    expect(hasFuzzyHighlight("anything", "  ")).toBe(false);
  });
});
