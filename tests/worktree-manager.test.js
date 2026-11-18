// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

import { isGitAvailable, isGitRepo, canIsolate, ensureLocalExcludes, worktreePath } from '../src/main/worktree-manager.js'

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

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}
function commitAll(cwd, msg) {
  execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-C', cwd, 'add', '-A'])
  execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-C', cwd, 'commit', '-m', msg])
}

describe('worktree-manager / canIsolate', () => {
  let root
  beforeAll(() => { root = mkdtempSync(join(tmpdir(), 'cs-wt-ci-')) })
  afterAll(() => { rmSync(root, { recursive: true, force: true }) })

  it('reports each reason', () => {
    const withCommit = join(root, 'with commit')
    const emptyInit = join(root, 'empty')
    const plain = join(root, 'plain')
    for (const d of [withCommit, emptyInit, plain]) mkdirSync(d)
    for (const d of [withCommit, emptyInit]) execFileSync('git', ['init', '-q'], { cwd: d })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: withCommit })
    expect(canIsolate(withCommit)).toEqual({ ok: true, reason: null })
    expect(canIsolate(emptyInit)).toEqual({ ok: false, reason: 'no-commits' })
    expect(canIsolate(plain)).toEqual({ ok: false, reason: 'not-a-repo' })
  })
})

describe('worktree-manager / worktreePath', () => {
  it('places worktrees beside the repo under .codespace-worktrees/<repo>/<id>', () => {
    const repo = join(tmpdir(), 'some parent', 'my repo')
    expect(worktreePath(repo, 'abc')).toBe(join(tmpdir(), 'some parent', '.codespace-worktrees', 'my repo', 'abc'))
  })

  it('falls back to the nested legacy path for a drive-root repo', () => {
    const rootDir = process.platform === 'win32' ? 'C:\\' : '/'
    expect(worktreePath(rootDir, 'abc')).toBe(join(rootDir, '.codespace', 'worktrees', 'abc'))
  })
})

describe('worktree-manager / ensureLocalExcludes', () => {
  let root, repoDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-ex-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
  })
  afterAll(() => { rmSync(root, { recursive: true, force: true }) })

  it('adds each line once and never touches .gitignore', () => {
    ensureLocalExcludes(repoDir)
    ensureLocalExcludes(repoDir)
    const body = readFileSync(join(repoDir, '.git', 'info', 'exclude'), 'utf8')
    expect(body.match(/^\.codespace\/$/gm)).toHaveLength(1)
    expect(body.match(/^\/node_modules$/gm)).toHaveLength(1)
    expect(existsSync(join(repoDir, '.gitignore'))).toBe(false)
  })

  it('appends to an existing exclude file without a trailing newline', () => {
    const exclude = join(repoDir, '.git', 'info', 'exclude')
    writeFileSync(exclude, '*.log')
    ensureLocalExcludes(repoDir)
    const body = readFileSync(exclude, 'utf8')
    expect(body).toContain('*.log\n')
    expect(body).toContain('.codespace/')
  })
})

