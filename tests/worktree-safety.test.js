// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

import { canIsolate, create, close, checkDirty, wipeAll, closeAllForWorkspace, readMeta } from '../src/main/worktree-manager.js'
import { readFileSync } from 'fs'
import { claudeConfigPath, projectKey } from '../src/main/claude-trust.js'
import { removeAllLinks } from '../src/main/worktree-setup.js'

vi.setConfig({ testTimeout: 30000 })

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
function makeRepo(dir) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'master')
  git(dir, 'config', 'user.email', 't@e')
  git(dir, 'config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

let root, repoDir, n = 0
const newId = () => `5afe000${++n}-aaaa-bbbb-cccc-dddddddddddd`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cs-safety-'))
  repoDir = makeRepo(join(root, 'with space'))
})

afterEach(() => {
  const wtRoot = join(root, '.codespace-worktrees')
  try {
    for (const repo of readdirSync(wtRoot)) {
      for (const id of readdirSync(join(wtRoot, repo))) {
        try { removeAllLinks(join(wtRoot, repo, id)) } catch {}
      }
    }
  } catch {}
  rmSync(root, { recursive: true, force: true })
})

describe('subfolder and drive-root workspaces', () => {
  it('canIsolate refuses a folder inside a repo, and create throws not-repo-root', async () => {
    const sub = join(repoDir, 'packages', 'app')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'package.json'), '{}')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-q', '-m', 'sub')
    expect(canIsolate(sub)).toEqual({ ok: false, reason: 'not-repo-root' })
    await expect(create({ repoDir: sub, workspaceName: 'w', agentId: newId() })).rejects.toMatchObject({ code: 'not-repo-root' })
    expect(existsSync(join(repoDir, 'packages', '.codespace-worktrees'))).toBe(false)
    expect(git(repoDir, 'status', '--porcelain').trim()).toBe('')
    expect(git(repoDir, 'branch', '--list', 'cs/*').trim()).toBe('')
  })

  it('canIsolate accepts the repo root however it is spelled', () => {
    expect(canIsolate(repoDir)).toEqual({ ok: true, reason: null })
    expect(canIsolate(repoDir + '\\')).toEqual({ ok: true, reason: null })
    expect(canIsolate(repoDir[0].toLowerCase() + repoDir.slice(1))).toEqual({ ok: true, reason: null })
  })

  it('canIsolate refuses a repo at a drive root, and create throws drive-root', async () => {
    // Map the repo to a spare drive letter so it sits at a drive root.
    const used = new Set(execFileSync('cmd.exe', ['/d', '/c', 'subst'], { encoding: 'utf8' })
      .split(/\r?\n/).map(l => l.slice(0, 1).toUpperCase()))
    let letter = null
    for (const c of 'QRSTUVWXYZ') {
      if (!used.has(c) && !existsSync(`${c}:\\`)) { letter = c; break }
    }
    if (!letter) return // no spare letter on this machine
    execFileSync('subst', [`${letter}:`, repoDir])
    try {
      const driveRoot = `${letter}:\\`
      expect(canIsolate(driveRoot)).toEqual({ ok: false, reason: 'drive-root' })
      await expect(create({ repoDir: driveRoot, workspaceName: 'w', agentId: newId() })).rejects.toMatchObject({ code: 'drive-root' })
      expect(existsSync(join(repoDir, '.codespace', 'worktrees'))).toBe(false)
      expect(git(repoDir, 'branch', '--list', 'cs/*').trim()).toBe('')
    } finally {
      execFileSync('subst', [`${letter}:`, '/d'])
    }
  })
})

