---
name: plugin-release
description: Pre-release gate for Paseo plugins — hygiene scan, README accuracy, open-issue triage, GitHub mirror dry-run, and vendor-tree verification before an operator-authorized push
---

# Plugin Release Skill

Run this gate before any push to the public GitHub mirror. It is **dry-run and
report only**: the gate never pushes. Only the operator authorizes a real
mirror push; see the hard rule below.

## Hard rule: operator-authorized pushes only

GitHub pushes are **operator-authorized only**. Do not run `git push github`,
`make github-mirror`, or `mirror-github.mjs` without `--dry-run`. The #91–94
issues carry `flag/stop-work` and freeze mirror work; a push while they are
open is a protocol violation. Report the dry-run result and stop.

## 1. Hygiene scan — no private strings

Scan the publish surface (plugin trees plus `packages/paseo-plugin-helper`):

```bash
git grep -n -E 'oktay|aager|mrs\.aager\.de' -- 'plugins/*' 'packages/*' ':!*dist*'
```

Also check for internal flow/agent names: `Orchestrator`, `Minion`,
`fgj`/`fgjx`, `envelope-tool`, `xpufx-tool`, `forgejo-issues-check`, and
internal label scopes.

Verdict per hit:
- **Must go**: personal handles (`oktay`), private repo slugs (`2fado`),
  internal infra (`forge.mrs.aager.de/...` registry or runner paths), private
  settings namespaces, hard-coded internal hostnames.
- **May stay**: public URLs (`github.com/xpufx/...`), and
  `forge.mrs.aager.de/xpufx/paseo` where it is the documented public mirror
  source.

Vendored helper copies (`plugins/*/{client,server,shared}/vendor/paseo-plugin-helper/`)
mirror `packages/paseo-plugin-helper/src`. Fix the helper source, then run
`node scripts/vendor-sync.mjs` — never edit vendor copies by hand.

`.agents/**` is pruned from the mirror by the cumulative target set (see §4).
Never mirror with `--all`: `--all` skips that prune and would publish internal
skills and the root lockfile.

## 2. README presence + accuracy

```bash
for p in plugins/*/; do test -f "$p/README.md" || echo "MISSING README: $p"; done
git grep -n -i -E 'beta|v7|v8' -- 'plugins/*/README.md' 'README.md'
```

- Every shipped plugin has a root `README.md`.
- Install command is present and correct:
  `paseo plugin add xpufx/paseo --path plugins/<id>` (or the plugin's own repo).
- Version strings match `plugins/<id>/package.json` and
  `plugins/<id>/paseo-plugin.json` (`requirements.paseo >= 0.8.0`).
- No stale generation wording (`v7`, `v8`, superseded beta pins) in prose.

## 3. Open issues per plugin

```bash
fgjx issue list --hostname forge.mrs.aager.de -R xpufx/paseo -s open --json
```

Group rows by `target/<plugin>`. Escalate anything that blocks release:
`priority/0-SOS`, `flag/stop-work`, `dep/blocked`, or an open `kind/bug` at
`attention/1-agent`. List the rest as known-open, not blockers. Do not close
or relabel issues as part of the gate.

## 4. GitHub mirror state + cumulative target set

```bash
git ls-remote github refs/heads/main
gh api repos/xpufx/paseo/contents/plugins --jq '.[].name'

TARGETS=top,demo,mcp-tools,forges,x-comms,slash,twofado,plugin-updates,helper
node scripts/mirror-github.mjs --target="$TARGETS" --dry-run
```

`mirror-github.mjs` prunes every path not in the target set, so a
single-plugin target (`--target=top`) removes the other plugins from the
mirror. Always pass the **cumulative target set** — every plugin directory
plus `helper` — so existing subdirs are never pruned. The printed commit must
fast-forward the current remote head (no force).

Confirm the prepared tree keeps every subdir (the script prints
`Prepared tree ID: <tree>`):

```bash
git ls-tree --name-only <tree>:plugins   # all plugin dirs still present
```

## 5. Vendor trees publishable

```bash
node scripts/vendor-sync.mjs --check   # must exit 0
git ls-files -s | awk '$1==120000 {print $4}'   # no symlink under a vendor path
```

`--check` fails on drift or a linked tree. A linked vendor tree is not
installable (Paseo's compiler rejects a symlink that realpaths outside the
plugin) — run `node scripts/vendor-sync.mjs` to materialize it.

## Gate result

Report findings first as `file:line` with a must-go / may-stay verdict, then
the dry-run mirror summary (remote head → prepared commit, targets, prune
diff). Only the operator authorizes the real push.
