import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, readdirSync, rmSync, rmdirSync, lstatSync, realpathSync } from 'fs'
import { join, dirname, basename, resolve } from 'path'
import { setupWorktree, removeAllLinks, pickPort, releasePort } from './worktree-setup.js'
import { trustFolder, forgetFolder } from './claude-trust.js'

let gitAvailable = null

export function isGitAvailable() {
  if (gitAvailable !== null) return gitAvailable
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true })
    gitAvailable = true
  } catch {
    gitAvailable = false
  }
  return gitAvailable
}

export function isGitRepo(dir) {
  if (typeof dir !== 'string' || dir.length === 0) return false
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      encoding: 'utf8'
    })
    return out.trim() === 'true'
  } catch {
    return false
  }
}

// Same folder, compared the way Windows does: through junctions/subst
// (realpath), any drive-letter case, trailing separator or letter case.
function canonical(p) {
  let r = p
  try { r = realpathSync.native(p) } catch {}
  return repoKey(r).toLowerCase()
}

// Why `dir` can't hold isolated agents even though it is inside a repo, or null.
// - not-repo-root: a worktree is a checkout of the WHOLE repo, so a workspace
//   on a subfolder would run its agents (and Finish's check) in the wrong place.
// - drive-root: worktrees go beside the repo; a repo at a drive root has no
//   "beside", and nesting them inside it makes test runners see them twice.
function rootProblem(dir) {
  let top
  try {
    top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, encoding: 'utf8'
    }).trim()
  } catch {
    return 'not-repo-root'
  }
  if (!top || canonical(top) !== canonical(dir)) return 'not-repo-root'
  const abs = resolve(dir)
  if (dirname(abs) === abs) return 'drive-root'
  return null
}

export function canIsolate(dir) {
  if (!isGitAvailable()) return { ok: false, reason: 'git-missing' }
  if (!isGitRepo(dir)) return { ok: false, reason: 'not-a-repo' }
  const problem = rootProblem(dir)
  if (problem) return { ok: false, reason: problem }
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--verify', '--quiet', 'HEAD'], {
      stdio: 'ignore',
      windowsHide: true
    })
  } catch {
    return { ok: false, reason: 'no-commits' }
  }
  return { ok: true, reason: null }
}

// Worktrees live beside the repo, not inside it, so tools that scan the repo
// (test runners, watchers) never see a nested copy of the project.
const WT_ROOT_NAME = '.codespace-worktrees'

function legacyWorktreePath(repoDir, agentId) {
  return join(repoDir, '.codespace', 'worktrees', agentId)
}

export function worktreePath(repoDir, agentId) {
  const parent = dirname(repoDir)
  const name = basename(repoDir)
  if (!name || parent === repoDir) return legacyWorktreePath(repoDir, agentId)
  return join(parent, WT_ROOT_NAME, name, agentId)
}

// Where an existing agent's worktree really is. v1 entries have no `path`.
export function entryWorktreePath(repoDir, agentId, entry) {
  return entry?.path || legacyWorktreePath(repoDir, agentId)
}

// After a worktree is gone, drop its now-empty repo folder and the shared
// root. Non-recursive on purpose: anything still inside blocks the removal.
function pruneWorktreeRoots(wtPath) {
  const repoFolder = dirname(wtPath)
  const root = dirname(repoFolder)
  if (basename(root) !== WT_ROOT_NAME) return
  try { rmdirSync(repoFolder) } catch {}
  try { rmdirSync(root) } catch {}
}

export function ensureLocalExcludes(repoDir) {
  const out = execFileSync('git', ['-C', repoDir, 'rev-parse', '--git-common-dir'], {
    stdio: ['ignore', 'pipe', 'ignore'],
    windowsHide: true,
    encoding: 'utf8'
  }).trim()
  const infoDir = join(resolve(repoDir, out), 'info')
  const path = join(infoDir, 'exclude')
  let body = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const have = new Set(body.split(/\r?\n/).map(l => l.trim()))
  const missing = ['.codespace/', '/node_modules'].filter(l => !have.has(l))
  if (missing.length === 0) return
  if (body.length > 0 && !body.endsWith('\n')) body += '\n'
  body += missing.join('\n') + '\n'
  mkdirSync(infoDir, { recursive: true })
  writeFileSync(path, body, 'utf8')
}

export const META_DEFAULT = Object.freeze({ version: 1, gitignoreTouched: false, agents: {} })

