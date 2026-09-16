# Label base (example)

A generic, apply-able seed for the scoped labels the agent workflow depends on:
`state/`, `priority/`, `attention/`, `spec/`, plus an optional `flag/stop-work`
circuit breaker. `exclusive: true` is what gives each scope its
single-occupancy behavior (apply one, the previous mate evicts itself).

See [`../../docs/workflow.md`](../../docs/workflow.md) §3 for how the labels
drive the board and the plugin.

## File

`label-base.yaml` — a YAML label template in the format Forgejo/Gitea read
(`labels:` list, each with `name`, `color`, `exclusive`, `description`).

## Apply it

### As an instance label template (Forgejo >= 1.19)

Copy the file into the instance's custom label directory and it becomes a
selectable label set when creating repositories:

```sh
sudo cp label-base.yaml "$FORGEJO_CUSTOM/options/label/agent-workflow.yaml"
```

Label templates are applied at **repository creation time** (choose the set in
the create-repo dialog or pass `issue_labels` to the API). For an existing repo
there is no single "apply template" call.

### To an existing repo via the API

Fetch the template's labels and create each one. Example with `jq`:

```sh
FORGEJO_URL=https://forge.example.com
OWNER=your-org
REPO=your-repo
TOKEN=<your-personal-access-token>

jq -c '.labels[]' label-base.yaml | while read -r label; do
  curl -s -X POST \
    -H "Authorization: token ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --argjson l "$label" '{name:$l.name,color:$l.color,description:$l.description,exclusive:$l.exclusive}')" \
    "${FORGEJO_URL}/api/v1/repos/${OWNER}/${REPO}/labels"
done
```

### By hand

The UI's **Labels → New Label** accepts a `scope/value` name and an
**Exclusive** checkbox. This is the slowest option but needs no API token.

## Notes

- Label colors render in the plugin's chips; keep them 6-digit hex (with or
  without `#`). Scoped chips always split into scope + value segments.
- The four documented scopes are enough to run the workflow. Add your own
  scopes freely — the plugin derives the live vocabulary from whatever labels
  are actually on the board, so it degrades gracefully if you rename or omit
  any of these.
- Applying a new label in an exclusive scope requires deleting the old one only
  if the label was created **without** `exclusive: true`. Keep the flag set.
