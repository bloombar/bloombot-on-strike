/**
 * Tests for the PreToolUse path guard.
 *
 * This hook is the only mechanism standing between an agent and the `.env` files
 * holding live OpenAI and LiveAvatar keys, and the only thing that stops an agent
 * editing its own guardrails in `.claude/`. A regression here is silent — the hook
 * simply stops blocking — so it is tested like production code.
 *
 * Run with: node --test .claude/hooks/*.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'guard-paths.sh')

// A fixed fake project root keeps the tests independent of where they run.
const ROOT = '/repo'

/** Runs the hook with a payload; returns its exit code. */
const runHook = (payload) => {
  try {
    execFileSync(HOOK, {
      input: JSON.stringify(payload),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT },
    })
    return 0
  } catch (error) {
    return error.status
  }
}

const BLOCKED = 2
const ALLOWED = 0

const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } })
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } })

test('blocks writes to environment files holding live credentials', () => {
  for (const path of ['.env', 'client/.env', 'python-server/.env', `${ROOT}/python-server/.env`, '.env.local'])
    assert.equal(runHook(write(path)), BLOCKED, path)
})

test('blocks writes to log files inside the project', () => {
  assert.equal(runHook(write('python-server/server.log')), BLOCKED)
  assert.equal(runHook(write('logs/relay.log')), BLOCKED)
  assert.equal(runHook(write(`${ROOT}/client/vite.log`)), BLOCKED)
  assert.equal(runHook(bash('rm python-server/server.log')), BLOCKED)
  assert.equal(runHook(bash('npm run dev > client/dev.log 2>&1')), BLOCKED)
})

test('allows log files outside the project, such as an agent scratchpad', () => {
  // Regression: the rule matched every *.log, so agents writing their own run
  // output to a temp directory were blocked and had to stop.
  assert.equal(runHook(write('/private/tmp/claude-503/x/scratchpad/run.log')), ALLOWED)
  assert.equal(runHook(bash('scripts/ci/all.sh > /private/tmp/scratch/all.log 2>&1')), ALLOWED)
  assert.equal(runHook(bash('rm -f /tmp/review/out.log')), ALLOWED)
})

test('blocks a force-add, which is how a gitignored secret reaches a public repo', () => {
  assert.equal(runHook(bash('git add -f python-server/.env')), BLOCKED)
})

test('blocks commands that delete or overwrite a protected path', () => {
  assert.equal(runHook(bash('rm -f python-server/.env')), BLOCKED)
  assert.equal(runHook(bash('echo KEY=x > client/.env')), BLOCKED)
  assert.equal(runHook(bash('echo KEY=x >> .env')), BLOCKED)
  assert.equal(runHook(bash('cd x && cp env.example .env')), BLOCKED)
  assert.equal(runHook(bash("sed -i '' 's/a/b/' python-server/.env")), BLOCKED)
})

test('allows the tracked env templates', () => {
  // `env.example` (no leading dot) is the tracked template and carries no secrets.
  assert.equal(runHook(write('python-server/env.example')), ALLOWED)
  assert.equal(runHook(write('client/env.example')), ALLOWED)
})

test('allows ordinary source files', () => {
  assert.equal(runHook(write('client/src/App.tsx')), ALLOWED)
  assert.equal(runHook(write('python-server/server.py')), ALLOWED)
  assert.equal(runHook(bash('cd client && npx tsc -p tsconfig.app.json --noEmit')), ALLOWED)
})

test('allows reads of protected paths — the risk is modification, not inspection', () => {
  assert.equal(runHook(bash('grep -i sandbox python-server/.env')), ALLOWED)
  assert.equal(runHook(bash('ls python-server/.env client/.env')), ALLOWED)
  assert.equal(runHook(bash('tail -50 python-server/server.log')), ALLOWED)
})

test('a stderr redirect elsewhere in the command is not a write to .env', () => {
  // Regression: `2>/dev/null` followed later by a read of `.env` matched the old
  // "`>` then `.env` anywhere after it" pattern and blocked a read-only command.
  assert.equal(runHook(bash('git log -S x 2>/dev/null; grep -i sandbox python-server/.env 2>/dev/null')), ALLOWED)
  assert.equal(runHook(bash('ls python-server/.env client/.env 2>&1')), ALLOWED)
})

test('blocks agent writes to this project .claude/ config', () => {
  assert.equal(runHook(write('.claude/settings.local.json')), BLOCKED)
  assert.equal(runHook(write(`${ROOT}/.claude/hooks/guard-paths.sh`)), BLOCKED)
  assert.equal(runHook(bash("sed -i '' 's/a/b/' .claude/settings.json")), BLOCKED)
  assert.equal(runHook(bash(`cp /tmp/x ${ROOT}/.claude/hooks/verify.sh`)), BLOCKED)
  assert.equal(runHook(bash('echo x > .claude/x')), BLOCKED)
  assert.equal(runHook(bash("cd .claude && sed -i '' 's/a/b/' CLAUDE.md")), BLOCKED)
  assert.equal(runHook(bash(`cd ${ROOT}/.claude/hooks && echo x > verify.sh`)), BLOCKED)
  assert.equal(runHook(bash('rm -rf ./.claude')), BLOCKED)
})

test('allows reads of .claude/ and writes to ~/.claude memory', () => {
  assert.equal(runHook(bash('cat .claude/CLAUDE.md')), ALLOWED)
  assert.equal(runHook(bash('node --test .claude/hooks/*.test.mjs')), ALLOWED)
  assert.equal(runHook(write('/Users/someone/.claude/projects/x/memory/a.md')), ALLOWED)
})

test('quoted text containing a redirect is not a write', () => {
  assert.equal(runHook(bash(`printf '%s' "echo x > .claude/x" | wc -c`)), ALLOWED)
  assert.equal(runHook(bash(`echo 'never > .env'`)), ALLOWED)
})

test('only the first line is inspected, so prose about a protected path is not a command', () => {
  const message = ["git commit -F - <<'EOF'", 'Add guardrails', '', 'Blocks writes to .env and *.log.', 'EOF'].join('\n')
  assert.equal(runHook(bash(message)), ALLOWED)
  assert.equal(runHook(bash('git add -A')), ALLOWED)
  assert.equal(runHook(bash('echo "never commit .env"')), ALLOWED)
})

test('a malformed payload does not block work', () => {
  // A hook that fails open on garbage is right: it runs before every tool call,
  // and an unparseable payload is a bug in the harness, not an attack.
  assert.equal(runHook({}), ALLOWED)
})
