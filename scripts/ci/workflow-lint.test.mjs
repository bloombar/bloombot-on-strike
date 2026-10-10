// Tests for workflow-lint.sh. Split from changed-checks.test.mjs because these need PyYAML (the
// pipenv env) but not client/node_modules, so CI runs them in the python job. When CI is set,
// missing PyYAML FAILS the tests instead of skipping them: a skip in CI would be a hidden gap.
// WORKFLOW_LINT_SCRIPT points the suite at another copy of the script.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const lintScript = process.env.WORKFLOW_LINT_SCRIPT ?? resolve(here, 'workflow-lint.sh')

const roots = []
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const tmp = (prefix) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(d)
  return d
}
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

// Same lookup as workflow-lint.sh. `pipenv --venv` first so probing never creates a virtualenv.
const yamlAvailable =
  spawnSync('python3', ['-c', 'import yaml']).status === 0 ||
  (spawnSync('pipenv', ['--venv'], { cwd: repo }).status === 0 &&
    spawnSync('pipenv', ['run', 'python', '-c', 'import yaml'], { cwd: repo }).status === 0)
const needYaml = { skip: !yamlAvailable && !process.env.CI }

test('PyYAML is available (mandatory in CI)', () => {
  if (!yamlAvailable && process.env.CI) assert.fail('PyYAML missing in CI: the workflow-lint tests would be skipped')
})

const lintRun = (actBody, workflow = 'name: x\non: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n') => {
  const root = tmp('wf-lint-')
  write(root, '.github/workflows/ci.yml', workflow)
  const bin = tmp('fake-act-')
  writeFileSync(join(bin, 'act'), `#!/usr/bin/env bash\n${actBody}\n`)
  chmodSync(join(bin, 'act'), 0o755)
  return spawnSync('bash', [lintScript], {
    encoding: 'utf8',
    env: { ...process.env, REPO_ROOT: root, PATH: `${bin}:${process.env.PATH}` },
  })
}

test('workflow-lint tolerates act failing only on the node24 limitation', needYaml, () => {
  const r = lintRun('echo "Error: The runs.using key in action.yml must be one of: [node20], got node24"; exit 1')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /node24/)
})

test('workflow-lint fails on another act error even if the node24 line is present', needYaml, () => {
  const r = lintRun(
    'echo "*DRYRUN* [CI/python] Unable to resolve v999-nonexistent: reference not found"\n' +
      'echo "Error: The runs.using key in action.yml must be one of: [node20], got node24"; exit 1',
  )
  assert.notEqual(r.status, 0, r.stdout + r.stderr)
})

test('workflow-lint fails when act fails with an unrecognised message', needYaml, () => {
  const r = lintRun('echo "boom"; exit 1')
  assert.notEqual(r.status, 0, r.stdout + r.stderr)
})

test('workflow-lint passes when act succeeds', needYaml, () => {
  const r = lintRun('echo plan ok; exit 0')
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('workflow-lint without any PyYAML fails with a one-line fix, not a traceback', () => {
  const root = tmp('wf-lint-')
  write(root, '.github/workflows/ci.yml', 'name: x\non: push\njobs: {}\n')
  const bin = tmp('fake-py-')
  // python3 without yaml, and a pipenv with no virtualenv.
  for (const [name, body] of [['python3', 'exit 1'], ['pipenv', 'exit 1']]) {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\n${body}\n`)
    chmodSync(join(bin, name), 0o755)
  }
  const r = spawnSync('bash', [lintScript], {
    encoding: 'utf8',
    env: { ...process.env, REPO_ROOT: root, PATH: `${bin}:${process.env.PATH}` },
  })
  assert.notEqual(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stderr, /PyYAML not found; run 'pipenv install'/)
  assert.doesNotMatch(r.stderr, /Traceback/)
})
