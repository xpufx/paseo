# Agent Timeline Items, Transformers & Custom Renderers

> Guide to intercepting, styling, and injecting custom cards and streaming outputs into the Paseo agent conversation timeline.
>
> **References**:
> - [Upstream Timeline Items Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#timeline-items)
> - [Append Timeline Row Reference](file:///home/xpufx/code/3rdparty/paseo/paseo/public-docs/plugins/reference.md#append-a-timeline-row-from-the-daemon)
> - [Timeline Items Example](file:///home/xpufx/code/3rdparty/paseo/paseo/plugin-examples/timeline-items)
> - [Inline Thinking Example](file:///home/xpufx/code/3rdparty/paseo/paseo/plugin-examples/inline-thinking)

---

## Table of Contents

1. [Timeline Architecture Overview](#1-timeline-architecture-overview)
2. [Timeline Transformers (`addTimelineTransformer`)](#2-timeline-transformers)
3. [Custom Component Renderers (`addTimelineRenderer`)](#3-custom-component-renderers)
4. [Streaming Text Pacing (`useRevealedText`)](#4-streaming-text-pacing)
5. [Daemon-Appended Timeline Rows (`timeline.append`)](#5-daemon-appended-timeline-rows)

---

## 1. Timeline Architecture Overview

The Paseo conversation timeline consists of canonical chronological entries (`AgentTimelineItem`). Plugins can modify how timeline items appear on the client without modifying the server database:

```text
Built-in Source Item (e.g. tool call or reasoning)
                 │
                 ▼
       [Timeline Transformer] ── Synchronous & Deterministic
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
  Keep original       Transform into Plugin Item:
  (return undefined)  { type: "plugin", kind: "my-card", version: 1, data: {...} }
                           │
                           ▼
                  [Timeline Renderer] ── Matches kind + version
                           │
                           ▼
                Mounted React Native UI Card
```

### Streaming Lifecycle
Transformers run both on loaded historical turns and dynamically on incoming stream events:
- **`phase: "streaming"`**: Emitted while the agent or tool is actively generating text or executing.
- **`phase: "complete"`**: Emitted once the turn step finishes and commits to history.

---

## 2. Timeline Transformers

`addTimelineTransformer` intercepts source items by type:

```tsx
// index.client.tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";

export function contributeTimeline(client: PluginClientContext) {
  client.addTimelineTransformer({
    id: "format-todo-tool",
    // Intercept tool calls
    query: { itemType: "tool_call" },
    transform: ({ item, phase }) => {
      // Check if this tool call matches our target
      if (item.toolName !== "todo_tracker") {
        return undefined; // Keep default Paseo rendering
      }

      const parsedArgs = JSON.parse(item.args || "{}");

      // Replace tool item with custom plugin timeline item
      return {
        items: [
          {
            type: "plugin",
            kind: "todo-card",
            version: 1,
            data: {
              task: parsedArgs.task,
              status: parsedArgs.status,
              phase,
            },
          },
        ],
      };
    },
  });
}
```

### Transformer Rules:
- **Deterministic**: Must be a pure synchronous function without async RPCs or network calls.
- **Return Values**:
  - `undefined`: Leaves the built-in item untouched.
  - `{ items: [...] }`: Replaces the source item with one or more plugin items.
  - `{ items: [] }`: Hides/suppresses the item completely from view.

---

## 3. Custom Component Renderers

Renderers register against a matching `kind` and `version` and validate input data with a Zod schema:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Card, Row, StatusDot, Text, Badge } from "paseo-plugin-helper/client";
import { z } from "zod";

const todoSchema = z.object({
  task: z.string(),
  status: z.enum(["pending", "in_progress", "done"]),
  phase: z.enum(["streaming", "complete"]),
});

type TodoData = z.infer<typeof todoSchema>;

function TodoCardComponent({ data }: { data: TodoData }) {
  return (
    <Card variant="elevated">
      <Row justify="space-between" align="center">
        <Row align="center" gap="sm">
          <StatusDot variant={data.status === "done" ? "success" : "warning"} />
          <Text>{data.task}</Text>
        </Row>
        <Badge
          variant={data.status === "done" ? "success" : "neutral"}
          label={data.status.replace("_", " ")}
        />
      </Row>
    </Card>
  );
}

export function registerRenderer(client: PluginClientContext) {
  client.addTimelineRenderer({
    kind: "todo-card",
    version: 1,
    schema: todoSchema,
    Component: TodoCardComponent,
  });
}
```

---

## 4. Streaming Text Pacing (`useRevealedText`)

When rendering streaming text (such as custom reasoning or markdown outputs), rendering raw incoming text chunks can cause jitter. Use `useRevealedText` from `@getpaseo/plugin/client/react-native` to smooth output rendering:

```tsx
import { useRevealedText } from "@getpaseo/plugin/client/react-native";
import { Text } from "react-native";

function StreamingThoughtCard({ data }: { data: { text: string; phase: "streaming" | "complete" } }) {
  // Paces the reveal of incoming characters for human reading velocity
  const displayedText = useRevealedText(data.text, data.phase);

  return (
    <Text style={{ fontStyle: "italic", opacity: 0.8 }}>
      {displayedText}
    </Text>
  );
}
```

---

## 5. Daemon-Appended Timeline Rows

In addition to client-side transformers, a daemon server handler can directly push a plugin-owned row into an agent’s timeline:

```ts
// index.server.ts
import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(server: PluginServerContext) {
  server.handle(publishAuditReportRpc, async ({ agentId, findings }, { paseo }) => {
    // Append a canonical row directly to the agent timeline
    await paseo.agents.ref(agentId).timeline.append({
      type: "plugin",
      id: "security-audit-summary", // Reusing the same ID updates this row in-place!
      kind: "audit-card",
      version: 1,
      data: {
        score: findings.score,
        criticalIssues: findings.issues.length,
      },
    });

    return { success: true };
  });

  return () => {};
}
```

### Append Invariants:
1. **Idempotent Updates**: Re-appending with the same `id` updates the row in-place without duplicating entries.
2. **Payload Limit**: `data` is strictly capped at **64 KiB** serialized JSON; payloads exceeding this size are rejected by the daemon.
3. **Session Verification**: The daemon automatically stamps `pluginId` onto the row using the caller’s authenticated plugin session; external clients cannot spoof plugin rows.
