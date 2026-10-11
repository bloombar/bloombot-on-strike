---
name: stale-check
description: Check for stale branches, open PRs, and drift from the base branch before starting or reviewing a slice. Run this before any new task.
---

# Stale branch & PR check

Run this **before starting a slice** and **before reviewing one**. The most expensive failure is two slices
editing the same files from different bases, and that is invisible unless somebody looks.

```bash
# 1. What is already in flight? An open PR touching your files means coordinate, not proceed.
gh pr list --state open --json number,title,headRefName,updatedAt \
  --jq '.[] | "#\(.number) \(.headRefName) — \(.title) (updated \(.updatedAt))"'

# 2. Is this branch behind its base? Use main, or heygen-avatar for avatar work.
git fetch origin --quiet
git rev-list --count HEAD..origin/main
git rev-list --count HEAD..origin/heygen-avatar

# 3. Which remote branches are merged into main and can be deleted?
git branch -r --merged origin/main | grep -v 'origin/main\|origin/HEAD' || echo "none"

# 4. Which remote branches have gone quiet?
git for-each-ref --sort=-committerdate refs/remotes/origin \
  --format='%(refname:short)  %(committerdate:relative)'
```

## How to act on it

| finding | action |
| --- | --- |
| An open PR touches files in your slice | **Stop and report it.** Do not edit those files in parallel. |
| Your branch is behind its base | Rebase onto the base before starting. |
| A merged branch still exists on the remote | Report it for deletion. Do not delete branches yourself. |
| A branch is quiet, unmerged, and has no open PR | Report it — abandoned or unfinished, a human decides. |

## Known state

`main` is the default branch. `heygen-avatar` is the long-lived avatar branch and the GitHub Pages deploy
branch — it is not stale for being ahead of `main`. Before concluding a branch's work is unlanded, check
`git diff --diff-filter=A --name-only main <branch>`; commit counts mislead after a squash merge.
