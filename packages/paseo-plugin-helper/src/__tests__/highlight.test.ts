import { describe, it, expect } from "vitest";
import { hasHighlightMatch, splitHighlightParts } from "../shared/highlight.js";

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

  it("returns no match run when the query is absent", () => {
    expect(splitHighlightParts("Bug", "feature")).toEqual([{ text: "Bug", matched: false }]);
  });
});

describe("hasHighlightMatch", () => {
  it("mirrors the splitter's literal, case-insensitive contract", () => {
    expect(hasHighlightMatch("Fix the FIXER", "fix")).toBe(true);
    expect(hasHighlightMatch("a.b", "a.b")).toBe(true);
    expect(hasHighlightMatch("axb", "a.b")).toBe(false);
    expect(hasHighlightMatch("anything", "  ")).toBe(false);
  });
});
