// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, lstatSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

import {
  create, close, closeAllForWorkspace, wipeAll, repairOrphans, checkDirty,
  worktreePath, ensureLocalExcludes, readMeta
} from '../src/main/worktree-manager.js'
import { setupWorktree, removeDepsLink, isDepsLink } from '../src/main/worktree-setup.js'

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

let root, repoDir
const SENTINEL = () => join(repoDir, 'node_modules', 'sentinel')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cs-setup-'))
  repoDir = join(root, 'with space')
  mkdirSync(repoDir)
  git(repoDir, 'init', '-q')
  writeFileSync(join(repoDir, '.gitignore'), '.env.local\n')
  writeFileSync(join(repoDir, 'a.txt'), 'a')
  git(repoDir, 'add', '-A')
  execFileSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-C', repoDir, 'commit', '-q', '-m', 'init'])
  mkdirSync(join(repoDir, 'node_modules'))
  writeFileSync(SENTINEL(), 'x')
  writeFileSync(join(repoDir, '.env.local'), 'SECRET=1')
  writeFileSync(join(repoDir, '.env.other'), 'OTHER=1')
})

afterEach(() => {
  // Drop any junction first so the recursive cleanup can never reach the real folder.
  const wtRoot = join(root, '.codespace-worktrees', 'with space')
  try {
    for (const id of readdirSync(wtRoot)) { try { removeDepsLink(join(wtRoot, id)) } catch {} }
  } catch {}
  rmSync(root, { recursive: true, force: true })
})

function manualWorktree(id) {
  ensureLocalExcludes(repoDir)
  const wtPath = worktreePath(repoDir, id)
  git(repoDir, 'worktree', 'add', '-b', `t/${id}`, wtPath, 'HEAD')
  return wtPath
}

describe('worktree-setup / setupWorktree', () => {
  it('links node_modules (lstat reports a link) and git add -A does not stage it', () => {
    const wtPath = manualWorktree('a1')
    const { warnings } = setupWorktree({ repoDir, wtPath })
    expect(warnings).toEqual([])
    expect(lstatSync(join(wtPath, 'node_modules')).isSymbolicLink()).toBe(true)
    expect(isDepsLink(wtPath)).toBe(true)
    expect(existsSync(join(wtPath, 'node_modules', 'sentinel'))).toBe(true)
    git(wtPath, 'add', '-A')
    expect(git(wtPath, 'diff', '--cached', '--name-only')).not.toContain('node_modules')
  })

  it('copies ignored .env files and skips unignored ones', () => {
    const wtPath = manualWorktree('a2')
    setupWorktree({ repoDir, wtPath })
    expect(existsSync(join(wtPath, '.env.local'))).toBe(true)
    expect(existsSync(join(wtPath, '.env.other'))).toBe(false)
  })

  it('does nothing and warns nothing when the repo has no node_modules', () => {
    rmSync(join(repoDir, 'node_modules'), { recursive: true, force: true })
    const wtPath = manualWorktree('a3')
    const { warnings } = setupWorktree({ repoDir, wtPath })
    expect(warnings).toEqual([])
    expect(existsSync(join(wtPath, 'node_modules'))).toBe(false)
  })

  it('reports a warning and still returns when the link fails', () => {
    const wtPath = manualWorktree('a4')
    writeFileSync(join(wtPath, 'node_modules'), 'a file in the way')
    const { warnings } = setupWorktree({ repoDir, wtPath })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/node_modules/)
    expect(existsSync(join(wtPath, '.env.local'))).toBe(true)
  })
})

