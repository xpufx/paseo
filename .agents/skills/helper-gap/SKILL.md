---
name: helper-gap
description: Decide whether a plugin UI should use paseo-plugin-helper or trigger a shared helper improvement
---

# Helper Gap Protocol

Use this skill whenever a plugin UI does not fit the existing
`paseo-plugin-helper` API.

## Required decision

Do not silently hand-roll a plugin-local replacement. First classify the need:

1. **Existing helper fit**: use the existing helper primitive.
2. **Reusable helper gap**: improve `packages/paseo-plugin-helper` and add
   contract-preserving tests/documentation.
3. **Plugin-specific behavior**: retain the smallest local composition and
   document why it is not reusable.

## Gap report

When option 2 or 3 applies, record:

- The exact UI behavior and interaction semantics.
- The existing helper APIs considered.
- Why they do not fit.
- Whether another plugin is likely to need the same capability.
- The proposed shared API, if reusable.
- Any temporary local implementation and its removal plan.

Use a linked Forgejo issue when the gap is not fixed in the same change.

## Contract safety

Helper improvements must be additive or behavior-preserving:

- Do not remove or rename existing exports.
- Do not change existing prop meanings or defaults.
- Preserve host initialization and runtime boundaries.
- Add focused component tests and update docs.
- Synchronize vendored helper copies only after the shared implementation is
  verified.

## Completion gate

Before claiming UI conformance:

```bash
make typecheck
npm test --workspace packages/paseo-plugin-helper
make conformance
```

If conformance still reports a finding because the helper lacks a capability,
do not suppress it. Link the helper gap issue or the shared helper commit and
explain the intentional exception.
