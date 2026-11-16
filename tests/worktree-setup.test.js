// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, lstatSync, readdirSync, symlinkSync, appendFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync, spawn } from 'child_process'

import {
  create, close, closeAllForWorkspace, wipeAll, repairOrphans, checkDirty,
  worktreePath, ensureLocalExcludes, readMeta
} from '../src/main/worktree-manager.js'
import { setupWorktree, removeDepsLink, removeAllLinks, isDepsLink, pickPort, releasePort, reservedPorts } from '../src/main/worktree-setup.js'
import { createServer } from 'net'

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
    for (const id of readdirSync(wtRoot)) { try { removeAllLinks(join(wtRoot, id)) } catch {} }
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
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    expect(isDepsLink(r.path)).toBe(true)
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

  it('repairOrphans leaves a worktree whose folder and link still exist alone', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    await repairOrphans({ repoDir })
    expect(existsSync(r.path)).toBe(true)
    expect(isDepsLink(r.path)).toBe(true)
    expect(existsSync(SENTINEL())).toBe(true)
    expect(readMeta(repoDir).agents[agentId]).toBeTruthy()
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

// Links an agent can create anywhere in its worktree; each points outside the
// repo at a folder with a sentinel that must survive every cleanup path.
function plantExtraLinks(wtPath) {
  const targets = []
  const mk = (name) => {
    const t = join(root, name)
    mkdirSync(t)
    writeFileSync(join(t, 'sentinel'), 'x')
    targets.push(t)
    return t
  }
  // renamed node_modules (the realistic one: mv node_modules node_modules.bak)
  removeDepsLink(wtPath)
  symlinkSync(join(repoDir, 'node_modules'), join(wtPath, 'node_modules.bak'), 'junction')
  // nested, in a folder that also holds real files
  mkdirSync(join(wtPath, 'packages', 'app'), { recursive: true })
  writeFileSync(join(wtPath, 'packages', 'app', 'real.txt'), 'real')
  symlinkSync(mk('ext-nested'), join(wtPath, 'packages', 'app', 'node_modules'), 'junction')
  // an arbitrary-name junction at the top
  symlinkSync(mk('ext-top'), join(wtPath, 'shared-cache'), 'junction')
  return targets
}

describe('worktree-manager / links anywhere in the worktree', () => {
  const agentId = 'bbbb2222-0000-0000-0000-000000000000'

  it.each(['close', 'closeAllForWorkspace', 'wipeAll'])(
    '%s unlinks renamed, nested and mixed-folder junctions without touching their targets', async (which) => {
      const r = await create({ repoDir, workspaceName: 'ws', agentId })
      if (which === 'wipeAll') {
        // wipeAll keeps dirty worktrees, so hide the planted files from git status
        // to let it reach the removal (and the link walk) at all.
        const ex = join(repoDir, '.git', 'info', 'exclude')
        appendFileSync(ex, ['/node_modules.bak', '/shared-cache', '/packages/', ''].join('\n'))
      }
      const targets = plantExtraLinks(r.path)
      if (which === 'close') await close({ repoDir, agentId })
      else if (which === 'closeAllForWorkspace') await closeAllForWorkspace({ repoDir, agentIds: [agentId] })
      else await wipeAll({ repoDir, liveAgentIds: [] })
      for (const t of targets) expect(existsSync(join(t, 'sentinel'))).toBe(true)
      expect(existsSync(SENTINEL())).toBe(true)
      expect(existsSync(r.path)).toBe(false)
    })

  it('removeAllLinks removes a dangling link', () => {
    const wtPath = manualWorktree('c1')
    const gone = join(root, 'gone')
    mkdirSync(gone)
    symlinkSync(gone, join(wtPath, 'node_modules'), 'junction')
    rmSync(gone, { recursive: true })
    expect(isDepsLink(wtPath)).toBe(true)
    removeAllLinks(wtPath)
    expect(isDepsLink(wtPath)).toBe(false)
    // and the same through removeDepsLink
    const gone2 = join(root, 'gone2')
    mkdirSync(gone2)
    symlinkSync(gone2, join(wtPath, 'node_modules'), 'junction')
    rmSync(gone2, { recursive: true })
    removeDepsLink(wtPath)
    expect(isDepsLink(wtPath)).toBe(false)
  })

  it('removeAllLinks leaves real folders and files alone', () => {
    const wtPath = manualWorktree('c2')
    mkdirSync(join(wtPath, 'real', 'deep'), { recursive: true })
    writeFileSync(join(wtPath, 'real', 'deep', 'f.txt'), 'f')
    removeAllLinks(wtPath)
    expect(existsSync(join(wtPath, 'real', 'deep', 'f.txt'))).toBe(true)
    expect(existsSync(join(wtPath, '.git'))).toBe(true)
  })

  it('a lstat failure other than "missing" stops the removal', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    const eperm = () => { const e = new Error('EPERM simulated'); e.code = 'EPERM'; throw e }
    const mgr = await loadManager({ lstatSync: (p, ...a) => (String(p).endsWith('node_modules') ? eperm() : undefined) })
    const out = await mgr.close({ repoDir, agentId })
    expect(out.ok).toBe(false)
    expect(out.error).toBe('deps-unlink-failed')
    expect(existsSync(r.path)).toBe(true)
    expect(isDepsLink(r.path)).toBe(true)
    expect(existsSync(SENTINEL())).toBe(true)
    expect(readMeta(repoDir).agents[agentId]).toBeTruthy()
  })

  it('lstat ENOENT and ENOTDIR still mean missing', () => {
    expect(isDepsLink(join(root, 'does-not-exist'))).toBe(false)
    expect(isDepsLink(join(repoDir, 'a.txt'))).toBe(false) // ENOTDIR: a.txt/node_modules
  })
})

