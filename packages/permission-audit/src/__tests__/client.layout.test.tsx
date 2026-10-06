import { describe, expect, it } from "vitest";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Pressable, Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { initClientHelpers } from "paseo-plugin-helper/core";
import { PermissionAuditView } from "../client.js";
import type { AuditRecord } from "../shared.js";
import { findHorizontalOverflows } from "./flex-measure.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Regression guard for xpufx-org/paseo#897 (operator report, #1043 class).
 *
 * The operator saw long audit values clip out of the surface, and the filter
 * buttons stop responding. Both are the same defect: the filter row and the
 * table row were non-wrapping rows whose children default to `flexShrink: 0`,
 * so the four decision chips demanded more width than a narrow surface had and
 * the trailing ones were painted outside the container — clipped, and not
 * hittable. The containment suite below fails on the pre-fix tree with the
 * filter row and the long tool name among its findings; the press suite then
 * proves each button's handler still filters once the row can hold them.
 *
 * The press suite locates chips by their visible label rather than a testID
 * precisely because it must be meaningful on both trees: the handlers were
 * never dead, so it is green before and after and only guards the wiring. The
 * red evidence for the button defect is the filter-row overflow finding.
 */

const LONG_COMMAND =
  "rg --hidden --glob '!node_modules' --glob '!dist' 'some very long search pattern that keeps going' packages plugins";

const ENTRIES: AuditRecord[] = [
  {
    id: "r1",
    timestamp: "2026-09-28T10:00:00.000Z",
    agentId: "agent-with-a-long-identifier",
    kind: "tool",
    name: "bash",
    input: { command: LONG_COMMAND },
    decision: "allow",
  },
  {
    id: "r2",
    timestamp: "2026-09-28T10:05:00.000Z",
    agentId: "agent-2",
    kind: "tool",
    name: "read",
    input: { path: "/etc/hosts" },
    decision: "deny",
  },
  {
    recordType: "tool_call",
    id: "call-1",
    timestamp: "2026-09-28T10:06:00.000Z",
    turnId: "turn-9",
    sequence: 3,
    agentId: "agent-1",
    kind: "tool_call",
    name: "mcp__forge__list_pull_requests_for_a_very_long_repository_name",
    input: { filePath: "/tmp/out.txt" },
    outcome: "success",
  },
];

function installHost() {
  initClientHelpers({
    Icon: () => null,
    Modal: Object.assign(() => null, { Content: () => null }),
    useRpc: () => async () => ({ entries: ENTRIES, total: ENTRIES.length }),
    useToast: () => ({}),
  } as never);
}

function renderView(
  props: React.ComponentProps<typeof PermissionAuditView>,
): TestRenderer.ReactTestRenderer {
  installHost();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>
        <PermissionAuditView {...props} />
      </QueryClientProvider>,
    );
  });
  return renderer;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function treeText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(treeText).join(" ");
  if (node && typeof node === "object") {
    const el = node as { children?: unknown };
    if ("children" in el) return treeText(el.children);
  }
  return "";
}

function instanceText(instance: TestRenderer.ReactTestInstance): string {
  let out = "";
  for (const child of instance.children) {
    if (typeof child === "string") out += child;
    else out += instanceText(child);
  }
  return out;
}

/**
 * Locates a filter chip by its visible label. The pre-fix tree had no testIDs,
 * so this works on both trees and proves the `onPress` handlers were live.
 * `occurrence` disambiguates the two "All" chips (type row first, decision row
 * second).
 */
function filterButtonByLabel(
  renderer: TestRenderer.ReactTestRenderer,
  label: string,
  occurrence = 0,
): TestRenderer.ReactTestInstance {
  const matches = renderer.root
    .findAllByType(Pressable)
    .filter((candidate) => instanceText(candidate).trim() === label);
  const node = matches[occurrence];
  if (!node) throw new Error(`no filter chip labelled ${label}[${occurrence}]`);
  return node;
}

