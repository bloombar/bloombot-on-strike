#!/usr/bin/env bash
# Run every CI stage locally, with the same scripts CI runs.
#
# Usage: scripts/ci/all.sh [--clean] [BASE]
#   BASE      comparison base for the "no new problems" gate. Also settable via CI_BASE.
#             Default: origin/heygen-avatar (fetched first; a notice, not a failure, if offline).
#   --clean   closest-to-CI run: `npm ci` for the client and `pipenv install --deploy` for
#             Python, exactly as the CI jobs install. Slower; replaces client/node_modules.
#
# Stages: python, client (tests + build + gate), gate-tests, workflow-lint, claude-hooks.
# Runs ALL stages even if one fails, prints a summary, exits non-zero if any failed.
# Needs the pipenv env (`pipenv install`) and, without --clean, client/node_modules.
# For a full container run of ci.yml see scripts/ci/act.sh.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

clean=()
BASE="${CI_BASE:-}"
for arg in "$@"; do
  case "$arg" in
    --clean) clean=(--clean) ;;
    *) BASE="$arg" ;;
  esac
done
BASE="${BASE:-origin/heygen-avatar}"

# Refresh the remote-tracking base so the comparison is not against a stale ref.
if [[ "$BASE" == origin/* ]]; then
  if ! git fetch origin "${BASE#origin/}" --quiet 2>/dev/null; then
    echo "notice: could not fetch $BASE (offline?); using the local ref"
  fi
fi

names=()
results=()

run_stage() {
  local name="$1"
  shift
  echo
  echo "################ $name ################"
  if "$@"; then results+=(PASS); else results+=(FAIL); fi
  names+=("$name")
}

run_stage python scripts/ci/python.sh "${clean[@]+"${clean[@]}"}"
run_stage client scripts/ci/client.sh "${clean[@]+"${clean[@]}"}" "$BASE"
run_stage gate-tests node --test scripts/ci/*.test.mjs
run_stage workflow-lint scripts/ci/workflow-lint.sh
run_stage claude-hooks bash -c 'node --test .claude/hooks/*.test.mjs'

echo
echo "================ summary (base: $BASE${clean[*]:+, --clean}) ================"
failed=0
for i in "${!names[@]}"; do
  printf '%-14s %s\n' "${names[$i]}" "${results[$i]}"
  [ "${results[$i]}" = PASS ] || failed=1
done
exit "$failed"