import { readMeta, writeMeta, META_DEFAULT, create, checkDirty, close, closeAllForWorkspace, repairOrphans, wipeAll, discard } from '../src/main/worktree-manager.js'

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

  it('default returns are independent across calls', () => {
    const m1 = readMeta(join(root, 'doesnotexist1'))
    m1.agents['x'] = { branch: 'cs/x/aaaa' }
    const m2 = readMeta(join(root, 'doesnotexist2'))
    expect(m2.agents).toEqual({})
  })
})

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
    expect(r.path).toBe(join(root, '.codespace-worktrees', 'repo', agentId))
    expect(existsSync(r.path)).toBe(true)
    expect(r.branch).toMatch(/^cs\/codespace\/11111111$/)
    const list = execFileSync('git', ['-C', repoDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    expect(list).toContain(r.path.replace(/\\/g, '/'))
  })

  it('records the agent in the meta file with branch and baseSha', async () => {
    const agentId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const r = await create({ repoDir, workspaceName: 'CodeSpace', agentId })
    const meta = readMeta(repoDir)
    expect(meta.agents[agentId]).toMatchObject({ path: r.path, branch: r.branch, baseSha: r.baseSha })
    expect(meta.agents[agentId].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('leaves the main folder clean and excludes locally', async () => {
    await create({ repoDir, workspaceName: 'CodeSpace', agentId: 'a1111111-0000-0000-0000-000000000000' })
    await create({ repoDir, workspaceName: 'CodeSpace', agentId: 'a2222222-0000-0000-0000-000000000000' })
    expect(git(repoDir, 'status', '--porcelain').trim()).toBe('')
    expect(existsSync(join(repoDir, '.gitignore'))).toBe(false)
    const body = readFileSync(join(repoDir, '.git', 'info', 'exclude'), 'utf8')
    expect(body.match(/^\.codespace\/$/gm)).toHaveLength(1)
  })

  it('retries with -2 suffix on branch collision', async () => {
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
      expect(existsSync(worktreePath(repoDir, id))).toBe(false)
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
      expect(existsSync(worktreePath(repoDir, id))).toBe(false)
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

  it('skips worktrees with uncommitted changes and reports them in kept', async () => {
    const dirtyId = 'w4444444-0000-0000-0000-000000000000'
    const cleanId = 'w5555555-0000-0000-0000-000000000000'
    const dirty = await create({ repoDir, workspaceName: 'X', agentId: dirtyId })
    await create({ repoDir, workspaceName: 'X', agentId: cleanId })
    // Make dirtyId actually dirty (uncommitted untracked file)
    writeFileSync(join(dirty.path, 'unsaved.txt'), 'in-flight work')

    const result = await wipeAll({ repoDir })

    // Dirty one survives intact
    expect(existsSync(worktreePath(repoDir, dirtyId))).toBe(true)
    expect(readMeta(repoDir).agents[dirtyId]).toBeDefined()
    expect(result.kept.map(k => k.agentId)).toContain(dirtyId)
    expect(result.kept.find(k => k.agentId === dirtyId).branch).toBe(dirty.branch)

    // Clean one is gone
    expect(existsSync(worktreePath(repoDir, cleanId))).toBe(false)
    expect(readMeta(repoDir).agents[cleanId]).toBeUndefined()
  })
})

describe('worktree-manager / safe wipes and removal', () => {
  let root, repoDir

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-safe-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir })
  })
  afterAll(() => { rmSync(root, { recursive: true, force: true }) })

  it('wipeAll skips live agents of another workspace on the same repo', async () => {
    const idA = 'f1111111-0000-0000-0000-000000000000'
    const a = await create({ repoDir, workspaceName: 'w', agentId: idA })
    const r = await wipeAll({ repoDir, liveAgentIds: [idA] })
    expect(existsSync(a.path)).toBe(true)
    expect(readMeta(repoDir).agents[idA]).toBeTruthy()
    expect(r.stranded).toEqual([])
    await close({ repoDir, agentId: idA })
  })

  it('wipeAll lists unmerged cs/ branches as stranded, excluding live ones', async () => {
    const closedId = 'f2222222-0000-0000-0000-000000000000'
    const liveId = 'f3333333-0000-0000-0000-000000000000'
    const closed = await create({ repoDir, workspaceName: 'w', agentId: closedId })
    const live = await create({ repoDir, workspaceName: 'w', agentId: liveId })
    writeFileSync(join(closed.path, 'c.txt'), 'c')
    commitAll(closed.path, 'c')
    writeFileSync(join(live.path, 'l.txt'), 'l')
    commitAll(live.path, 'l')
    const r = await wipeAll({ repoDir, liveAgentIds: [liveId] })
    expect(r.stranded).toEqual([{ branch: closed.branch, ahead: 1 }])
    expect(existsSync(closed.path)).toBe(false)
    expect(existsSync(live.path)).toBe(true)
    await close({ repoDir, agentId: liveId })
  })

  it('close prunes the empty .codespace-worktrees folders', async () => {
    const id = 'f4444444-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'w', agentId: id })
    expect(existsSync(join(root, '.codespace-worktrees', 'repo'))).toBe(true)
    const others = Object.keys(readMeta(repoDir).agents).filter(k => k !== id)
    await closeAllForWorkspace({ repoDir, agentIds: [id, ...others] })
    expect(existsSync(r.path)).toBe(false)
    expect(existsSync(join(root, '.codespace-worktrees'))).toBe(false)
  })

  it('removes a v1 worktree that has no path in its meta entry', async () => {
    const id = 'f5555555-0000-0000-0000-000000000000'
    const legacy = join(repoDir, '.codespace', 'worktrees', id)
    git(repoDir, 'worktree', 'add', '-b', 'cs/legacy/f5555555', legacy, 'HEAD')
    const meta = readMeta(repoDir)
    meta.agents[id] = { branch: 'cs/legacy/f5555555', baseSha: git(repoDir, 'rev-parse', 'HEAD').trim(), createdAt: new Date().toISOString() }
    writeMeta(repoDir, meta)
    expect(await checkDirty({ repoDir, agentId: id })).toEqual({ dirty: false })
    await close({ repoDir, agentId: id })
    expect(existsSync(legacy)).toBe(false)
    expect(readMeta(repoDir).agents[id]).toBeUndefined()
  })

  it('close removes the folder even when git refuses to (locked worktree)', async () => {
    const id = 'f6666666-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'w', agentId: id })
    git(repoDir, 'worktree', 'lock', r.path)
    await close({ repoDir, agentId: id })
    expect(existsSync(r.path)).toBe(false)
  })
})