function metaDir(repoDir) {
  return join(repoDir, '.codespace', 'worktrees')
}

function metaPath(repoDir) {
  return join(metaDir(repoDir), '.cs-meta.json')
}

export function readMeta(repoDir) {
  const p = metaPath(repoDir)
  if (!existsSync(p)) return { ...META_DEFAULT, agents: { ...META_DEFAULT.agents } }
  let raw
  try { raw = readFileSync(p, 'utf8') }
  catch { return { ...META_DEFAULT, agents: { ...META_DEFAULT.agents } } }
  let parsed
  try { parsed = JSON.parse(raw) }
  catch {
    try { renameSync(p, p + '.corrupt-' + Date.now()) } catch {}
    return { ...META_DEFAULT, agents: { ...META_DEFAULT.agents } }
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.agents) return { ...META_DEFAULT, agents: { ...META_DEFAULT.agents } }
  return {
    version: 1,
    gitignoreTouched: !!parsed.gitignoreTouched,
    agents: { ...parsed.agents }
  }
}

export function writeMeta(repoDir, data) {
  const dir = metaDir(repoDir)
  mkdirSync(dir, { recursive: true })
  const p = metaPath(repoDir)
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, p)
}

export function execGit(args, opts = {}) {
  return execFileSync('git', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    encoding: 'utf8',
    // Hooks and big diffs can print a lot; the 1MB default throws after git
    // has already succeeded, which reads as a failure.
    maxBuffer: 64 * 1024 * 1024,
    ...opts
  })
}

function slugify(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace'
}

function shortId(uuid) {
  return String(uuid).split('-')[0] || String(uuid).slice(0, 8)
}

