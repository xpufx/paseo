import { describe, expect, it } from "vitest";
import {
  KNOWN_OPEN_TARGETS,
  SEED_COMMANDS,
  SEED_OPERATION_BINDINGS,
  SlashSettingsSchema,
  actionSummary,
  draftFromCommand,
  emptyCommandDraft,
  mergeOperationBindings,
  missingCatalogCommands,
  operationsListRpc,
  removeCommandByName,
  upsertCommand,
  validateCommandDraft,
  type SlashCommand,
  type SlashCommandDraft,
} from "./resources";

function draft(patch: Partial<SlashCommandDraft> = {}): SlashCommandDraft {
  return { ...emptyCommandDraft(), ...patch };
}

function command(name: string): SlashCommand {
  return { name, title: name, description: "", enabled: true, action: { verb: "send", template: "x" } };
}

const validSend = draft({ name: "deploy", title: "Deploy", template: "Ship {args}" });

describe("SlashSettingsSchema prefix", () => {
  it("defaults an unset prefix to slash- but keeps an explicit empty override", () => {
    expect(SlashSettingsSchema.parse({ commands: [] }).prefix).toBe("slash-");
    expect(SlashSettingsSchema.parse({ prefix: "", commands: [] }).prefix).toBe("");
  });
});

describe("validateCommandDraft", () => {
  it("accepts valid send, open, and rpc drafts", () => {
    expect(validateCommandDraft(validSend).command?.action).toEqual({ verb: "send", template: "Ship {args}" });
    expect(
      validateCommandDraft(draft({ name: "go", title: "Go", verb: "open", target: "slash-console" })).command?.action,
    ).toEqual({ verb: "open", target: "slash-console" });
    expect(
      validateCommandDraft(draft({ name: "ping", title: "Ping", verb: "rpc", operation: "slash.ping" })).command?.action,
    ).toEqual({ verb: "rpc", operation: "slash.ping", params: {} });
  });

  it("enforces the name regex and caps", () => {
    expect(validateCommandDraft({ ...validSend, name: "Deploy" }).errors.name).toBeDefined();
    expect(validateCommandDraft({ ...validSend, name: "-x" }).errors.name).toBeDefined();
    expect(validateCommandDraft({ ...validSend, name: "a".repeat(65) }).errors.name).toBeDefined();
  });

  it("enforces title and description caps", () => {
    expect(validateCommandDraft({ ...validSend, title: "t".repeat(121) }).errors.title).toBeDefined();
    expect(validateCommandDraft({ ...validSend, description: "d".repeat(501) }).errors.description).toBeDefined();
  });

  it("requires the action payload for the selected verb", () => {
    expect(validateCommandDraft({ ...validSend, template: "" }).errors.action).toBeDefined();
    expect(validateCommandDraft({ ...validSend, verb: "open", target: "" }).errors.action).toBeDefined();
    expect(validateCommandDraft({ ...validSend, verb: "rpc", operation: "" }).errors.action).toBeDefined();
  });

  it("reports duplicate names", () => {
    const result = validateCommandDraft({ ...validSend, name: "review" }, ["review"]);
    expect(result.command).toBeUndefined();
    expect(result.errors.name).toMatch(/already exists/);
  });

  it("validates every shipped seed command", () => {
    for (const seed of SEED_COMMANDS) {
      expect(validateCommandDraft(draftFromCommand(seed)).command).toBeDefined();
    }
  });
});

describe("command list transforms", () => {
  const list = [command("a"), command("b")];

  it("adds new commands", () => {
    expect(upsertCommand(list, null, command("c")).map((c) => c.name)).toEqual(["a", "b", "c"]);
  });

  it("edits in place including renames", () => {
    expect(upsertCommand(list, "a", command("z")).map((c) => c.name)).toEqual(["z", "b"]);
  });

  it("removes by name", () => {
    expect(removeCommandByName(list, "a").map((c) => c.name)).toEqual(["b"]);
  });

  it("finds catalog entries missing from settings", () => {
    expect(missingCatalogCommands([SEED_COMMANDS[0]], SEED_COMMANDS).map((c) => c.name)).toEqual(
      SEED_COMMANDS.slice(1).map((c) => c.name),
    );
    expect(missingCatalogCommands(SEED_COMMANDS, SEED_COMMANDS)).toEqual([]);
  });
});

