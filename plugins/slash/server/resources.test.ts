import { describe, expect, it } from "vitest";
import { KNOWN_OPEN_TARGETS, operationsListRpc } from "../shared/resources";
import { allowedOperations, handleListOperations } from "./resources";

describe("handleListOperations", () => {
  it("returns the allowlisted rpc operations and the curated open targets", async () => {
    const result = await handleListOperations();
    expect(result.rpc).toEqual(await allowedOperations());
    expect(result.open).toEqual(KNOWN_OPEN_TARGETS);
    expect(operationsListRpc.output.parse(result)).toEqual(result);
  });

  it("returns copies so callers cannot mutate the shared lists", async () => {
    const result = await handleListOperations();
    expect(result.open).not.toBe(KNOWN_OPEN_TARGETS);
  });

  it("includes agent-mux operations in allowed operations", async () => {
    const ops = await allowedOperations();
    expect(ops).toContain("slash.agent-mux.status");
    expect(ops).toContain("slash.agent-mux.probe");
    expect(ops).toContain("slash.agent-mux.cooldowns");
  });
});

