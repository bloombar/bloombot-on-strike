# scripts/ci

One source of truth for checks: GitHub Actions (`.github/workflows/ci.yml`) and local runs execute these same scripts.

| Script | What it does |
| --- | --- |
| `all.sh [--clean] [BASE]` | Runs every stage (does not stop at the first failure), prints a PASS/FAIL summary. BASE from arg or `CI_BASE`, default `origin/heygen-avatar` (fetched first). `--clean` = `npm ci` + `pipenv install --deploy`. |
| `python.sh [--clean]` | `pipenv verify` + `python-server` unit tests; `--clean` first runs `pipenv install --deploy` as CI does. |
| `client.sh [--clean] [BASE]` | `npm test`, `npm run build`, then `changed-checks.sh BASE`. `--clean` runs `npm ci` (CI always does); otherwise checks the lockfile is in sync with `npm ci --dry-run`. |
| `changed-checks.sh BASE` | "No new problems" gate: ESLint (whole client config) + tsc, compared against a temporary worktree of merge-base(BASE, HEAD); fails on any diagnostic the current tree has more of, including in unchanged files. Current tree = working tree (uncommitted/untracked included). Line numbers are ignored. If `client/package.json` or `package-lock.json` differ from the merge-base, the baseline gets its own `npm ci` (so dependency bumps are compared fairly; a failed install is exit 2); otherwise it reuses `client/node_modules`. All-zeros BASE skips; exit 2 means the gate could not run. |
| `changed-checks.test.mjs` | `node --test` self-tests for the gate (throwaway git repos; the dependency-bump cases use local `file:` packages, no network). Needs `client/node_modules`. CI: client job. |
| `workflow-lint.test.mjs` | `node --test` self-tests for `workflow-lint.sh`. Need PyYAML (pipenv env); skipped without it locally, but a FAILURE when `CI` is set. CI: python job. |
| `workflow-lint.sh` | YAML parse of workflows (needs PyYAML: `pipenv install`), `actionlint` and `act -n` if installed. |
| `act.sh` | Opt-in full container run of ci.yml via `act` (slow, needs Docker). |

Usage: `scripts/ci/all.sh` before pushing. Needs the pipenv env (`pipenv install`) and `client/node_modules`.

**`scripts/ci/all.sh --clean` is the closest-to-CI local run.**
