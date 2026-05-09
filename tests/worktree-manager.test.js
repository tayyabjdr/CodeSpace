// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
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

  it('default returns are independent across calls', () => {
    const m1 = readMeta(join(root, 'doesnotexist1'))
    m1.agents['x'] = { branch: 'cs/x/aaaa' }
    const m2 = readMeta(join(root, 'doesnotexist2'))
    expect(m2.agents).toEqual({})
  })
})