describe('worktree-setup / env copy safety', () => {
  it('does not copy an .env that is ignored only by an uncommitted .gitignore', () => {
    writeFileSync(join(repoDir, '.gitignore'), '.env.local\n.env.secret\n') // not committed
    writeFileSync(join(repoDir, '.env.secret'), 'S=1')
    const wtPath = manualWorktree('d1')
    setupWorktree({ repoDir, wtPath })
    expect(existsSync(join(wtPath, '.env.secret'))).toBe(false)
    expect(existsSync(join(wtPath, '.env.local'))).toBe(true) // committed rule still copies
  })
})

describe('worktree-manager / failed cleanup reporting', () => {
  const agentId = 'cccc3333-0000-0000-0000-000000000000'

  it('closeAllForWorkspace reports the folders it could not remove', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    const mgr = await loadManager({ unlinkSync: () => { throw new Error('EPERM simulated') } })
    const out = await mgr.closeAllForWorkspace({ repoDir, agentIds: [agentId] })
    expect(out.failures).toHaveLength(1)
    expect(out.failures[0].agentId).toBe(agentId)
    expect(out.failures[0].path).toBe(r.path)
    expect(out.failures[0].detail).toMatch(/EPERM/)
    expect(existsSync(r.path)).toBe(true)
    expect(existsSync(SENTINEL())).toBe(true)
  })

  it('closeAllForWorkspace reports no failures on success', async () => {
    await create({ repoDir, workspaceName: 'ws', agentId })
    expect((await closeAllForWorkspace({ repoDir, agentIds: [agentId] })).failures).toEqual([])
  })

  it('wipeAll marks kept entries with a reason', async () => {
    await create({ repoDir, workspaceName: 'ws', agentId })
    const mgr = await loadManager({ unlinkSync: () => { throw new Error('EPERM simulated') } })
    const out = await mgr.wipeAll({ repoDir, liveAgentIds: [] })
    expect(out.kept.find(k => k.agentId === agentId).reason).toBe('cleanup-failed')

    const other = 'dddd4444-0000-0000-0000-000000000000'
    const r2 = await create({ repoDir, workspaceName: 'ws2', agentId: other })
    writeFileSync(join(r2.path, 'dirty.txt'), 'x')
    const out2 = await wipeAll({ repoDir, liveAgentIds: [] })
    expect(out2.kept.find(k => k.agentId === other).reason).toBe('uncommitted')
  })
})

