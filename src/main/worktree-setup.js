import { execFileSync } from 'child_process'
import { existsSync, lstatSync, symlinkSync, unlinkSync, readdirSync, copyFileSync, constants } from 'fs'
import { join } from 'path'

// node_modules is linked (junction) rather than copied: an install per agent
// is slow and heavy. The link is local-excluded, so git never stages it.
//
// DANGER: the link points at the user's real node_modules. Anything that
// deletes a worktree recursively must call removeDepsLink first and must stop
// if that throws.

// Only "it isn't there" counts as missing. Any other failure (EPERM, EACCES,
// EBUSY...) must throw: treating it as "no link" would let a delete go ahead.
function lstatOrNull(p) {
  try { return lstatSync(p) }
  catch (e) {
    if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') return null
    throw e
  }
}

// lstat on purpose: never follow the link. A Windows junction reports
// isSymbolicLink() === true from lstat. Throws on anything but "missing".
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

// Unlinks EVERY link (symlink or junction) at any depth under wtPath, never
// following one. git and recursive deletes walk through junctions and delete
// the target's contents, and a link can be anywhere (an agent may rename
// node_modules, or nest one). Run before any removal; if it throws, do not
// remove anything. The top-level `.git` entry (a file in a worktree) is skipped.
export function removeAllLinks(wtPath) {
  const root = lstatOrNull(wtPath)
  if (!root) return
  if (root.isSymbolicLink()) throw new Error(`${wtPath} is itself a link, refusing to touch it`)
  if (!root.isDirectory()) return
  const stack = [wtPath]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      if (dir === wtPath && name === '.git') continue
      const p = join(dir, name)
      const st = lstatOrNull(p)
      if (!st) continue
      if (st.isSymbolicLink()) {
        unlinkSync(p)
        if (lstatOrNull(p)) throw new Error(`link is still present after unlink: ${p}`)
      } else if (st.isDirectory()) {
        stack.push(p)
      }
    }
  }
}

function isIgnoredIn(dir, name) {
  try {
    execFileSync('git', ['-C', dir, 'check-ignore', '-q', '--', name], {
      stdio: 'ignore', windowsHide: true
    })
    return true
  } catch {
    return false
  }
}

// Ignored in the repo AND in the worktree: a rule that lives only in an
// uncommitted .gitignore wouldn't exist in the worktree, and a copied secret
// there could be committed by "git add -A".
function isIgnored(repoDir, wtPath, name) {
  return isIgnoredIn(repoDir, name) && isIgnoredIn(wtPath, name)
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
    if (!isIgnored(repoDir, wtPath, name)) continue
    try {
      copyFileSync(join(repoDir, name), join(wtPath, name), constants.COPYFILE_EXCL)
    } catch (e) {
      if (e?.code === 'EEXIST') continue
      warnings.push(`Couldn't copy ${name}. Copy it from the main folder by hand.`)
    }
  }

  return { warnings }
}
