import { describe, it, expect } from "vitest";
import { registerCommandCenterItem } from "../client/command-center.js";
import { createMockClientContext } from "../testing/mock-client.js";

describe("registerCommandCenterItem", () => {
  it("forwards the contribution and returns the host cleanup", () => {
    const client = createMockClientContext();
    const opened: string[] = [];

    const cleanup = registerCommandCenterItem(client, {
      id: "open-console",
      title: "Console",
      icon: "Terminal",
      keywords: ["console", "settings"],
      context: "global",
      onSelect({ openSurface }) {
        openSurface("console-surface");
      },
    });

    expect(client.registeredCommandCenterItems).toHaveLength(1);
    expect(client.registeredCommandCenterItems[0]).toMatchObject({
      id: "open-console",
      context: "global",
      keywords: ["console", "settings"],
    });

    client.registeredCommandCenterItems[0].onSelect({
      openSurface: (id) => opened.push(id),
      openSettings: () => {},
    });
    expect(opened).toEqual(["console-surface"]);

    cleanup();
    expect(client.registeredCommandCenterItems).toHaveLength(0);
  });
});
