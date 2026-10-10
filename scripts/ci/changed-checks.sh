#!/usr/bin/env bash
# Usage: changed-checks.sh BASE
#
# "No NEW problems" gate for the client. The client carries pre-existing ESLint and tsc
# errors, so a full-tree gate would be red forever; instead this compares the diagnostics of
# the current tree against those of the merge-base of BASE and HEAD and fails on any
# diagnostic the current tree has more of. That also catches breakage that lands in
# UNCHANGED files (a changed export breaking an importer, a deleted file still imported).
#
#   - "Current tree" is the working tree (uncommitted and untracked files included; in CI it
#     is simply the checkout of HEAD).
#   - The baseline is a temporary detached git worktree of merge-base(BASE, HEAD) under
#     $TMPDIR and is removed on exit. Only .git metadata is touched, never the main tree.
#     Dependencies: if client/package.json and client/package-lock.json are identical at the
#     merge-base and in the current tree, the baseline symlinks the main tree's
#     client/node_modules (fast). If either differs, a dependency bump could add errors in
#     unchanged files that equal counts would hide, so the baseline gets its own
#     `npm ci --ignore-scripts` of the merge-base's lockfile (needs network/npm cache) and runs
#     its own tsc/eslint binaries from there.
#   - Diagnostics are normalised to  tool|file|rule-or-TS-code|message  with no line/column,
#     so a pre-existing error that merely moved is not "new"; duplicates are counted.
#   - ESLint runs the whole client lint config (`eslint .`, errors only); tsc runs both the
#     app and node configs.
#
# A missing/all-zeros BASE (new-branch push) skips with a notice and exits 0.
# Exit: 0 no new problems, 1 new problems, 2 the gate could not run (git, a tool, or the
# baseline `npm ci` failed or crashed). Never a silent pass.
#
# Env overrides (used by changed-checks.test.mjs): REPO_ROOT, TSC_BIN, ESLINT_BIN.
set -euo pipefail
export LC_ALL=C

BASE="${1:-}"
ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"
TSC="${TSC_BIN:-$ROOT/client/node_modules/.bin/tsc}"
ESLINT="${ESLINT_BIN:-$ROOT/client/node_modules/.bin/eslint}"

die() {
  echo "changed-checks: $*" >&2
  exit 2
}

if [ -z "$BASE" ] || [[ "$BASE" =~ ^0+$ ]]; then
  echo "changed-checks: no base commit (new branch); skipping."
  exit 0
fi
git rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || die "base '$BASE' not found (fetch it?)"
merge_base="$(git merge-base "$BASE" HEAD)" || die "no merge base between '$BASE' and HEAD (shallow clone or unrelated history?)"
[ -x "$TSC" ] || die "tsc not found at $TSC (run npm ci in client/)"
[ -x "$ESLINT" ] || die "eslint not found at $ESLINT (run npm ci in client/)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/changed-checks.XXXXXX")"
cleanup() {
  git -C "$ROOT" worktree remove --force "$TMP/base" >/dev/null 2>&1 || true
  git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

# Informational list of what differs from the merge-base. NUL-separated so non-ASCII and
# spaced paths survive; a git failure here is a gate failure, not "no changes".
{
  git diff --name-only -z --diff-filter=ACMRD "$merge_base" &&
    git ls-files -z --others --exclude-standard
} >"$TMP/changed0" || die "could not list changed files against $merge_base"
echo "changed-checks: base $BASE (merge-base ${merge_base:0:10}); changed client paths:"
tr '\0' '\n' <"$TMP/changed0" | grep '^client/' | sed 's/^/  /' || echo "  (none)"

# collect TREE_ROOT OUTFILE TSC ESLINT: write normalised diagnostics of TREE_ROOT/client to
# OUTFILE, running the given tsc and eslint binaries.
collect() {
  local dir="$1/client" out="$2" tsc="$3" eslint="$4" cfg rc before
  : >"$out"
  if [ ! -f "$dir/package.json" ]; then
    echo "changed-checks: no client/ in $1; treating as zero diagnostics"
    return 0
  fi

  # tsc: exit 0 clean; 1/2 only counts as diagnostics if it printed `error TS` lines.
  # Anything else (crash, OOM, missing binary) is a gate failure. Not `tsc -b`: it rewrites
  # tracked *.tsbuildinfo files.
  for cfg in tsconfig.app.json tsconfig.node.json; do
    [ -f "$dir/$cfg" ] || continue
    rc=0
    (cd "$dir" && "$tsc" -p "$cfg" --noEmit --incremental false) >"$TMP/tsc.out" 2>&1 || rc=$?
    case "$rc" in
      0) ;;
      1 | 2) grep -q 'error TS' "$TMP/tsc.out" || { cat "$TMP/tsc.out" >&2; die "tsc exited $rc without diagnostics ($dir/$cfg)"; } ;;
      *) cat "$TMP/tsc.out" >&2; die "tsc crashed with exit $rc ($dir/$cfg)" ;;
    esac
    { grep 'error TS' "$TMP/tsc.out" || true; } |
      sed -E -e 's/^(.*)\([0-9]+,[0-9]+\): error (TS[0-9]+): (.*)$/tsc|\1|\2|\3/' -e t -e 's/^error (TS[0-9]+): (.*)$/tsc||\1|\2/' >>"$out"
  done

  # eslint: exit 0/1 are normal (1 = lint errors); 2+ is a crash/config error.
  before="$(wc -l <"$out")"
  rc=0
  (cd "$dir" && "$eslint" . --quiet --format json) >"$TMP/eslint.json" 2>"$TMP/eslint.err" || rc=$?
  if [ "$rc" -gt 1 ]; then
    cat "$TMP/eslint.err" >&2
    die "eslint crashed with exit $rc ($dir)"
  fi
  node -e '
    const fs = require("fs"), path = require("path")
    const dir = fs.realpathSync(process.argv[1])
    const results = JSON.parse(fs.readFileSync(0, "utf8"))
    if (!Array.isArray(results)) throw new Error("eslint JSON is not an array")
    for (const r of results)
      for (const m of r.messages)
        if (m.severity === 2)
          console.log(["eslint", path.relative(dir, fs.realpathSync(r.filePath)), m.ruleId, m.message.replace(/\s+/g, " ")].join("|"))
  ' "$dir" <"$TMP/eslint.json" >>"$out" || die "could not parse eslint output ($dir)"
  if [ "$rc" -eq 1 ] && [ "$(wc -l <"$out")" -eq "$before" ]; then
    cat "$TMP/eslint.err" >&2
    die "eslint exited 1 but reported no errors ($dir)"
  fi
}

