#!/usr/bin/env bash
# Usage: python.sh [--clean]
# Python stage: the same checks the CI `python` job runs after `pipenv install --deploy`.
#   0. With --clean: `pipenv install --deploy` (CI always does this; fails if the lock is stale).
#   1. Pipfile.lock is in sync with Pipfile (what --deploy enforces in CI).
#   2. The relay's unit tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# Never litter the tree with __pycache__.
export PYTHONDONTWRITEBYTECODE=1

if [ "${1:-}" = --clean ]; then
  echo "== pipenv install --deploy =="
  pipenv install --deploy
fi

echo "== pipenv verify =="
pipenv verify

echo "== python-server unit tests =="
cd python-server
pipenv run python -m unittest -v
