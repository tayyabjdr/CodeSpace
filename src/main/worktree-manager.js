import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, readdirSync, rmSync, rmdirSync, lstatSync } from 'fs'
import { join, dirname, basename, resolve } from 'path'
import { setupWorktree, removeAllLinks } from './worktree-setup.js'

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

export function canIsolate(dir) {
  if (!isGitAvailable()) return { ok: false, reason: 'git-missing' }
  if (!isGitRepo(dir)) return { ok: false, reason: 'not-a-repo' }
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
function entryWorktreePath(repoDir, agentId, entry) {
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

const repoLocks = new Map()
export async function withRepoLock(repoDir, fn) {
  const prev = repoLocks.get(repoDir) ?? Promise.resolve()
  let release
  const next = new Promise(r => { release = r })
  const chained = prev.then(() => next)
  repoLocks.set(repoDir, chained)
  await prev
  try { return await fn() }
  finally { release(); if (repoLocks.get(repoDir) === chained) repoLocks.delete(repoDir) }
}

async function _createImpl({ repoDir, workspaceName, agentId }) {
  if (!isGitAvailable()) {
    const err = new Error('git not found on PATH'); err.code = 'git-missing'; throw err
  }
  if (!isGitRepo(repoDir)) {
    const err = new Error('source is not a git repo'); err.code = 'not-a-repo'; throw err
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

  return { path: wtPath, branch, baseSha, warnings }
}

export async function create(args) {
  return withRepoLock(args.repoDir, () => _createImpl(args))
}

function metaEntry(repoDir, agentId) {
  const m = readMeta(repoDir)
  return { meta: m, entry: m.agents[agentId] }
}

export async function checkDirty({ repoDir, agentId }) {
  const { entry } = metaEntry(repoDir, agentId)
  if (!entry) return { missing: true }
  const wtPath = entryWorktreePath(repoDir, agentId, entry)
  if (!existsSync(wtPath)) return { missing: true }
  let out
  try { out = execGit(['-C', wtPath, 'status', '--porcelain']) }
  catch { return { dirty: false } }
  return { dirty: out.trim().length > 0 }
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
  if (!entry) return { ok: true, missing: true }
  const wtPath = entryWorktreePath(repoDir, agentId, entry)

  let aheadCount = 0
  if (existsSync(wtPath)) {
    try {
      const out = execGit(['-C', repoDir, 'rev-list', '--count', `${entry.baseSha}..${entry.branch}`])
      aheadCount = parseInt(out.trim(), 10) || 0
    } catch {}
  }

  // The worktree holds links (node_modules and any an agent made or renamed)
  // into the user's real folders, and git deletes through them. Unlink every
  // link BEFORE anything deletes, and if that fails touch nothing: a leftover
  // folder is cheap, a deleted node_modules is not.
  try { removeAllLinks(wtPath) }
  catch (e) {
    return {
      ok: false,
      error: 'deps-unlink-failed',
      path: wtPath,
      detail: `Couldn't detach links from ${wtPath}: ${e?.message ?? e}`
    }
  }

  // The agent's process was only just killed, so its files may still be held
  // for a moment. Retry a few times, each attempt starting with a link walk.
  // Only a real directory is deleted, never a link that could point elsewhere.
  for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(REMOVE_RETRY_MS)
    try { removeAllLinks(wtPath) }
    catch (e) {
      return {
        ok: false,
        error: 'deps-unlink-failed',
        path: wtPath,
        detail: `Couldn't detach links from ${wtPath}: ${e?.message ?? e}`
      }
    }
    try { execGit(['-C', repoDir, 'worktree', 'remove', '--force', wtPath]) }
    catch {}
    try {
      removeAllLinks(wtPath) // again: a link may have appeared since the first walk
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

  return { ok: true, branchKept: aheadCount > 0 }
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
      try {
        const res = await _closeImpl({ repoDir, agentId: id })
        if (res && res.ok === false) failures.push({ agentId: id, path: res.path ?? path, detail: res.detail ?? res.error })
      } catch (e) {
        failures.push({ agentId: id, path, detail: String(e?.message ?? e) })
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

// Synchronous dirty check (no lock — caller already holds it).
// Returns false on any error so cleanup isn't blocked by an unrelated git fault.
function _isDirty(repoDir, agentId, entry) {
  const wtPath = entryWorktreePath(repoDir, agentId, entry)
  if (!existsSync(wtPath)) return false
  try {
    const out = execGit(['-C', wtPath, 'status', '--porcelain'])
    return out.trim().length > 0
  } catch {
    return false
  }
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
      if (_isDirty(repoDir, id, entry)) {
        kept.push({
          agentId: id,
          branch: entry.branch,
          path: entryWorktreePath(repoDir, id, entry),
          reason: 'uncommitted'
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
