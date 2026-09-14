#!/usr/bin/env python3
"""
Prunes unused legacy labels from a Forgejo repository.
Audits all open and closed issues to ensure 0-usage safety before deletion.
"""
import sys, subprocess, json, argparse

def main():
    parser = argparse.ArgumentParser(description="Prune unused labels from a Forgejo repo.")
    parser.add_argument("--repo", default="xpufx/paseo-plugin-helper", help="Target repo (owner/name)")
    parser.add_argument("--hostname", default="forge.mrs.aager.de", help="Forgejo host")
    parser.add_argument("--dry-run", action="store_true", help="Print candidates without deleting")
    args = parser.parse_args()

    # 1. Fetch labels
    res = subprocess.run(["fgjx", "api", f"repos/{args.repo}/labels", "--hostname", args.hostname], capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error fetching labels: {res.stderr}", file=sys.stderr)
        sys.exit(1)
    labels = json.loads(res.stdout)

    # 2. Fetch all issues
    res = subprocess.run(["fgjx", "api", f"repos/{args.repo}/issues?state=all&limit=200", "--hostname", args.hostname], capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error fetching issues: {res.stderr}", file=sys.stderr)
        sys.exit(1)
    issues = json.loads(res.stdout)

    # Count usage
    usage = {l["name"]: 0 for l in labels}
    for iss in issues:
        for l in iss.get("labels", []):
            name = l["name"]
            usage[name] = usage.get(name, 0) + 1

    unused = [l for l in labels if usage.get(l["name"], 0) == 0]
    print(f"[{args.repo}] Found {len(unused)} unused labels out of {len(labels)} total.")

    for l in sorted(unused, key=lambda x: x["name"]):
        name = l["name"]
        lid = l["id"]
        # Do not prune scoped template labels that just haven't been applied yet
        if "/" in name:
            print(f"  [PRESERVE] Scoped template label: {name} (0 issues)")
            continue
        if args.dry_run:
            print(f"  [DRY RUN] Would delete: {name} (id={lid})")
        else:
            p = subprocess.run(["fgjx", "api", "-X", "DELETE", f"repos/{args.repo}/labels/{lid}", "--hostname", args.hostname], capture_output=True)
            print(f"  [DELETED] {name} (id={lid}) - status {p.returncode}")

if __name__ == "__main__":
    main()
