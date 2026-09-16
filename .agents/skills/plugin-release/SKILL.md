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

The one standing exception is the `install-smoke` workflow itself: on `main` it
performs the push automatically **after** the staged-tree smoke for the same
scoped tree passes (see §6). Agents still never push by hand.

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

`.agents/**` and `.forgejo/**` are pruned from the mirror by the cumulative
target set (see §4). Never mirror with `--all`: `--all` skips that prune and
would publish internal skills, Forgejo CI metadata, and the root lockfile.
`.forgejo/` is Forgejo-only CI metadata — it is excluded from the mirror, so
internal runner/registry paths there are legitimate and the hygiene scan must
not force fake placeholders into the workflows.

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

`--check` fails on drift or a legacy linked tree. A linked vendor tree is not
installable (Paseo's compiler rejects a symlink that realpaths outside the
plugin) — run `node scripts/vendor-sync.mjs` to materialize it.

Dev source imports the bare specifier (`paseo-plugin-helper/{client,server,
shared,mcp}`), which each plugin's `tsconfig.json` `paths` aliases to the helper
src, so a helper src edit reflects on reload with no copy step (#176). The
committed vendored copies are the **publish** artifact: `mirror-github.mjs`
rewrites those bare specifiers to the vendored relative imports in the staged
tree (and fails if any bare specifier survives). `vendor-sync` refreshes the
committed copies; run it whenever the helper src changed, then commit them.

## 6. CI gate: `.forgejo/workflows/install-smoke.yml`

The steps above are also enforced automatically by the install-smoke workflow
on `pull_request` and `push` to `main` (and manually via `workflow_dispatch`).
It gates the tree the mirror *would* publish, in order:

1. **Hygiene** — private-strings scan on `plugins/*` + `packages/*`
   (`oktay`, `aager`, non-documented `mrs.aager.de` hosts) plus README presence.
   `forge.mrs.aager.de/xpufx/paseo` remains allowed as the documented mirror
   source.
2. **Vendor gate** — `node scripts/vendor-sync.mjs` materializes any legacy dev
   symlink, then `--check` must be clean and no vendored helper path may be a
   committed symlink (`git ls-files -s` mode 120000). A linked/partial tree is
   never smoked or published.
3. **Staged tree** — `node scripts/mirror-github.mjs --target=<8 plugins,helper>
   --dry-run` rewrites dev bare helper specifiers to the vendored relative
   imports and prepares the scoped tree/commit against a temp local bare remote
   (`file://`, never github.com); the prepared commit is pushed to that local
   remote only.
4. **Install smoke** — `paseo plugin add file://<staged>:plugins/<dir> --ref
   <commit>` for all eight plugins, asserting each reaches `status=running`.
   On failure the job dumps the daemon log.
5. **Mirror push** — on `main` only, after 3+4 pass, `mirror-github.mjs` pushes
   the same scoped tree to the public GitHub mirror. The credential is the
   Forgejo Actions secret `GITHUB_MIRROR_TOKEN` (GitHub fine-grained PAT with
   `Contents: Read and write` on `xpufx/paseo`). If the secret is absent the step
   warns and skips the push; the gate itself still passes.

`helper` is a workspace package (`packages/paseo-plugin-helper`), not a
`plugins/` directory: it is part of the staged target set (so the mirror does
not prune it) and is validated by step 2, not by `paseo plugin add`.
`.forgejo/**` stays excluded from the mirror by the target set — never mirror
with `--all`.

## Gate result

Report findings first as `file:line` with a must-go / may-stay verdict, then
the dry-run mirror summary (remote head → prepared commit, targets, prune
diff). Only the operator authorizes the real push.