function branchExists(repoDir, branch) {
  try {
    execGit(['-C', repoDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    return true
  } catch { return false }
}

function pickBranchName(repoDir, base) {
  if (!branchExists(repoDir, base)) return base
  for (let i = 2; i <= 5; i++) {
    const candidate = `${base}-${i}`
    if (!branchExists(repoDir, candidate)) return candidate
  }
  const err = new Error(`could not find a free branch name near ${base}`)
  err.code = 'branch-collision'
  throw err
}

// agentId -> reserved port, for this session. Released when the agent's
// worktree is actually removed; a close that fails keeps it, so the retry
// (wipeAll) is what frees it.
const agentPorts = new Map()
function freeAgentPort(agentId) {
  const port = agentPorts.get(agentId)
  if (port === undefined) return
  agentPorts.delete(agentId)
  releasePort(port)
}

// One key per folder however it is spelled: `D:\x`, `d:\x` and `D:\x\` are
// the same repo and must share a lock. Only the key is normalised; callers
// keep using the path they were given.
export function repoKey(repoDir) {
  let p = resolve(String(repoDir))
  if (/^[A-Za-z]:/.test(p)) p = p[0].toLowerCase() + p.slice(1)
  while (p.length > 3 && /[\\/]$/.test(p)) p = p.slice(0, -1)
  return p
}

const repoLocks = new Map()
export async function withRepoLock(repoDir, fn) {
  const key = repoKey(repoDir)
  const prev = repoLocks.get(key) ?? Promise.resolve()
  let release
  const next = new Promise(r => { release = r })
  const chained = prev.then(() => next)
  repoLocks.set(key, chained)
  await prev
  try { return await fn() }
  finally { release(); if (repoLocks.get(key) === chained) repoLocks.delete(key) }
}

async function _createImpl({ repoDir, workspaceName, agentId }) {
  if (!isGitAvailable()) {
    const err = new Error('git not found on PATH'); err.code = 'git-missing'; throw err
  }
  if (!isGitRepo(repoDir)) {
    const err = new Error('source is not a git repo'); err.code = 'not-a-repo'; throw err
  }
  const problem = rootProblem(repoDir)
  if (problem === 'not-repo-root') {
    const err = new Error('source is a folder inside a repo, not the repo root'); err.code = 'not-repo-root'; throw err
  }
  if (problem === 'drive-root') {
    const err = new Error('source repo is at a drive root'); err.code = 'drive-root'; throw err
  }
  let baseSha
  try { baseSha = execGit(['-C', repoDir, 'rev-parse', 'HEAD']).trim() }
  catch {
    const err = new Error('source repo has no commits'); err.code = 'no-commits'; throw err
  }

  ensureLocalExcludes(repoDir)

  const slug = slugify(workspaceName)
  const branch = pickBranchName(repoDir, `cs/${slug}/${shortId(agentId)}`)
  const wtPath = worktreePath(repoDir, agentId)

  try {
    execGit(['-C', repoDir, 'worktree', 'add', '-b', branch, wtPath, baseSha])
  } catch (e) {
    const err = new Error(`git worktree add failed: ${e.stderr || e.message}`)
    err.code = 'worktree-create-failed'
    err.detail = String(e.stderr || e.message).slice(0, 500)
    throw err
  }

  const meta = readMeta(repoDir)
  meta.gitignoreTouched = true
  meta.agents[agentId] = { path: wtPath, branch, baseSha, createdAt: new Date().toISOString() }
  writeMeta(repoDir, meta)

  // Never fails the create: problems come back as warnings.
  let warnings = []
  try { warnings = setupWorktree({ repoDir, wtPath }).warnings }
  catch { warnings = ["Couldn't finish setting up this agent's folder. Run an install there."] }

  // A port of its own; without one the agent still starts, on the shared default.
  let port = null
  try { port = await pickPort() } catch {}
  if (port === null) warnings = [...warnings, "Couldn't find a free port for this agent, so it uses the default one."]
  else agentPorts.set(agentId, port)

  // So Claude doesn't ask "Do you trust this folder?" for every agent.
  try { trustFolder(wtPath) } catch {}

  return { path: wtPath, branch, baseSha, warnings, port }
}

export async function create(args) {
  return withRepoLock(args.repoDir, () => _createImpl(args))
}

function metaEntry(repoDir, agentId) {
  const m = readMeta(repoDir)
  return { meta: m, entry: m.agents[agentId] }
}

// Whether a worktree holds uncommitted work. Fails CLOSED: if git can't read
// it (the repo was renamed or moved, the folder is damaged...), it counts as
// dirty, because every caller uses "clean" as permission to delete.
function dirtyState(repoDir, agentId, entry) {
  const wtPath = entryWorktreePath(repoDir, agentId, entry)
  if (!existsSync(wtPath)) return { missing: true }
  try {
    const out = execGit(['-C', wtPath, 'status', '--porcelain'])
    return { dirty: out.trim().length > 0 }
  } catch (e) {
    return {
      dirty: true,
      unreadable: true,
      detail: `git couldn't read ${wtPath}: ${String(e?.stderr || e?.message || e).trim().slice(0, 300)}`
    }
  }
}

export async function checkDirty({ repoDir, agentId }) {
  const { entry } = metaEntry(repoDir, agentId)
  if (!entry) return { missing: true }
  return dirtyState(repoDir, agentId, entry)
}

const REMOVE_ATTEMPTS = 3
const REMOVE_RETRY_MS = 500
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// true: gone. false: still there. Error object: couldn't tell (treated as not gone).
function folderGone(p) {
  try { lstatSync(p); return false }
  catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return true
    return e instanceof Error ? e : new Error(String(e))
  }
}

async function _closeImpl({ repoDir, agentId }) {
  const m = readMeta(repoDir)
  const entry = m.agents[agentId]
  if (!entry) { freeAgentPort(agentId); return { ok: true, missing: true } }
  const wtPath = entryWorktreePath(repoDir, agentId, entry)

  // Commits the agent made on its branch. Counted whether or not the folder
  // still exists: a folder the user deleted by hand (after a locked close told
  // them to) leaves the branch as the only copy of that work. null means the
  // count failed, and an uncounted branch is kept, never deleted.
  let aheadCount = null
  try {
    const out = execGit(['-C', repoDir, 'rev-list', '--count', `${entry.baseSha}..${entry.branch}`])
    const n = parseInt(out.trim(), 10)
    if (Number.isFinite(n)) aheadCount = n
  } catch {}

  // The worktree holds links (node_modules and any an agent made or renamed)
  // into the user's real folders, and git deletes through them. Every delete
  // below is preceded by a link walk, and a walk that fails stops the close
  // with nothing further deleted: a leftover folder is cheap, a deleted
  // node_modules is not.
  const unlinkFailed = (e) => ({
    ok: false,
    error: 'deps-unlink-failed',
    path: wtPath,
    detail: `Couldn't detach links from ${wtPath}: ${e?.message ?? e}`
  })

  // The agent's process was only just killed, so its files may still be held
  // for a moment. Retry a few times. Only a real directory is ever deleted,
  // never a link that could point elsewhere.
  for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(REMOVE_RETRY_MS)
    try { removeAllLinks(wtPath) } catch (e) { return unlinkFailed(e) }
    try { execGit(['-C', repoDir, 'worktree', 'remove', '--force', wtPath]) }
    catch {}
    if (folderGone(wtPath) === true) break
    // git left the folder behind. Walk again before deleting it ourselves: a
    // link may have appeared since the walk above.
    try { removeAllLinks(wtPath) } catch (e) { return unlinkFailed(e) }
    try {
      if (lstatSync(wtPath).isDirectory()) rmSync(wtPath, { recursive: true, force: true })
    } catch {}
    if (folderGone(wtPath) === true) break
  }

  // Never report success for a folder that is still there (or whose state we
  // can't read). Keep the meta entry and the branch so wipeAll retries it.
  const gone = folderGone(wtPath)
  if (gone !== true) {
    return {
      ok: false,
      error: 'folder-locked',
      path: wtPath,
      detail: gone === false
        ? `Couldn't remove ${wtPath}; something is still using it.`
        : `Couldn't check whether ${wtPath} was removed: ${gone.message ?? gone}`
    }
  }
  pruneWorktreeRoots(wtPath)

  try { execGit(['-C', repoDir, 'worktree', 'prune']) } catch {}

  if (aheadCount === 0) {
    try { execGit(['-C', repoDir, 'branch', '-D', entry.branch]) } catch {}
  }

  delete m.agents[agentId]
  writeMeta(repoDir, m)
  freeAgentPort(agentId)
  try { forgetFolder(wtPath) } catch {}

  return { ok: true, branchKept: aheadCount !== 0 }
}

