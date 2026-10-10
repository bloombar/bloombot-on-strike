#!/usr/bin/env bash
# Usage: client.sh [--clean] [BASE]
#
# Client stage, identical to the CI `client` job: tests, build, then the no-new-diagnostics
# gate (eslint + tsc, current tree vs merge-base with BASE; only NEW problems fail; default
# BASE origin/heygen-avatar).
#   --clean   run `npm ci` first for exact install parity (always used in CI).
# Without --clean it instead checks package-lock.json is in sync with package.json
# (what `npm ci` fails on) via `npm ci --dry-run`, which installs nothing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
clean=0
BASE=""
for arg in "$@"; do
  case "$arg" in
    --clean) clean=1 ;;
    *) BASE="$arg" ;;
  esac
done
BASE="${BASE:-origin/heygen-avatar}"

cd "$ROOT/client"

if [ "$clean" -eq 1 ]; then
  echo "== npm ci =="
  npm ci
else
  echo "== package-lock.json in sync with package.json =="
  npm ci --dry-run --ignore-scripts >/dev/null
fi

echo "== npm test =="
npm test

echo "== npm run build =="
npm run build

echo "== no-new-diagnostics gate (eslint + tsc vs merge-base) =="
"$ROOT/scripts/ci/changed-checks.sh" "$BASE"