describe("actionSummary", () => {
  it("summarizes each verb", () => {
    expect(actionSummary({ verb: "send", template: "x" })).toBe("send");
    expect(actionSummary({ verb: "open", target: "slash-console" })).toBe("open → slash-console");
    expect(actionSummary({ verb: "rpc", operation: "slash.ping", params: {} })).toBe("rpc → slash.ping");
  });
});

describe("operation catalog validation", () => {
  const catalog = { rpc: ["slash.ping", "slash.echo"], open: ["slash-console", "approvals"] };

  it("blocks unknown rpc operations", () => {
    const result = validateCommandDraft(
      draft({ name: "oops", title: "Oops", verb: "rpc", operation: "slash.nope" }),
      [],
      catalog,
    );
    expect(result.command).toBeUndefined();
    expect(result.errors.action).toMatch(/Unknown RPC operation/);
    expect(result.errors.action).toContain("slash.ping");
  });

  it("allows allowlisted rpc operations", () => {
    const result = validateCommandDraft(
      draft({ name: "ping", title: "Ping", verb: "rpc", operation: "slash.ping" }),
      [],
      catalog,
    );
    expect(result.errors).toEqual({});
    expect(result.command).toBeDefined();
  });

  it("warns on unknown open targets without blocking the save", () => {
    const result = validateCommandDraft(
      draft({ name: "go", title: "Go", verb: "open", target: "not-a-surface" }),
      [],
      catalog,
    );
    expect(result.command).toBeDefined();
    expect(result.warnings.action).toMatch(/Unknown surface id/);
  });

  it("stays silent when no catalog is supplied", () => {
    expect(validateCommandDraft(draft({ name: "ping", title: "Ping", verb: "rpc", operation: "slash.nope" })).command).toBeDefined();
    expect(validateCommandDraft(draft({ name: "go", title: "Go", verb: "open", target: "not-a-surface" })).warnings).toEqual({});
  });
});

describe("mergeOperationBindings", () => {
  it("returns the seed bindings when no custom bindings are supplied", () => {
    expect(mergeOperationBindings(undefined).map((b) => b.name)).toEqual(
      SEED_OPERATION_BINDINGS.map((b) => b.name),
    );
    expect(mergeOperationBindings([])).toEqual(SEED_OPERATION_BINDINGS);
  });

  it("adds custom bindings without dropping the seeds", () => {
    const merged = mergeOperationBindings([
      { name: "fleet.orch", primitive: "slash.orchestrate", params: {}, target: "http://10.20.30.24:8099" },
    ]);
    expect(merged.map((b) => b.name)).toContain("fleet.orch");
    expect(merged.map((b) => b.name)).toContain("slash.orchestrate");
  });

  it("lets a custom binding override a seed with the same name", () => {
    const merged = mergeOperationBindings([
      { name: "slash.orchestrate", primitive: "slash.orchestrate", params: {}, target: "http://elsewhere:9" },
    ]);
    const orchestrate = merged.filter((b) => b.name === "slash.orchestrate");
    expect(orchestrate).toHaveLength(1);
    expect(orchestrate[0]?.target).toBe("http://elsewhere:9");
  });
});

describe("SlashSettingsSchema operation/hook fields", () => {
  it("defaults bindings to empty and hook fields to empty strings", () => {
    const parsed = SlashSettingsSchema.parse({ commands: [] });
    expect(parsed.operationBindings).toEqual([]);
    expect(parsed.hookUrl).toBe("");
    expect(parsed.hookSecretFile).toBe("");
  });

  it("validates binding shape", () => {
    expect(
      SlashSettingsSchema.parse({
        commands: [],
        operationBindings: [{ name: "a", primitive: "slash.ping", params: { x: 1 }, target: "http://h:1" }],
      }).operationBindings,
    ).toHaveLength(1);
    expect(
      SlashSettingsSchema.safeParse({ commands: [], operationBindings: [{ name: "a" }] }).success,
    ).toBe(false);
  });
});

describe("slash.operations.list contract", () => {
  it("exposes the list shape and the slash console surface", () => {
    expect(operationsListRpc.name).toBe("slash.operations.list");
    expect(operationsListRpc.output.parse({ rpc: ["slash.ping"], open: ["slash-console"] })).toEqual({
      rpc: ["slash.ping"],
      open: ["slash-console"],
    });
    expect(KNOWN_OPEN_TARGETS).toContain("slash-console");
  });
});