describe('unreadable worktrees are treated as dirty', () => {
  it('checkDirty reports dirty and unreadable once the repo has been moved', async () => {
    const id = newId()
    const r = await create({ repoDir, workspaceName: 'w', agentId: id })
    writeFileSync(join(r.path, 'precious.txt'), 'uncommitted agent work')
    const moved = join(root, 'with space renamed')
    renameSync(repoDir, moved)
    expect(await checkDirty({ repoDir: moved, agentId: id })).toMatchObject({ dirty: true, unreadable: true })
  })

  it('wipeAll keeps a worktree git cannot read, with reason unreadable', async () => {
    const id = newId()
    const r = await create({ repoDir, workspaceName: 'w', agentId: id })
    writeFileSync(join(r.path, 'precious.txt'), 'uncommitted agent work')
    const moved = join(root, 'with space renamed')
    renameSync(repoDir, moved)
    const res = await wipeAll({ repoDir: moved, liveAgentIds: [] })
    expect(existsSync(join(r.path, 'precious.txt'))).toBe(true)
    const kept = res.kept.find(k => k.agentId === id)
    expect(kept).toMatchObject({ agentId: id, reason: 'unreadable', path: r.path })
    expect(typeof kept.detail).toBe('string')
    expect(readMeta(moved).agents[id]).toBeTruthy()
  })
})

describe('closeAllForWorkspace keeps uncommitted work', () => {
  it('skips a dirty worktree, closes a clean one, and reports the dirty one', async () => {
    const dirtyId = newId()
    const cleanId = newId()
    const d = await create({ repoDir, workspaceName: 'w', agentId: dirtyId })
    const c = await create({ repoDir, workspaceName: 'w', agentId: cleanId })
    writeFileSync(join(d.path, 'precious.txt'), 'x')
    const res = await closeAllForWorkspace({ repoDir, agentIds: [dirtyId, cleanId] })
    expect(res.failures).toEqual([
      expect.objectContaining({ agentId: dirtyId, path: d.path, branch: d.branch, reason: 'uncommitted' })
    ])
    expect(existsSync(join(d.path, 'precious.txt'))).toBe(true)
    expect(git(repoDir, 'branch', '--list', d.branch).trim()).not.toBe('')
    expect(readMeta(repoDir).agents[dirtyId]).toBeTruthy()
    expect(existsSync(c.path)).toBe(false)
    expect(readMeta(repoDir).agents[cleanId]).toBeUndefined()
  })

  it('skips a worktree git cannot read, with reason unreadable', async () => {
    const id = newId()
    const r = await create({ repoDir, workspaceName: 'w', agentId: id })
    writeFileSync(join(r.path, 'precious.txt'), 'x')
    const moved = join(root, 'with space renamed')
    renameSync(repoDir, moved)
    const res = await closeAllForWorkspace({ repoDir: moved, agentIds: [id] })
    expect(res.failures).toEqual([
      expect.objectContaining({ agentId: id, path: r.path, branch: r.branch, reason: 'unreadable' })
    ])
    expect(typeof res.failures[0].detail).toBe('string')
    expect(existsSync(join(r.path, 'precious.txt'))).toBe(true)
  })
})

describe('worktree / Claude folder trust', () => {
  const trusted = (p) => {
    try { return JSON.parse(readFileSync(claudeConfigPath(), 'utf8')).projects?.[projectKey(p)]?.hasTrustDialogAccepted === true }
    catch { return false }
  }

  it('marks a new agent folder trusted, and forgets it when the folder is removed', async () => {
    const agentId = newId()
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    expect(trusted(r.path)).toBe(true)
    expect(trusted(repoDir)).toBe(false) // the user's own repo is never touched
    expect((await close({ repoDir, agentId })).ok).toBe(true)
    expect(trusted(r.path)).toBe(false)
  })

  it('keeps the trust when the folder could not be removed', async () => {
    const agentId = newId()
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    writeFileSync(join(r.path, 'work.txt'), 'uncommitted')
    const res = await closeAllForWorkspace({ repoDir, agentIds: [agentId] })
    expect(res.failures.length).toBe(1)
    expect(trusted(r.path)).toBe(true)
  })
})
