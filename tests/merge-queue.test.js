// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, openSync, closeSync, watch } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { execFileSync, spawn } from 'child_process'

import { create, close, readMeta, writeMeta, withRepoLock } from '../src/main/worktree-manager.js'
import { isDepsLink, removeAllLinks } from '../src/main/worktree-setup.js'
import { createMergeQueue } from '../src/main/merge-queue.js'

// Real git repos on Windows: a few seconds per test is normal.
vi.setConfig({ testTimeout: 30000 })

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
function commitAll(cwd, msg) {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', msg)
}
const head = (cwd, ref = 'HEAD') => git(cwd, 'rev-parse', ref).trim()
const mergeCommits = (cwd, ref) => git(cwd, 'rev-list', '--min-parents=2', ref).trim()

function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms))
async function waitFor(cond, ms = 15000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('waitFor timed out')
    await tick(10)
  }
}
let lastCheck = null
// Resolves once the check stub has been entered n times.
const checkStarted = (n = 1) => waitFor(() => lastCheck && lastCheck.mock.calls.length >= n)

let root, repoDir, idSeq = 0

function makeRepo(name) {
  const dir = join(root, name)
  mkdirSync(dir)
  git(dir, 'init', '-q', '-b', 'master')
  git(dir, 'config', 'user.email', 't@e')
  git(dir, 'config', 'user.name', 't')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'a.txt'), 'a\n')
  commitAll(dir, 'init')
  return dir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cs-merge-'))
  repoDir = makeRepo('with space')
})

