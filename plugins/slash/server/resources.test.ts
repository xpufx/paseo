import { describe, expect, it } from "vitest";
import { KNOWN_OPEN_TARGETS, operationsListRpc } from "../shared/resources";
import { allowedOperations, handleListOperations } from "./resources";

describe("handleListOperations", () => {
  it("returns the allowlisted rpc operations and the curated open targets", () => {
    const result = handleListOperations();
    expect(result.rpc).toEqual(allowedOperations());
    expect(result.open).toEqual(KNOWN_OPEN_TARGETS);
    expect(operationsListRpc.output.parse(result)).toEqual(result);
  });

  it("returns copies so callers cannot mutate the shared lists", () => {
    const result = handleListOperations();
    expect(result.open).not.toBe(KNOWN_OPEN_TARGETS);
  });
});
