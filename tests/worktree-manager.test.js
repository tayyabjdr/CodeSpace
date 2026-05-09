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
