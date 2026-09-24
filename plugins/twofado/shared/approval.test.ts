import { describe, expect, it } from "vitest";
import {
  approvalSelect,
  approvalStatus,
  isAskPetition,
  isNotifyPetition,
  pendingList,
  recentList,
} from "./approval";

describe("ask petition schema", () => {
  it("parses an ask pending item with question, options and flags", () => {
    const parsed = pendingList.output.parse({
      items: [
        {
          id: "abc123",
          argv: [],
          host: "ubuntu",
          caller: "1001",
          cwd: "/srv",
          expiresIn: 90,
          kind: "ask",
          question: "Which wire format?",
          options: [
            { id: "0", label: "Envelope v5" },
            { id: "1", label: "Peer-RPC seen-id LRU" },
          ],
          multiSelect: true,
          allowWriteIn: true,
          recommendedIndex: 2,
        },
      ],
    });
    const item = parsed.items[0];
    expect(item.kind).toBe("ask");
    expect(item.question).toBe("Which wire format?");
    expect(item.options?.map((option) => option.label)).toEqual([
      "Envelope v5",
      "Peer-RPC seen-id LRU",
    ]);
    expect(item.multiSelect).toBe(true);
    expect(item.allowWriteIn).toBe(true);
    expect(item.recommendedIndex).toBe(2);
  });

  it("keeps legacy exec items valid without ask fields", () => {
    const parsed = pendingList.output.parse({
      items: [
        {
          id: "exec1",
          argv: ["rm", "-rf", "/tmp/x"],
          host: "ubuntu",
          caller: "1001",
          cwd: "/srv",
          expiresIn: 30,
        },
      ],
    });
    expect(parsed.items[0].step).toBe("initial");
    expect(parsed.items[0].options).toBeUndefined();
    expect(parsed.items[0].question).toBeUndefined();
  });

  it("carries selection state through recent and status payloads", () => {
    const recent = recentList.output.parse({
      items: [
        {
          id: "abc123",
          argv: [],
          cwd: "/srv",
          decision: "select",
          by: "paseo",
          exit: -1,
          output: "",
          kind: "ask",
          question: "Which wire format?",
          options: [{ id: "1", label: "Envelope v5" }],
          selection: "Envelope v5",
          selectionIdx: 1,
        },
      ],
    });
    expect(recent.items[0].selection).toBe("Envelope v5");
    expect(recent.items[0].selectionIdx).toBe(1);

    const status = approvalStatus.output.parse({
      id: "abc123",
      status: "selected",
      exit: -1,
      kind: "ask",
      selection: "Envelope v5",
      selectionIdx: 1,
    });
    expect(status.status).toBe("selected");
  });

  it("accepts the terminal ask statuses the daemon reports", () => {
    for (const value of ["selected", "cancelled"] as const) {
      expect(approvalStatus.output.parse({ id: "x", status: value, exit: -1 }).status).toBe(value);
    }
  });

  it("classifies petition kinds consistently", () => {
    expect(isAskPetition("ask")).toBe(true);
    expect(isAskPetition("notify")).toBe(false);
    expect(isAskPetition(undefined)).toBe(false);
    expect(isNotifyPetition("notify")).toBe(true);
    expect(isNotifyPetition("ask")).toBe(false);
  });
});

describe("approvalSelect contract", () => {
  it("requires a non-empty id and selection", () => {
    expect(() => approvalSelect.input.parse({ id: "", selection: "x" })).toThrow();
    expect(() => approvalSelect.input.parse({ id: "abc", selection: "" })).toThrow();
  });

  it("accepts an indexed single-select answer", () => {
    const parsed = approvalSelect.input.parse({
      id: "abc",
      selection: "Envelope v5",
      selectionIdx: 1,
    });
    expect(parsed.selectionIdx).toBe(1);
    expect(parsed.writeIn).toBeUndefined();
  });

  it("accepts a write-in answer without an index", () => {
    const parsed = approvalSelect.input.parse({
      id: "abc",
      selection: "use a signed envelope instead",
      writeIn: true,
    });
    expect(parsed.selectionIdx).toBeUndefined();
    expect(parsed.writeIn).toBe(true);
  });

  it("reports selected and optional error on output", () => {
    expect(approvalSelect.output.parse({ selected: true }).selected).toBe(true);
    expect(approvalSelect.output.parse({ selected: false, error: "unknown-request" }).error).toBe(
      "unknown-request",
    );
  });
});
