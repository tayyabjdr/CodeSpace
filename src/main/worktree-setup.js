import { execFileSync } from 'child_process'
import { existsSync, lstatSync, symlinkSync, unlinkSync, readdirSync, copyFileSync, constants } from 'fs'
import { join } from 'path'

// node_modules is linked (junction) rather than copied: an install per agent
// is slow and heavy. The link is local-excluded, so git never stages it.
//
// DANGER: the link points at the user's real node_modules. Anything that
// deletes a worktree recursively must call removeDepsLink first and must stop
// if that throws.

function lstatOrNull(p) {
  try { return lstatSync(p) } catch { return null }
}

// lstat on purpose: never follow the link. A Windows junction reports
// isSymbolicLink() === true from lstat.
export function isDepsLink(wtPath) {
  const st = lstatOrNull(join(wtPath, 'node_modules'))
  return !!st && st.isSymbolicLink()
}

// Removes only the link itself. No-op when node_modules is missing or a real
// folder. Throws if the link cannot be removed or is still there afterwards.
export function removeDepsLink(wtPath) {
  if (!isDepsLink(wtPath)) return
  unlinkSync(join(wtPath, 'node_modules'))
  if (isDepsLink(wtPath)) throw new Error('node_modules link is still present after unlink')
}

function isIgnored(repoDir, name) {
  try {
    execFileSync('git', ['-C', repoDir, 'check-ignore', '-q', '--', name], {
      stdio: 'ignore', windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

export function setupWorktree({ repoDir, wtPath }) {
  const warnings = []

  try {
    const target = join(repoDir, 'node_modules')
    if (existsSync(target)) symlinkSync(target, join(wtPath, 'node_modules'), 'junction')
  } catch {
    warnings.push("Couldn't link node_modules. Run an install in this agent's folder.")
  }

  let names = []
  try {
    names = readdirSync(repoDir, { withFileTypes: true })
      .filter(d => d.isFile() && /^\.env/.test(d.name))
      .map(d => d.name)
  } catch {}
  for (const name of names) {
    if (!isIgnored(repoDir, name)) continue
    try {
      copyFileSync(join(repoDir, name), join(wtPath, name), constants.COPYFILE_EXCL)
    } catch (e) {
      if (e?.code === 'EEXIST') continue
      warnings.push(`Couldn't copy ${name}. Copy it from the main folder by hand.`)
    }
  }

  return { warnings }
}
