import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("./x-comms-conversation.tsx", import.meta.url), "utf8");

describe("new conversation picker", () => {
  it("uses the host modal scroller and semantic pressable rows", () => {
    assert.match(source, /<ModalContent[^>]*size="large"/);
    assert.match(source, /accessibilityLabel=\{`Start a conversation with \$\{configuredAgent\.name\}/);
    assert.match(source, /accessibilityLabel=\{`Start a conversation with \$\{a\.name\}/);
    assert.equal((source.match(/accessibilityRole="button"/g) ?? []).length >= 2, true);
  });
});
