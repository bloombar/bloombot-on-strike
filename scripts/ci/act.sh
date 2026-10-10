#!/usr/bin/env bash
# Opt-in: run .github/workflows/ci.yml in Docker via `act`, as a pull_request to heygen-avatar.
# SLOW (pulls a large runner image, installs Python/Node/deps inside the container) and needs a
# running Docker daemon. Runs the committed+working copy; the changed-files gate diffs
# origin/heygen-avatar...HEAD, so commit first if you want it to see your changes.
# Needs act >= 0.2.89: older versions cannot run node24 actions (setup-node@v6), which both jobs use,
# so neither job gets past setup-node. Forced to linux/amd64 so it matches GitHub runners (emulated, slower, on Apple silicon).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

command -v act >/dev/null || { echo "act not installed" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running" >&2; exit 1; }

# act derives github.base_ref from the event payload.
event="$(mktemp)"
trap 'rm -f "$event"' EXIT
echo '{"pull_request":{"base":{"ref":"heygen-avatar"}}}' >"$event"

act pull_request \
  -W .github/workflows/ci.yml \
  -e "$event" \
  --container-architecture linux/amd64 \
  -P ubuntu-latest=catthehacker/ubuntu:act-latest \
  "$@"