function buttonByTestID(
  renderer: TestRenderer.ReactTestRenderer,
  testID: string,
  index = 0,
): TestRenderer.ReactTestInstance {
  const matches = renderer.root
    .findAllByType(Pressable)
    .filter((candidate) => candidate.props.testID === testID);
  const node = matches[index];
  if (!node) throw new Error(`no button with testID ${testID}[${index}]`);
  return node;
}

describe("PermissionAuditView containment (#897)", () => {
  const layouts = [
    { label: "table", layout: { compact: false, platform: "web" } },
    { label: "compact card", layout: { compact: true, platform: "ios" } },
  ] as const;
  for (const variant of ["page", "compact"] as const) {
    for (const { label, layout } of layouts) {
      for (const width of [320, 360, 390, 430]) {
        it(`${variant} ${label} variant fits inside ${width}px with long values`, async () => {
          const renderer = renderView({ variant, layout: layout as never });
          await settle();
          expect(findHorizontalOverflows(renderer.toJSON(), width)).toEqual([]);
        });
      }
    }
  }

  it("renders all seven filter chips at 320px", async () => {
    const renderer = renderView({ variant: "compact" });
    await settle();
    expect(renderer.root.findAllByType(Pressable)).toHaveLength(7);
  });
});

describe("PermissionAuditView filter buttons (#897)", () => {
  it("filters to tool calls when the Tool calls chip is pressed", async () => {
    const renderer = renderView({ variant: "compact" });
    await settle();
    expect(treeText(renderer.toJSON())).toContain("bash");

    act(() => {
      filterButtonByLabel(renderer, "Tool calls").props.onPress();
    });
    await settle();

    const text = treeText(renderer.toJSON());
    expect(text).toContain("mcp__forge");
    expect(text).not.toContain("bash");
    expect(text).not.toContain("read");
  });

  it("filters to permissions when the Permissions chip is pressed", async () => {
    const renderer = renderView({ variant: "compact" });
    await settle();

    act(() => {
      filterButtonByLabel(renderer, "Permissions").props.onPress();
    });
    await settle();

    const text = treeText(renderer.toJSON());
    expect(text).toContain("bash");
    expect(text).not.toContain("mcp__forge");
  });

  it("filters by decision when a decision chip is pressed", async () => {
    const renderer = renderView({ variant: "compact" });
    await settle();

    act(() => {
      filterButtonByLabel(renderer, "Denied").props.onPress();
    });
    await settle();

    const text = treeText(renderer.toJSON());
    expect(text).toContain("read");
    expect(text).not.toContain("bash");
    expect(text).not.toContain("mcp__forge");
  });

  it("restores the full list when the All chips are pressed", async () => {
    const renderer = renderView({ variant: "compact" });
    await settle();

    act(() => {
      filterButtonByLabel(renderer, "Tool calls").props.onPress();
    });
    await settle();
    act(() => {
      filterButtonByLabel(renderer, "All", 0).props.onPress();
    });
    await settle();

    const text = treeText(renderer.toJSON());
    expect(text).toContain("bash");
    expect(text).toContain("mcp__forge");
  });

  it("renders every filter chip with a live press handler", async () => {
    const renderer = renderView({ variant: "page" });
    await settle();
    const ids = [
      "permission-audit-type-all",
      "permission-audit-type-permission",
      "permission-audit-type-tool_call",
      "permission-audit-decision-all",
      "permission-audit-decision-pending",
      "permission-audit-decision-allow",
      "permission-audit-decision-deny",
    ];
    for (const id of ids) {
      expect(typeof buttonByTestID(renderer, id).props.onPress).toBe("function");
    }
    for (const label of ["All", "Permissions", "Tool calls", "Pending", "Allowed", "Denied"]) {
      expect(typeof filterButtonByLabel(renderer, label).props.onPress).toBe("function");
    }
    expect(renderer.root.findAllByType(Text).length).toBeGreaterThan(0);
  });
});
