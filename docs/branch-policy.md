# Branch & Backport Policy

This repository carries two SDK compatibility lanes. Normal development
happens on `main`; the `release/0.8` branch is a preserved baseline kept alive
only for necessary fixes.

## Lanes

- **`main` — SDK 0.9 mainline.** Feature work, refactors, and dependency
  updates target `main`. It tracks the current Paseo SDK 0.9 baseline
  (`@getpaseo/*` `0.9.0-beta.2`).
- **`release/0.8` — SDK 0.8 maintenance.** The 0.8-compatible baseline
  (preserved at `10945ec`), carrying only necessary bug and security fixes for
  consumers still on SDK 0.8.

## Backport rule

Normal pull requests target `main`. Only **bug and security fixes** are
cherry-picked or backported to `release/0.8`, as needed.

Fixes should generally land on `main` first, then be backported to
`release/0.8`. Do not develop features directly on `release/0.8`, and do not
merge `main` into `release/0.8` wholesale — keep the backport set minimal and
intentional.

## Milestones

Use milestones to make the compatibility track explicit:

- 0.8.x fixes → **`0.8.x Maintenance`**
- 0.9 work → **`0.9.0 Features`** / **`0.9.0 Migration`**
