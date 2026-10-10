// Tests for changed-checks.sh and workflow-lint.sh. A gate that silently exits 0 is the main
// risk, so each case builds a throwaway git repo with a tiny TS client (node_modules symlinked
// from client/) and never touches the real tree.
// CHANGED_CHECKS_SCRIPT / WORKFLOW_LINT_SCRIPT point the suite at another copy of a script
// (used to prove the tests fail against the pre-fix versions).
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  realpathSync,
  chmodSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = process.env.CHANGED_CHECKS_SCRIPT ?? resolve(here, 'changed-checks.sh')
const lintScript = process.env.WORKFLOW_LINT_SCRIPT ?? resolve(here, 'workflow-lint.sh')
const realNodeModules = resolve(here, '../../client/node_modules')

const roots = []
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8', input: '' }).trim()
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true })
  writeFileSync(join(root, rel), text)
}
const tmp = (prefix) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(d)
  return d
}
const commit = (root, msg = 'change') => {
  git(root, 'add', '-A')
  git(root, 'commit', '-qm', msg)
}

// Base commit has a type error AND a lint error in client/src/old.ts (pre-existing problems),
// plus an importer/exporter pair (lib.ts <- use.ts) that is clean.
const makeRepo = () => {
  const root = tmp('changed-checks-')
  git(root, 'init', '-q')
  write(root, 'client/package.json', '{"type":"module"}')
  write(
    root,
    'client/eslint.config.js',
    `import js from '@eslint/js'
import tseslint from 'typescript-eslint'
export default tseslint.config({ files: ['**/*.ts'], extends: [js.configs.recommended, ...tseslint.configs.recommended] })
`,
  )
  const tsconfig = (include) =>
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        skipLibCheck: true,
      },
      include,
    })
  write(root, 'client/tsconfig.app.json', tsconfig(['src']))
  write(root, 'client/tsconfig.node.json', tsconfig(['vite.config.ts']))
  write(root, 'client/vite.config.ts', 'export default {}\n')
  write(root, 'client/src/ok.ts', 'export const ok: number = 1\n')
  write(root, 'client/src/old.ts', 'export const bad: number = "a"\nconst unused = 1\n')
  write(root, 'client/src/lib.ts', 'export const v: number = 1\n')
  write(root, 'client/src/use.ts', "import { v } from './lib'\nexport const w: number = v\n")
  symlinkSync(realNodeModules, join(root, 'client/node_modules'))
  write(root, '.gitignore', 'client/node_modules\n')
  commit(root, 'base')
  return { root, base: git(root, 'rev-parse', 'HEAD') }
}

const run = (root, base, env = {}) =>
  spawnSync('bash', [script, base], { encoding: 'utf8', env: { ...process.env, REPO_ROOT: root, ...env } })

// A fake tool script, for simulating crashes.
const fakeTool = (body) => {
  const f = join(tmp('fake-tool-'), 'tool')
  writeFileSync(f, `#!/usr/bin/env bash\n${body}\n`)
  chmodSync(f, 0o755)
  return f
}

before(() => {
  assert.ok(existsSync(realNodeModules), 'client/node_modules required (npm ci in client/)')
})
after(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

test('new type error in a changed file fails', () => {
  const { root, base } = makeRepo()
  write(root, 'client/src/new.ts', 'export const x: number = "oops"\n')
  commit(root)
  const r = run(root, base)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /tsc\|src\/new\.ts\|TS2322/)
})

test('new lint error in a changed file fails', () => {
  const { root, base } = makeRepo()
  write(root, 'client/src/new.ts', 'const unusedThing = 1\nexport const y = 2\n')
  commit(root)
  const r = run(root, base)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /no-unused-vars/)
})

test('pre-existing errors in an unchanged file pass', () => {
  const { root, base } = makeRepo()
  write(root, 'client/src/fine.ts', 'export const z: number = 3\n')
  commit(root)
  const r = run(root, base)
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('pre-existing errors whose line numbers shifted pass', () => {
  const { root, base } = makeRepo()
  write(root, 'client/src/old.ts', '// a\n// b\n// c\nexport const bad: number = "a"\nconst unused = 1\n')
  commit(root)
  const r = run(root, base)
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

test('a duplicate of a pre-existing error counts as new', () => {
  const { root, base } = makeRepo()
  write(root, 'client/src/old.ts', 'export const bad: number = "a"\nexport const bad2: number = "a"\nconst unused = 1\n')
  commit(root)
  const r = run(root, base)
  assert.equal(r.status, 1, r.stdout + r.stderr)
})

test('a changed export that breaks an UNCHANGED importer fails', () => {
  const { root, base } = makeRepo()
  write(root, 'client/src/lib.ts', 'export const v: string = "now a string"\n')
  commit(root)
  const r = run(root, base)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /tsc\|src\/use\.ts\|TS2322/)
})

test('a deleted file that is still imported fails', () => {
  const { root, base } = makeRepo()
  rmSync(join(root, 'client/src/lib.ts'))
  commit(root)
  const r = run(root, base)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /tsc\|src\/use\.ts\|TS2307/)
})

test('no changed client files passes', () => {
  const { root, base } = makeRepo()
  write(root, 'README.md', 'hi\n')
  commit(root)
  const r = run(root, base)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /no new problems/)
})

test('all-zeros BASE (new branch push) skips with a notice', () => {
  const { root } = makeRepo()
  const r = run(root, '0'.repeat(40))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /skipping/)
})

