#!/usr/bin/env bash
# Stop hook: the turn does not end until the project's checks pass.
#
# Runs the same scripts CI runs (scripts/ci/, see its README), but only the
# stages whose inputs changed in the working tree, so a turn that touched
# nothing relevant ends quickly. For the full CI-equivalent run use
# `scripts/ci/all.sh --clean`.
#
# The client gate fails only on lint/tsc diagnostics that are NEW relative to
# the merge-base with the base branch (the client carries pre-existing errors).
# Base: $CI_BASE if set, else origin/heygen-avatar.
#
# Exit 2 blocks the turn and shows stderr to the model.

set -uo pipefail

ROOT="${CLAUDE_PROJECT_DIR:-.}"
cd "$ROOT" || exit 0

BASE="${CI_BASE:-origin/heygen-avatar}"
failures=""

fail() {
  failures="${failures}
--- $1 ---
$2
"
}

# Runs a stage, recording its output as a failure if it exits non-zero.
stage() {
  local name="$1"
  shift
  local output
  if ! output=$("$@" 2>&1); then
    fail "$name" "$(printf '%s\n' "$output" | tail -60)"
  fi
}

# Files changed in the working tree vs HEAD, plus untracked files.
changed=$( (git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null) | sort -u)
touched() { printf '%s\n' "$changed" | grep -qE "$1"; }

# Path guard tests: always run. A silent regression here un-protects the .env files.
stage "guard hook tests" node --test .claude/hooks/*.test.mjs

# Python relay: Pipfile.lock sync + unit tests (CI python job).
if touched '^(python-server/|Pipfile)'; then
  if command -v pipenv >/dev/null && pipenv --venv >/dev/null 2>&1; then
    stage "scripts/ci/python.sh" scripts/ci/python.sh
  else
    fail "python tests" "no pipenv env — run 'pipenv install' at the repo root"
  fi
fi

# Client: lockfile sync, tests, build, no-new-diagnostics gate (CI client job).
if touched '^client/'; then
  if [ -d client/node_modules ]; then
    stage "scripts/ci/client.sh" scripts/ci/client.sh "$BASE"
  else
    fail "client checks" "client/node_modules missing — run 'npm ci' in client/"
  fi
fi

# CI tooling itself: gate self-tests and workflow lint.
if touched '^(scripts/ci/|\.github/workflows/)'; then
  stage "gate self-tests" node --test scripts/ci/*.test.mjs
  stage "scripts/ci/workflow-lint.sh" scripts/ci/workflow-lint.sh
fi

if [ -n "$failures" ]; then
  {
    echo "Checks failed. Fix these before ending the turn:"
    echo "$failures"
  } >&2
  exit 2
fi

exit 0
