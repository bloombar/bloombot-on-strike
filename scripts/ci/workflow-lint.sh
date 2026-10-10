#!/usr/bin/env bash
# Validate .github/workflows/*.yml:
#   - YAML parses
#   - actionlint, if installed (skipped with a notice otherwise)
#   - `act -n` plan of ci.yml, if act is installed (skipped with a notice otherwise)
set -euo pipefail

# SELF is this repo (where the pipenv env lives); ROOT is whose workflows to lint
# (REPO_ROOT overrides it; used by the tests).
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${REPO_ROOT:-$SELF}"
cd "$ROOT"
export PYTHONDONTWRITEBYTECODE=1

shopt -s nullglob
workflows=(.github/workflows/*.yml .github/workflows/*.yaml)
[ "${#workflows[@]}" -gt 0 ] || { echo "no workflows found" >&2; exit 1; }

echo "== YAML parse =="
# PyYAML lives in the Pipfile env; fall back to system python if it has it.
if command -v pipenv >/dev/null && (cd "$SELF" && pipenv --venv >/dev/null 2>&1); then
  py=(env "PIPENV_PIPFILE=$SELF/Pipfile" pipenv run python)
else
  py=(python3)
fi
if ! "${py[@]}" -c 'import yaml' 2>/dev/null; then
  echo "workflow-lint: PyYAML not found; run 'pipenv install' in $SELF" >&2
  exit 1
fi
"${py[@]}" -c 'import sys, yaml
for f in sys.argv[1:]:
    yaml.safe_load(open(f))
    print("ok", f)' "${workflows[@]/#/$ROOT/}"

echo "== actionlint =="
if command -v actionlint >/dev/null; then
  actionlint "${workflows[@]}"
else
  echo "notice: actionlint not installed; skipping"
fi

echo "== act -n (plan) =="
if command -v act >/dev/null; then
  # act 0.2.x cannot load actions that run on node24 (checkout@v6, setup-node@v6): a limitation
  # of act, not of the workflow (deploy-pages.yml uses the same majors). Tolerate it ONLY if
  # every error line in act's output is that one; any other error (e.g. an unresolvable
  # action version) fails, even when the node24 line is also present.
  act_out="$(mktemp)"
  trap 'rm -f "$act_out"' EXIT
  if act -n pull_request -W .github/workflows/ci.yml --container-architecture linux/amd64 >"$act_out" 2>&1; then
    cat "$act_out"
  else
    cat "$act_out"
    errors="$(grep -E 'Error:|level=(error|fatal)|Unable to resolve|❌|Failure' "$act_out" || true)"
    other="$(printf '%s\n' "$errors" | grep -v 'got node24' | sed '/^$/d' || true)"
    if [ -n "$errors" ] && [ -z "$other" ]; then
      echo "notice: this act version does not support node24 actions; plan is only partial (not a workflow error)"
    else
      echo "workflow-lint: act reported errors other than the known node24 limitation" >&2
      exit 1
    fi
  fi
else
  echo "notice: act not installed; skipping"
fi
