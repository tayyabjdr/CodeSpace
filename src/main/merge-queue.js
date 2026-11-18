// Finish: lands an agent's branch on the branch checked out in the main
// folder, one Finish at a time per repo.
//
//   1. target    the main folder's branch when Finish was clicked
//   2. leftovers commit uncommitted work as "<agent name>: finish"
//   3. rebase    ONLY the agent's own commits (baseSha..HEAD) onto the
//                target's current commit; a real conflict is left in progress
//   4. deps      lockfile differs from the target's: real install in place of the link
//   5. check     the project's test (else build) script, via the injected runCheck
//   6. guard     the worktree must be exactly what was checked
//   7. land      under withRepoLock, only if the target still sits on the commit
//                we rebased onto: git merge --ff-only <tested sha>
//   8. after     the agent's baseSha becomes the new head; the worktree stays open
//
// Safety:
// - withRepoLock is taken only for short meta updates and for landing, never
//   during the check, which can run for minutes.
// - The main folder's working tree is only ever changed by
//   `git merge --ff-only --no-overwrite-ignore` (hooks off). If that fails
//   part way, only files git itself wrote over clean paths are put back.
//   A path the user had changed is never touched.
// - The worktree's node_modules is a junction into the user's real folder.
//   Links are removed before anything deletes or replaces files there; if
//   that fails the Finish stops (blocked) without deleting anything.
// - git runs with argument arrays and LC_ALL=C so its stderr can be parsed.
//   Anything that can run hooks or take long runs async with a timeout.
// - Nothing pushes.

import { spawn } from 'child_process'
import { existsSync, lstatSync, statSync, readFileSync, mkdirSync, writeFileSync, appendFileSync, unlinkSync, rmSync, rmdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, dirname } from 'path'
import { execGit, withRepoLock, readMeta, writeMeta, entryWorktreePath, repoKey } from './worktree-manager.js'
import { removeDepsLink, removeAllLinks, setupWorktree, isDepsLink } from './worktree-setup.js'
import { CHECK_TIMEOUT_MS } from './check-runner.js'

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']
const DETAIL_MAX = 500
const OUTPUT_CAP = 1024 * 1024

export const GIT_TIMEOUTS = Object.freeze({
  add: 120000,
  commit: 300000, // runs the user's pre-commit hooks
  rebase: 120000,
  merge: 120000,
  restore: 60000
})

const SYSTEM_ROOT = process.env.SystemRoot || 'C:\\Windows'
const TASKKILL_EXE = join(SYSTEM_ROOT, 'System32', 'taskkill.exe')

