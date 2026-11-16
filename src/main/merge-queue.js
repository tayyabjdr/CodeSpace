// Finish: lands an agent's branch on the branch checked out in the main
// folder, one Finish at a time per repo.
//
//   1. target    the main folder's branch when Finish was clicked
//   2. leftovers commit uncommitted work as "<agent name>: finish"
//   3. rebase    onto the target; a conflict is left in progress
//   4. deps      lockfile differs from the target's: real install in place of the link
//   5. check     the project's test (else build) script, via the injected runCheck
//   6. guard     the worktree must be exactly what was checked
//   7. land      under withRepoLock: git merge --ff-only in the main folder
//   8. after     the agent's baseSha becomes the new head; the worktree stays open
//
// Safety:
// - withRepoLock is taken only for landing, never during the check, which can
//   run for minutes and would otherwise block agents from being created.
// - The main folder's working tree is only ever changed by
//   `git merge --ff-only`, which refuses rather than overwrite the user's
//   uncommitted edits. Nothing here deletes or resets anything there.
// - The worktree's node_modules is a junction into the user's real folder.
//   Before an install replaces it, the link is unlinked; if that fails the
//   Finish stops (blocked) without touching anything.
// - git runs with argument arrays and LC_ALL=C so its stderr can be parsed.
// - Nothing pushes.

import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { execGit, withRepoLock, readMeta, writeMeta, entryWorktreePath } from './worktree-manager.js'
import { removeDepsLink, removeAllLinks } from './worktree-setup.js'
import { CHECK_TIMEOUT_MS } from './check-runner.js'

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
const DETAIL_MAX = 500

function gitEnv() {
  return { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0' }
}

function git(cwd, args) {
  return execGit(['-C', cwd, ...args], { env: gitEnv() })
}

function errText(e) {
  const s = String(e?.stderr || e?.message || e || '').trim()
  return s.length > DETAIL_MAX ? s.slice(0, DETAIL_MAX) : s
}

function truncate(s) {
  s = String(s)
  return s.length > DETAIL_MAX ? s.slice(0, DETAIL_MAX) : s
}

function currentBranch(dir) {
  try { return git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).trim() || null }
  catch { return null }
}

function headSha(dir) {
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

function rebaseInProgress(wt) {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const p = git(wt, ['rev-parse', '--git-path', name]).trim()
    if (existsSync(resolve(wt, p))) return true
  }
  return false
}

// Paths from `git status --porcelain -z`. Renames and copies carry the
// original path as an extra NUL-separated entry, which is skipped.
function changedFiles(dir) {
  const out = git(dir, ['status', '--porcelain', '-z', '--untracked-files=all'])
  const parts = out.split('\0')
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.length < 4) continue
    const xy = p.slice(0, 2)
    files.push(p.slice(3))
    if (xy[0] === 'R' || xy[0] === 'C') i++
  }
  return files
}

function aheadCount(wt, base) {
  return parseInt(git(wt, ['rev-list', '--count', `${base}..HEAD`]).trim(), 10) || 0
}

// git exits 1 for "differs"; anything else is a real error and is rethrown.
function lockfileDiffers(wt, targetRef) {
  try {
    git(wt, ['diff', '--quiet', targetRef, 'HEAD', '--', ...LOCKFILES])
    return false
  } catch (e) {
    if (e?.status === 1) return true
    throw e
  }
}

// Which lockfile blobs the worktree's HEAD holds, so a retry after the target
// moved doesn't reinstall for the same lockfile.
function lockSignature(wt) {
  try { return git(wt, ['ls-tree', 'HEAD', '--', ...LOCKFILES]) }
  catch { return null }
}

// The tab-indented file lines that follow git's "would be overwritten" header.
export function parseOverwritten(stderr) {
  const files = []
  let inList = false
  for (const line of String(stderr ?? '').split(/\r?\n/)) {
    if (/would be overwritten/i.test(line)) { inList = true; continue }
    if (inList && line.startsWith('\t')) { files.push(line.trim()); continue }
    inList = false
  }
  return files
}

function isRealDir(p) {
  try { const st = lstatSync(p); return st.isDirectory() && !st.isSymbolicLink() }
  catch { return false }
}

function minutes(ms) {
  const m = Math.round(ms / 60000)
  return `${m} minute${m === 1 ? '' : 's'}`
}

export function mergeLogPath(repoDir, agentId) {
  return join(repoDir, '.codespace', 'merge-logs', `${agentId}.log`)
}

// Thrown inside the pipeline to stop it with a final state.
class Stop {
  constructor(state, extra = {}) { this.state = state; this.extra = extra }
}
const blocked = (detail, extra = {}) => new Stop('blocked', { detail: truncate(detail), ...extra })