describe('worktree-setup / removeDepsLink', () => {
  it('removes only the link and leaves the target intact', () => {
    const wtPath = manualWorktree('b1')
    setupWorktree({ repoDir, wtPath })
    removeDepsLink(wtPath)
    expect(isDepsLink(wtPath)).toBe(false)
    expect(existsSync(join(wtPath, 'node_modules'))).toBe(false)
    expect(existsSync(SENTINEL())).toBe(true)
  })

  it('is a no-op for a missing node_modules and for a real folder', () => {
    const wtPath = manualWorktree('b2')
    expect(() => removeDepsLink(wtPath)).not.toThrow()
    mkdirSync(join(wtPath, 'node_modules'))
    writeFileSync(join(wtPath, 'node_modules', 'real'), 'x')
    removeDepsLink(wtPath)
    expect(existsSync(join(wtPath, 'node_modules', 'real'))).toBe(true)
    expect(isDepsLink(wtPath)).toBe(false)
  })
})

describe('worktree-manager / linked deps', () => {
  const agentId = 'aaaa1111-0000-0000-0000-000000000000'

  it('create returns warnings and the worktree is linked', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    expect(r.warnings).toEqual([])
    expect(isDepsLink(r.path)).toBe(true)
  })

  it('does not treat the link as dirty', async () => {
    await create({ repoDir, workspaceName: 'ws', agentId })
    expect(await checkDirty({ repoDir, agentId })).toEqual({ dirty: false })
  })

  it.each(['close', 'closeAllForWorkspace', 'wipeAll', 'repairOrphans'])(
    '%s leaves the main node_modules intact', async (which) => {
      const r = await create({ repoDir, workspaceName: 'ws', agentId })
      expect(isDepsLink(r.path)).toBe(true)
      if (which === 'close') await close({ repoDir, agentId })
      else if (which === 'closeAllForWorkspace') await closeAllForWorkspace({ repoDir, agentIds: [agentId] })
      else if (which === 'wipeAll') await wipeAll({ repoDir, liveAgentIds: [] })
      else {
        // The worktree folder is gone (link taken off first, as a manual cleanup would).
        removeDepsLink(r.path)
        rmSync(r.path, { recursive: true, force: true })
        await repairOrphans({ repoDir })
      }
      expect(existsSync(SENTINEL())).toBe(true)
      expect(existsSync(join(repoDir, 'node_modules'))).toBe(true)
      if (which !== 'repairOrphans') expect(existsSync(r.path)).toBe(false)
    })

  it('close does not delete the worktree when the link cannot be removed', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    // Simulate an undeletable link: lstat says link, unlink fails.
    expect(isDepsLink(r.path)).toBe(true)
    const out = await closeWithFailingUnlink({ repoDir, agentId })
    expect(out.ok).toBe(false)
    expect(out.error).toBe('deps-unlink-failed')
    expect(existsSync(r.path)).toBe(true)
    expect(isDepsLink(r.path)).toBe(true)
    expect(existsSync(SENTINEL())).toBe(true)
    expect(readMeta(repoDir).agents[agentId]).toBeTruthy()
  })

  it('wipeAll keeps (and reports) a worktree whose link cannot be removed', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    const out = await wipeWithFailingUnlink({ repoDir })
    expect(out.kept.map(k => k.agentId)).toContain(agentId)
    expect(existsSync(r.path)).toBe(true)
    expect(existsSync(SENTINEL())).toBe(true)
    expect(readMeta(repoDir).agents[agentId]).toBeTruthy()
  })
})

// Run a manager call with unlinkSync made to fail (ESM fs bindings can't be
// spied, so the manager is loaded fresh against a mocked fs).
async function closeWithFailingUnlink(args) {
  const mgr = await loadManagerWithFailingUnlink()
  return mgr.close(args)
}
async function wipeWithFailingUnlink({ repoDir }) {
  const mgr = await loadManagerWithFailingUnlink()
  return mgr.wipeAll({ repoDir, liveAgentIds: [] })
}
async function loadManagerWithFailingUnlink() {
  vi.resetModules()
  vi.doMock('fs', async (orig) => {
    const actual = await orig()
    return { ...actual, unlinkSync: () => { throw new Error('EPERM simulated') } }
  })
  const mgr = await import('../src/main/worktree-manager.js')
  vi.doUnmock('fs')
  return mgr
}