function gitEnv() {
  return { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0' }
}

// Quick read-only git calls that run no hooks.
function git(cwd, args) {
  return execGit(['-C', cwd, '-c', 'core.longpaths=true', ...args], { env: gitEnv() })
}

// An empty folder used as core.hooksPath, so git runs no hooks at all.
let noHooksDir = null
function emptyHooksDir() {
  if (!noHooksDir || !existsSync(noHooksDir)) noHooksDir = mkdtempSync(join(tmpdir(), 'cs-nohooks-'))
  return noHooksDir.replace(/\\/g, '/')
}

function killTree(pid) {
  return new Promise(res => {
    if (!pid) return res()
    const k = spawn(TASKKILL_EXE, ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    k.once('error', () => res())
    k.once('exit', () => res())
  })
}

// Async git with a timeout that kills git and anything it started (hooks).
// Never rejects: { code, stdout, stderr, timedOut }.
function runGit(cwd, args, { timeoutMs, input, env } = {}) {
  return new Promise(res => {
    let stdout = '', stderr = ''
    const append = (cur, d) => (cur.length >= OUTPUT_CAP ? cur : cur + d.toString('utf8'))
    let child
    try {
      child = spawn('git', ['-C', cwd, '-c', 'core.longpaths=true', ...args], {
        windowsHide: true,
        env: { ...gitEnv(), ...env },
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
      })
    } catch (e) {
      return res({ code: -1, stdout: '', stderr: String(e?.message ?? e), timedOut: false })
    }
    let timedOut = false
    let settled = false
    let grace = null
    const done = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(grace)
      try { child.stdout.destroy() } catch {}
      try { child.stderr.destroy() } catch {}
      res({ code, stdout, stderr, timedOut })
    }
    // taskkill /T can't reach every hook process: MSYS programs a hook starts
    // (sleep, node, ...) are not in git's Windows process tree, and they keep
    // the pipes open. So git's own exit decides, with a short grace period
    // to collect the rest of its output.
    const timer = timeoutMs ? setTimeout(() => { timedOut = true; killTree(child.pid) }, timeoutMs) : null
    child.stdout.on('data', d => { stdout = append(stdout, d) })
    child.stderr.on('data', d => { stderr = append(stderr, d) })
    child.once('error', (e) => { stderr += String(e?.message ?? e); done(-1) })
    child.once('exit', (code) => { grace = setTimeout(() => done(code ?? -1), timedOut ? 0 : 1000) })
    child.once('close', (code) => done(code))
    if (input !== undefined) {
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
  })
}

// git killed mid-commit leaves the worktree's index.lock behind, and every
// later git command there (the agent's included) then fails. Remove it only
// if it was created after our own commit started, i.e. it is ours.
function clearOwnIndexLock(wt, since) {
  try {
    const p = resolve(wt, git(wt, ['rev-parse', '--git-path', 'index.lock']).trim())
    const st = lstatOrNull(p)
    if (st && st.isFile() && st.mtimeMs >= since - 1000) unlinkSync(p)
  } catch {}
}

function truncate(s) {
  s = String(s ?? '').trim()
  return s.length > DETAIL_MAX ? s.slice(0, DETAIL_MAX) : s
}

function errText(e) {
  return truncate(e?.stderr || e?.message || e || '')
}

function resultText(r, what) {
  if (r.timedOut) return `${what} timed out`
  return truncate(r.stderr || r.stdout || `${what} failed`)
}

function currentBranch(dir) {
  try { return git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).trim() || null }
  catch { return null }
}

function headSha(dir) {
  return git(dir, ['rev-parse', 'HEAD']).trim()
}

function refSha(dir, ref) {
  try { return git(dir, ['rev-parse', '--verify', '-q', ref]).trim() || null }
  catch { return null }
}

function isAncestor(dir, a, b) {
  try { git(dir, ['merge-base', '--is-ancestor', a, b]); return true }
  catch (e) {
    if (e?.status === 1) return false
    throw e
  }
}

function rebaseInProgress(wt) {
  for (const name of ['rebase-merge', 'rebase-apply']) {
    const p = git(wt, ['rev-parse', '--git-path', name]).trim()
    if (existsSync(resolve(wt, p))) return true
  }
  return false
}

function conflictedFiles(wt) {
  try { return git(wt, ['diff', '--name-only', '-z', '--diff-filter=U']).split('\0').filter(Boolean) }
  catch { return [] }
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

// Lines added and removed against `base`, counting uncommitted edits too.
// `git diff <base>` covers commits plus the working tree for tracked files;
// new untracked files are counted by reading them, skipping big or binary
// ones, so a fresh file the agent hasn't committed still shows its lines.
const UNTRACKED_LINE_LIMIT = 1024 * 1024
function diffLines(dir, base) {
  let insertions = 0
  let deletions = 0
  for (const entry of git(dir, ['diff', '--numstat', '-z', base]).split('\0')) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(entry)
    if (!m) continue
    if (m[1] !== '-') insertions += Number(m[1])
    if (m[2] !== '-') deletions += Number(m[2])
  }
  const status = git(dir, ['status', '--porcelain', '-z', '--untracked-files=all']).split('\0')
  for (const p of status) {
    if (!p.startsWith('?? ')) continue
    try {
      const file = join(dir, p.slice(3))
      if (statSync(file).size > UNTRACKED_LINE_LIMIT) continue
      const buf = readFileSync(file)
      if (buf.includes(0)) continue
      if (buf.length === 0) continue
      let lines = 0
      for (const b of buf) if (b === 10) lines++
      if (buf[buf.length - 1] !== 10) lines++
      insertions += lines
    } catch {}
  }
  return { insertions, deletions }
}

function countRange(dir, from, to = 'HEAD') {
  return parseInt(git(dir, ['rev-list', '--count', `${from}..${to}`]).trim(), 10) || 0
}

// git exits 1 for "differs"; anything else is a real error and is rethrown.
function lockfileDiffers(wt, targetSha) {
  try {
    git(wt, ['diff', '--quiet', targetSha, 'HEAD', '--', ...LOCKFILES])
    return false
  } catch (e) {
    if (e?.status === 1) return true
    throw e
  }
}

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

function lstatOrNull(p) {
  try { return lstatSync(p) } catch { return null }
}

function isRealDir(p) {
  const st = lstatOrNull(p)
  return !!st && st.isDirectory() && !st.isSymbolicLink()
}

function minutes(ms) {
  const m = Math.round(ms / 60000)
  return `${m} minute${m === 1 ? '' : 's'}`
}

export function mergeLogPath(repoDir, agentId) {
  return join(repoDir, '.codespace', 'merge-logs', `${agentId}.log`)
}

// Thrown inside the pipeline to stop it with a final state. `log` is extra
// text for the merge log, which the failure handoff points the agent at.
class Stop {
  constructor(state, extra = {}, log = '') { this.state = state; this.extra = extra; this.log = log }
}
const blocked = (detail, extra = {}, log = '') => new Stop('blocked', { detail: truncate(detail), ...extra }, log)

// ── Landing a failed fast-forward safely ───────────────────────────────────
// A fast-forward that fails part way (a file held open by a dev server, an
// editor or antivirus) can leave some of the agent's files written into the
// main folder while HEAD stays put, so they look like the user's own edits.
// Put back exactly those: paths that were clean before, are changed now, and
// now hold precisely the content of the tested commit.

function diffEntries(repoDir, from, to) {
  const out = git(repoDir, ['diff', '--no-renames', '--name-status', '-z', from, to])
  const parts = out.split('\0').filter(s => s.length)
  const entries = []
  for (let i = 0; i + 1 < parts.length; i += 2) entries.push({ status: parts[i][0], path: parts[i + 1] })
  return entries
}

function snapshotBeforeMerge(repoDir, onto, sha) {
  const entries = diffEntries(repoDir, onto, sha)
  const dirty = new Set(changedFiles(repoDir))
  const clean = entries.filter(({ status, path }) => {
    if (dirty.has(path)) return false
    // A path the agent adds must not already exist (untracked or ignored).
    if (status === 'A') return !lstatOrNull(join(repoDir, path))
    return true
  })
  return clean
}

async function blobIds(repoDir, specs) {
  if (specs.length === 0) return []
  const r = await runGit(repoDir, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    input: specs.join('\n') + '\n', timeoutMs: GIT_TIMEOUTS.restore
  })
  if (r.code !== 0) return null
  const lines = r.stdout.split(/\r?\n/)
  return specs.map((_, i) => {
    const [oid, type] = String(lines[i] ?? '').split(' ')
    return type === 'blob' ? oid : null
  })
}