export async function close(args) {
  return withRepoLock(args.repoDir, () => _closeImpl(args))
}

export async function closeAllForWorkspace({ repoDir, agentIds }) {
  return withRepoLock(repoDir, async () => {
    const failures = []
    for (const id of agentIds) {
      const entry = readMeta(repoDir).agents[id]
      const path = entry ? entryWorktreePath(repoDir, id, entry) : null
      // Never force-remove work: a worktree with uncommitted changes (or one
      // git can't read) stays, folder and branch, and is reported instead.
      if (entry) {
        const st = dirtyState(repoDir, id, entry)
        const reason = keepReason(st)
        if (reason) {
          failures.push({
            agentId: id,
            path,
            branch: entry.branch,
            reason,
            detail: st.detail ?? `${path} has uncommitted changes`
          })
          continue
        }
      }
      try {
        const res = await _closeImpl({ repoDir, agentId: id })
        if (res && res.ok === false) {
          failures.push({ agentId: id, path: res.path ?? path, branch: entry?.branch, reason: res.error ?? 'cleanup-failed', detail: res.detail ?? res.error })
        }
      } catch (e) {
        failures.push({ agentId: id, path, branch: entry?.branch, reason: e?.code ?? 'cleanup-failed', detail: String(e?.message ?? e) })
      }
    }
    try {
      const dir = join(repoDir, '.codespace', 'worktrees')
      const entries = readdirSync(dir).filter(n => n !== '.cs-meta.json')
      if (entries.length === 0 && Object.keys(readMeta(repoDir).agents).length === 0) rmSync(dir, { recursive: true, force: true })
    } catch {}
    return { failures }
  })
}

// Why a worktree must be kept rather than removed, or null if it may go.
function keepReason(state) {
  if (state.unreadable) return 'unreadable'
  if (state.dirty) return 'uncommitted'
  return null
}