test('unknown BASE is an error, not a silent pass', () => {
  const { root } = makeRepo()
  const r = run(root, 'does-not-exist')
  assert.equal(r.status, 2, r.stdout + r.stderr)
})

test('unrelated history (no merge base) is an error, not "no changes"', () => {
  const { root } = makeRepo()
  write(root, 'client/src/new.ts', 'export const x: number = "oops"\n')
  commit(root)
  const emptyTree = execFileSync('git', ['hash-object', '-t', 'tree', '--stdin'], { cwd: root, encoding: 'utf8', input: '' }).trim()
  const orphan = git(root, 'commit-tree', emptyTree, '-m', 'unrelated root')
  const r = run(root, orphan)
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /no merge base/)
})

test('local mode sees uncommitted and untracked files', () => {
  const { root, base } = makeRepo()
  write(root, 'client/src/ok.ts', 'export const ok: number = "now bad"\n') // modified, uncommitted
  let r = run(root, base)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  write(root, 'client/src/ok.ts', 'export const ok: number = 1\n')
  write(root, 'client/src/untracked.ts', 'export const u: number = "bad"\n') // untracked
  r = run(root, base)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /src\/untracked\.ts/)
})

test('non-ASCII and spaced paths are checked, not dropped', () => {
  for (const name of ['café.ts', 'my file.ts']) {
    const { root, base } = makeRepo()
    write(root, `client/src/${name}`, 'export const x: number = "oops"\n')
    commit(root)
    const r = run(root, base)
    assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`)
    assert.ok(r.stderr.includes(`src/${name}`), r.stderr)
  }
})

test('a crashing tsc (exit 134, no diagnostics) is an error, not OK', () => {
  const { root, base } = makeRepo()
  const tsc = fakeTool('echo "RangeError: Maximum call stack size exceeded" >&2; exit 134')
  const r = run(root, base, { TSC_BIN: tsc })
  assert.equal(r.status, 2, r.stdout + r.stderr)
})

test('tsc exiting 1 without any `error TS` line is an error', () => {
  const { root, base } = makeRepo()
  const tsc = fakeTool('echo "something odd"; exit 1')
  const r = run(root, base, { TSC_BIN: tsc })
  assert.equal(r.status, 2, r.stdout + r.stderr)
})

test('a crashing eslint (exit 2) is an error, not OK', () => {
  const { root, base } = makeRepo()
  const eslint = fakeTool('echo "Oops! Something went wrong" >&2; exit 2')
  const r = run(root, base, { ESLINT_BIN: eslint })
  assert.equal(r.status, 2, r.stdout + r.stderr)
})

test('the baseline worktree is removed afterwards', () => {
  const { root, base } = makeRepo()
  run(root, base)
  assert.equal(git(root, 'worktree', 'list').split('\n').length, 1)
})

// ---- dependency bumps: the baseline must use ITS OWN dependencies ----
// A repo whose client depends on a local `file:` package `fakelib`. No node_modules symlink:
// the head tree gets a real `npm ci` (offline; file: deps need no registry), and tsc/eslint come
// from the real client install via TSC_BIN/ESLINT_BIN.
const realBin = (name) => join(realNodeModules, '.bin', name)
const npmIn = (cwd, ...args) =>
  execFileSync('npm', [...args, '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], { cwd, encoding: 'utf8', input: '' })
const fakelib = (root, n, type) => {
  write(root, `fakelibs/fakelib-${n}/package.json`, JSON.stringify({ name: 'fakelib', version: `${n}.0.0`, types: 'index.d.ts' }))
  write(root, `fakelibs/fakelib-${n}/index.d.ts`, `export declare const v: ${type}\n`)
}
const depEnv = { TSC_BIN: realBin('tsc'), ESLINT_BIN: realBin('eslint') }
const makeFakelibRepo = ({ baseLock = true } = {}) => {
  const root = tmp('changed-checks-dep-')
  git(root, 'init', '-q')
  const pkg = (n) => JSON.stringify({ type: 'module', dependencies: { fakelib: `file:../fakelibs/fakelib-${n}` } })
  const tsconfig = (include) =>
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, module: 'ESNext', moduleResolution: 'Bundler', skipLibCheck: true }, include })
  write(root, 'client/eslint.config.js', 'export default []\n')
  write(root, 'client/tsconfig.app.json', tsconfig(['src']))
  write(root, 'client/tsconfig.node.json', tsconfig(['vite.config.ts']))
  write(root, 'client/vite.config.ts', 'export default {}\n')
  write(root, 'client/src/usefake.ts', "import { v } from 'fakelib'\nexport const w: number = v\n")
  write(root, '.gitignore', 'node_modules\n')
  fakelib(root, 1, 'number')
  write(root, 'client/package.json', pkg(1))
  if (baseLock) npmIn(join(root, 'client'), 'install', '--package-lock-only')
  commit(root, 'base')
  const base = git(root, 'rev-parse', 'HEAD')
  // The change: only bump fakelib 1 -> 2 (v: number -> v: string).
  fakelib(root, 2, 'string')
  write(root, 'client/package.json', pkg(2))
  npmIn(join(root, 'client'), 'install', '--package-lock-only')
  commit(root, 'bump fakelib')
  npmIn(join(root, 'client'), 'ci') // head tree's own install, as CI does
  return { root, base }
}

test('a dependency bump that breaks an unchanged file fails (baseline uses its own deps)', () => {
  const { root, base } = makeFakelibRepo()
  const r = run(root, base, depEnv)
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /tsc\|src\/usefake\.ts\|TS2322/)
  assert.match(r.stdout, /installing baseline dependencies/)
})

test('unchanged dependencies reuse node_modules (fast path)', () => {
  const { root } = makeFakelibRepo()
  write(root, 'README.md', 'hi\n')
  commit(root)
  // Base = the bump commit itself, so the package files are identical to the current tree's.
  const r = run(root, git(root, 'rev-parse', 'HEAD~1'), depEnv)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /reusing client\/node_modules/)
})

// A bumped TOOL (typescript / eslint) must also be the baseline's own, not the head tree's.
// Fake tool packages: v1 reports nothing, v2 reports one error.
const makeToolRepo = (tool) => {
  const root = tmp('changed-checks-tool-')
  git(root, 'init', '-q')
  const body = {
    typescript: (n) => (n === 1 ? 'process.exit(0)' : "console.log('src/a.ts(1,1): error TS9999: boom'); process.exit(2)"),
    eslint: (n) =>
      n === 1
        ? 'console.log("[]")'
        : 'console.log(JSON.stringify([{ filePath: process.cwd() + "/src/a.ts", messages: [{ severity: 2, ruleId: "x", message: "boom" }] }])); process.exit(1)',
  }[tool]
  const bin = tool === 'typescript' ? 'tsc' : 'eslint'
  const pkg = (n) => JSON.stringify({ type: 'module', dependencies: { [tool]: `file:../fakes/${tool}-${n}` } })
  const fake = (n) => {
    write(root, `fakes/${tool}-${n}/package.json`, JSON.stringify({ name: tool, version: `${n}.0.0`, bin: { [bin]: 'bin.js' } }))
    write(root, `fakes/${tool}-${n}/bin.js`, `#!/usr/bin/env node\n${body(n)}\n`)
    chmodSync(join(root, `fakes/${tool}-${n}/bin.js`), 0o755)
  }
  const cfg = JSON.stringify({ compilerOptions: { noEmit: true }, include: ['src'] })
  write(root, 'client/eslint.config.js', 'export default []\n')
  write(root, 'client/tsconfig.app.json', cfg)
  write(root, 'client/tsconfig.node.json', cfg)
  write(root, 'client/src/a.ts', 'export const a = 1\n')
  write(root, '.gitignore', 'node_modules\n')
  fake(1)
  write(root, 'client/package.json', pkg(1))
  npmIn(join(root, 'client'), 'install', '--package-lock-only')
  commit(root, 'base')
  const base = git(root, 'rev-parse', 'HEAD')
  fake(2)
  write(root, 'client/package.json', pkg(2))
  npmIn(join(root, 'client'), 'install', '--package-lock-only')
  commit(root, 'bump tool')
  npmIn(join(root, 'client'), 'ci')
  return { root, base }
}

test('a typescript bump that adds an error fails (baseline runs its own tsc)', () => {
  const { root, base } = makeToolRepo('typescript')
  const r = run(root, base, { ESLINT_BIN: realBin('eslint') })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /tsc\|src\/a\.ts\|TS9999/)
})

test('an eslint bump that adds an error fails (baseline runs its own eslint)', () => {
  const { root, base } = makeToolRepo('eslint')
  const r = run(root, base, { TSC_BIN: realBin('tsc') })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /eslint\|src\/a\.ts\|x\|boom/)
})

test('a baseline without the tool binary is exit 2, not a fall-back to the head tree\'s', () => {
  const { root, base } = makeFakelibRepo() // deps install fine but provide no tsc/eslint
  mkdirSync(join(root, 'client/node_modules/.bin'), { recursive: true })
  for (const n of ['tsc', 'eslint']) symlinkSync(realBin(n), join(root, 'client/node_modules/.bin', n)) // head only
  const r = run(root, base) // no TSC_BIN/ESLINT_BIN: the baseline must use its own (absent) binaries
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /baseline tsc not found/)
})

test('a failing baseline install is exit 2, never a pass', () => {
  const { root, base } = makeFakelibRepo({ baseLock: false }) // no lockfile at base: npm ci fails
  const r = run(root, base, depEnv)
  assert.equal(r.status, 2, r.stdout + r.stderr)
  assert.match(r.stderr, /baseline/)
})

