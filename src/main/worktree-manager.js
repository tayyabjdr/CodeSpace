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
