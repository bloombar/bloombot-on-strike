# Instructions to Claude

## Project layout

- `client/` — Vite + React + TypeScript front end. Embeds a remark slideshow in an iframe and drives a HeyGen
  LiveAvatar (`@heygen/liveavatar-web-sdk`) that narrates each slide. Deployed to GitHub Pages by
  `.github/workflows/deploy-pages.yml` on every push to `heygen-avatar`.
- `python-server/` — websocket relay (`server.py`). Talks to OpenAI for slide narration and mints LiveAvatar
  session tokens (`live_avatar_api.py`). Course config lives in `bot_config.yml`.

## Checks

There is no test suite yet, and the client currently has pre-existing ESLint and `tsc` errors. Do not make
them worse: the `Stop` hook (`.claude/hooks/verify.sh`) only fails on errors in files you changed.

| check | command |
| --- | --- |
| client lint | `cd client && npm run lint` |
| client typecheck | `cd client && npx tsc -p tsconfig.app.json --noEmit --incremental false` |
| client build | `cd client && npm run build` |
| server syntax | `python3 -c "import ast,sys; [ast.parse(open(f).read(), f) for f in sys.argv[1:]]" python-server/*.py` |
| hook tests | `node --test .claude/hooks/*.test.mjs` |

New behaviour should come with a test that **fails without the change** where a harness exists for it. When
adding the first test harness to `client/` or `python-server/`, add its command to the table above and to
`verify.sh`.

## Code conventions

### Formatting

ESLint (`client/eslint.config.js`) and Prettier (`.prettierrc`: no semicolons, single quotes, 120 columns)
for the client. Python follows pylint defaults (see `.vscode/settings.json`).

### Comments

Leave comments explaining any large block of complicated code. Include function-level and module-level
comments. Avoid jargon and keep comments concise.

### Check for staleness

Always check for stale branches and PRs before starting a new task — run the `stale-check` skill. An open PR
touching your files means coordinate, not proceed.

## Git workflow

- The default branch is `main`. `heygen-avatar` is the live deploy branch: **pushing to it publishes the
  client to GitHub Pages**, so push only when asked.
- Do code changes on a feature branch named `feat/<slug>` and open a PR. Documentation and `env.example`
  files may go straight to the working branch.
- Commit and push only when asked. If asked to diverge from this flow, say so and confirm before proceeding.

## Protected paths

**IMPORTANT:** `.env` and `.env.*` (e.g. `client/.env`, `python-server/.env`) hold live OpenAI and LiveAvatar
API keys, and `*.log` files may hold transcripts. A `PreToolUse` hook (`.claude/hooks/guard-paths.sh`, tested
by `node --test .claude/hooks/*.test.mjs`) blocks writes to them. A block is a signal to stop and report — never route
around it. Reading them is allowed. `env.example` files are the tracked templates and are fine to edit.

Anything prefixed `VITE_` in `client/.env` is compiled into the public bundle. Never put a secret there.

LiveAvatar sessions cost credits for as long as they run. Code that opens a session must also close it.

## Agent workflow

Implementation runs as a supervisor/developer split: `.claude/agents/developer-agent.md` implements a scoped
slice against a brief, `.claude/agents/spec-reviewer.md` reviews the diff in fresh context, and the agent
doing the work is never the one grading it. The brief template and definition of done are in the
`phase-handoff` skill.

## One writer in the working tree at a time

Agents share the repository's working directory. They cannot see each other's uncommitted edits, and `git`
has no idea two of them exist — so two agents writing at once produce a broken tree, a `tsc` that fails for
reasons neither caused, and commits that sweep up work nobody meant to include.

**The supervisor:**

- Runs **one writing agent at a time** against the working tree. Reviewers are read-only and may run in
  parallel with anything, but they must work in a temporary `git worktree`, never the main tree.
- Runs two writing agents concurrently only with `isolation: "worktree"`, which gives each its own checkout.
  Without it, serialise — waiting is cheaper than untangling.
- Does **not** edit or commit the tree while a writing agent is running, including documentation. A
  `git status` an agent cannot explain is a `git status` it has to stop and ask about.

**Every agent, before committing:**

- Run `git status` first. **Stage only the files you touched, by path.** Never `git add -A`, `git add .` or
  `git commit -a` — those are how another agent's half-finished work ends up in your commit.
- If `git status` shows files you did not touch, **stop and report before doing anything about them**. Do not
  commit them, do not revert them, do not "clean up". Uncommitted content is not recoverable from git, and it
  may be the user's own work-in-progress (e.g. `command-line-examples.txt`) rather than another agent's.
- If a check fails in a file outside your slice, say so and stop rather than fixing it. A failure you did not
  cause is information the supervisor needs, not a chore to absorb.

`git checkout -- <file>`, `git stash` and `git restore` discard uncommitted work irreversibly — including work
you cannot see because another agent has not committed it yet. Commit early instead.