echo "-- diagnostics: current tree --"
collect "$ROOT" "$TMP/head.raw" "$TSC" "$ESLINT"

echo "-- diagnostics: merge-base --"
git worktree prune >/dev/null 2>&1 || true
git worktree add --detach --quiet "$TMP/base" "$merge_base" || die "could not create baseline worktree"
base_tsc="$TSC"
base_eslint="$ESLINT"
if [ -d "$TMP/base/client" ]; then
  # Compare the merge-base's dependency manifests with the current tree's (working tree
  # content, so uncommitted/untracked changes count; a file present on one side only differs).
  deps_differ=0
  for f in package.json package-lock.json; do
    if [ -e "$TMP/base/client/$f" ] || [ -e "$ROOT/client/$f" ]; then
      cmp -s "$TMP/base/client/$f" "$ROOT/client/$f" || deps_differ=1
    fi
  done
  if [ "$deps_differ" -eq 1 ]; then
    echo "changed-checks: client dependencies differ from the merge-base; installing baseline dependencies (npm ci) in the worktree"
    (cd "$TMP/base/client" && npm ci --ignore-scripts --no-audit --no-fund) >"$TMP/npm.out" 2>&1 ||
      { cat "$TMP/npm.out" >&2; die "baseline npm ci failed in $TMP/base/client"; }
    # The baseline must run ITS OWN tsc/eslint (a typescript or eslint bump changes results),
    # unless a binary was explicitly overridden.
    [ -n "${TSC_BIN:-}" ] || base_tsc="$TMP/base/client/node_modules/.bin/tsc"
    [ -n "${ESLINT_BIN:-}" ] || base_eslint="$TMP/base/client/node_modules/.bin/eslint"
    [ -x "$base_tsc" ] || die "baseline tsc not found at $base_tsc (not in the merge-base's dependencies?)"
    [ -x "$base_eslint" ] || die "baseline eslint not found at $base_eslint (not in the merge-base's dependencies?)"
  elif [ -d "$ROOT/client/node_modules" ]; then
    echo "changed-checks: client dependencies unchanged; reusing client/node_modules for the baseline"
    ln -s "$ROOT/client/node_modules" "$TMP/base/client/node_modules"
  fi
fi
collect "$TMP/base" "$TMP/base.raw" "$base_tsc" "$base_eslint"

sort "$TMP/head.raw" >"$TMP/head.diag"
sort "$TMP/base.raw" >"$TMP/base.diag"
echo "changed-checks: $(wc -l <"$TMP/base.diag" | tr -d ' ') baseline diagnostics, $(wc -l <"$TMP/head.diag" | tr -d ' ') now"

# Lines only in the current tree (comm is multiset-aware: an extra duplicate counts as new).
comm -13 "$TMP/base.diag" "$TMP/head.diag" >"$TMP/new.diag"
if [ -s "$TMP/new.diag" ]; then
  echo "changed-checks: NEW problems versus the merge-base:" >&2
  cat "$TMP/new.diag" >&2
  exit 1
fi
echo "changed-checks: OK (no new problems)"
