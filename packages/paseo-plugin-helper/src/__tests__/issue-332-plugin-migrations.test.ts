import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");

function source(...parts: string[]): string {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

describe("#332 helper UI migrations", () => {
  it("keeps top's composer and sidebar on helper-owned contracts without a width cap", () => {
    const pill = source("plugins", "top", "client", "pill.tsx");
    const surface = source("plugins", "top", "client", "surface.tsx");
    expect(pill).toContain("registerComposerPill");
    expect(pill).toContain("registerSidebarSurface");
    expect(pill).not.toMatch(/\bPressable\b/);
    expect(surface).toContain("<ModalBody");
    expect(surface).not.toMatch(/maxContentWidth|TOP_CONTENT_MAX_WIDTH/);
  });

  it("leaves twofado's helper-owned sidebar scroller fluid", () => {
    const approvals = source("plugins", "twofado", "client", "approvals.tsx");
    expect(approvals).toContain("<ModalBody");
    expect(approvals).not.toMatch(/maxContentWidth|TWOFADO_CONTENT_MAX_WIDTH/);
  });

  it("uses helper controls and local composition styles in forges cards and pills", () => {
    const client = path.join(root, "plugins", "forges", "client");
    for (const file of fs.readdirSync(client).filter((name) => name.endsWith(".tsx"))) {
      const body = fs.readFileSync(path.join(client, file), "utf8");
      expect(body, file).not.toMatch(/\bPressable\b|\bStyleSheet\b/);
    }
    expect(source("plugins", "forges", "client", "issues-pill.tsx")).toContain("<CopyButton");
    expect(source("plugins", "forges", "client", "hook-queue-panel.tsx")).toContain("<Card");
  });

  it("removes x-comms content caps from every named surface", () => {
    for (const file of ["x-comms-pill.tsx", "main.tsx", "peer-status.tsx", "settings-prototype.tsx"]) {
      const body = source("plugins", "x-comms", "client", file);
      expect(body, file).not.toMatch(/maxContentWidth|X_COMMS_CONTENT_MAX_WIDTH/);
      expect(body, file).toContain("ModalBody");
    }
  });
});
