#!/usr/bin/env bash
# Formats a client file right after it is edited, so formatting never shows up
# as review noise in a slice's diff. Uses the repo-root `.prettierrc` and
# `client/eslint.config.js`.
#
# Deliberately best-effort: this runs after every edit, and a formatter that is
# missing or unhappy must never block the work. Always exits 0. Prettier is not
# yet a client devDependency, so until it is added that step is a no-op.

set -uo pipefail

payload=$(cat)

file_path=$(printf '%s' "$payload" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
value = (data.get('tool_input') or {}).get('file_path')
if value:
    print(value)
" 2>/dev/null || true)

[ -n "$file_path" ] || exit 0
[ -f "$file_path" ] || exit 0

ROOT="${CLAUDE_PROJECT_DIR:-.}"
case "$file_path" in
  "$ROOT"/client/* | client/*) ;;
  *) exit 0 ;;
esac
case "$file_path" in
  */node_modules/* | */dist/*) exit 0 ;;
  *.ts | *.tsx | *.js | *.jsx | *.json | *.css) ;;
  *) exit 0 ;;
esac

case "$file_path" in
  /*) abs_path="$file_path" ;;
  *) abs_path="$ROOT/$file_path" ;;
esac

cd "$ROOT/client" || exit 0
[ -d node_modules ] || exit 0

npx --no-install prettier --write "$abs_path" >/dev/null 2>&1 || true

case "$abs_path" in
  *.ts | *.tsx | *.js | *.jsx) npx --no-install eslint --fix "$abs_path" >/dev/null 2>&1 || true ;;
esac

exit 0