async function hashFiles(repoDir, paths) {
  if (paths.length === 0) return []
  const r = await runGit(repoDir, ['hash-object', '--stdin-paths'], {
    input: paths.join('\n') + '\n', timeoutMs: GIT_TIMEOUTS.restore
  })
  if (r.code !== 0) return null
  return r.stdout.split(/\r?\n/).slice(0, paths.length)
}

function pruneEmptyParents(repoDir, filePath) {
  const top = resolve(repoDir)
  let dir = dirname(resolve(filePath))
  while (dir.length > top.length && dir.toLowerCase().startsWith(top.toLowerCase())) {
    try { rmdirSync(dir) } catch { return }
    dir = dirname(dir)
  }
}

async function undoPartialLanding(repoDir, cleanBefore, sha) {
  const nowDirty = new Set(changedFiles(repoDir))
  const candidates = []
  for (const e of cleanBefore) {
    if (e.path.includes('\n')) continue
    const abs = join(repoDir, e.path)
    const st = lstatOrNull(abs)
    if (e.status === 'A') {
      if (st && st.isFile()) candidates.push({ ...e, abs, kind: 'file' })
    } else if (e.status === 'D') {
      if (nowDirty.has(e.path) && !st) candidates.push({ ...e, abs, kind: 'gone' })
    } else if (nowDirty.has(e.path) && st && st.isFile()) {
      candidates.push({ ...e, abs, kind: 'file' })
    }
  }
  const files = candidates.filter(c => c.kind === 'file')
  const want = await blobIds(repoDir, files.map(c => `${sha}:${c.path}`))
  const have = await hashFiles(repoDir, files.map(c => c.path))
  if (!want || !have) return { restored: [], failed: files.map(c => c.path) }
  const matches = new Set(files.filter((c, i) => want[i] && want[i] === have[i]).map(c => c.path))

  const restoreFromHead = []
  const deleteNew = []
  for (const c of candidates) {
    if (c.kind === 'gone') restoreFromHead.push(c)
    else if (matches.has(c.path)) (c.status === 'A' ? deleteNew : restoreFromHead).push(c)
  }

  const restored = []
  const failed = []
  for (const c of deleteNew) {
    try {
      const st = lstatSync(c.abs)
      if (!st.isFile()) throw new Error('not a file')
      unlinkSync(c.abs)
      pruneEmptyParents(repoDir, c.abs)
      restored.push(c.path)
    } catch { failed.push(c.path) }
  }
  if (restoreFromHead.length) {
    const r = await runGit(repoDir, [
      '-c', `core.hooksPath=${emptyHooksDir()}`,
      'restore', '--source=HEAD', '--staged', '--worktree',
      '--pathspec-from-file=-', '--pathspec-file-nul'
    ], {
      input: restoreFromHead.map(c => c.path).join('\0'),
      timeoutMs: GIT_TIMEOUTS.restore,
      env: { GIT_LITERAL_PATHSPECS: '1' }
    })
    if (r.code === 0) restored.push(...restoreFromHead.map(c => c.path))
    else failed.push(...restoreFromHead.map(c => c.path))
  }
  return { restored, failed }
}