// A real process whose cwd is inside the folder, which keeps Windows from
// deleting it. Always killed by the caller's finally.
async function holdCwd(dir, ms) {
  const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ms})`], { cwd: dir, stdio: 'ignore', windowsHide: true })
  await new Promise((res, rej) => { child.once('spawn', res); child.once('error', rej) })
  await new Promise(r => setTimeout(r, 150)) // let it chdir/boot before we start removing
  return child
}
async function stop(child) {
  if (child.exitCode !== null) return
  await new Promise(r => { child.once('exit', r); child.kill() })
}
const branchExists = (b) => git(repoDir, 'branch', '--list', b).trim().length > 0

describe('worktree-manager / locked folders', () => {
  const agentId = 'eeee5555-0000-0000-0000-000000000000'

  it('close reports folder-locked and keeps meta and branch while a process holds the folder', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    const child = await holdCwd(r.path, 60000)
    try {
      const out = await close({ repoDir, agentId })
      expect(out.ok).toBe(false)
      expect(out.error).toBe('folder-locked')
      expect(out.path).toBe(r.path)
      expect(existsSync(r.path)).toBe(true)
      expect(readMeta(repoDir).agents[agentId]).toBeTruthy()
      expect(branchExists(r.branch)).toBe(true)
      expect(existsSync(SENTINEL())).toBe(true)
    } finally { await stop(child) }
  }, 20000)

  it('close succeeds when the process lets go within the retry window', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    const child = await holdCwd(r.path, 600)
    try {
      const out = await close({ repoDir, agentId })
      expect(out.ok).toBe(true)
      expect(existsSync(r.path)).toBe(false)
      expect(readMeta(repoDir).agents[agentId]).toBeUndefined()
      expect(existsSync(SENTINEL())).toBe(true)
    } finally { await stop(child) }
  }, 20000)

  it('closeAllForWorkspace lists a locked folder in failures', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    const child = await holdCwd(r.path, 60000)
    try {
      const out = await closeAllForWorkspace({ repoDir, agentIds: [agentId] })
      expect(out.failures).toHaveLength(1)
      expect(out.failures[0].path).toBe(r.path)
      expect(readMeta(repoDir).agents[agentId]).toBeTruthy()
    } finally { await stop(child) }
  }, 20000)

  it('a failed second link walk stops the close before anything is deleted', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    // Root lstat calls in one attempt: 1 first walk, 2 folderGone after git,
    // 3 the second walk (only reached because the held folder survives git).
    let rootCalls = 0
    const rmCalls = []
    const mgr = await loadManager({
      lstatSync: (p) => {
        if (String(p) === r.path && ++rootCalls === 3) { const e = new Error('EPERM simulated'); e.code = 'EPERM'; throw e }
      },
      rmSync: (p) => { rmCalls.push(String(p)) }
    })
    const child = await holdCwd(r.path, 60000)
    try {
      const out = await mgr.close({ repoDir, agentId })
      expect(rootCalls).toBe(3)
      expect(out.ok).toBe(false)
      expect(out.error).toBe('deps-unlink-failed')
      expect(out.detail).toMatch(/EPERM simulated/)
      expect(rmCalls).not.toContain(r.path)
      expect(existsSync(r.path)).toBe(true)
      expect(readMeta(repoDir).agents[agentId]).toBeTruthy()
      expect(branchExists(r.branch)).toBe(true)
      expect(existsSync(SENTINEL())).toBe(true)
    } finally { await stop(child) }
  }, 20000)

  it('keeps a branch with commits after its locked folder is deleted by hand', async () => {
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    writeFileSync(join(r.path, 'work.txt'), 'agent work')
    git(r.path, 'add', 'work.txt')
    git(r.path, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'agent work')

    // Close fails while something holds the folder; meta and branch are kept.
    const child = await holdCwd(r.path, 60000)
    try {
      expect((await close({ repoDir, agentId })).error).toBe('folder-locked')
    } finally { await stop(child) }

    // The user deletes the folder, as the failure message tells them to.
    removeAllLinks(r.path)
    rmSync(r.path, { recursive: true, force: true })
    expect(existsSync(r.path)).toBe(false)

    // The next wipe clears the entry but must not delete the only copy of the work.
    const out = await wipeAll({ repoDir, liveAgentIds: [] })
    expect(readMeta(repoDir).agents[agentId]).toBeUndefined()
    expect(branchExists(r.branch)).toBe(true)
    expect(out.stranded.map(s => s.branch)).toContain(r.branch)
    expect(existsSync(SENTINEL())).toBe(true)
  }, 20000)
})

describe('worktree-setup / removeAllLinks and .git', () => {
  it('refuses a top-level .git that is a junction, and leaves its target alone', () => {
    const wt = join(root, 'fake-wt'); mkdirSync(wt)
    const ext = join(root, 'ext-git'); mkdirSync(ext); writeFileSync(join(ext, 'sentinel'), 'x')
    symlinkSync(ext, join(wt, '.git'), 'junction')
    expect(() => removeAllLinks(wt)).toThrow(/\.git/)
    expect(existsSync(join(ext, 'sentinel'))).toBe(true)
    removeDepsLink(wt) // no-op, not node_modules
    unlinkSync(join(wt, '.git'))
  })
  it('refuses a top-level .git that is a real folder, in any letter case', () => {
    const wt = join(root, 'fake-wt2'); mkdirSync(join(wt, '.Git'), { recursive: true })
    expect(() => removeAllLinks(wt)).toThrow(/\.git/i)
  })
})

// Run a manager call with unlinkSync made to fail (ESM fs bindings can't be
// spied, so the manager is loaded fresh against a mocked fs).
async function closeWithFailingUnlink(args) {
  const mgr = await loadManager({ unlinkSync: () => { throw new Error('EPERM simulated') } })
  return mgr.close(args)
}
async function wipeWithFailingUnlink({ repoDir }) {
  const mgr = await loadManager({ unlinkSync: () => { throw new Error('EPERM simulated') } })
  return mgr.wipeAll({ repoDir, liveAgentIds: [] })
}
// Loads a fresh manager against a fs whose named functions are overridden.
// An override may return undefined to fall through to the real function.
async function loadManager(overrides) {
  vi.resetModules()
  vi.doMock('fs', async (orig) => {
    const actual = await orig()
    const wrapped = {}
    for (const [k, fn] of Object.entries(overrides)) {
      wrapped[k] = (...args) => {
        const v = fn(...args)
        return v === undefined ? actual[k](...args) : v
      }
    }
    return { ...actual, ...wrapped }
  })
  const mgr = await import('../src/main/worktree-manager.js')
  vi.doUnmock('fs')
  return mgr
}

describe('worktree-setup / ports', () => {
  const listenOn = (port) => new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(port, '127.0.0.1', () => res(s))
  })
  const closeServer = (s) => new Promise(r => s.close(r))

  it('pickPort skips a port in use and never repeats a reserved one', async () => {
    let blocker = null
    try { blocker = await listenOn(4100) } catch { /* already in use by something else: still must be skipped */ }
    const a = await pickPort()
    const b = await pickPort()
    try {
      expect(a).toBeGreaterThanOrEqual(4100)
      expect(b).toBeLessThanOrEqual(4999)
      expect(a).not.toBe(4100)
      expect(b).not.toBe(4100)
      expect(a).not.toBe(b)
    } finally {
      releasePort(a); releasePort(b)
      if (blocker) await closeServer(blocker)
    }
  })

  it('pickPort skips a port another process holds on the wildcard address', async () => {
    const first = await pickPort()
    releasePort(first)
    const s = await new Promise((res, rej) => { const x = createServer(); x.once('error', rej); x.listen(first, () => res(x)) })
    try {
      const p = await pickPort()
      expect(p).not.toBe(first)
      releasePort(p)
    } finally { await closeServer(s) }
  })

  it('create returns a port and close releases it', async () => {
    const agentId = 'ffff6666-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    expect(Number.isInteger(r.port)).toBe(true)
    expect(reservedPorts().has(r.port)).toBe(true)
    expect((await close({ repoDir, agentId })).ok).toBe(true)
    expect(reservedPorts().has(r.port)).toBe(false)
  })

  it('wipeAll releases the ports of the agents it removes', async () => {
    const agentId = 'ffff7777-0000-0000-0000-000000000000'
    const r = await create({ repoDir, workspaceName: 'ws', agentId })
    await wipeAll({ repoDir, liveAgentIds: [] })
    expect(reservedPorts().has(r.port)).toBe(false)
  })
})
