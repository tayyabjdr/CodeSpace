import { execFileSync } from 'child_process'

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
