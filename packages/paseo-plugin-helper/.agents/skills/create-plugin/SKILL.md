---
name: create-plugin
description: Scaffold a new Paseo plugin on paseo-plugin-helper from scratch with v8 layout, init wiring, and verify steps
parameters:
  path:
    type: string
    description: Directory to create the plugin in
    required: false
  pluginId:
    type: string
    description: Plugin id for paseo-plugin.json (lowercase, dashes)
    required: false
---

# Create Plugin Skill

Use this skill when starting a NEW Paseo plugin that uses
`paseo-plugin-helper` from the beginning. For migrating an existing plugin,
use the `audit-plugin` skill instead.

The fastest path is the official scaffold plus the helper adopt command,
which writes the dependency and the version-correct `initClientHelpers()`
block for you:

```bash
paseo plugin init ~/code/my-plugin
cd ~/code/my-plugin && npm install
npx paseo-plugin-helper adopt .
npm install && npm run typecheck
```

The golden reference is `demo-v8/` in the helper repo: every pattern below
appears there in working form. For migrating an existing plugin, use the
`audit-plugin` skill instead.

## 1. Layout (Paseo v0.8)

```text
my-plugin/
  paseo-plugin.json
  package.json
  tsconfig.json
  index.client.tsx
  index.server.ts
  client/
  server/
  shared/
```

Rules: client entry imports only `client/`, `shared/`, client-safe packages.
Server entry imports only `server/`, `shared/`, server-safe packages. No code
module at the root. At least one entry required.

## 2. Manifest (`paseo-plugin.json`)

```json
{
  "id": "my-plugin",
  "requirements": { "paseo": ">=0.8.0" },
  "build": [["npm", "install"]]
}
```

Missing `requirements.paseo` means `<0.8.0`, and a v0.8 daemon rejects the
plugin before any code runs.

## 3. Dependencies (`package.json`)

```json
{
  "dependencies": { "paseo-plugin-helper": "^0.4.0" },
  "devDependencies": { "@getpaseo/plugin": "0.8.0-beta.1" }
}
```

Use the SDK version matching the target daemon. Never import SDK values
inside shared code; the helper needs none.

## 4. Client entry (`index.client.tsx`)

The init call is REQUIRED and comes first. Use the specifiers matching the
installed SDK:

```tsx
// Paseo v0.8
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";

initClientHelpers({ Icon, Modal, useRpc, useToast });
```

```tsx
// Paseo v0.7
import { useRpc } from "@getpaseo/plugin";
import { Icon, Modal, useToast } from "@getpaseo/plugin/react-native";
import { initClientHelpers } from "paseo-plugin-helper/client";

initClientHelpers({ Icon, Modal, useRpc, useToast });
```

Without init, every helper component throws instead of rendering. Type
registrar params structurally (`ComposerPillRegistrar` from
`paseo-plugin-helper/client`) rather than importing SDK context types.

## 5. Shared contracts (`shared/`)

```ts
import { defineContract } from "paseo-plugin-helper/shared";
import { z } from "zod";

export const getDataRpc = defineContract({
  name: "my-plugin.get-data",
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});
```

For persisted settings, use `defineSettingsContract` plus
`createSettingsHandlers` on the server and `usePluginSettings` in client.

## 6. Server entry (`index.server.ts`)

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(server: PluginServerContext) {
  server.handle(getDataRpc, async () => ({ ok: true }));
  return () => {};
}
```

Prefer helper server modules over bespoke code: `createPluginLogger`,
`PluginStorage`, `createPeriodicTask`, `McpClient`, `upsertMcpServer`.

## 7. Verify

```bash
npm run typecheck
npx paseo-plugin-helper doctor . --strict
paseo plugin add <dir>
paseo plugin ls
```

Require `running` with no error. For UI plugins, open the pill and modal on
both desktop and mobile: no horizontal overflow, no clipped text, copy
actions toast on both.

## Reporting Norm

Work in silence: post progress, blockers, and completion notes as comments
on the relevant Forgejo issue (`fgj issue comment <id> --body ...`),
not as chat chatter. `fgj` resolves repo context from the `origin` remote
and does not fall through to configured hosts, so pass explicit
`--hostname`/`-R` on every call unless the Forgejo remote is literally
named `origin` (#18). Move the issue through labels yourself
(`green-light` -> `wip` -> `verify`). Chat is for decisions, approvals, and
escalations only. One closing line in chat with the SHA when done.

## Traceability

No PR flow exists on the Forgejo side, so link work by hand, both
directions, every time:
- Commit messages name the issue: `feat: ... (#12)`.
- The completion comment on the issue names the commit SHA.
- An issue is not `verify` until both links exist. A SHA without an
  issue, or an issue without a SHA, is unfinished work.
