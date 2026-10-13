import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "test";
}

import { uppidiFleetSettingsSchema } from "../contracts.js";

describe("uppidiFleetSettingsSchema – providerConcurrencyLimits (#1198)", () => {
  it("defaults to empty object when absent", () => {
    const result = uppidiFleetSettingsSchema.safeParse({});
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.providerConcurrencyLimits, {});
    }
  });

  it("accepts valid provider concurrency limits", () => {
    const input = {
      providerConcurrencyLimits: { openai: 4, anthropic: 2 },
    };
    const result = uppidiFleetSettingsSchema.safeParse(input);
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.providerConcurrencyLimits, { openai: 4, anthropic: 2 });
    }
  });

  it("rejects non-integer values", () => {
    const input = {
      providerConcurrencyLimits: { openai: 3.5 },
    };
    const result = uppidiFleetSettingsSchema.safeParse(input);
    assert.equal(result.success, false);
  });

  it("rejects zero and negative values", () => {
    const result1 = uppidiFleetSettingsSchema.safeParse({
      providerConcurrencyLimits: { openai: 0 },
    });
    assert.equal(result1.success, false);

    const result2 = uppidiFleetSettingsSchema.safeParse({
      providerConcurrencyLimits: { openai: -1 },
    });
    assert.equal(result2.success, false);
  });

  it("accepts undefined as optional field", () => {
    const result = uppidiFleetSettingsSchema.safeParse({
      providerConcurrencyLimits: undefined,
    });
    assert.equal(result.success, true);
    if (result.success) {
      assert.deepStrictEqual(result.data.providerConcurrencyLimits, {});
    }
  });

  it("preserves other settings alongside concurrency limits", () => {
    const input = {
      hookHost: "0.0.0.0",
      hookPort: 9090,
      providerConcurrencyLimits: { openai: 4 },
    };
    const result = uppidiFleetSettingsSchema.safeParse(input);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.hookHost, "0.0.0.0");
      assert.equal(result.data.hookPort, 9090);
      assert.deepStrictEqual(result.data.providerConcurrencyLimits, { openai: 4 });
    }
  });
});
