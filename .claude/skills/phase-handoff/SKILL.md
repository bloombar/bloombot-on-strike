---
name: phase-handoff
description: The brief template and definition of done for handing a slice to developer-agent. Use when scoping work on bloombot-on-strike.
---

# Handing off a slice

A slice is work small enough that its **diff can be reviewed in one pass**. If you cannot describe the
change in a few sentences, split it.

## The brief template

A brief without a runnable check is not ready to hand over. That check is what lets the loop close without a
human watching it.

````markdown
## Slice: <short name>

**Branch:** feat/<slug>, cut from the working base (`main`, or `heygen-avatar` for avatar work)

### Goal

One paragraph. What exists after this slice that did not before.

### Files and interfaces

- `client/src/…` or `python-server/…` — what it must contain
- Reuse `existingHelper()` from `…` rather than writing a new one

### Out of scope

Explicitly. Name the adjacent things you do NOT want touched — this keeps the diff reviewable, and the
reviewer checks it.

### Verification

```bash
<the exact command, and what its output must show>
```

### Notes

Prior art in this repo, and any decision already taken that constrains the implementation.
````

## Definition of done

- `cd client && npm run lint && npx tsc -p tsconfig.app.json --noEmit --incremental false && npm run build` add no new errors in touched files
- `python3 -c "import ast,sys; [ast.parse(open(f).read(), f) for f in sys.argv[1:]]" python-server/*.py` and `node --test .claude/hooks/*.test.mjs` pass
- Both reviewers have run and every **must-fix** finding is resolved
- New behaviour has a test that **fails without the change**, where a harness exists for it
- Changes touching the avatar have been run end to end (`client` dev server + `python-server/server.py`)
  and the session was seen to stay connected and to close on Stop

## The loop

1. Run `stale-check`. An open PR touching these files means coordinate, not proceed.
2. Spawn `developer-agent` with the brief.
3. Run `/code-review` and `spec-reviewer` in parallel on the diff. Effort scales with blast radius — high for
   secrets handling, the LiveAvatar session lifecycle, and the websocket relay.
4. Triage. **must-fix** → back to the developer. **cheap-fix** → only within files already touched.
   **note** → mention it in the PR description, and ship.
5. Commit, push the feature branch and open the PR — only when the user asks. Never push `heygen-avatar`
   directly unless asked: it deploys to GitHub Pages.

**Two rounds of rework, maximum.** A third means the slice was mis-scoped rather than merely wrong — re-split
it and write a sharper brief.