afterEach(() => {
  // Unlink every junction first so the recursive cleanup never reaches a real folder.
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

async function agent(dir = repoDir) {
  const agentId = `0000000${++idSeq}-aaaa-bbbb-cccc-dddddddddddd`
  const r = await create({ repoDir: dir, workspaceName: 'w', agentId })
  return { agentId, wt: r.path, branch: r.branch }
}

function setup({ runCheck, runInstall } = {}) {
  const events = []
  const check = vi.fn(runCheck ?? (async () => ({ result: 'passed', script: 'test' })))
  const install = vi.fn(runInstall ?? (async () => ({ ok: true })))
  lastCheck = check
  const q = createMergeQueue({ runCheck: check, runInstall: install, onStatus: (s) => events.push(s) })
  const states = (agentId) => events.filter(e => e.agentId === agentId).map(e => e.state)
  const last = (agentId) => events.filter(e => e.agentId === agentId).at(-1)
  return { q, events, check, install, states, last }
}

describe('merge-queue / pipeline', () => {
  it('commits leftovers, rebases, checks, and fast-forwards the target', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'agent.txt'), 'from agent\n') // left uncommitted
    // The target moves on before Finish, so the rebase has real work to do.
    writeFileSync(join(repoDir, 'main.txt'), 'main\n')
    commitAll(repoDir, 'main moves')

    const { q, check, states, last } = setup()
    expect(q.finish({ repoDir, agentId: a.agentId, agentName: 'Agent 1' })).toEqual({ accepted: true })
    await q.drain()

    expect(states(a.agentId)).toEqual(['queued', 'testing', 'merged'])
    expect(last(a.agentId).target).toBe('master')
    expect(check).toHaveBeenCalledTimes(1)
    expect(check.mock.calls[0][0].cwd).toBe(a.wt)
    expect(readFileSync(join(repoDir, 'agent.txt'), 'utf8')).toBe('from agent\n')
    expect(git(repoDir, 'log', '-1', '--format=%s', 'master').trim()).toBe('Agent 1: finish')
    expect(mergeCommits(repoDir, 'master')).toBe('')
    expect(head(repoDir, 'master')).toBe(head(a.wt))
    expect(readMeta(repoDir).agents[a.agentId].baseSha).toBe(head(repoDir, 'master'))
    expect(existsSync(a.wt)).toBe(true) // the worktree stays open

    await close({ repoDir, agentId: a.agentId })
    expect(git(repoDir, 'branch', '--list', a.branch).trim()).toBe('')
  })

  it('leaves the target untouched when the check fails', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const before = head(repoDir, 'master')
    const { q, last } = setup({ runCheck: async () => ({ result: 'failed', script: 'test' }) })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('tests-failed')
    expect(resolve(last(a.agentId).logPath)).toBe(resolve(repoDir, '.codespace', 'merge-logs', `${a.agentId}.log`))
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('treats timeout as tests-failed with detail "Timed out after 10 minutes"', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const before = head(repoDir, 'master')
    const { q, last } = setup({ runCheck: async () => ({ result: 'timeout', script: 'test' }) })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('tests-failed')
    expect(last(a.agentId).detail).toBe('Timed out after 10 minutes')
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('marks merged-untested when the check returns none', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const { q, last } = setup({ runCheck: async () => ({ result: 'none', script: null }) })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('merged-untested')
    expect(existsSync(join(repoDir, 'x.txt'))).toBe(true)
  })

  it('leaves the rebase in progress on conflict', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'a.txt'), 'agent version\n')
    commitAll(a.wt, 'agent edits a')
    writeFileSync(join(repoDir, 'a.txt'), 'main version\n')
    commitAll(repoDir, 'main edits a')
    const before = head(repoDir, 'master')

    const { q, check, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('conflict')
    expect(check).not.toHaveBeenCalled()
    const rm = resolve(a.wt, git(a.wt, 'rev-parse', '--git-path', 'rebase-merge').trim())
    expect(existsSync(rm)).toBe(true)
    expect(head(repoDir, 'master')).toBe(before)
    expect(readFileSync(join(repoDir, 'a.txt'), 'utf8')).toBe('main version\n')
  })

  it('reports conflict again without restarting while a rebase is in progress', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'a.txt'), 'agent version\n')
    commitAll(a.wt, 'agent edits a')
    writeFileSync(join(repoDir, 'a.txt'), 'main version\n')
    commitAll(repoDir, 'main edits a')

    const { q, check, states } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    const rm = resolve(a.wt, git(a.wt, 'rev-parse', '--git-path', 'rebase-merge').trim())
    const stopped = readFileSync(join(rm, 'stopped-sha'), 'utf8')

    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(states(a.agentId).filter(s => s === 'conflict')).toHaveLength(2)
    expect(check).not.toHaveBeenCalled()
    expect(existsSync(rm)).toBe(true)
    expect(readFileSync(join(rm, 'stopped-sha'), 'utf8')).toBe(stopped) // same rebase, not restarted
  })

  it('blocks when the worktree changed during the check', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const before = head(repoDir, 'master')
    const { q, last } = setup({
      runCheck: async ({ cwd }) => {
        writeFileSync(join(cwd, 'late.txt'), 'late')
        commitAll(cwd, 'agent commits mid-check')
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).detail).toBe('changed during tests')
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('names files when a generated file dirties the tree during the check', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const before = head(repoDir, 'master')
    const { q, last } = setup({
      runCheck: async ({ cwd }) => {
        writeFileSync(join(cwd, 'coverage report.json'), '{}')
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).detail).toContain('changed during tests')
    expect(last(a.agentId).detail).toContain('coverage report.json')
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('re-runs once from rebase when the user committed in the main folder during the check', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'agent.txt'), 'agent')
    commitAll(a.wt, 'agent work')
    let calls = 0
    const { q, check, last } = setup({
      runCheck: async () => {
        if (++calls === 1) {
          writeFileSync(join(repoDir, 'user.txt'), 'user')
          commitAll(repoDir, 'user commits mid-check')
        }
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(check).toHaveBeenCalledTimes(2)
    expect(last(a.agentId).state).toBe('merged')
    expect(existsSync(join(repoDir, 'user.txt'))).toBe(true)
    expect(existsSync(join(repoDir, 'agent.txt'))).toBe(true)
    expect(mergeCommits(repoDir, 'master')).toBe('')
    expect(git(repoDir, 'log', '-1', '--format=%s', 'master').trim()).toBe('agent work')
  })

  it('blocks when the target moves a second time', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'agent.txt'), 'agent')
    commitAll(a.wt, 'agent work')
    let calls = 0
    const { q, check, last } = setup({
      runCheck: async () => {
        writeFileSync(join(repoDir, `user${++calls}.txt`), 'user')
        commitAll(repoDir, `user commit ${calls}`)
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(check).toHaveBeenCalledTimes(2)
    expect(last(a.agentId).state).toBe('blocked')
    expect(existsSync(join(repoDir, 'agent.txt'))).toBe(false)
  })

  it('blocks if the main folder switched branch during the check', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const masterBefore = head(repoDir, 'master')
    const { q, last } = setup({
      runCheck: async () => {
        git(repoDir, 'switch', '-q', '-c', 'other')
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(head(repoDir, 'master')).toBe(masterBefore)
    expect(head(repoDir, 'other')).toBe(masterBefore)
    expect(existsSync(join(repoDir, 'x.txt'))).toBe(false)
  })

  it('blocks and names files when main-folder edits overlap, losing nothing', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'a.txt'), 'agent version\n')
    commitAll(a.wt, 'agent edits a')
    writeFileSync(join(repoDir, 'a.txt'), 'user unsaved work\n') // uncommitted
    const before = head(repoDir, 'master')
    const { q, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).detail).toContain('a.txt')
    expect(readFileSync(join(repoDir, 'a.txt'), 'utf8')).toBe('user unsaved work\n')
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('blocks on detached HEAD in the main folder', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    git(repoDir, 'checkout', '-q', '--detach')
    const { q, check, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).target).toBe(null)
    expect(check).not.toHaveBeenCalled()
  })

  it('blocks when there is nothing to merge', async () => {
    const a = await agent()
    const { q, check, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).detail).toMatch(/nothing to merge/i)
    expect(check).not.toHaveBeenCalled()
  })

  it('blocks with the error when the leftover commit fails', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    const hooks = join(root, 'hooks')
    mkdirSync(hooks)
    writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n')
    git(repoDir, 'config', 'core.hooksPath', hooks.replace(/\\/g, '/'))
    const { q, check, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).detail).toContain('hook says no')
    expect(last(a.agentId).detail.length).toBeLessThanOrEqual(500)
    expect(check).not.toHaveBeenCalled()
  })
})

