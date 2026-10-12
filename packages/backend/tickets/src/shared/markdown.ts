export type MarkdownLiteSpan =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; url: string };

export type MarkdownLiteBlock =
  | { kind: "paragraph"; spans: MarkdownLiteSpan[] }
  | { kind: "heading"; level: 1 | 2 | 3; spans: MarkdownLiteSpan[] }
  | { kind: "list"; ordered: boolean; items: MarkdownLiteSpan[][] }
  | { kind: "code"; text: string; language?: string };

const INLINE_PATTERN =
  /(`[^`]+`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)/g;

export function parseMarkdownLiteInline(text: string): MarkdownLiteSpan[] {
  if (!text) return [];
  const spans: MarkdownLiteSpan[] = [];
  let cursor = 0;
  INLINE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) {
      spans.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    if (match[1]) {
      spans.push({ kind: "code", text: match[1].slice(1, -1) });
    } else if (match[2]) {
      spans.push({ kind: "link", text: match[3], url: match[4] });
    } else if (match[5]) {
      spans.push({ kind: "bold", text: match[6] });
    } else if (match[7]) {
      spans.push({ kind: "bold", text: match[8] });
    } else if (match[9]) {
      spans.push({ kind: "italic", text: match[10] });
    } else if (match[11]) {
      spans.push({ kind: "italic", text: match[12] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    spans.push({ kind: "text", text: text.slice(cursor) });
  }
  return spans.filter((span) => {
    if (span.kind === "link") return span.text.length > 0 && span.url.length > 0;
    return span.text.length > 0;
  });
}

const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*$/;
const UNORDERED_PATTERN = /^\s*[-*]\s+(.+)$/;
const ORDERED_PATTERN = /^\s*\d+[.)]\s+(.+)$/;
const FENCE_PATTERN = /^\s*```\s*([A-Za-z0-9_+-]*)\s*$/;

export function parseMarkdownLite(body: string | undefined | null): MarkdownLiteBlock[] {
  if (!body || typeof body !== "string") return [];
  const blocks: MarkdownLiteBlock[] = [];
  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("\n").trim();
    paragraph.length = 0;
    if (!text) return;
    blocks.push({ kind: "paragraph", spans: parseMarkdownLiteInline(text) });
  };
  const closeList = (list: MarkdownLiteBlock | null) => {
    if (list && list.kind === "list" && list.items.length > 0) blocks.push(list);
  };
  let openList: MarkdownLiteBlock | null = null;
  let fenceLanguage: string | undefined;
  let fenceLines: string[] | null = null;
  for (const rawLine of body.split(/\r?\n/)) {
    const fence = FENCE_PATTERN.exec(rawLine);
    if (fence) {
      if (fenceLines == null) {
        flushParagraph();
        closeList(openList);
        openList = null;
        fenceLanguage = fence[1] || undefined;
        fenceLines = [];
      } else {
        blocks.push({
          kind: "code",
          text: fenceLines.join("\n").replace(/\n$/, ""),
          ...(fenceLanguage ? { language: fenceLanguage } : {}),
        });
        fenceLanguage = undefined;
        fenceLines = null;
      }
      continue;
    }
    if (fenceLines != null) {
      fenceLines.push(rawLine);
      continue;
    }
    if (!rawLine.trim()) {
      flushParagraph();
      closeList(openList);
      openList = null;
      continue;
    }
    const heading = HEADING_PATTERN.exec(rawLine);
    if (heading) {
      flushParagraph();
      closeList(openList);
      openList = null;
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        spans: parseMarkdownLiteInline(heading[2]),
      });
      continue;
    }
    const unordered = UNORDERED_PATTERN.exec(rawLine);
    const ordered = unordered ? null : ORDERED_PATTERN.exec(rawLine);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = !unordered;
      const content = (unordered?.[1] ?? ordered?.[1] ?? "").trim();
      if (!content) continue;
      if (!openList || openList.kind !== "list" || openList.ordered !== isOrdered) {
        closeList(openList);
        openList = { kind: "list", ordered: isOrdered, items: [] };
      }
      (openList as { kind: "list"; ordered: boolean; items: MarkdownLiteSpan[][] }).items.push(
        parseMarkdownLiteInline(content),
      );
      continue;
    }
    closeList(openList);
    openList = null;
    paragraph.push(rawLine);
  }
  if (fenceLines != null) {
    blocks.push({
      kind: "code",
      text: fenceLines.join("\n").replace(/\n$/, ""),
      ...(fenceLanguage ? { language: fenceLanguage } : {}),
    });
  }
  flushParagraph();
  closeList(openList);
  return blocks;
}
