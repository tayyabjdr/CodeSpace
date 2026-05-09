# Isolated Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-workspace toggle that gives each Claude agent its own git worktree on its own branch, so concurrent edits in different panes don't collide. v1 is pure isolation (no in-app merge UI).

**Architecture:** A new main-process module `worktree-manager.js` shells out to `git` and owns a per-repo metadata file. The renderer asks main to create/destroy worktrees over IPC and gets back a filesystem path to spawn each PTY in. `pty-manager.js` is unchanged — it just spawns at whatever cwd it's given.

**Tech Stack:** Electron (main/preload/renderer), node `child_process.execFile` shelling out to `git`, vitest for tests, React for UI.

**Spec:** `docs/superpowers/specs/2026-05-09-isolated-agents-design.md`

---

## Background reading (before starting)

Read these files first — most tasks touch them:

- `src/main/pty-manager.js` — how PTYs are spawned (unchanged by this work, but the cwd flow ends here)
- `src/main/ipc-handlers.js` — pattern for adding new IPC handlers
- `src/main/workspaces-store.js` — `loadWorkspaces`/`saveWorkspaces` shape and the sanitize pattern
- `src/preload/index.js` — `electronAPI` surface; new `worktree.*` namespace will sit alongside `editor.*`
- `src/renderer/App.jsx` lines 60-70, 213-289, 313-360, 378-417 — agent creation, lazy spawn, workspace deletion, terminal removal — all four sites are touched
- `src/renderer/components/Onboarding.jsx` — toggle is added here
- `src/renderer/components/ConfirmDialog.jsx` — reused for the dirty-discard confirm
- `tests/pty-manager.test.js`, `tests/ipc-handlers.test.js` — pattern for `// @vitest-environment node` and how to mock `electron` and `node-pty`

---

## File structure

**New:**
- `src/main/worktree-manager.js` — git ops, meta file, single-writer locks
- `tests/worktree-manager.test.js` — node-env tests using a real git binary against tmp repos

**Modified:**
- `src/main/ipc-handlers.js` — register `worktree:isGitRepo`, `worktree:checkDirty`, `worktree:create`, `worktree:close`, `worktree:closeAll`, `worktree:isGitAvailable`
- `src/preload/index.js` — expose `worktree.*` on `electronAPI`
- `src/main/workspaces-store.js` — sanitize and persist `isolated: boolean`
- `src/renderer/App.jsx` — async agent creation, dirty-confirm on close, workspace-delete cleanup
- `src/renderer/components/Onboarding.jsx` + `.css` — isolation toggle and validation
- `src/renderer/components/TerminalPane.jsx` + `.css` — branch line in pane header
- `src/renderer/components/Sidebar.jsx` + `.css` — isolation glyph next to workspace name
- `tests/ipc-handlers.test.js` — extend to cover new handlers
- `tests/components/App.test.jsx` (if applicable to isolation flow)

**Note:** Tests live flat under `tests/` matching repo convention (not `tests/main/...` as the spec sketched).

**API design refinement vs spec:** The spec described `worktree.close({ force? })` returning `{ dirty: true }` to surface the dirty-check. To avoid race conditions between the dirty check and PTY kill (Windows file locks prevent `git worktree remove` while the PTY holds open handles), this plan splits the surface into two IPCs:

- `worktree:checkDirty` — peek only, mutates nothing
- `worktree:close` — unconditional cleanup (caller has already confirmed and killed the PTY)

Same observable behavior. Flow: renderer calls `checkDirty` → if dirty, show confirm modal → caller kills PTY → caller calls `close`.

---

## Task 1: worktree-manager skeleton — git availability and repo detection

**Files:**
- Create: `src/main/worktree-manager.js`
- Test: `tests/worktree-manager.test.js`

This task creates the module's foundations: detecting whether `git` is on PATH and whether a directory is a git working tree. No worktrees are created yet.

- [ ] **Step 1: Write the failing tests**

Create `tests/worktree-manager.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

import { isGitAvailable, isGitRepo } from '../src/main/worktree-manager.js'

describe('worktree-manager / detection', () => {
  let root, repoDir, plainDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-'))
    repoDir  = join(root, 'repo')
    plainDir = join(root, 'plain')
    mkdirSync(repoDir)
    mkdirSync(plainDir)
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('isGitAvailable returns true when git is on PATH', () => {
    expect(isGitAvailable()).toBe(true)
  })

  it('isGitRepo returns true for a git working tree', () => {
    expect(isGitRepo(repoDir)).toBe(true)
  })

  it('isGitRepo returns false for a plain directory', () => {
    expect(isGitRepo(plainDir)).toBe(false)
  })

  it('isGitRepo returns false for a path that does not exist', () => {
    expect(isGitRepo(join(root, 'nope'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- worktree-manager`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `src/main/worktree-manager.js`:

```js
import { execFileSync } from 'child_process'

let gitAvailable = null

export function isGitAvailable() {
  if (gitAvailable !== null) return gitAvailable
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true })
    gitAvailable = true
  } catch {
    gitAvailable = false
  }
  return gitAvailable
}

export function isGitRepo(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return false
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      encoding: 'utf8'
    })
    return out.trim() === 'true'
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- worktree-manager`
Expected: 4/4 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/worktree-manager.js tests/worktree-manager.test.js
git commit -m "feat(worktree): isGitAvailable + isGitRepo detection"
```

---

## Task 2: ensureGitignoreExcludes — idempotent `.codespace/` entry

**Files:**
- Modify: `src/main/worktree-manager.js`
- Modify: `tests/worktree-manager.test.js`

Adds `.codespace/` to a repo's `.gitignore` if missing. Called once per repo at first worktree creation.

- [ ] **Step 1: Write the failing tests**

Append to `tests/worktree-manager.test.js`:

```js
import { readFileSync, existsSync } from 'fs'
import { ensureGitignoreExcludes } from '../src/main/worktree-manager.js'

