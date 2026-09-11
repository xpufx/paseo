import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import {
  contractSchemaToFields,
  registerHelperSettingsScreen,
  type HelperSettingsUiBundle,
} from "../client/settings-screen.js";
import { defineSettingsContract } from "../shared/settings.js";
import { createMockClientContext } from "../testing/mock-client.js";

const stubUi: HelperSettingsUiBundle = {
  SettingsCard: (() => null) as any,
  SettingsSection: (() => null) as any,
  SettingsSwitch: (() => null) as any,
  SettingsSelect: (() => null) as any,
  SettingsInput: (() => null) as any,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("contractSchemaToFields", () => {
  it("maps boolean, enum, string, and number fields with describe text as labels", () => {
    const schema = z.object({
      showCpu: z.boolean().default(true).describe("Show CPU"),
      theme: z.enum(["light", "dark"]).default("light").describe("Theme"),
      host: z.string().default("localhost").describe("Host"),
      port: z.number().default(8080).describe("Port"),
    });
    const fields = contractSchemaToFields(schema);
    expect(fields.map((f) => f.key)).toEqual(["showCpu", "theme", "host", "port"]);
    expect(fields.map((f) => f.kind)).toEqual(["boolean", "enum", "string", "number"]);
    expect(fields[0].label).toBe("Show CPU");
    expect(fields[1].options).toEqual(["light", "dark"]);
    expect(fields[3].label).toBe("Port");
  });

  it("falls back to field names when no describe text is present", () => {
    const schema = z.object({
      showCpu: z.boolean().default(true),
      host: z.string().default("x"),
    });
    const fields = contractSchemaToFields(schema);
    expect(fields[0].label).toBe("showCpu");
    expect(fields[0].description).toBeUndefined();
    expect(fields[1].label).toBe("host");
  });

  it("applies per-field label and description overrides", () => {
    const schema = z.object({
      showCpu: z.boolean().default(true).describe("Show CPU"),
    });
    const fields = contractSchemaToFields(schema, {
      labels: { showCpu: "CPU visible" },
      descriptions: { showCpu: "Custom hint" },
    });
    expect(fields[0].label).toBe("CPU visible");
    expect(fields[0].description).toBe("Custom hint");
  });

  it("skips unsupported field shapes with a warning instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const schema = z.object({
      keep: z.boolean().default(true),
      nested: z.object({ a: z.string() }),
      tags: z.array(z.string()),
    });
    const fields = contractSchemaToFields(schema);
    expect(fields.map((f) => f.key)).toEqual(["keep"]);
    expect(warn).toHaveBeenCalled();
  });

  it("returns an empty list for non-object schemas with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(contractSchemaToFields(z.string())).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe("registerHelperSettingsScreen", () => {
  it("registers with contract name, description title, and default icon", () => {
    const contract = defineSettingsContract({
      name: "demo.settings",
      schema: z.object({ showCpu: z.boolean().default(true) }),
      description: "Demo settings",
    });
    const client = createMockClientContext();
    const remover = registerHelperSettingsScreen(client, contract, { ui: stubUi });
    expect(typeof remover).toBe("function");
    expect(client.registeredSettingsScreens).toHaveLength(1);
    expect(client.registeredSettingsScreens[0].id).toBe("demo.settings");
    expect(client.registeredSettingsScreens[0].title).toBe("Demo settings");
    expect(client.registeredSettingsScreens[0].icon).toBe("Settings");
    expect(client.registeredSettingsScreens[0].Component).toBeDefined();
    remover();
    expect(client.registeredSettingsScreens).toHaveLength(0);
  });

  it("falls back to contract name for title and honors explicit overrides", () => {
    const contract = defineSettingsContract({
      name: "plain.settings",
      schema: z.object({ showCpu: z.boolean().default(true) }),
    });
    const client = createMockClientContext();
    registerHelperSettingsScreen(client, contract, {
      ui: stubUi,
      id: "custom-id",
      title: "Custom title",
      icon: "Sliders",
    });
    expect(client.registeredSettingsScreens[0].id).toBe("custom-id");
    expect(client.registeredSettingsScreens[0].title).toBe("Custom title");
    expect(client.registeredSettingsScreens[0].icon).toBe("Sliders");

    const client2 = createMockClientContext();
    registerHelperSettingsScreen(client2, contract, { ui: stubUi });
    expect(client2.registeredSettingsScreens[0].title).toBe("plain.settings");
  });
});
