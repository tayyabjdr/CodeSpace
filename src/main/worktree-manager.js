import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'fs'
import { join } from 'path'

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

export function ensureGitignoreExcludes(repoDir) {
  const path = join(repoDir, '.gitignore')
  let body = ''
  if (existsSync(path)) {
    body = readFileSync(path, 'utf8')
    const lines = body.split(/\r?\n/)
    if (lines.some(l => l.trim() === '.codespace/')) return
    if (body.length > 0 && !body.endsWith('\n')) body += '\n'
    body += '.codespace/\n'
  } else {
    body = '.codespace/\n'
  }
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

function execGit(args, opts = {}) {
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

export async function create({ repoDir, workspaceName, agentId }) {
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

  ensureGitignoreExcludes(repoDir)

  const slug = slugify(workspaceName)
  const branch = pickBranchName(repoDir, `cs/${slug}/${shortId(agentId)}`)
  const wtPath = join(repoDir, '.codespace', 'worktrees', agentId)

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
  meta.agents[agentId] = { branch, baseSha, createdAt: new Date().toISOString() }
  writeMeta(repoDir, meta)

  return { path: wtPath, branch, baseSha }
}

function metaEntry(repoDir, agentId) {
  const m = readMeta(repoDir)
  return { meta: m, entry: m.agents[agentId] }
}

export async function checkDirty({ repoDir, agentId }) {
  const { entry } = metaEntry(repoDir, agentId)
  if (!entry) return { missing: true }
  const wtPath = join(repoDir, '.codespace', 'worktrees', agentId)
  if (!existsSync(wtPath)) return { missing: true }
  let out
  try { out = execGit(['-C', wtPath, 'status', '--porcelain']) }
  catch { return { dirty: false } }
  return { dirty: out.trim().length > 0 }
}

export async function close({ repoDir, agentId }) {
  const m = readMeta(repoDir)
  const entry = m.agents[agentId]
  if (!entry) return { ok: true, missing: true }
  const wtPath = join(repoDir, '.codespace', 'worktrees', agentId)

  let aheadCount = 0
  if (existsSync(wtPath)) {
    try {
      const out = execGit(['-C', repoDir, 'rev-list', '--count', `${entry.baseSha}..${entry.branch}`])
      aheadCount = parseInt(out.trim(), 10) || 0
    } catch {}
  }

  try { execGit(['-C', repoDir, 'worktree', 'remove', '--force', wtPath]) }
  catch {}

  try { execGit(['-C', repoDir, 'worktree', 'prune']) } catch {}

  if (aheadCount === 0) {
    try { execGit(['-C', repoDir, 'branch', '-D', entry.branch]) } catch {}
  }

  delete m.agents[agentId]
  writeMeta(repoDir, m)

  return { ok: true, branchKept: aheadCount > 0 }
}