function listForDetail(paths, max = 10) {
  const shown = paths.slice(0, max).join(', ')
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown
}

export function createMergeQueue({ runCheck, runInstall, onStatus = () => {}, timeouts = {} }) {
  const T = { ...GIT_TIMEOUTS, ...timeouts }
  const chains = new Map() // repoKey -> tail promise of that repo's Finishes
  const active = new Map() // agentId -> job (queued or running)

  function emit(job, state, extra = {}, { truth = false } = {}) {
    // After a cancel, only the cancel's own 'idle' gets out, except the
    // truth: work that really landed is always reported as landed.
    if (job.cancelled && state !== 'idle' && !truth) return
    const payload = { agentId: job.agentId, state, target: job.target }
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) payload[k] = v
    try { onStatus(payload) } catch {}
  }

  function log(job, text) {
    try { appendFileSync(job.logPath, text.endsWith('\n') ? text : text + '\n') } catch {}
  }

  // Short meta edits go under the repo lock so they can't race create/close.
  async function patchEntry(job, patch) {
    try {
      await withRepoLock(job.repoDir, () => {
        const meta = readMeta(job.repoDir)
        const entry = meta.agents[job.agentId]
        if (!entry) return
        const next = { ...entry, ...patch }
        for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k]
        meta.agents[job.agentId] = next
        writeMeta(job.repoDir, meta)
      })
    } catch {}
  }

  // After a failed or cancelled install: drop the partial install and put the
  // link back so the live agent keeps working. Under the repo lock, so a
  // concurrent close (which also takes it) can't be walking this folder.
  async function restoreDepsLink(job, wt) {
    return withRepoLock(job.repoDir, () => {
      const entry = readMeta(job.repoDir).agents[job.agentId]
      if (!entry || !existsSync(wt)) return { ok: true } // closed meanwhile; nothing to restore
      const nm = join(wt, 'node_modules')
      try {
        removeDepsLink(wt)
        if (isRealDir(nm)) {
          removeAllLinks(nm)
          if (isRealDir(nm)) rmSync(nm, { recursive: true, force: true })
        }
      } catch (e) {
        return { ok: false, detail: `couldn't clear the partial install in ${nm}: ${e?.message ?? e}` }
      }
      try { setupWorktree({ repoDir: job.repoDir, wtPath: wt }) } catch {}
      if (existsSync(join(job.repoDir, 'node_modules')) && !isDepsLink(wt)) {
        return { ok: false, detail: `couldn't link node_modules back into ${wt}; run an install there` }
      }
      return { ok: true }
    })
  }

  // Rebase only the agent's commits (upstream..HEAD) onto `onto`.
  async function rebaseOnto(job, wt, onto, upstream) {
    const r = await runGit(wt, [
      '-c', `core.hooksPath=${emptyHooksDir()}`,
      '-c', 'rebase.updateRefs=false',
      'rebase', '--no-autostash', '--onto', onto, upstream
    ], { timeoutMs: T.rebase })
    if (r.code === 0 && !r.timedOut) return
    const output = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
    if (!r.timedOut && rebaseInProgress(wt)) {
      const files = conflictedFiles(wt)
      if (files.length) {
        // Remember where this rebase was going, so once the agent finishes
        // it the next Finish knows which commits are the agent's.
        await patchEntry(job, { rebaseOnto: onto })
        throw new Stop('conflict', {
          detail: truncate(`rebase onto ${job.target} hit a conflict in ${listForDetail(files)}`),
          logPath: job.logPath
        }, [
          `Rebase onto ${job.target} (${onto}) stopped with conflicts.`,
          output,
          'Conflicted files:',
          ...files.map(f => `  ${f}`),
          'Resolve the conflicts in these files, commit, then git rebase --continue'
        ].join('\n'))
      }
    }
    // Not a conflict (timeout, fatal error): don't leave a rebase behind that
    // would keep asking for --continue.
    if (rebaseInProgress(wt)) {
      await runGit(wt, ['-c', `core.hooksPath=${emptyHooksDir()}`, 'rebase', '--abort'], { timeoutMs: T.rebase })
    }
    throw blocked(r.timedOut ? 'rebase timed out' : (truncate(r.stderr || r.stdout) || `couldn't rebase onto ${job.target}`), { logPath: job.logPath }, output)
  }

  async function landUnderLock(job, wt, sha, onto) {
    const { repoDir, target } = job
    if (job.cancelled) return { cancelled: true }

    const entry = readMeta(repoDir).agents[job.agentId]
    if (!entry) throw blocked('the agent was closed before its work could land')
    if (!existsSync(wt) || refSha(wt, 'HEAD') !== sha) throw blocked('changed during tests')

    const cur = currentBranch(repoDir)
    if (cur !== target) {
      throw blocked(cur
        ? `the main folder switched to ${cur} during tests`
        : 'the main folder is on a detached HEAD')
    }
    const now = refSha(repoDir, `refs/heads/${target}`)
    if (now !== onto) return { moved: true, now }

    const cleanBefore = snapshotBeforeMerge(repoDir, onto, sha)
    // Last chance to stop: nothing has touched the main folder yet.
    if (job.cancelled) return { cancelled: true }
    // Hooks off (no post-merge surprises, no unbounded output); never
    // overwrite ignored files; never autostash the user's edits.
    const r = await runGit(repoDir, [
      '-c', `core.hooksPath=${emptyHooksDir()}`,
      'merge', '--ff-only', '--no-autostash', '--no-overwrite-ignore', '--no-edit', sha
    ], { timeoutMs: T.merge })

    // Whatever git's exit, the ref says whether the work landed.
    const landed = refSha(repoDir, `refs/heads/${target}`) === sha
    if (!landed) {
      const output = [r.stdout, r.stderr].filter(Boolean).join('\n').trim()
      const overlap = parseOverwritten(r.stderr)
      let undo = { restored: [], failed: [] }
      try { undo = await undoPartialLanding(repoDir, cleanBefore, sha) } catch {}
      const parts = []
      if (overlap.length) parts.push(`files in the main folder would be overwritten: ${listForDetail(overlap)}`)
      else parts.push(r.timedOut ? 'git merge timed out' : (truncate(r.stderr || r.stdout) || 'git merge --ff-only failed'))
      if (undo.restored.length) parts.push(`put back ${listForDetail(undo.restored)}`)
      if (undo.failed.length) parts.push(`couldn't put back ${listForDetail(undo.failed)}`)
      throw blocked(parts.join('; '), { logPath: job.logPath }, output)
    }

    // A later close keeps any branch with commits past baseSha. Everything on
    // the branch is now in the target, so move baseSha up to it. Its own try:
    // a failed meta write must not turn a landed merge into "blocked".
    try {
      const meta = readMeta(repoDir)
      if (meta.agents[job.agentId]) {
        const next = { ...meta.agents[job.agentId], baseSha: sha }
        delete next.rebaseOnto
        meta.agents[job.agentId] = next
        writeMeta(repoDir, meta)
      }
    } catch (e) {
      log(job, `Landed, but couldn't record it in the agent's meta: ${e?.message ?? e}`)
    }
    return { landed: true }
  }

  async function pipeline(job) {
    const { repoDir, agentId, target } = job

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
      const files = conflictedFiles(wt)
      throw new Stop('conflict', {
        detail: 'a rebase is still in progress; finish it with git rebase --continue',
        logPath: job.logPath
      }, [
        'A rebase from an earlier Finish is still in progress.',
        ...(files.length ? ['Conflicted files:', ...files.map(f => `  ${f}`)] : []),
        'Resolve the conflicts in these files, commit, then git rebase --continue'
      ].join('\n'))
    }
    const wtBranch = currentBranch(wt)
    if (wtBranch !== entry.branch) {
      throw blocked(`the agent's folder is on ${wtBranch ?? 'a detached HEAD'}, not ${entry.branch}`)
    }

    // Where the agent's own commits start. After a conflict the agent
    // finished, they sit on the commit that rebase was going onto.
    let upstream = entry.baseSha
    if (entry.rebaseOnto) {
      let continued = false
      try { continued = isAncestor(wt, entry.rebaseOnto, 'HEAD') } catch {}
      if (continued) upstream = entry.rebaseOnto
      await patchEntry(job, continued ? { baseSha: entry.rebaseOnto, rebaseOnto: undefined } : { rebaseOnto: undefined })
    }
    let baseOk = false
    try { baseOk = !!upstream && isAncestor(wt, upstream, 'HEAD') } catch {}
    if (!baseOk) throw blocked("the agent's branch was rewritten, so its own commits can't be told apart; rebase it onto the target by hand")

    emit(job, 'testing')

    // 2. Commit leftovers (the user's own hooks run here, async with a limit)
    if (changedFiles(wt).length > 0) {
      const add = await runGit(wt, ['add', '-A'], { timeoutMs: T.add })
      if (add.code !== 0 || add.timedOut) throw blocked(resultText(add, 'git add'), {}, add.stderr)
      const commitStart = Date.now()
      const commit = await runGit(wt, ['commit', '-q', '-m', `${job.agentName || 'Agent'}: finish`], { timeoutMs: T.commit })
      if (commit.timedOut) clearOwnIndexLock(wt, commitStart)
      if (commit.code !== 0 || commit.timedOut) {
        throw blocked(
          commit.timedOut ? `committing the agent's changes timed out after ${Math.round(T.commit / 1000)}s (a commit hook?)` : resultText(commit, 'git commit'),
          {}, [commit.stdout, commit.stderr].filter(Boolean).join('\n')
        )
      }
    }
    if (job.cancelled) return

    if (countRange(wt, upstream) === 0) throw blocked('nothing to merge')

    let onto = refSha(repoDir, `refs/heads/${target}`)
    if (!onto) throw blocked(`couldn't read ${target}`)
    let retried = false
    let installedSig = null
    for (;;) {
      // 3. Rebase just the agent's commits
      await rebaseOnto(job, wt, onto, upstream)
      upstream = onto
      await patchEntry(job, { baseSha: onto })
      if (countRange(wt, onto) === 0) throw blocked(`nothing to merge, ${target} already has these changes`)
      if (job.cancelled) return

      // 4. Dependencies
      if (lockfileDiffers(wt, onto)) {
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
          let r = null
          try { r = await runInstall({ cwd: wt, logPath: job.logPath, signal: job.controller.signal }) } catch {}
          if (job.cancelled || !r?.ok) {
            const back = await restoreDepsLink(job, wt)
            if (job.cancelled) return
            if (!back.ok) throw blocked(`installing the changed dependencies failed, and ${back.detail}`, { logPath: job.logPath })
            throw blocked('installing the changed dependencies failed', { logPath: job.logPath })
          }
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
      if (dirty.length) throw blocked(`changed during tests: ${listForDetail(dirty)}`)

      // 7. Land (the only long step under the repo lock, and it has a timeout)
      const landed = await withRepoLock(repoDir, () => landUnderLock(job, wt, sha, onto))
      if (landed.cancelled) return
      if (landed.moved) {
        if (retried) throw blocked(`${target} moved again during tests`)
        retried = true
        if (!landed.now) throw blocked(`couldn't read ${target}`)
        onto = landed.now
        continue
      }

      // 8. After landing
      const done = new Stop(untested ? 'merged-untested' : 'merged', {
        lockfileChanged: job.lockfileChanged || undefined
      })
      done.landed = true // reported even if a cancel arrived while git was landing it
      throw done
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
      const stop = e instanceof Stop ? e : blocked(errText(e) || 'unexpected error')
      if (!job.cancelled) {
        if (stop.log) log(job, stop.log)
        if (stop.state === 'blocked' && stop.extra.detail) log(job, `Blocked: ${stop.extra.detail}`)
      }
      if (stop.state === 'blocked' && stop.extra.detail && !stop.extra.logPath) stop.extra.logPath = job.logPath
      emit(job, stop.state, stop.extra, { truth: !!stop.landed })
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

    const key = repoKey(repoDir)
    const prev = chains.get(key) ?? Promise.resolve()
    const p = prev
      .then(() => { job.started = true; return runJob(job) })
      .catch(() => {})
      .then(() => { if (chains.get(key) === p) chains.delete(key) })
    chains.set(key, p)
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
    const empty = { ahead: 0, files: 0, dirty: false, insertions: 0, deletions: 0, target }
    try {
      const entry = readMeta(repoDir).agents[agentId]
      if (!entry) return empty
      const wt = entryWorktreePath(repoDir, agentId, entry)
      if (!existsSync(wt)) return empty
      // The agent's own commits start at baseSha; fall back to the target if
      // the branch no longer contains it.
      let base = entry.baseSha
      try { if (!base || !isAncestor(wt, base, 'HEAD')) base = target ? `refs/heads/${target}` : null } catch { base = null }
      if (!base) return empty
      const ahead = countRange(wt, base)
      const files = new Set(git(wt, ['diff', '--name-only', '-z', `${base}...HEAD`]).split('\0').filter(Boolean))
      const dirtyFiles = changedFiles(wt)
      for (const f of dirtyFiles) files.add(f)
      let lines = { insertions: 0, deletions: 0 }
      try { lines = diffLines(wt, base) } catch {}
      return { ahead, files: files.size, dirty: dirtyFiles.length > 0, ...lines, target }
    } catch {
      return empty
    }
  }

  // Resolves once every queued Finish (for one repo, or all) has settled.
  async function drain(repoDir) {
    for (;;) {
      const pending = repoDir ? [chains.get(repoKey(repoDir))].filter(Boolean) : [...chains.values()]
      if (pending.length === 0) return
      await Promise.all(pending)
    }
  }

  return { finish, cancel, info, drain }
}