describe('worktree-manager / ensureGitignoreExcludes', () => {
  let root, repoDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-gi-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('creates a .gitignore with .codespace/ when none exists', () => {
    ensureGitignoreExcludes(repoDir)
    const gi = readFileSync(join(repoDir, '.gitignore'), 'utf8')
    expect(gi).toContain('.codespace/')
  })

  it('appends .codespace/ when missing from existing .gitignore', () => {
    writeFileSync(join(repoDir, '.gitignore'), 'node_modules\n')
    ensureGitignoreExcludes(repoDir)
    const gi = readFileSync(join(repoDir, '.gitignore'), 'utf8')
    expect(gi).toContain('node_modules')
    expect(gi).toContain('.codespace/')
  })

  it('does nothing when .codespace/ is already on its own line', () => {
    writeFileSync(join(repoDir, '.gitignore'), 'node_modules\n.codespace/\n')
    ensureGitignoreExcludes(repoDir)
    const gi = readFileSync(join(repoDir, '.gitignore'), 'utf8')
    const matches = gi.match(/^\.codespace\/$/gm) ?? []
    expect(matches.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- worktree-manager`
Expected: 3 new tests FAIL (function not exported).

- [ ] **Step 3: Implement**

Append to `src/main/worktree-manager.js`:

```js
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'

export function ensureGitignoreExcludes(repoDir) {
  const path = join(repoDir, '.gitignore')
  let body = ''
  if (existsSync(path)) {
    body = readFileSync(path, 'utf8')
    const lines = body.split(/\r?\n/)
    if (lines.some(l => l.trim() === '.codespace/')) return
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += '.codespace/\n'
  } else {
    body = '.codespace/\n'
  }
  writeFileSync(path, body, 'utf8')
}
```

(Move the `import { readFileSync, ... }` to the top of the file alongside the existing import.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- worktree-manager`
Expected: 7/7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/worktree-manager.js tests/worktree-manager.test.js
git commit -m "feat(worktree): ensureGitignoreExcludes appends .codespace/"
```

---

## Task 3: Meta file read/write with atomic temp+rename

**Files:**
- Modify: `src/main/worktree-manager.js`
- Modify: `tests/worktree-manager.test.js`

`<repo>/.codespace/worktrees/.cs-meta.json` tracks each agent's branch, base SHA, and a `gitignoreTouched` flag.

- [ ] **Step 1: Write the failing tests**

Append to `tests/worktree-manager.test.js`:

```js
import { readMeta, writeMeta, META_DEFAULT } from '../src/main/worktree-manager.js'

describe('worktree-manager / meta file', () => {
  let root, repoDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-meta-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('readMeta returns default shape when file missing', () => {
    expect(readMeta(repoDir)).toEqual({ version: 1, gitignoreTouched: false, agents: {} })
  })

  it('round-trips agent entries', () => {
    const m = { version: 1, gitignoreTouched: true, agents: { 'a-1': { branch: 'cs/x/abcd1234', baseSha: 'deadbeef', createdAt: '2026-05-09T00:00:00.000Z' } } }
    writeMeta(repoDir, m)
    expect(readMeta(repoDir)).toEqual(m)
  })

  it('returns default and quarantines a corrupt meta file', () => {
    const dir2 = join(root, 'corrupt')
    mkdirSync(join(dir2, '.codespace', 'worktrees'), { recursive: true })
    writeFileSync(join(dir2, '.codespace', 'worktrees', '.cs-meta.json'), '{not json')
    expect(readMeta(dir2)).toEqual(META_DEFAULT)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- worktree-manager`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement**

Add to `src/main/worktree-manager.js`:

```js
import { renameSync, mkdirSync } from 'fs'

export const META_DEFAULT = Object.freeze({ version: 1, gitignoreTouched: false, agents: {} })

function metaDir(repoDir) {
  return join(repoDir, '.codespace', 'worktrees')
}
function metaPath(repoDir) {
  return join(metaDir(repoDir), '.cs-meta.json')
}

export function readMeta(repoDir) {
  const p = metaPath(repoDir)
  if (!existsSync(p)) return { ...META_DEFAULT }
  let raw
  try { raw = readFileSync(p, 'utf8') }
  catch { return { ...META_DEFAULT } }
  let parsed
  try { parsed = JSON.parse(raw) }
  catch {
    try { renameSync(p, p + '.corrupt-' + Date.now()) } catch {}
    return { ...META_DEFAULT }
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.agents) return { ...META_DEFAULT }
  return {
    version: 1,
    gitignoreTouched: !!parsed.gitignoreTouched,
    agents: { ...parsed.agents }
  }
}

export function writeMeta(repoDir, data) {
  const dir = metaDir(repoDir)
  mkdirSync(dir, { recursive: true })
  const p = metaPath(repoDir)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, p)
}
```

(Merge new fs imports with existing.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- worktree-manager`
Expected: 10/10 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/worktree-manager.js tests/worktree-manager.test.js
git commit -m "feat(worktree): atomic meta file read/write"
```

---

## Task 4: create() — full worktree creation with branch-collision retry

**Files:**
- Modify: `src/main/worktree-manager.js`
- Modify: `tests/worktree-manager.test.js`

Creates `<repo>/.codespace/worktrees/<agentId>/` on a new branch `cs/<workspaceSlug>/<uuid8>`, branched from the source repo's HEAD. Records the branch and base SHA in meta. Retries up to 5 times on branch-name collision with numeric suffix.

- [ ] **Step 1: Write the failing tests**

Append to `tests/worktree-manager.test.js`:

```js
import { create } from '../src/main/worktree-manager.js'

describe('worktree-manager / create', () => {
  let root, repoDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-create-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('creates a worktree at the deterministic path on a new branch', async () => {
    const agentId = '11111111-2222-3333-4444-555555555555'
    const r = await create({ repoDir, workspaceName: 'CodeSpace', agentId })
    expect(r.path).toBe(join(repoDir, '.codespace', 'worktrees', agentId))
    expect(existsSync(r.path)).toBe(true)
    expect(r.branch).toMatch(/^cs\/codespace\/11111111$/)
    const list = execFileSync('git', ['-C', repoDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    expect(list).toContain(r.path)
  })

  it('records the agent in the meta file with branch and baseSha', async () => {
    const agentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const r = await create({ repoDir, workspaceName: 'CodeSpace', agentId })
    const meta = readMeta(repoDir)
    expect(meta.agents[agentId]).toMatchObject({ branch: r.branch, baseSha: r.baseSha })
    expect(meta.agents[agentId].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('ensures .codespace/ in .gitignore exactly once', async () => {
    const r1 = await create({ repoDir, workspaceName: 'CodeSpace', agentId: 'a1111111-0000-0000-0000-000000000000' })
    await create({ repoDir, workspaceName: 'CodeSpace', agentId: 'a2222222-0000-0000-0000-000000000000' })
    const gi = readFileSync(join(repoDir, '.gitignore'), 'utf8')
    const matches = gi.match(/^\.codespace\/$/gm) ?? []
    expect(matches.length).toBe(1)
    expect(readMeta(repoDir).gitignoreTouched).toBe(true)
  })

  it('retries with -2 suffix on branch collision', async () => {
    // Pre-create a branch that the slug would collide with
    execFileSync('git', ['-C', repoDir, 'branch', 'cs/codespace/deadbeef'], { stdio: 'ignore' })
    const r = await create({ repoDir, workspaceName: 'CodeSpace', agentId: 'deadbeef-0000-0000-0000-000000000000' })
    expect(r.branch).toBe('cs/codespace/deadbeef-2')
  })

  it('throws { code: "no-commits" } when source repo has no commits', async () => {
    const empty = join(root, 'empty')
    mkdirSync(empty)
    execFileSync('git', ['init', '-q'], { cwd: empty })
    await expect(create({ repoDir: empty, workspaceName: 'X', agentId: 'eeeeeeee-0000-0000-0000-000000000000' }))
      .rejects.toMatchObject({ code: 'no-commits' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- worktree-manager`
Expected: 5 new tests FAIL.

- [ ] **Step 3: Implement**

Append to `src/main/worktree-manager.js`:

```js
function execGit(args, opts = {}) {
  return execFileSync('git', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    encoding: 'utf8',
    ...opts
  })
}

function slugify(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
}

function shortId(uuid) {
  // First dash-delimited segment of a UUID — 8 hex chars, ~32 bits.
  return String(uuid).split('-')[0] || String(uuid).slice(0, 8)
}

function branchExists(repoDir, branch) {
  try {
    execGit(['-C', repoDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch { return false }
}

function pickBranchName(repoDir, base) {
  if (!branchExists(repoDir, base)) return base
  for (let i = 2; i <= 5; i++) {
    const candidate = `${base}-${i}`
    if (!branchExists(repoDir, candidate)) return candidate
  }
  const err = new Error(`could not find a free branch name near ${base}`)
  err.code = 'branch-collision'
  throw err
}

export async function create({ repoDir, workspaceName, agentId }) {
  if (!isGitAvailable()) {
    const err = new Error('git not found on PATH'); err.code = 'git-missing'; throw err
  }
  if (!isGitRepo(repoDir)) {
    const err = new Error('source is not a git repo'); err.code = 'not-a-repo'; throw err
  }
  let baseSha
  try { baseSha = execGit(['-C', repoDir, 'rev-parse', 'HEAD']).trim() }
  catch {
    const err = new Error('source repo has no commits'); err.code = 'no-commits'; throw err
  }

  ensureGitignoreExcludes(repoDir)

  const slug = slugify(workspaceName)
  const branch = pickBranchName(repoDir, `cs/${slug}/${shortId(agentId)}`)
  const wtPath = join(repoDir, '.codespace', 'worktrees', agentId)

  try {
    execGit(['-C', repoDir, 'worktree', 'add', '-b', branch, wtPath, baseSha])
  } catch (e) {
    const err = new Error(`git worktree add failed: ${e.stderr || e.message}`)
    err.code = 'worktree-create-failed'
    err.detail = String(e.stderr || e.message).slice(0, 500)
    throw err
  }

  const meta = readMeta(repoDir)
  meta.gitignoreTouched = true
  meta.agents[agentId] = { branch, baseSha, createdAt: new Date().toISOString() }
  writeMeta(repoDir, meta)

  return { path: wtPath, branch, baseSha }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- worktree-manager`
Expected: 15/15 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/worktree-manager.js tests/worktree-manager.test.js
git commit -m "feat(worktree): create() with branch-collision retry"
```

---

## Task 5: checkDirty() and close() — smart cleanup

**Files:**
- Modify: `src/main/worktree-manager.js`
- Modify: `tests/worktree-manager.test.js`

`checkDirty` peeks `git status --porcelain` without mutating. `close` removes the worktree and deletes the branch only if no commits exist beyond base.

- [ ] **Step 1: Write the failing tests**

Append to `tests/worktree-manager.test.js`:

```js
import { checkDirty, close } from '../src/main/worktree-manager.js'

describe('worktree-manager / checkDirty + close', () => {
  let root, repoDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-close-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('checkDirty returns false on a fresh worktree', async () => {
    const id = 'cd111111-0000-0000-0000-000000000000'
    await create({ repoDir, workspaceName: 'X', agentId: id })
    expect(await checkDirty({ repoDir, agentId: id })).toEqual({ dirty: false })
  })

  it('checkDirty returns true when worktree has untracked file', async () => {
    const id = 'cd222222-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'X', agentId: id })
    writeFileSync(join(r.path, 'scratch.txt'), 'hi')
    expect(await checkDirty({ repoDir, agentId: id })).toEqual({ dirty: true })
  })

  it('checkDirty returns { missing: true } when meta has no entry', async () => {
    expect(await checkDirty({ repoDir, agentId: 'nope-0000-0000-0000-000000000000' })).toEqual({ missing: true })
  })

  it('close removes a clean worktree and prunes the branch (no commits beyond base)', async () => {
    const id = 'cd333333-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'X', agentId: id })
    await close({ repoDir, agentId: id })
    expect(existsSync(r.path)).toBe(false)
    const branches = execFileSync('git', ['-C', repoDir, 'branch', '--list', r.branch], { encoding: 'utf8' })
    expect(branches.trim()).toBe('')
    expect(readMeta(repoDir).agents[id]).toBeUndefined()
  })

  it('close removes worktree but keeps branch when commits exist beyond base', async () => {
    const id = 'cd444444-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'X', agentId: id })
    writeFileSync(join(r.path, 'a.txt'), 'a')
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-C', r.path, 'add', 'a.txt'])
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-C', r.path, 'commit', '-m', 'a'])
    await close({ repoDir, agentId: id })
    expect(existsSync(r.path)).toBe(false)
    const branches = execFileSync('git', ['-C', repoDir, 'branch', '--list', r.branch], { encoding: 'utf8' })
    expect(branches).toContain(r.branch)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- worktree-manager`
Expected: 5 new tests FAIL.

- [ ] **Step 3: Implement**

Append to `src/main/worktree-manager.js`:

```js
function metaEntry(repoDir, agentId) {
  const m = readMeta(repoDir)
  return { meta: m, entry: m.agents[agentId] }
}

export async function checkDirty({ repoDir, agentId }) {
  const { entry } = metaEntry(repoDir, agentId)
  if (!entry) return { missing: true }
  const wtPath = join(repoDir, '.codespace', 'worktrees', agentId)
  if (!existsSync(wtPath)) return { missing: true }
  let out
  try { out = execGit(['-C', wtPath, 'status', '--porcelain']) }
  catch { return { dirty: false } } // best-effort: if status fails, treat as clean to allow cleanup
  return { dirty: out.trim().length > 0 }
}

export async function close({ repoDir, agentId }) {
  const m = readMeta(repoDir)
  const entry = m.agents[agentId]
  if (!entry) return { ok: true, missing: true }
  const wtPath = join(repoDir, '.codespace', 'worktrees', agentId)

  let aheadCount = 0
  if (existsSync(wtPath)) {
    try {
      const out = execGit(['-C', repoDir, 'rev-list', '--count', `${entry.baseSha}..${entry.branch}`])
      aheadCount = parseInt(out.trim(), 10) || 0
    } catch {}
  }

  // Remove worktree (--force handles uncommitted changes too)
  try { execGit(['-C', repoDir, 'worktree', 'remove', '--force', wtPath]) }
  catch {}

  // Make sure git's bookkeeping is clean even if the directory had been deleted manually
  try { execGit(['-C', repoDir, 'worktree', 'prune']) } catch {}

  if (aheadCount === 0) {
    try { execGit(['-C', repoDir, 'branch', '-D', entry.branch]) } catch {}
  }

  delete m.agents[agentId]
  writeMeta(repoDir, m)

  return { ok: true, branchKept: aheadCount > 0 }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- worktree-manager`
Expected: 20/20 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/worktree-manager.js tests/worktree-manager.test.js
git commit -m "feat(worktree): checkDirty + close with smart cleanup"
```

---

## Task 6: closeAllForWorkspace + repairOrphans

**Files:**
- Modify: `src/main/worktree-manager.js`
- Modify: `tests/worktree-manager.test.js`

Bulk close used during workspace deletion. Orphan repair drops meta entries whose worktrees no longer exist (handles user-side cleanup or aborted operations).

- [ ] **Step 1: Write the failing tests**

Append to `tests/worktree-manager.test.js`:

```js
import { closeAllForWorkspace, repairOrphans } from '../src/main/worktree-manager.js'

describe('worktree-manager / bulk + repair', () => {
  let root, repoDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-bulk-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('closeAllForWorkspace removes every worktree given a list of agentIds', async () => {
    const ids = ['b1111111-0000-0000-0000-000000000000', 'b2222222-0000-0000-0000-000000000000']
    for (const id of ids) await create({ repoDir, workspaceName: 'X', agentId: id })
    await closeAllForWorkspace({ repoDir, agentIds: ids })
    for (const id of ids) {
      expect(existsSync(join(repoDir, '.codespace', 'worktrees', id))).toBe(false)
      expect(readMeta(repoDir).agents[id]).toBeUndefined()
    }
  })

  it('repairOrphans drops meta entries whose worktree directory is gone', async () => {
    const id = 'orphan11-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'X', agentId: id })
    rmSync(r.path, { recursive: true, force: true })
    await repairOrphans({ repoDir })
    expect(readMeta(repoDir).agents[id]).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- worktree-manager`
Expected: 2 new tests FAIL.

- [ ] **Step 3: Implement**

Append to `src/main/worktree-manager.js`:

```js
// In-memory lock per repoDir so concurrent IPC calls don't race on meta or git state.
const repoLocks = new Map()
async function withRepoLock(repoDir, fn) {
  const prev = repoLocks.get(repoDir) ?? Promise.resolve()
  let release
  const next = new Promise(r => { release = r })
  repoLocks.set(repoDir, prev.then(() => next))
  await prev
  try { return await fn() }
  finally { release(); if (repoLocks.get(repoDir) === next) repoLocks.delete(repoDir) }
}

export async function closeAllForWorkspace({ repoDir, agentIds }) {
  return withRepoLock(repoDir, async () => {
    for (const id of agentIds) {
      try { await close({ repoDir, agentId: id }) } catch {}
    }
    // Best-effort: drop the worktrees dir if empty
    try {
      const dir = join(repoDir, '.codespace', 'worktrees')
      const entries = require('fs').readdirSync(dir).filter(n => n !== '.cs-meta.json')
      if (entries.length === 0) require('fs').rmSync(dir, { recursive: true, force: true })
    } catch {}
  })
}

export async function repairOrphans({ repoDir }) {
  return withRepoLock(repoDir, async () => {
    const m = readMeta(repoDir)
    let changed = false
    for (const [id, entry] of Object.entries(m.agents)) {
      const wtPath = join(repoDir, '.codespace', 'worktrees', id)
      if (!existsSync(wtPath)) {
        delete m.agents[id]
        changed = true
        // Branch might still exist; only delete if no commits beyond base.
        try {
          const out = execGit(['-C', repoDir, 'rev-list', '--count', `${entry.baseSha}..${entry.branch}`])
          if (parseInt(out.trim(), 10) === 0) {
            try { execGit(['-C', repoDir, 'branch', '-D', entry.branch]) } catch {}
          }
        } catch {}
      }
    }
    try { execGit(['-C', repoDir, 'worktree', 'prune']) } catch {}
    if (changed) writeMeta(repoDir, m)
  })
}
```

Replace the dynamic `require('fs')` with the imports already at the top — use `readdirSync`, `rmSync`. (Add them to the existing import.)

Also wrap the existing `create`, `close` exports in `withRepoLock` for consistency:

```js
const _create = create
export async function create(args) { return withRepoLock(args.repoDir, () => _create(args)) }
const _close = close
export async function close(args) { return withRepoLock(args.repoDir, () => _close(args)) }
```

(Or, simpler: refactor the existing `create`/`close` bodies into `_createImpl`/`_closeImpl` helpers and have `create`/`close` call them through the lock. Keep the test API identical.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- worktree-manager`
Expected: 22/22 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/worktree-manager.js tests/worktree-manager.test.js
git commit -m "feat(worktree): closeAllForWorkspace + repairOrphans + per-repo lock"
```

---

## Task 7: IPC handlers

**Files:**
- Modify: `src/main/ipc-handlers.js`
- Modify: `tests/ipc-handlers.test.js`

Wire the worktree-manager API to the renderer through IPC. Validate input (path absolute, workspaceName/agentId are strings).

- [ ] **Step 1: Write the failing tests**

Append to `tests/ipc-handlers.test.js`:

```js
vi.mock('../src/main/worktree-manager.js', () => ({
  isGitAvailable: vi.fn(() => true),
  isGitRepo:      vi.fn(() => true),
  create:         vi.fn(async () => ({ path: 'C:/repo/.codespace/worktrees/aid', branch: 'cs/x/abcd1234', baseSha: 'sha' })),
  close:          vi.fn(async () => ({ ok: true })),
  closeAllForWorkspace: vi.fn(async () => {}),
  checkDirty:     vi.fn(async () => ({ dirty: false }))
}))

import * as wt from '../src/main/worktree-manager.js'

describe('ipc-handlers / worktree', () => {
  it('registers worktree:* handlers', () => {
    registerHandlers(makeMockWindow())
    for (const ch of ['worktree:isGitAvailable', 'worktree:isGitRepo', 'worktree:create', 'worktree:close', 'worktree:closeAll', 'worktree:checkDirty']) {
      expect(ipcMain.handle).toHaveBeenCalledWith(ch, expect.any(Function))
    }
  })

  it('worktree:create rejects non-absolute repoDir', async () => {
    registerHandlers(makeMockWindow())
    const fn = getHandler('handle', 'worktree:create')
    const r = await fn({}, { repoDir: 'relative/path', workspaceName: 'X', agentId: 'aid' })
    expect(r).toEqual({ error: 'invalid-args' })
    expect(wt.create).not.toHaveBeenCalled()
  })

  it('worktree:create surfaces error code from manager', async () => {
    wt.create.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'no-commits' }))
    registerHandlers(makeMockWindow())
    const fn = getHandler('handle', 'worktree:create')
    const r = await fn({}, { repoDir: 'C:/repo', workspaceName: 'X', agentId: 'aid' })
    expect(r).toEqual({ error: 'no-commits' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- ipc-handlers`
Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement**

In `src/main/ipc-handlers.js`, add at the top alongside other imports:

```js
import * as worktree from './worktree-manager.js'
```

And inside `registerHandlers(mainWindow)`, after the existing handlers:

```js
ipcMain.handle('worktree:isGitAvailable', () => worktree.isGitAvailable())
ipcMain.handle('worktree:isGitRepo', (_e, dir) => {
  if (typeof dir !== 'string' || !isAbsolute(dir)) return false
  return worktree.isGitRepo(dir)
})
ipcMain.handle('worktree:create', async (_e, args) => {
  if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir)
      || typeof args.workspaceName !== 'string' || typeof args.agentId !== 'string') {
    return { error: 'invalid-args' }
  }
  try { return await worktree.create(args) }
  catch (err) { return { error: err.code || 'unknown', detail: err.detail } }
})
ipcMain.handle('worktree:close', async (_e, args) => {
  if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir) || typeof args.agentId !== 'string') {
    return { error: 'invalid-args' }
  }
  try { return await worktree.close(args) }
  catch (err) { return { error: err.code || 'unknown' } }
})
ipcMain.handle('worktree:closeAll', async (_e, args) => {
  if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir) || !Array.isArray(args.agentIds)) {
    return { error: 'invalid-args' }
  }
  try { await worktree.closeAllForWorkspace(args); return { ok: true } }
  catch (err) { return { error: err.code || 'unknown' } }
})
ipcMain.handle('worktree:checkDirty', async (_e, args) => {
  if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir) || typeof args.agentId !== 'string') {
    return { error: 'invalid-args' }
  }
  try { return await worktree.checkDirty(args) }
  catch (err) { return { error: err.code || 'unknown' } }
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- ipc-handlers worktree-manager`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.js tests/ipc-handlers.test.js
git commit -m "feat(worktree): IPC handlers"
```

---

## Task 8: Preload bridge

**Files:**
- Modify: `src/preload/index.js`

Expose the worktree IPC on `electronAPI.worktree`.

- [ ] **Step 1: Edit preload**

Insert after the `editor: { ... }` block in `src/preload/index.js`:

```js
  worktree: {
    isGitAvailable: () => ipcRenderer.invoke('worktree:isGitAvailable'),
    isGitRepo:      (dir) => ipcRenderer.invoke('worktree:isGitRepo', dir),
    create:         (args) => ipcRenderer.invoke('worktree:create', args),
    close:          (args) => ipcRenderer.invoke('worktree:close', args),
    closeAll:       (args) => ipcRenderer.invoke('worktree:closeAll', args),
    checkDirty:     (args) => ipcRenderer.invoke('worktree:checkDirty', args),
  },
```

- [ ] **Step 2: Sanity check (no automated test for the bridge — pattern matches existing surface)**

Run: `npm run build`
Expected: build succeeds, no TypeScript/ESLint errors.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(worktree): expose worktree.* on preload bridge"
```

---

## Task 9: Persist `isolated` on workspace records

**Files:**
- Modify: `src/main/workspaces-store.js`
- Modify: `src/renderer/App.jsx` (two `saveWorkspaces` payload sites)

Round-trip a new boolean field `isolated`. Defaults to false for back-compat with existing `workspaces.json`.

- [ ] **Step 1: Edit workspaces-store.js**

In `loadWorkspaces` (`src/main/workspaces-store.js:55-64`), add `isolated` to the mapping:

```js
return {
  workspaces: parsed.workspaces.map(w => ({
    id: String(w.id),
    name: String(w.name ?? 'Workspace'),
    dir: String(w.dir ?? ''),
    agentCount: Number.isFinite(w.agentCount) ? Math.max(1, Math.min(8, w.agentCount)) : 2,
    isolated: !!w.isolated,
    editor: sanitizeEditor(w.editor)
  })),
  activeWorkspaceId: parsed.activeWorkspaceId ?? null
}
```

In `saveWorkspaces` (`src/main/workspaces-store.js:78-86`), include `isolated` in the safe payload:

```js
const safe = {
  workspaces: (state?.workspaces ?? []).map(w => ({
    id: w.id,
    name: w.name,
    dir: w.dir,
    agentCount: w.agentCount,
    isolated: !!w.isolated,
    editor: sanitizeEditor(w.editor)
  })),
  activeWorkspaceId: state?.activeWorkspaceId ?? null
}
```

- [ ] **Step 2: Edit App.jsx persistence sites**

In `src/renderer/App.jsx:130-136` (debounced save):

```js
window.electronAPI.saveWorkspaces({
  workspaces: persistable.map(w => ({
    id: w.id, name: w.name, dir: w.dir, agentCount: w.agentCount,
    isolated: !!w.isolated,
    editor: w.editor ? { open: w.editor.open, file: w.editor.file, line: w.editor.line, width: w.editor.width } : undefined
  })),
  activeWorkspaceId: activeIsDraft ? (persistable[0]?.id ?? null) : activeId
})
```

In `src/renderer/App.jsx:329-335` (delete-time save):

```js
window.electronAPI.saveWorkspaces({
  workspaces: nextWorkspaces.map(w => ({
    id: w.id, name: w.name, dir: w.dir, agentCount: w.agentCount,
    isolated: !!w.isolated,
    editor: w.editor ? { open: w.editor.open, file: w.editor.file, line: w.editor.line, width: w.editor.width } : undefined
  })),
  activeWorkspaceId: nextActiveId
})
```

- [ ] **Step 3: Run existing store tests if any; otherwise smoke-build**

Run: `npm test`
Expected: existing tests still PASS; no new ones needed (sanitization is trivial and covered by manual smoke later).

- [ ] **Step 4: Commit**

```bash
git add src/main/workspaces-store.js src/renderer/App.jsx
git commit -m "feat(worktree): persist isolated flag on workspace records"
```

---

## Task 10: Onboarding — isolation toggle + git-repo validation

**Files:**
- Modify: `src/renderer/components/Onboarding.jsx`
- Modify: `src/renderer/components/Onboarding.css`
- Modify: `src/renderer/App.jsx` (wire `isolated` through `onLaunch`)

Adds the toggle row below the agent grid and a git-repo check that disables submit when isolation is on but the folder isn't a git repo.

- [ ] **Step 1: Edit Onboarding.jsx**

In `src/renderer/components/Onboarding.jsx`, add isolated state and validation. After `const [projectDir, setProjectDir] = useState(initialDir)`:

```js
const [isolated, setIsolated] = useState(false)
const [isRepo, setIsRepo] = useState(true)

useEffect(() => {
  if (!projectDir) { setIsRepo(true); return }
  let cancelled = false
  window.electronAPI.worktree.isGitRepo(projectDir).then(v => { if (!cancelled) setIsRepo(!!v) })
  return () => { cancelled = true }
}, [projectDir])
```

Update `canLaunch`:

```js
const canLaunch =
  name.trim().length > 0 &&
  projectDir.length > 0 &&
  !launching &&
  (!isolated || isRepo)
```

Update `handleLaunch`:

```js
const handleLaunch = () => {
  if (!canLaunch) return
  setLaunching(true)
  setTimeout(() => onLaunch(selectedCount, projectDir, name.trim(), isolated), ONBOARDING_BOOT_DELAY_MS)
}
```

Add the toggle UI below the right column's `ob-cards` block (still inside the second `<section className="ob-col">`):

```jsx
<div className="ob-field ob-isolation">
  <label className="ob-toggle">
    <input
      type="checkbox"
      checked={isolated}
      onChange={e => setIsolated(e.target.checked)}
    />
    <span className="ob-toggle-track" aria-hidden />
    <span className="ob-toggle-text">
      <span className="ob-toggle-title">Isolated agents</span>
      <span className="ob-toggle-help">
        Each agent gets its own git branch and folder under <code>.codespace/worktrees/</code>. Requires a git repo.
      </span>
    </span>
  </label>
  {isolated && projectDir && !isRepo && (
    <p className="ob-isolation-error">
      This folder isn't a git repo. Run <code>git init</code> there, or turn off isolated agents.
    </p>
  )}
</div>
```

- [ ] **Step 2: Edit Onboarding.css**

Append to `src/renderer/components/Onboarding.css`:

```css
.ob-isolation { margin-top: 16px; }
.ob-toggle {
  display: flex; gap: 12px; align-items: flex-start; cursor: pointer;
}
.ob-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.ob-toggle-track {
  flex: 0 0 auto; width: 32px; height: 18px; border-radius: 999px;
  background: var(--cs-border-subtle, #1b1e24);
  border: 1px solid var(--cs-border, #2b3038);
  position: relative; transition: background 180ms ease;
}
.ob-toggle-track::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--cs-text-dim, #b0b6bf);
  transition: transform 180ms ease, background 180ms ease;
}
.ob-toggle input:checked + .ob-toggle-track { background: var(--cs-cyan-dim, #1e3a44); }
.ob-toggle input:checked + .ob-toggle-track::after { transform: translateX(14px); background: var(--cs-cyan, #67e8f9); }
.ob-toggle-text { display: flex; flex-direction: column; gap: 2px; }
.ob-toggle-title { font-size: 13px; color: var(--cs-text-primary, #e6e9ef); }
.ob-toggle-help { font-size: 11.5px; color: var(--cs-text-dim, #8c93a0); line-height: 1.45; }
.ob-toggle-help code {
  font-family: 'Geist Mono Variable', ui-monospace, monospace;
  font-size: 11px; padding: 0 4px; border-radius: 3px;
  background: var(--cs-bg-elevated, #11151b); color: var(--cs-text-primary, #e6e9ef);
}
.ob-isolation-error {
  margin: 8px 0 0; padding: 8px 10px; border-radius: 6px;
  background: rgba(255, 99, 99, 0.08);
  border: 1px solid rgba(255, 99, 99, 0.22);
  color: #ffb4b4; font-size: 12px; line-height: 1.45;
}
.ob-isolation-error code {
  font-family: 'Geist Mono Variable', ui-monospace, monospace;
  font-size: 11.5px; background: rgba(0,0,0,0.25); padding: 0 4px; border-radius: 3px;
}
```

- [ ] **Step 3: Wire `isolated` into App.jsx onLaunch handlers**

`handleOnboardingLaunch` (line 228 in `src/renderer/App.jsx`):

```js
const handleOnboardingLaunch = useCallback((count, dir, name, isolated) => {
  const resolvedName = (name && name.trim())
    || dir.split(/[\\/]/).filter(Boolean).pop()
    || 'Workspace'
  const ws = {
    id: makeId(),
    name: resolvedName,
    dir,
    agentCount: count,
    isolated: !!isolated,
    terminals: [],
    agentCounter: 0,
    focusedTerminalId: null,
    spawned: false,
    fontSize: 13,
    editor: defaultEditorState()
  }
  setWorkspaces([ws])
  setActiveId(ws.id)
}, [])
```

`handleInitializeDraft` (line 272):

```js
const handleInitializeDraft = useCallback((count, dir, name, isolated) => {
  const resolvedName = (name && name.trim()) || 'New Workspace'
  setWorkspaces(prev => prev.map(w => {
    if (w.id !== activeId || !w.unconfigured) return w
    // Note: terminals are NOT created synchronously here for isolated workspaces — see Task 11.
    // For now (compat with non-isolated), keep behavior; Task 11 reworks this branch.
    const terminals = isolated ? [] : makeAgents(count, dir, 1)
    return {
      ...w,
      name: resolvedName,
      dir,
      agentCount: count,
      isolated: !!isolated,
      terminals,
      agentCounter: count,
      spawned: !isolated, // isolated paths spawn lazily once worktrees exist (Task 11)
      focusedTerminalId: terminals[0]?.id ?? null,
      unconfigured: false
    }
  }))
}, [activeId])
```

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`
- Try creating a workspace pointing at a non-git folder with the toggle off → submit works (current behavior).
- Toggle on → submit disabled; an inline error appears under the toggle.
- Pick a git repo with the toggle on → submit re-enabled.
- (Isolated workspaces still don't actually spawn agents in worktrees yet — that's Task 11. Don't try to run agents in an isolated workspace yet.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/Onboarding.jsx src/renderer/components/Onboarding.css src/renderer/App.jsx
git commit -m "feat(onboarding): isolated-agents toggle + git-repo validation"
```

---

## Task 11: Async agent creation for isolated workspaces

**Files:**
- Modify: `src/renderer/App.jsx`

Replace synchronous `makeAgents(...)` calls with an async path that creates worktrees first. Three call sites: lazy-spawn `useEffect`, `handleInitializeDraft`, `addAgent`. On worktree-create error, surface a non-blocking message and skip the agent.

- [ ] **Step 1: Add a helper at the top of `AppInner` (after `desktopPathRef`)**

```js
const materializeAgents = useCallback(async (workspace, count, startNum) => {
  const agents = []
  for (let i = 0; i < count; i++) {
    const id = makeId()
    let cwd = workspace.dir
    if (workspace.isolated) {
      const r = await window.electronAPI.worktree.create({
        repoDir: workspace.dir,
        workspaceName: workspace.name,
        agentId: id
      })
      if (r?.error) {
        console.error('worktree.create failed', r)
        // Skip this agent — surface via console; future toast wiring is v2 polish.
        continue
      }
      cwd = r.path
    }
    agents.push({
      id, shell: 'claude', agentNum: startNum + i,
      cwd, ptyId: null, autoName: null,
      branch: workspace.isolated ? r.branch : null
    })
  }
  return agents
}, [])
```

(The `r.branch` reference inside the push needs `let r` outside the if — adjust as needed; the intent is the agent record carries its branch name when isolated, used by Task 13.)

A cleaner variant — restructure so `r` is declared above:

```js
const materializeAgents = useCallback(async (workspace, count, startNum) => {
  const agents = []
  for (let i = 0; i < count; i++) {
    const id = makeId()
    let cwd = workspace.dir
    let branch = null
    if (workspace.isolated) {
      const r = await window.electronAPI.worktree.create({
        repoDir: workspace.dir,
        workspaceName: workspace.name,
        agentId: id
      })
      if (r?.error) {
        console.error('worktree.create failed', r)
        continue
      }
      cwd = r.path
      branch = r.branch
    }
    agents.push({
      id, shell: 'claude', agentNum: startNum + i,
      cwd, ptyId: null, autoName: null, branch
    })
  }
  return agents
}, [])
```

- [ ] **Step 2: Replace lazy-spawn `useEffect`**

Change `src/renderer/App.jsx:213-226` from sync to async:

```js
useEffect(() => {
  if (!activeId) return
  let cancelled = false
  ;(async () => {
    const w0 = workspaces.find(x => x.id === activeId)
    if (!w0 || w0.spawned || w0.unconfigured) return
    const terminals = await materializeAgents(w0, w0.agentCount, 1)
    if (cancelled) return
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== activeId || w.spawned) return w
      return {
        ...w,
        terminals,
        agentCounter: w.agentCount,
        spawned: true,
        focusedTerminalId: terminals[0]?.id ?? null
      }
    }))
  })()
  return () => { cancelled = true }
}, [activeId, materializeAgents])
```

(Note: this dep on `workspaces.find(...)` reads the latest by id from the closure. Since the effect only fires on `activeId` change and reads `w0.spawned` once, the initial-spawn race is fine.)

- [ ] **Step 3: Update `handleInitializeDraft` for the isolated path**

Replace the current implementation (Task 10 left a placeholder) with:

```js
const handleInitializeDraft = useCallback(async (count, dir, name, isolated) => {
  const resolvedName = (name && name.trim()) || 'New Workspace'
  const draft = workspaces.find(w => w.id === activeId && w.unconfigured)
  if (!draft) return
  const provisional = { ...draft, name: resolvedName, dir, agentCount: count, isolated: !!isolated }
  const terminals = await materializeAgents(provisional, count, 1)
  setWorkspaces(prev => prev.map(w => {
    if (w.id !== activeId || !w.unconfigured) return w
    return {
      ...w,
      name: resolvedName,
      dir,
      agentCount: count,
      isolated: !!isolated,
      terminals,
      agentCounter: count,
      spawned: true,
      focusedTerminalId: terminals[0]?.id ?? null,
      unconfigured: false
    }
  }))
}, [activeId, workspaces, materializeAgents])
```

- [ ] **Step 4: Update `addAgent`**

Change `src/renderer/App.jsx:378-398`:

```js
const addAgent = useCallback(async () => {
  if (!activeId) return
  const w = workspaces.find(x => x.id === activeId)
  if (!w || w.unconfigured) return
  const used = new Set(w.terminals.map(t => t.agentNum))
  let nextNum = 1
  while (used.has(nextNum)) nextNum++
  const [agent] = await materializeAgents(w, 1, nextNum)
  if (!agent) return // creation failed; abort silently (already logged)
  setWorkspaces(prev => prev.map(x => x.id === activeId ? {
    ...x,
    agentCounter: Math.max(x.agentCounter, nextNum),
    terminals: [...x.terminals, agent]
  } : x))
}, [activeId, workspaces, materializeAgents])
```

- [ ] **Step 5: Manual smoke**

Run: `npm run dev`

- Create an isolated workspace pointing at a known git repo with 3 agents.
- Wait for it to launch (Claude prompts will take a beat).
- In another terminal, run `git -C <repo> worktree list` → expect three worktrees under `.codespace/worktrees/`.
- Run `git -C <repo> branch` → expect three `cs/<slug>/<id>` branches.
- Click "+ Agent" → fourth worktree appears.
- Make different file edits in two panes simultaneously → confirm no collisions in either pane's filesystem view.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(worktree): async agent materialization for isolated workspaces"
```

---

## Task 12: Close-pane lifecycle (dirty confirm + worktree close)

**Files:**
- Modify: `src/renderer/App.jsx`

Single-pane close: peek dirty → if dirty, ConfirmDialog → kill PTY → close worktree.
Workspace delete: closeAllForWorkspace after persistence (no per-agent confirms).

- [ ] **Step 1: Add a dirty-close pending state**

Near `pendingDelete`, add:

```js
const [pendingWorktreeClose, setPendingWorktreeClose] = useState(null)
// shape: { wsId, termId, branch, agentName }
```

- [ ] **Step 2: Replace `removeTerminal`**

Replace `src/renderer/App.jsx:400-417`:

```js
const removeTerminal = useCallback(async (termId) => {
  const w = workspaces.find(x => x.id === activeId)
  if (!w) return
  const target = w.terminals.find(t => t.id === termId)
  if (!target) return

  if (w.isolated) {
    // Peek dirty status before tearing anything down.
    const peek = await window.electronAPI.worktree.checkDirty({ repoDir: w.dir, agentId: termId })
    if (peek?.dirty) {
      setPendingWorktreeClose({
        wsId: w.id, termId, branch: target.branch,
        agentName: target.name || target.autoName || `Agent ${target.agentNum}`
      })
      return
    }
  }

  // Clean (or non-isolated): tear down immediately
  finalizeTerminalRemoval(w, target)
}, [activeId, workspaces])

function finalizeTerminalRemoval(w, target) {
  if (target.ptyId) ptyPool.killPty(target.ptyId)
  else ptyPool.cancelCreate(target.id)

  if (w.isolated) {
    // Fire-and-forget; main is single-writer and tolerates errors.
    window.electronAPI.worktree.close({ repoDir: w.dir, agentId: target.id })
      .catch(err => console.error('worktree.close failed', err))
  }

  setWorkspaces(prev => prev.map(x => {
    if (x.id !== w.id) return x
    const remaining = x.terminals
      .filter(t => t.id !== target.id)
      .map((t, i) => ({ ...t, agentNum: i + 1 }))
    return {
      ...x,
      terminals: remaining,
      agentCounter: remaining.length,
      focusedTerminalId: x.focusedTerminalId === target.id ? null : x.focusedTerminalId
    }
  }))
}
```

(Hoist `finalizeTerminalRemoval` to a `useCallback` if your linter complains; keep deps `[setWorkspaces]`.)

- [ ] **Step 3: Render the dirty-close ConfirmDialog**

In JSX near the existing `pendingDeleteWorkspace` dialog block (around `src/renderer/App.jsx:758`), add:

```jsx
{pendingWorktreeClose && (
  <ConfirmDialog
    title="Discard agent's uncommitted changes?"
    message={
      <>
        <strong className="cd-emphasis">{pendingWorktreeClose.agentName}</strong> has uncommitted changes in <code>{pendingWorktreeClose.branch}</code>. The worktree will be removed and the changes lost. Committed work on the branch is preserved.
      </>
    }
    confirmLabel="Discard and close"
    cancelLabel="Cancel"
    destructive
    onConfirm={() => {
      const { wsId, termId } = pendingWorktreeClose
      setPendingWorktreeClose(null)
      const w = workspaces.find(x => x.id === wsId)
      const target = w?.terminals.find(t => t.id === termId)
      if (w && target) finalizeTerminalRemoval(w, target)
    }}
    onCancel={() => setPendingWorktreeClose(null)}
  />
)}
```

- [ ] **Step 4: Update `handleConfirmDelete` to close all worktrees on workspace deletion**

In `src/renderer/App.jsx:321-360`, after `setPendingDelete(null)` and BEFORE the staggered PTY kills, add a `closeAll` call:

```js
// Released-then-cleanup ordering: kill PTYs first (so files are released),
// then ask main to clean up all worktrees + branches in one call.
if (target?.isolated) {
  const agentIds = (target.terminals ?? []).map(t => t.id)
  // Fire after PTY kills are scheduled — main will retry on locked files anyway.
  setTimeout(() => {
    window.electronAPI.worktree.closeAll({ repoDir: target.dir, agentIds })
      .catch(err => console.error('worktree.closeAll failed', err))
  }, agentIds.length * 80 + 100)
}
```

- [ ] **Step 5: Manual smoke**

Run: `npm run dev`

- Open an isolated workspace with 2 agents.
- In one pane, create an untracked file (`echo hi > scratch.txt`).
- Close that pane → confirm modal appears with the branch name.
- Cancel → pane stays.
- Close again, this time confirm → pane goes; verify in another shell that `git worktree list` no longer shows it; verify branch is gone (since no commits were made).
- In the other pane, commit a change, then close pane → no confirm; pane goes; worktree gone but `git branch` still shows that agent's branch.
- Delete the whole workspace → all remaining worktrees and clean-branches are gone.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(worktree): close-pane dirty confirm + workspace-delete cleanup"
```

---

## Task 13: TerminalPane — branch line in pane header

**Files:**
- Modify: `src/renderer/components/TerminalPane.jsx`
- Modify: `src/renderer/components/TerminalPane.css`

For isolated workspaces, render a dim branch line under the agent name. Click to copy.

- [ ] **Step 1: Edit TerminalPane.jsx**

Add `branch` to the prop list and pass it through from App.jsx (already on `t.branch` from Task 11). Inside the pane header, where the agent name renders, add a sibling element when `branch` is non-null:

```jsx
{branch && (
  <button
    type="button"
    className="tp-branch"
    title={`${branch} — click to copy`}
    onClick={(e) => {
      e.stopPropagation()
      window.electronAPI.writeClipboardText(branch)
    }}
  >
    <span className="tp-branch-icon" aria-hidden>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    </span>
    <span className="tp-branch-text">{branch}</span>
  </button>
)}
```

In `App.jsx`, pass `branch={t.branch}` when rendering each `<TerminalPane ...>`.

- [ ] **Step 2: Edit TerminalPane.css**

Append:

```css
.tp-branch {
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 2px; padding: 1px 4px;
  background: transparent; border: 0; cursor: pointer;
  font-family: 'Geist Mono Variable', ui-monospace, monospace;
  font-size: 10.5px; color: var(--cs-text-dim, #8c93a0);
  border-radius: 3px;
  max-width: 100%; min-width: 0;
}
.tp-branch:hover { color: var(--cs-text-primary, #e6e9ef); background: var(--cs-bg-elevated, #11151b); }
.tp-branch-icon { display: inline-flex; opacity: 0.85; flex: 0 0 auto; }
.tp-branch-text {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
}
```

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`

- Open isolated workspace → each pane header shows the dim branch line.
- Click branch → confirm clipboard now has the branch name (paste it somewhere).
- Resize a pane narrow → branch text middle/end-truncates without overflowing.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TerminalPane.jsx src/renderer/components/TerminalPane.css src/renderer/App.jsx
git commit -m "feat(worktree): show branch in TerminalPane header for isolated workspaces"
```

---

## Task 14: Sidebar — isolation glyph

**Files:**
- Modify: `src/renderer/components/Sidebar.jsx`
- Modify: `src/renderer/components/Sidebar.css`

Tiny branch icon next to a workspace's name when `isolated: true`. No text. Tooltip "Isolated agents."

- [ ] **Step 1: Edit Sidebar.jsx**

In the workspace row JSX, render the icon to the right of the name when `w.isolated`:

```jsx
{w.isolated && (
  <span className="sb-iso" title="Isolated agents" aria-label="Isolated agents">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  </span>
)}
```

- [ ] **Step 2: Edit Sidebar.css**

Append:

```css
.sb-iso {
  display: inline-flex; align-items: center;
  margin-left: 6px; opacity: 0.55;
  color: var(--cs-text-dim, #8c93a0);
}
.sb-iso:hover { opacity: 0.9; color: var(--cs-cyan, #67e8f9); }
```

- [ ] **Step 3: Manual smoke**

Run: `npm run dev`

- Verify the glyph appears on isolated workspaces, not on shared ones.
- Hover → tooltip "Isolated agents".

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Sidebar.jsx src/renderer/components/Sidebar.css
git commit -m "feat(worktree): sidebar isolation glyph"
```

---

## Task 15: Sweep last-session worktrees on activation + repairOrphans on boot

**Files:**
- Modify: `src/main/worktree-manager.js`
- Modify: `tests/worktree-manager.test.js`
- Modify: `src/main/ipc-handlers.js`
- Modify: `src/preload/index.js`
- Modify: `src/renderer/App.jsx`

**Why this task exists:** Agent UUIDs are session-only — they're regenerated every time the app starts (`makeAgents` calls `crypto.randomUUID()` fresh). So when you reopen an isolated workspace, the meta file's old agent IDs no longer match any live in-app agent, and the on-disk worktrees from the previous session would accumulate forever. Two cleanups are needed:

1. **`wipeAll`** (new): close every meta-tracked worktree for a repo. Run on activation of an isolated workspace, BEFORE materializing fresh agents. Branches with committed work survive (via existing `close` logic); branches with no commits are pruned.
2. **`repairOrphans`** (already built in Task 6): drops meta entries whose worktree directory has been manually deleted by the user. Run once at boot for safety.

- [ ] **Step 1: Implement `wipeAll` in worktree-manager.js**

Append:

```js
export async function wipeAll({ repoDir }) {
  return withRepoLock(repoDir, async () => {
    const m = readMeta(repoDir)
    const ids = Object.keys(m.agents)
    for (const id of ids) {
      try { await _closeImpl({ repoDir, agentId: id }) } catch {}
    }
    try { execGit(['-C', repoDir, 'worktree', 'prune']) } catch {}
    try {
      const dir = join(repoDir, '.codespace', 'worktrees')
      const entries = readdirSync(dir).filter(n => n !== '.cs-meta.json')
      if (entries.length === 0) rmSync(dir, { recursive: true, force: true })
    } catch {}
  })
}
```

(`_closeImpl` is the un-locked variant of `close` introduced in Task 6 when wrapping with `withRepoLock`. If you didn't extract it during Task 6, do so now: rename the original `close` body to `_closeImpl({...})`, and have the exported `close` call `withRepoLock(args.repoDir, () => _closeImpl(args))`.)

- [ ] **Step 2: Add a test for wipeAll**

Append to `tests/worktree-manager.test.js`:

```js
import { wipeAll } from '../src/main/worktree-manager.js'

describe('worktree-manager / wipeAll', () => {
  let root, repoDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-wipe-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir })
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('removes every meta-tracked worktree and clears meta', async () => {
    const ids = ['w1111111-0000-0000-0000-000000000000', 'w2222222-0000-0000-0000-000000000000']
    for (const id of ids) await create({ repoDir, workspaceName: 'X', agentId: id })
    await wipeAll({ repoDir })
    for (const id of ids) {
      expect(existsSync(join(repoDir, '.codespace', 'worktrees', id))).toBe(false)
      expect(readMeta(repoDir).agents[id]).toBeUndefined()
    }
  })

  it('keeps a branch that has commits beyond base', async () => {
    const id = 'w3333333-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'X', agentId: id })
    writeFileSync(join(r.path, 'k.txt'), 'k')
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-C', r.path, 'add', 'k.txt'])
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-C', r.path, 'commit', '-m', 'k'])
    await wipeAll({ repoDir })
    const branches = execFileSync('git', ['-C', repoDir, 'branch', '--list', r.branch], { encoding: 'utf8' })
    expect(branches).toContain(r.branch)
  })
})
```

Run: `npm test -- worktree-manager`
Expected: 2 new tests fail → after step 1, all PASS.

- [ ] **Step 3: Expose `worktree:wipeAll` and `worktree:repairOrphans` IPCs**

Add to `src/main/ipc-handlers.js` after the existing `worktree:*` handlers:

```js
ipcMain.handle('worktree:wipeAll', async (_e, args) => {
  if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir)) return { error: 'invalid-args' }
  try { await worktree.wipeAll(args); return { ok: true } }
  catch (err) { return { error: err.code || 'unknown' } }
})

ipcMain.handle('worktree:repairOrphans', async (_e, args) => {
  if (!args || typeof args.repoDir !== 'string' || !isAbsolute(args.repoDir)) return { error: 'invalid-args' }
  try { await worktree.repairOrphans(args); return { ok: true } }
  catch (err) { return { error: err.code || 'unknown' } }
})
```

- [ ] **Step 4: Expose them on the preload bridge**

In `src/preload/index.js`, extend the `worktree` block:

```js
worktree: {
  isGitAvailable: () => ipcRenderer.invoke('worktree:isGitAvailable'),
  isGitRepo:      (dir) => ipcRenderer.invoke('worktree:isGitRepo', dir),
  create:         (args) => ipcRenderer.invoke('worktree:create', args),
  close:          (args) => ipcRenderer.invoke('worktree:close', args),
  closeAll:       (args) => ipcRenderer.invoke('worktree:closeAll', args),
  checkDirty:     (args) => ipcRenderer.invoke('worktree:checkDirty', args),
  wipeAll:        (args) => ipcRenderer.invoke('worktree:wipeAll', args),
  repairOrphans:  (args) => ipcRenderer.invoke('worktree:repairOrphans', args),
},
```

- [ ] **Step 5: Wire into App.jsx — wipe before lazy-spawn; repair on boot**

In `AppInner`, add an at-load housekeeping effect right after the persistence-load effect (after `setLoaded(true)`):

```js
useEffect(() => {
  if (!loaded) return
  for (const w of workspaces) {
    if (!w.isolated) continue
    window.electronAPI.worktree.repairOrphans({ repoDir: w.dir }).catch(() => {})
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [loaded])
```

Modify the lazy-spawn effect from Task 11 to wipe stale state BEFORE materializing:

```js
useEffect(() => {
  if (!activeId) return
  let cancelled = false
  ;(async () => {
    const w0 = workspaces.find(x => x.id === activeId)
    if (!w0 || w0.spawned || w0.unconfigured) return
    if (w0.isolated) {
      // Last session's worktrees are orphans now — agent UUIDs are session-only.
      // Wipe them; branches with commits survive.
      try { await window.electronAPI.worktree.wipeAll({ repoDir: w0.dir }) } catch {}
    }
    if (cancelled) return
    const terminals = await materializeAgents(w0, w0.agentCount, 1)
    if (cancelled) return
    setWorkspaces(prev => prev.map(w => {
      if (w.id !== activeId || w.spawned) return w
      return {
        ...w,
        terminals,
        agentCounter: w.agentCount,
        spawned: true,
        focusedTerminalId: terminals[0]?.id ?? null
      }
    }))
  })()
  return () => { cancelled = true }
}, [activeId, materializeAgents])
```

- [ ] **Step 6: Full manual smoke against the spec's test plan**

Run: `npm run dev`

Run through every entry in the spec's `## Test plan / Manual smoke` block (`docs/superpowers/specs/2026-05-09-isolated-agents-design.md`):

- Create a non-isolated workspace → confirm current behavior unchanged.
- Create an isolated workspace in a git repo → spawn 3 agents → verify three worktrees on three branches in `git worktree list`.
- Have agent 1 edit file A, agent 2 edit file B simultaneously; confirm no collisions.
- Commit in agent 1, close pane → branch survives; reopen workspace → committed branch still present in `git branch`, but old worktree is gone (replaced by a fresh one for the new session's agent).
- Close pane with uncommitted changes → confirm modal; discard → worktree gone, branch gone.
- Delete an isolated workspace → all worktrees removed; clean branches gone; branches with commits remain.
- Try to create an isolated workspace pointing at a non-git folder → submit blocked with inline error.
- Quit and relaunch the app → activate the isolated workspace → previous session's worktrees are gone (replaced by fresh ones); committed branches from prior sessions still exist in `git branch`.
- Delete `<repo>/.codespace/worktrees/<agentId>` manually with the app closed; relaunch → no errors; meta entries reconciled silently.

- [ ] **Step 7: Commit**

```bash
git add src/main/worktree-manager.js tests/worktree-manager.test.js src/main/ipc-handlers.js src/preload/index.js src/renderer/App.jsx
git commit -m "feat(worktree): wipeAll on activation + repairOrphans on boot"
```

- [ ] **Step 2: Full manual smoke against the spec's test plan**

Run: `npm run dev`

Run through every entry in the spec's `## Test plan / Manual smoke` block (`docs/superpowers/specs/2026-05-09-isolated-agents-design.md`):

- Create a non-isolated workspace → confirm current behavior unchanged.
- Create an isolated workspace in a git repo → spawn 3 agents → verify three worktrees on three branches in `git worktree list`.
- Have agent 1 edit file A, agent 2 edit file B simultaneously; confirm no collisions.
- Commit in agent 1, close pane → branch survives; reopen workspace → committed branch still present.
- Close pane with uncommitted changes → confirm modal; discard → worktree gone, branch gone.
- Delete an isolated workspace → all worktrees removed; no orphan branches for that workspace remain.
- Try to create an isolated workspace pointing at a non-git folder → submit blocked with inline error.
- Delete `<repo>/.codespace/worktrees/<agentId>` manually with the app closed; relaunch → no errors; meta entry pruned silently.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.jsx src/main/ipc-handlers.js src/preload/index.js
git commit -m "feat(worktree): repair orphans on app startup"
```

---

## Self-review notes (post-write)

- All `Background reading` files match real lines I verified during planning.
- Branch slug `cs/<workspace-slug>/<uuid8>` is consistent across spec, Task 4 (`pickBranchName`), Task 13 example, Task 14 example.
- Manager exports — `isGitAvailable`, `isGitRepo`, `create`, `close`, `closeAllForWorkspace`, `checkDirty`, `wipeAll`, `repairOrphans`, `ensureGitignoreExcludes`, `readMeta`, `writeMeta`, `META_DEFAULT` — every consumed name shows up as a manager export and (where externally used) an IPC handler and a preload bridge entry.
- `crypto.randomUUID()` is available in renderer (already used at `src/renderer/App.jsx:25`) and node ≥14.17. Tests use full hard-coded UUIDs to avoid coupling to env.
- Spec's `force?` flag refinement to two IPCs (`checkDirty` + `close`) is documented at the top of this plan; behavior is identical to spec.
- The `tests/` flat layout matches existing convention (`tests/pty-manager.test.js`, etc.).
- **Spec gap caught & filled by Task 15:** The spec assumed agent IDs persist across sessions ("reuse the existing worktree at the deterministic path"). They don't — `crypto.randomUUID()` regenerates each session. The plan adds `wipeAll` on activation as the v1 fix; orphan worktrees from prior sessions are torn down (committed branches survive) before fresh agents are materialized. This deviation should be reflected in the spec on the next pass.
- No "TODO" / "TBD" / "fill in" / "similar to". Every code block is complete.
