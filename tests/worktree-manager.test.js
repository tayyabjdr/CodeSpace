// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

import { isGitAvailable, isGitRepo, ensureGitignoreExcludes } from '../src/main/worktree-manager.js'

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

import { readMeta, writeMeta, META_DEFAULT, create } from '../src/main/worktree-manager.js'

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
    expect(r.path).toBe(join(repoDir, '.codespace', 'worktrees', agentId))
    expect(existsSync(r.path)).toBe(true)
    expect(r.branch).toMatch(/^cs\/codespace\/11111111$/)
    const list = execFileSync('git', ['-C', repoDir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
    expect(list).toContain(r.path.replace(/\\/g, '/'))
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