describe('worktree-manager / discard', () => {
  let root, repoDir
  const branchExists = (b) => execFileSync('git', ['-C', repoDir, 'branch', '--list', b], { encoding: 'utf8' }).includes(b)

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'cs-wt-discard-'))
    repoDir = join(root, 'repo')
    mkdirSync(repoDir)
    execFileSync('git', ['init', '-q'], { cwd: repoDir })
    execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'init'], { cwd: repoDir })
  })
  afterAll(() => { rmSync(root, { recursive: true, force: true }) })

  it('deletes a kept dirty agent: folder, meta entry and its branch with commits', async () => {
    const id = 'd1111111-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'w', agentId: id })
    writeFileSync(join(r.path, 'c.txt'), 'c')
    commitAll(r.path, 'c')
    writeFileSync(join(r.path, 'draft.txt'), 'unsaved')
    const wiped = await wipeAll({ repoDir })
    expect(wiped.kept.map(k => k.agentId)).toContain(id)

    const res = await discard({ repoDir, agentId: id })
    expect(res).toEqual({ ok: true })
    expect(existsSync(r.path)).toBe(false)
    expect(readMeta(repoDir).agents[id]).toBeUndefined()
    expect(branchExists(r.branch)).toBe(false)
  })

  it('refuses a live agent and touches nothing', async () => {
    const id = 'd2222222-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'w', agentId: id })
    const res = await discard({ repoDir, agentId: id, liveAgentIds: [id] })
    expect(res).toEqual({ ok: false, error: 'live' })
    expect(existsSync(r.path)).toBe(true)
    await close({ repoDir, agentId: id })
  })

  it('deletes a stranded cs/ branch, and refuses branches outside cs/ or still in use', async () => {
    const id = 'd3333333-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'w', agentId: id })
    writeFileSync(join(r.path, 's.txt'), 's')
    commitAll(r.path, 's')
    expect(await discard({ repoDir, branch: r.branch })).toEqual({ ok: false, error: 'in-use' })
    const wiped = await wipeAll({ repoDir })
    expect(wiped.stranded.map(s => s.branch)).toContain(r.branch)

    expect(await discard({ repoDir, branch: 'master' })).toEqual({ ok: false, error: 'invalid-branch' })
    expect(await discard({ repoDir, branch: r.branch })).toEqual({ ok: true })
    expect(branchExists(r.branch)).toBe(false)
  })

  it('treats an agent that is already cleaned up as discarded', async () => {
    expect(await discard({ repoDir, agentId: 'nope' })).toEqual({ ok: true, gone: true })
  })

  it('deletes the leftover branch of an agent whose folder and entry are already gone', async () => {
    const id = 'aaaa1111-0000-0000-0000-000000000000'
    execFileSync('git', ['-C', repoDir, 'branch', 'cs/gone/aaaa1111'])
    expect(await discard({ repoDir, agentId: id, branch: 'cs/gone/aaaa1111' })).toEqual({ ok: true, gone: true })
    expect(branchExists('cs/gone/aaaa1111')).toBe(false)
  })

  it('never deletes a non-CodeSpace branch for a gone agent', async () => {
    const main = execFileSync('git', ['-C', repoDir, 'branch', '--show-current'], { encoding: 'utf8' }).trim()
    expect(await discard({ repoDir, agentId: 'nope', branch: main })).toEqual({ ok: true, gone: true })
    expect(branchExists(main)).toBe(true)
  })
})