function listStranded(repoDir, protectedBranches) {
  let refs
  try { refs = execGit(['-C', repoDir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/cs/']) }
  catch { return [] }
  const stranded = []
  for (const branch of refs.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    if (protectedBranches.has(branch)) continue
    try {
      const ahead = parseInt(execGit(['-C', repoDir, 'rev-list', '--count', `HEAD..${branch}`]).trim(), 10) || 0
      if (ahead > 0) stranded.push({ branch, ahead })
    } catch {}
  }
  return stranded
}

export async function wipeAll({ repoDir, liveAgentIds = [] }) {
  return withRepoLock(repoDir, async () => {
    const live = new Set(liveAgentIds)
    const m = readMeta(repoDir)
    const ids = Object.keys(m.agents)
    const kept = []
    for (const id of ids) {
      if (live.has(id)) continue
      const entry = m.agents[id]
      const st = dirtyState(repoDir, id, entry)
      const reason = keepReason(st)
      if (reason) {
        kept.push({
          agentId: id,
          branch: entry.branch,
          path: entryWorktreePath(repoDir, id, entry),
          reason,
          ...(st.detail ? { detail: st.detail } : {})
        })
        continue
      }
      let res = null
      try { res = await _closeImpl({ repoDir, agentId: id }) } catch {}
      if (res && res.ok === false) {
        kept.push({ agentId: id, branch: entry.branch, path: entryWorktreePath(repoDir, id, entry), reason: 'cleanup-failed', detail: res.detail })
      }
    }
    try { execGit(['-C', repoDir, 'worktree', 'prune']) } catch {}
    try {
      const dir = join(repoDir, '.codespace', 'worktrees')
      const entries = readdirSync(dir).filter(n => n !== '.cs-meta.json')
      if (entries.length === 0 && Object.keys(readMeta(repoDir).agents).length === 0) rmSync(dir, { recursive: true, force: true })
    } catch {}
    // Branches still tied to a tracked agent (live or kept dirty) are in use.
    const inUse = new Set(Object.values(readMeta(repoDir).agents).map(e => e.branch))
    return { kept, stranded: listStranded(repoDir, inUse) }
  })
}

// The user chose to throw away work an earlier session left behind: one
// leftover agent (folder, uncommitted changes, branch and its commits) or one
// stranded agent branch. Never touches a live agent. The folder goes through
// _closeImpl, so links are detached before anything is deleted.
export async function discard({ repoDir, agentId, branch, liveAgentIds = [] }) {
  return withRepoLock(repoDir, async () => {
    if (agentId) {
      if (liveAgentIds.includes(agentId)) return { ok: false, error: 'live' }
      const entry = readMeta(repoDir).agents[agentId]
      // Already cleaned up elsewhere: only the branch can be left. Removing it
      // (or finding it gone) counts as discarded, so the row can go.
      if (!entry) {
        if (typeof branch !== 'string' || !branch.startsWith('cs/')) return { ok: true, gone: true }
        const inUse = new Set(Object.values(readMeta(repoDir).agents).map(e => e.branch))
        if (inUse.has(branch)) return { ok: false, error: 'in-use' }
        if (!deleteAgentBranch(repoDir, branch)) return { ok: false, error: 'branch-delete-failed' }
        return { ok: true, gone: true }
      }
      const res = await _closeImpl({ repoDir, agentId })
      if (!res || res.ok === false) return res ?? { ok: false, error: 'cleanup-failed' }
      deleteAgentBranch(repoDir, entry.branch)
      return { ok: true }
    }
    if (typeof branch !== 'string' || !branch.startsWith('cs/')) return { ok: false, error: 'invalid-branch' }
    const inUse = new Set(Object.values(readMeta(repoDir).agents).map(e => e.branch))
    if (inUse.has(branch)) return { ok: false, error: 'in-use' }
    if (!deleteAgentBranch(repoDir, branch)) return { ok: false, error: 'branch-delete-failed' }
    return { ok: true }
  })
}

// true when the branch is gone afterwards (deleted now, or already gone).
function deleteAgentBranch(repoDir, branch) {
  if (typeof branch !== 'string' || !branch.startsWith('cs/')) return false
  try { execGit(['-C', repoDir, 'branch', '-D', branch]) } catch {}
  try { execGit(['-C', repoDir, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]); return false }
  catch { return true }
}

export async function repairOrphans({ repoDir }) {
  return withRepoLock(repoDir, async () => {
    const m = readMeta(repoDir)
    let changed = false
    for (const [id, entry] of Object.entries(m.agents)) {
      const wtPath = entryWorktreePath(repoDir, id, entry)
      if (!existsSync(wtPath)) {
        delete m.agents[id]
        changed = true
        try {
          const out = execGit(['-C', repoDir, 'rev-list', '--count', `${entry.baseSha}..${entry.branch}`])
          if (parseInt(out.trim(), 10) === 0) {
            try { execGit(['-C', repoDir, 'branch', '-D', entry.branch]) } catch {}
          }
        } catch {}
      }
    }
    try { execGit(['-C', repoDir, 'worktree', 'prune']) } catch {}
    if (changed) writeMeta(repoDir, m)
  })
}