export function createMergeQueue({ runCheck, runInstall, onStatus = () => {} }) {
  const chains = new Map() // repoDir -> tail promise of that repo's Finishes
  const active = new Map() // agentId -> job (queued or running)

  function emit(job, state, extra = {}) {
    // After a cancel, only the cancel's own 'idle' gets out.
    if (job.cancelled && state !== 'idle') return
    const payload = { agentId: job.agentId, state, target: job.target }
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) payload[k] = v
    try { onStatus(payload) } catch {}
  }

  async function landUnderLock(job, sha) {
    const { repoDir, target } = job
    if (job.cancelled) return { cancelled: true }

    const cur = currentBranch(repoDir)
    if (cur !== target) {
      throw blocked(cur
        ? `the main folder switched to ${cur} during tests`
        : 'the main folder is on a detached HEAD')
    }

    try {
      git(repoDir, ['merge-base', '--is-ancestor', `refs/heads/${target}`, sha])
    } catch (e) {
      if (e?.status === 1) return { moved: true }
      throw blocked(errText(e) || `couldn't compare with ${target}`)
    }

    try {
      // --no-autostash: a user's merge.autoStash must never stash their edits.
      git(repoDir, ['merge', '--ff-only', '--no-autostash', '--no-edit', sha])
    } catch (e) {
      const files = parseOverwritten(e?.stderr)
      if (files.length) {
        throw blocked(`your uncommitted changes in the main folder would be overwritten: ${files.join(', ')}`)
      }
      throw blocked(errText(e) || 'git merge --ff-only failed')
    }

    const newHead = headSha(repoDir)
    // A later close keeps any branch with commits past baseSha. Everything on
    // the branch is now in the target, so move baseSha up to it.
    const meta = readMeta(repoDir)
    if (meta.agents[job.agentId]) {
      meta.agents[job.agentId] = { ...meta.agents[job.agentId], baseSha: newHead }
      writeMeta(repoDir, meta)
    }
    return { landed: true }
  }

  async function pipeline(job) {
    const { repoDir, agentId, target } = job
    const targetRef = `refs/heads/${target}`

    // 1. Target
    if (!target) throw blocked('the main folder is on a detached HEAD')
    const cur = currentBranch(repoDir)
    if (cur !== target) {
      throw blocked(cur ? `the main folder switched to ${cur}` : 'the main folder is on a detached HEAD')
    }
    const entry = readMeta(repoDir).agents[agentId]
    if (!entry) throw blocked("this agent doesn't have its own folder")
    const wt = entryWorktreePath(repoDir, agentId, entry)
    if (!existsSync(wt)) throw blocked(`the agent's folder is missing: ${wt}`)

    // A rebase left from an earlier Finish must be finished by hand first.
    if (rebaseInProgress(wt)) {
      throw new Stop('conflict', { detail: 'a rebase is still in progress; finish it with git rebase --continue', logPath: job.logPath })
    }
    const wtBranch = currentBranch(wt)
    if (wtBranch !== entry.branch) {
      throw blocked(`the agent's folder is on ${wtBranch ?? 'a detached HEAD'}, not ${entry.branch}`)
    }

    emit(job, 'testing')

    // 2. Commit leftovers
    if (changedFiles(wt).length > 0) {
      try {
        git(wt, ['add', '-A'])
        git(wt, ['commit', '-q', '-m', `${job.agentName || 'Agent'}: finish`])
      } catch (e) {
        throw blocked(errText(e) || "couldn't commit the agent's changes")
      }
    }
    if (job.cancelled) return

    let retried = false
    let installedSig = null
    for (;;) {
      // 3. Rebase
      if (aheadCount(wt, targetRef) === 0) throw blocked('nothing to merge')
      try {
        git(wt, ['-c', 'rebase.updateRefs=false', 'rebase', '--no-autostash', targetRef])
      } catch (e) {
        if (rebaseInProgress(wt)) {
          throw new Stop('conflict', { detail: truncate(`rebase onto ${target} hit a conflict`), logPath: job.logPath })
        }
        throw blocked(errText(e) || `couldn't rebase onto ${target}`)
      }
      if (aheadCount(wt, targetRef) === 0) throw blocked(`nothing to merge, ${target} already has these changes`)
      if (job.cancelled) return

      // 4. Dependencies
      if (lockfileDiffers(wt, targetRef)) {
        job.lockfileChanged = true
        const sig = lockSignature(wt)
        if (sig === null || sig !== installedSig) {
          // The install deletes and rewrites node_modules. Detach the junction
          // (and any link inside a real node_modules) first, or it would
          // delete the user's real dependencies.
          try {
            removeDepsLink(wt)
            const nm = join(wt, 'node_modules')
            if (isRealDir(nm)) removeAllLinks(nm)
          } catch (e) {
            throw blocked(`couldn't detach node_modules before installing: ${e?.message ?? e}`)
          }
          const r = await runInstall({ cwd: wt, logPath: job.logPath, signal: job.controller.signal })
          if (job.cancelled) return
          if (!r?.ok) throw blocked('installing the changed dependencies failed', { logPath: job.logPath })
          installedSig = sig
        }
      }

      // 5. Check
      const sha = headSha(wt)
      const res = await runCheck({ cwd: wt, logPath: job.logPath, signal: job.controller.signal })
      if (job.cancelled) return
      const result = res?.result
      if (result === 'cancelled') throw new Stop('idle')
      if (result === 'timeout') {
        throw new Stop('tests-failed', { detail: `Timed out after ${minutes(CHECK_TIMEOUT_MS)}`, logPath: job.logPath })
      }
      if (result !== 'passed' && result !== 'none') {
        throw new Stop('tests-failed', { logPath: job.logPath })
      }
      const untested = result === 'none'

      // 6. Guard: land exactly what was checked.
      if (headSha(wt) !== sha || currentBranch(wt) !== entry.branch) throw blocked('changed during tests')
      const dirty = changedFiles(wt)
      if (dirty.length) throw blocked(`changed during tests: ${dirty.join(', ')}`)

      // 7. Land (the only part under the repo lock)
      const landed = await withRepoLock(repoDir, () => landUnderLock(job, sha))
      if (landed.cancelled) return
      if (landed.moved) {
        if (retried) throw blocked(`${target} moved again during tests`)
        retried = true
        continue
      }

      // 8. After landing
      throw new Stop(untested ? 'merged-untested' : 'merged', {
        lockfileChanged: job.lockfileChanged || undefined
      })
    }
  }

  async function runJob(job) {
    try {
      if (job.cancelled) return
      try {
        mkdirSync(join(job.repoDir, '.codespace', 'merge-logs'), { recursive: true })
        writeFileSync(job.logPath, '')
      } catch {}
      await pipeline(job)
    } catch (e) {
      if (e instanceof Stop) emit(job, e.state, e.extra)
      else emit(job, 'blocked', { detail: truncate(errText(e) || 'unexpected error') })
    } finally {
      if (active.get(job.agentId) === job) active.delete(job.agentId)
    }
  }

  function finish({ repoDir, agentId, agentName }) {
    if (typeof repoDir !== 'string' || !repoDir || typeof agentId !== 'string' || !agentId) {
      return { accepted: false }
    }
    if (active.has(agentId)) return { accepted: false }

    const job = {
      repoDir,
      agentId,
      agentName: typeof agentName === 'string' ? agentName : '',
      // The target is fixed at click time; landing checks it is still checked out.
      target: currentBranch(repoDir),
      logPath: mergeLogPath(repoDir, agentId),
      controller: new AbortController(),
      cancelled: false,
      started: false,
      lockfileChanged: false
    }
    active.set(agentId, job)
    emit(job, 'queued')

    const prev = chains.get(repoDir) ?? Promise.resolve()
    const p = prev
      .then(() => { job.started = true; return runJob(job) })
      .catch(() => {})
      .then(() => { if (chains.get(repoDir) === p) chains.delete(repoDir) })
    chains.set(repoDir, p)
    return { accepted: true }
  }

  function cancel(agentId) {
    const job = active.get(agentId)
    if (!job || job.cancelled) return
    job.cancelled = true
    try { job.controller.abort() } catch {}
    // Queued: drop it now. Running: keep it registered until it has wound
    // down, so a new Finish can't start beside the one being stopped.
    if (!job.started) active.delete(agentId)
    emit(job, 'idle')
  }

  function info({ repoDir, agentId }) {
    let target = null
    try { target = currentBranch(repoDir) } catch {}
    const empty = { ahead: 0, files: 0, dirty: false, target }
    try {
      const entry = readMeta(repoDir).agents[agentId]
      if (!entry) return empty
      const wt = entryWorktreePath(repoDir, agentId, entry)
      if (!existsSync(wt)) return empty
      const base = target ? `refs/heads/${target}` : entry.baseSha
      const ahead = aheadCount(wt, base)
      const files = new Set(
        git(wt, ['diff', '--name-only', '-z', `${base}...HEAD`]).split('\0').filter(Boolean)
      )
      const dirtyFiles = changedFiles(wt)
      for (const f of dirtyFiles) files.add(f)
      return { ahead, files: files.size, dirty: dirtyFiles.length > 0, target }
    } catch {
      return empty
    }
  }

  // Resolves once every queued Finish (for one repo, or all) has settled.
  async function drain(repoDir) {
    for (;;) {
      const pending = repoDir ? [chains.get(repoDir)].filter(Boolean) : [...chains.values()]
      if (pending.length === 0) return
      await Promise.all(pending)
    }
  }

  return { finish, cancel, info, drain }
}