describe('merge-queue / queueing', () => {
  it('runs Finishes for one repo in order, never overlapping', async () => {
    const a = await agent()
    const b = await agent()
    writeFileSync(join(a.wt, 'from-a.txt'), 'a')
    commitAll(a.wt, 'a work')
    writeFileSync(join(b.wt, 'from-b.txt'), 'b')
    commitAll(b.wt, 'b work')

    const gate = deferred()
    let running = 0, maxRunning = 0, calls = 0
    const { q, states, last } = setup({
      runCheck: async () => {
        running++; maxRunning = Math.max(maxRunning, running)
        if (++calls === 1) await gate.promise
        running--
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    q.finish({ repoDir, agentId: b.agentId, agentName: 'B' })
    await checkStarted()
    expect(last(a.agentId).state).toBe('testing')
    expect(states(b.agentId)).toEqual(['queued'])

    gate.resolve()
    await q.drain()
    expect(maxRunning).toBe(1)
    expect(last(a.agentId).state).toBe('merged')
    expect(last(b.agentId).state).toBe('merged')
    expect(existsSync(join(repoDir, 'from-a.txt'))).toBe(true)
    expect(existsSync(join(repoDir, 'from-b.txt'))).toBe(true)
    expect(mergeCommits(repoDir, 'master')).toBe('')
    expect(git(repoDir, 'log', '--format=%s', 'master').trim().split(/\r?\n/)).toEqual(['b work', 'a work', 'init'])
  })

  it('runs different repos independently', async () => {
    const otherRepo = makeRepo('other repo')
    const a = await agent()
    const b = await agent(otherRepo)
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    writeFileSync(join(b.wt, 'y.txt'), 'y')
    commitAll(b.wt, 'y')

    const gate = deferred()
    const { q, last } = setup({
      runCheck: async ({ cwd }) => {
        if (cwd === a.wt) await gate.promise
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    q.finish({ repoDir: otherRepo, agentId: b.agentId, agentName: 'B' })
    await q.drain(otherRepo)
    expect(last(b.agentId).state).toBe('merged')
    expect(last(a.agentId).state).toBe('testing')
    gate.resolve()
    await q.drain()
    expect(last(a.agentId).state).toBe('merged')
  })

  it('ignores a second finish for an agent already queued or running', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const gate = deferred()
    const { q, check } = setup({
      runCheck: async () => { await gate.promise; return { result: 'passed', script: 'test' } }
    })
    expect(q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })).toEqual({ accepted: true })
    expect(q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })).toEqual({ accepted: false })
    await checkStarted()
    expect(q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })).toEqual({ accepted: false })
    gate.resolve()
    await q.drain()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('cancel while queued removes it; state idle', async () => {
    const a = await agent()
    const b = await agent()
    writeFileSync(join(a.wt, 'from-a.txt'), 'a')
    commitAll(a.wt, 'a work')
    writeFileSync(join(b.wt, 'from-b.txt'), 'b')
    commitAll(b.wt, 'b work')
    const gate = deferred()
    const { q, check, states } = setup({
      runCheck: async () => { await gate.promise; return { result: 'passed', script: 'test' } }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    q.finish({ repoDir, agentId: b.agentId, agentName: 'B' })
    await checkStarted()
    q.cancel(b.agentId)
    expect(states(b.agentId)).toEqual(['queued', 'idle'])
    gate.resolve()
    await q.drain()
    expect(check).toHaveBeenCalledTimes(1)
    expect(states(b.agentId)).toEqual(['queued', 'idle'])
    expect(existsSync(join(repoDir, 'from-b.txt'))).toBe(false)
    expect(existsSync(join(repoDir, 'from-a.txt'))).toBe(true)
  })

  it('cancel while checking aborts the signal; nothing lands; state idle', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const before = head(repoDir, 'master')
    let seenSignal
    const { q, last } = setup({
      runCheck: ({ signal }) => new Promise(r => {
        seenSignal = signal
        signal.addEventListener('abort', () => r({ result: 'cancelled', script: 'test' }), { once: true })
      })
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await checkStarted()
    expect(last(a.agentId).state).toBe('testing')
    q.cancel(a.agentId)
    expect(seenSignal.aborted).toBe(true)
    await q.drain()
    expect(last(a.agentId).state).toBe('idle')
    expect(head(repoDir, 'master')).toBe(before)
    // A new Finish is accepted once the cancelled one has wound down.
    expect(q.finish({ repoDir, agentId: a.agentId, agentName: 'A' }).accepted).toBe(true)
    await checkStarted(2)
    q.cancel(a.agentId)
    await q.drain()
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('cancel after a check that ignored the signal still lands nothing', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const before = head(repoDir, 'master')
    const gate = deferred()
    const { q, last } = setup({
      runCheck: async () => { await gate.promise; return { result: 'passed', script: 'test' } }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await checkStarted()
    q.cancel(a.agentId)
    gate.resolve()
    await q.drain()
    expect(last(a.agentId).state).toBe('idle')
    expect(head(repoDir, 'master')).toBe(before)
  })
})

describe('merge-queue / dependencies and locking', () => {
  it('replaces the link with a real install when the lockfile differs, and flags lockfileChanged', async () => {
    writeFileSync(join(repoDir, 'package-lock.json'), '{"v":1}\n')
    commitAll(repoDir, 'lockfile')
    mkdirSync(join(repoDir, 'node_modules'))
    writeFileSync(join(repoDir, 'node_modules', 'sentinel'), 'x')
    const a = await agent()
    expect(isDepsLink(a.wt)).toBe(true)
    writeFileSync(join(a.wt, 'package-lock.json'), '{"v":2}\n')
    commitAll(a.wt, 'bump deps')

    let linkAtInstall
    const { q, install, last } = setup({
      runInstall: async ({ cwd }) => {
        linkAtInstall = isDepsLink(cwd)
        mkdirSync(join(cwd, 'node_modules'))
        writeFileSync(join(cwd, 'node_modules', 'installed'), 'y')
        return { ok: true }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(install).toHaveBeenCalledTimes(1)
    expect(install.mock.calls[0][0].cwd).toBe(a.wt)
    expect(linkAtInstall).toBe(false)
    expect(existsSync(join(repoDir, 'node_modules', 'sentinel'))).toBe(true)
    expect(existsSync(join(repoDir, 'node_modules', 'installed'))).toBe(false)
    expect(last(a.agentId).state).toBe('merged')
    expect(last(a.agentId).lockfileChanged).toBe(true)
  })

  it('keeps the link and skips install when the lockfile is unchanged', async () => {
    writeFileSync(join(repoDir, 'package-lock.json'), '{"v":1}\n')
    commitAll(repoDir, 'lockfile')
    mkdirSync(join(repoDir, 'node_modules'))
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const { q, install, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(install).not.toHaveBeenCalled()
    expect(isDepsLink(a.wt)).toBe(true)
    expect(last(a.agentId).state).toBe('merged')
    expect(last(a.agentId).lockfileChanged).toBeFalsy()
  })

  it('blocks when the install fails', async () => {
    writeFileSync(join(repoDir, 'package-lock.json'), '{"v":1}\n')
    commitAll(repoDir, 'lockfile')
    mkdirSync(join(repoDir, 'node_modules'))
    writeFileSync(join(repoDir, 'node_modules', 'sentinel'), 'x')
    const a = await agent()
    writeFileSync(join(a.wt, 'package-lock.json'), '{"v":2}\n')
    commitAll(a.wt, 'bump deps')
    const before = head(repoDir, 'master')
    const { q, check, last } = setup({ runInstall: async () => ({ ok: false }) })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).logPath).toBeTruthy()
    expect(check).not.toHaveBeenCalled()
    expect(head(repoDir, 'master')).toBe(before)
    expect(existsSync(join(repoDir, 'node_modules', 'sentinel'))).toBe(true)
  })

  it('does not hold withRepoLock during the check', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const gate = deferred()
    const { q } = setup({
      runCheck: async () => { await gate.promise; return { result: 'passed', script: 'test' } }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await checkStarted()
    const created = await Promise.race([
      create({ repoDir, workspaceName: 'w', agentId: 'ffffffff-0000-0000-0000-000000000000' }).then(() => true),
      tick(10000).then(() => false)
    ])
    expect(created).toBe(true)
    gate.resolve()
    await q.drain()
  })
})

// ── Fix round 1 regressions ──────────────────────────────────────────────────

function useHooks(hooks) {
  const dir = join(root, 'hooks')
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(hooks)) writeFileSync(join(dir, name), body)
  git(repoDir, 'config', 'core.hooksPath', dir.split(String.fromCharCode(92)).join('/'))
}
const fwd = (p) => p.split(String.fromCharCode(92)).join('/')

// Holds `path` open without write/delete sharing, like a dev server or editor.
async function holdFile(path) {
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$f=[System.IO.File]::Open('${path.replace(/'/g, "''")}','Open','Read','Read'); Start-Sleep -Seconds 60; $f.Close()`],
    { stdio: 'ignore', windowsHide: true })
  // A cold PowerShell start can be slow when the whole suite is running; if
  // the lock never takes, say so rather than let the test run unlocked.
  try {
    await waitFor(() => {
      try { closeSync(openSync(path, 'r+')); return false } catch { return true }
    }, 45000)
  } catch {
    ps.kill()
    throw new Error(`holdFile: could not lock ${path}`)
  }
  return ps
}

describe('merge-queue / fix round 1', () => {
  it('moves only the agent\'s commits when the user dropped the commit it started from', async () => {
    writeFileSync(join(repoDir, 'wip.txt'), 'half-done experiment')
    commitAll(repoDir, 'wip experiment')
    const a = await agent()
    git(repoDir, 'reset', '--hard', '-q', 'HEAD~1')
    writeFileSync(join(a.wt, 'agent.txt'), 'agent')
    commitAll(a.wt, 'agent work')
    const { q, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('merged')
    expect(git(repoDir, 'log', '--format=%s', 'master').trim().split(/\r?\n/)).toEqual(['agent work', 'init'])
    expect(existsSync(join(repoDir, 'wip.txt'))).toBe(false)
  })

  it('does not bring back a commit the user dropped from the target during the check', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'agent.txt'), 'agent')
    commitAll(a.wt, 'agent work')
    writeFileSync(join(repoDir, 'oops-secret.txt'), 'API_KEY=123')
    commitAll(repoDir, 'oops, committed a secret')
    let calls = 0
    const { q, check, last } = setup({
      runCheck: async () => {
        if (++calls === 1) git(repoDir, 'reset', '--hard', '-q', 'HEAD~1')
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(check).toHaveBeenCalledTimes(2)
    expect(last(a.agentId).state).toBe('merged')
    expect(git(repoDir, 'log', '--format=%s', 'master').trim().split(/\r?\n/)).toEqual(['agent work', 'init'])
    expect(existsSync(join(repoDir, 'oops-secret.txt'))).toBe(false)
  })

  it('lands only the agent\'s commits after it finishes a conflicted rebase by hand', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'a.txt'), 'agent version\n')
    commitAll(a.wt, 'agent edits a')
    writeFileSync(join(repoDir, 'a.txt'), 'main version\n')
    commitAll(repoDir, 'main edits a')
    const { q, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('conflict')
    writeFileSync(join(a.wt, 'a.txt'), 'resolved\n')
    git(a.wt, 'add', 'a.txt')
    execFileSync('git', ['-C', a.wt, '-c', 'core.editor=true', 'rebase', '--continue'], { stdio: 'ignore', env: { ...process.env, GIT_EDITOR: 'true' } })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('merged')
    expect(git(repoDir, 'log', '--format=%s', 'master').trim().split(/\r?\n/)).toEqual(['agent edits a', 'main edits a', 'init'])
    expect(readFileSync(join(repoDir, 'a.txt'), 'utf8')).toBe('resolved\n')
  })

  it('never overwrites an ignored file in the main folder', async () => {
    writeFileSync(join(repoDir, '.gitignore'), 'config.local.json\n')
    commitAll(repoDir, 'ignore')
    const a = await agent()
    writeFileSync(join(repoDir, 'config.local.json'), 'USER SECRET\n')
    writeFileSync(join(a.wt, 'config.local.json'), 'agent placeholder\n')
    git(a.wt, 'add', '-f', 'config.local.json')
    git(a.wt, 'commit', '-q', '-m', 'agent adds config')
    const before = head(repoDir, 'master')
    const { q, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).detail).toContain('config.local.json')
    expect(readFileSync(join(repoDir, 'config.local.json'), 'utf8')).toBe('USER SECRET\n')
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('runs no main-folder hooks when landing, so a noisy post-merge hook cannot turn a landing into blocked', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const marker = fwd(join(root, 'post-merge-ran'))
    useHooks({ 'post-merge': `#!/bin/sh\necho ran > "${marker}"\nhead -c 2000000 /dev/zero | tr "\\0" "x"\n` })
    const { q, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('merged')
    expect(existsSync(join(root, 'post-merge-ran'))).toBe(false)
    expect(readMeta(repoDir).agents[a.agentId].baseSha).toBe(head(repoDir, 'master'))
  })

  it('reports merged even if recording the landing in meta fails', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const tmp = join(repoDir, '.codespace', 'worktrees', '.cs-meta.json.tmp')
    const { q, last } = setup({
      runCheck: async () => { mkdirSync(tmp, { recursive: true }); return { result: 'passed', script: 'test' } }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    rmSync(tmp, { recursive: true, force: true })
    expect(last(a.agentId).state).toBe('merged')
    expect(head(repoDir, 'master')).toBe(head(a.wt))
  })

  it('puts back files a failed fast-forward wrote, and leaves the user\'s own edits alone', async () => {
    for (const f of ['a1.txt', 'b2.txt', 'c3.txt']) writeFileSync(join(repoDir, f), `old ${f}\n`)
    commitAll(repoDir, 'files')
    const a = await agent()
    for (const f of ['a1.txt', 'b2.txt', 'c3.txt']) writeFileSync(join(a.wt, f), `NEW ${f}\n`)
    writeFileSync(join(a.wt, 'added.txt'), 'NEW added\n')
    commitAll(a.wt, 'agent changes files')
    writeFileSync(join(repoDir, 'a.txt'), 'user edit\n') // dirty, not in the agent's diff
    const before = head(repoDir, 'master')
    const ps = await holdFile(join(repoDir, 'b2.txt'))
    try {
      const { q, last } = setup()
      q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
      await q.drain()
      expect(last(a.agentId).state).toBe('blocked')
      expect(head(repoDir, 'master')).toBe(before)
      for (const f of ['a1.txt', 'b2.txt', 'c3.txt']) expect(readFileSync(join(repoDir, f), 'utf8')).toBe(`old ${f}\n`)
      expect(existsSync(join(repoDir, 'added.txt'))).toBe(false)
      expect(readFileSync(join(repoDir, 'a.txt'), 'utf8')).toBe('user edit\n')
      expect(git(repoDir, 'status', '--porcelain').trim()).toBe('M a.txt')
    } finally {
      ps.kill()
      await waitFor(() => { try { closeSync(openSync(join(repoDir, 'b2.txt'), 'r+')); return true } catch { return false } }, 20000)
    }
  }, 60000)

  it('keeps the event loop free while a commit hook runs', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x') // uncommitted, so the leftover commit runs the hook
    useHooks({ 'pre-commit': '#!/bin/sh\nsleep 2\n' })
    let maxGap = 0, lastBeat = Date.now()
    const iv = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - lastBeat); lastBeat = n }, 10)
    try {
      const { q, last } = setup()
      q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
      await q.drain()
      expect(last(a.agentId).state).toBe('merged')
      // A fully synchronous pipeline never yields, so let one more beat land
      // to measure the stall it caused.
      await tick(50)
    } finally { clearInterval(iv) }
    expect(maxGap).toBeLessThan(1000)
  })

  it('blocks when the leftover commit times out', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    useHooks({ 'pre-commit': '#!/bin/sh\nsleep 12\n' })
    const events = []
    const check = vi.fn(async () => ({ result: 'passed', script: 'test' }))
    const q = createMergeQueue({ runCheck: check, runInstall: async () => ({ ok: true }), onStatus: e => events.push(e), timeouts: { commit: 1500 } })
    const t0 = Date.now()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(Date.now() - t0).toBeLessThan(10000)
    expect(events.at(-1).state).toBe('blocked')
    expect(events.at(-1).detail).toMatch(/timed out/)
    expect(check).not.toHaveBeenCalled()
    // The killed commit's index.lock is gone, so git still works in the worktree.
    expect(existsSync(resolve(a.wt, git(a.wt, 'rev-parse', '--git-path', 'index.lock').trim()))).toBe(false)
    git(a.wt, 'add', '-A')
  })

  it('rebases a target file whose path is only too long inside the worktree', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'agent.txt'), 'agent')
    commitAll(a.wt, 'agent work')
    const dir = 'd'.repeat(100)
    const name = 'f'.repeat(235 - repoDir.length - 1 - dir.length - 1)
    mkdirSync(join(repoDir, dir))
    writeFileSync(join(repoDir, dir, name), 'long')
    commitAll(repoDir, 'long path on main')
    expect(join(a.wt, dir, name).length).toBeGreaterThan(260)
    const { q, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('merged')
    expect(existsSync(join(repoDir, 'agent.txt'))).toBe(true)
  })

  it('does not land when the agent was closed during the check', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const before = head(repoDir, 'master')
    const { q, last } = setup({
      runCheck: async () => {
        const m = readMeta(repoDir); delete m.agents[a.agentId]; writeMeta(repoDir, m)
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('does not land when the agent commits while landing waits for the lock', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'x.txt'), 'x')
    commitAll(a.wt, 'x')
    const before = head(repoDir, 'master')
    const held = deferred()
    const { q, last } = setup({
      runCheck: async () => { withRepoLock(repoDir, () => held.promise); return { result: 'passed', script: 'test' } }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await checkStarted()
    await tick(200)
    writeFileSync(join(a.wt, 'untested.txt'), 'u')
    commitAll(a.wt, 'agent commits while landing waits')
    held.resolve()
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(last(a.agentId).detail).toBe('changed during tests')
    expect(head(repoDir, 'master')).toBe(before)
  })

  it('serialises Finishes for one repo however its path is spelled', async () => {
    const a = await agent()
    const b = await agent()
    writeFileSync(join(a.wt, 'from-a.txt'), 'a')
    commitAll(a.wt, 'a work')
    writeFileSync(join(b.wt, 'from-b.txt'), 'b')
    commitAll(b.wt, 'b work')
    const lowerDrive = repoDir[0].toLowerCase() + repoDir.slice(1)
    const gate = deferred()
    let running = 0, maxRunning = 0, calls = 0
    const { q, last } = setup({
      runCheck: async () => {
        running++; maxRunning = Math.max(maxRunning, running)
        if (++calls === 1) await gate.promise
        running--
        return { result: 'passed', script: 'test' }
      }
    })
    q.finish({ repoDir: repoDir + '\\', agentId: a.agentId, agentName: 'A' })
    q.finish({ repoDir: lowerDrive, agentId: b.agentId, agentName: 'B' })
    await checkStarted()
    await tick(300)
    expect(last(b.agentId).state).toBe('queued')
    gate.resolve()
    await q.drain()
    expect(maxRunning).toBe(1)
    expect(last(a.agentId).state).toBe('merged')
    expect(last(b.agentId).state).toBe('merged')
  })

  it('withRepoLock serialises callers that spell the repo differently', async () => {
    const gate = deferred()
    let secondRan = false
    const first = withRepoLock(repoDir + '\\', () => gate.promise)
    const second = withRepoLock(repoDir[0].toLowerCase() + repoDir.slice(1), async () => { secondRan = true })
    await tick(100)
    expect(secondRan).toBe(false)
    gate.resolve()
    await Promise.all([first, second])
    expect(secondRan).toBe(true)
  })

  it('puts the node_modules link back when the install fails', async () => {
    writeFileSync(join(repoDir, 'package-lock.json'), '{"v":1}\n')
    commitAll(repoDir, 'lockfile')
    mkdirSync(join(repoDir, 'node_modules'))
    writeFileSync(join(repoDir, 'node_modules', 'sentinel'), 'x')
    const a = await agent()
    writeFileSync(join(a.wt, 'package-lock.json'), '{"v":2}\n')
    commitAll(a.wt, 'bump deps')
    const { q, last } = setup({
      runInstall: async ({ cwd }) => {
        mkdirSync(join(cwd, 'node_modules', 'half'), { recursive: true })
        writeFileSync(join(cwd, 'node_modules', 'half', 'partial'), 'p')
        return { ok: false }
      }
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    expect(isDepsLink(a.wt)).toBe(true)
    expect(existsSync(join(repoDir, 'node_modules', 'sentinel'))).toBe(true)
    expect(existsSync(join(repoDir, 'node_modules', 'half'))).toBe(false)
  })

  it('puts the node_modules link back when the install is cancelled', async () => {
    writeFileSync(join(repoDir, 'package-lock.json'), '{"v":1}\n')
    commitAll(repoDir, 'lockfile')
    mkdirSync(join(repoDir, 'node_modules'))
    writeFileSync(join(repoDir, 'node_modules', 'sentinel'), 'x')
    const a = await agent()
    writeFileSync(join(a.wt, 'package-lock.json'), '{"v":2}\n')
    commitAll(a.wt, 'bump deps')
    let installing = false
    const { q, last } = setup({
      runInstall: ({ cwd, signal }) => new Promise(r => {
        installing = true
        mkdirSync(join(cwd, 'node_modules', 'half'), { recursive: true })
        signal.addEventListener('abort', () => r({ ok: false }), { once: true })
      })
    })
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await waitFor(() => installing)
    q.cancel(a.agentId)
    await q.drain()
    expect(last(a.agentId).state).toBe('idle')
    expect(isDepsLink(a.wt)).toBe(true)
    expect(existsSync(join(repoDir, 'node_modules', 'sentinel'))).toBe(true)
  })

  it('writes the rebase output, conflicted files and next step to the log on conflict', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'a.txt'), 'agent version\n')
    commitAll(a.wt, 'agent edits a')
    writeFileSync(join(repoDir, 'a.txt'), 'main version\n')
    commitAll(repoDir, 'main edits a')
    const { q, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('conflict')
    const text = readFileSync(last(a.agentId).logPath, 'utf8')
    expect(text).toContain('CONFLICT')
    expect(text).toMatch(/^\s+a\.txt$/m)
    expect(text).toContain('Resolve the conflicts in these files, commit, then git rebase --continue')
    // A second Finish while the rebase is still open writes it again.
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(readFileSync(last(a.agentId).logPath, 'utf8')).toContain('git rebase --continue')
  })

  it('writes a blocked detail to the log', async () => {
    const a = await agent()
    const { q, last } = setup()
    q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
    await q.drain()
    expect(last(a.agentId).state).toBe('blocked')
    const logPath = join(repoDir, '.codespace', 'merge-logs', `${a.agentId}.log`)
    expect(readFileSync(logPath, 'utf8')).toContain('Blocked: nothing to merge')
  })
})

describe('merge-queue / final review', () => {
  it('reports merged when a cancel arrives while the landing is already writing', async () => {
    const a = await agent()
    mkdirSync(join(a.wt, 'gen'))
    for (let i = 0; i < 300; i++) writeFileSync(join(a.wt, 'gen', `f${i}.txt`), `file ${i}`)
    commitAll(a.wt, 'agent adds many files')
    const { q, last } = setup()
    let cancelled = false
    const w = watch(repoDir, { recursive: true }, (_ev, name) => {
      if (!cancelled && name && String(name).startsWith('gen')) { cancelled = true; q.cancel(a.agentId) }
    })
    try {
      q.finish({ repoDir, agentId: a.agentId, agentName: 'A' })
      await q.drain()
    } finally { w.close() }
    expect(cancelled).toBe(true)
    // The work landed, so the status must say so, cancel or not.
    expect(head(repoDir, 'master')).toBe(head(a.wt))
    expect(last(a.agentId).state).toBe('merged')
  })
})

describe('merge-queue / info', () => {
  it('counts commits and files ahead and reports the target and dirtiness', async () => {
    const a = await agent()
    writeFileSync(join(a.wt, 'one.txt'), '1')
    writeFileSync(join(a.wt, 'two.txt'), '2')
    commitAll(a.wt, 'c1')
    writeFileSync(join(a.wt, 'one.txt'), '1b')
    commitAll(a.wt, 'c2')
    const { q } = setup()
    expect(q.info({ repoDir, agentId: a.agentId })).toEqual({ ahead: 2, files: 2, dirty: false, insertions: 2, deletions: 0, target: 'master' })
    writeFileSync(join(a.wt, 'three.txt'), '3')
    expect(q.info({ repoDir, agentId: a.agentId })).toEqual({ ahead: 2, files: 3, dirty: true, insertions: 3, deletions: 0, target: 'master' })
  })
})
