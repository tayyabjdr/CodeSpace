import { execFileSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
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
