#!/usr/bin/env bash
# Blocks writes to files that must never be modified by an agent:
#
#   .env, .env.*     live OpenAI and LiveAvatar API keys (client/.env, python-server/.env)
#   *.log            logs inside this project (relay and dev-server logs can carry lecture
#                    transcripts). Logs outside the project, e.g. in a scratch or temp
#                    directory, are an agent's own output and stay writable.
#   .claude/         this project's agent config, hooks and permissions — an agent
#                    must not be able to loosen its own guardrails. Only this
#                    project's .claude/ is covered, not ~/.claude (agent memory).
#
# The tracked templates are `env.example` (no leading dot) and stay writable.
#
# CLAUDE.md rules are advisory; this is not. Exit code 2 blocks the tool call and
# shows stderr to the model, so a blocked write is a signal to stop, not an
# obstacle to route around.
#
# Reads the PreToolUse hook payload as JSON on stdin.

set -euo pipefail

payload=$(cat)

# Pull the fields we need without assuming jq is present.
extract() {
  printf '%s' "$payload" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
value = data
for key in sys.argv[1].split('.'):
    if not isinstance(value, dict):
        sys.exit(0)
    value = value.get(key)
    if value is None:
        sys.exit(0)
print(value)
" "$1" 2>/dev/null || true
}

tool=$(extract tool_name)
file_path=$(extract tool_input.file_path)
command=$(extract tool_input.command)

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Paths are matched on the tail of the path, so an absolute path and a relative
# one trip the same rule.
is_protected() {
  case "$1" in
    */.env | .env | */.env.* | .env.*) return 0 ;;
    *.log) is_project_path "$1" ;;
    *) is_config "$1" ;;
  esac
}

# A relative path is taken to be inside the project; an absolute one only if it
# is under the project root.
is_project_path() {
  case "$1" in
    "$PROJECT_ROOT"/*) return 0 ;;
    /*) return 1 ;;
    *) return 0 ;;
  esac
}

# This project's .claude/ directory, by relative path or by absolute path under
# the project root. ~/.claude and other projects' .claude stay writable.
is_config() {
  case "$1" in
    .claude | .claude/* | ./.claude | ./.claude/*) return 0 ;;
    "$PROJECT_ROOT"/.claude | "$PROJECT_ROOT"/.claude/*) return 0 ;;
    *) return 1 ;;
  esac
}

# A .env file as it appears inside a shell command: the token must start at a
# word boundary and end at whitespace, `;`, `|`, `&`, `)` or end of line.
ENV_TOKEN='(^|[[:space:]/"'"'"'])\.env(\.[A-Za-z0-9_.-]+)?["'"'"']?([[:space:];|&)]|$)'
# This project's .claude/ inside a command: relative (`.claude/x`, `./.claude`).
# The absolute form is matched separately against $PROJECT_ROOT.
CONFIG_TOKEN='(^|[[:space:]"'"'"'])(\./)?\.claude(/|["'"'"']?([[:space:];|&)]|$))'
# Commands that modify the paths they name.
MUTATING='^[[:space:]]*(sudo[[:space:]]+)?(rm|rmdir|truncate|shred|mv|cp|tee|touch|mkdir|chmod|ln|install|sed[[:space:]]+-i|perl[[:space:]]+-[a-z]*i)[[:space:]]'

# True if any *.log word in the segment is a protected (in-project) log.
names_project_log() {
  local word
  while IFS= read -r word; do
    [ -n "$word" ] && is_project_path "$word" && return 0
  done < <(printf '%s\n' "$1" | grep -oE '[^[:space:]"'"'"';|&()]+\.log' || true)
  return 1
}

deny() {
  echo "BLOCKED: $1" >&2
  echo "This path is protected: it holds live credentials or transcripts, or it is this project's" >&2
  echo ".claude/ config, which agents may not modify. Changes there are for the user to make by hand." >&2
  echo "Do not work around this. Stop and report the block." >&2
  exit 2
}

case "$tool" in
  Write | Edit | MultiEdit | NotebookEdit)
    if [ -n "$file_path" ] && is_protected "$file_path"; then
      deny "write to $file_path"
    fi
    ;;
  Bash)
    # Only guard commands that plainly mutate a protected path. A read (cat,
    # grep, ls) is allowed: the risk here is loss and leakage through
    # modification, not inspection.
    #
    # Matching is restricted to the FIRST LINE of the command. Everything after
    # a newline is a heredoc body, a commit message, or a multi-line script
    # argument — text that merely mentions `.env` rather than acting on it.
    if [ -n "$command" ]; then
      first_line=${command%%$'\n'*}

      # Force-add: the one operation that puts a gitignored secret into history.
      case "$first_line" in
        *"git add "*" -f"* | *"git add "*" --force"* | *"git add -f"* | *"git add --force"*)
          deny "git add --force can commit an ignored secret: $first_line"
          ;;
      esac

      # Split on command separators and inspect each simple command on its own,
      # so `rm foo; cat .env` does not read as deleting .env.
      in_config=false
      while IFS= read -r segment; do
        # `cd` into this project's .claude/ makes every later mutation a config write.
        if [[ "$segment" =~ ^[[:space:]]*cd[[:space:]]+[\"\']?([^[:space:]\"\']+) ]]; then
          if is_config "${BASH_REMATCH[1]%/}"; then in_config=true; else in_config=false; fi
        fi
        # Destructive commands naming a protected path.
        if [[ "$segment" =~ $MUTATING ]]; then
          if [[ "$segment" =~ $ENV_TOKEN ]] || [[ "$segment" =~ $CONFIG_TOKEN ]] ||
            [[ "$segment" == *"$PROJECT_ROOT/.claude"* ]] || names_project_log "$segment" || $in_config; then
            deny "command would modify a protected path: $first_line"
          fi
        fi
        # Redirection whose TARGET is a protected path (`> .env`, `>> a/b.log`).
        # Only the word directly after `>` counts, and quoted text is ignored, so
        # `2>/dev/null` or a quoted "> .env" in an argument is not a write.
        unquoted=$(printf '%s' "$segment" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")
        if [[ "$unquoted" =~ \>\>?[[:space:]]*([^[:space:]\;\|\&\)]+) ]]; then
          target=${BASH_REMATCH[1]}
          if is_protected "$target" ||
            { $in_config && [[ "$target" != /* && "$target" != '&'* ]]; }; then
            deny "command would overwrite a protected path: $first_line"
          fi
        fi
      done < <(printf '%s\n' "$first_line" | sed -E 's/(&&|\|\||;|\|)/\n/g')
    fi
    ;;
esac

exit 0
