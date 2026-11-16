import { execFileSync } from 'child_process'
import { existsSync, lstatSync, symlinkSync, unlinkSync, readdirSync, copyFileSync, constants } from 'fs'
import { join } from 'path'
import { createServer, connect } from 'net'

// ── Ports ─────────────────────────────────────────────────────────────────
// Each isolated agent gets its own PORT so two agents running the same dev
// server don't fight over one. Reservations live in memory for the session:
// a port is held from create until its agent's worktree is removed.

export const PORT_MIN = 4100
export const PORT_MAX = 4999
const reserved = new Set()

// On Windows a bind only fails when the address matches exactly: a dev
// server on 0.0.0.0 or :: does not stop a 127.0.0.1 bind. Binding 0.0.0.0 or
// :: ourselves would catch those, but listening on all networks makes Windows
// Firewall ask the user to allow CodeSpace. So everything here stays on
// loopback: try to listen on 127.0.0.1 and ::1 (catches exact holders), and
// try to connect to both (a server on 0.0.0.0 answers on 127.0.0.1, one on ::
// answers on both). A refused connect on loopback is immediate on Windows.
// An IPv6 address the machine doesn't have is skipped, not counted as busy.
const LOOPBACK = ['127.0.0.1', '::1']
const NOT_HERE = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT'])
const CONNECT_TIMEOUT_MS = 500

// 'free' | 'busy' | 'absent'
function probeListen(port, host) {
  return new Promise(resolve => {
    // Destroy any connection that lands in the short listen window, so the
    // close below can't wait on a client (a browser retrying a dead server).
    const s = createServer(sock => sock.destroy())
    s.unref()
    s.once('error', (e) => resolve(NOT_HERE.has(e?.code) ? 'absent' : 'busy'))
    s.listen({ port, host }, () => s.close(() => resolve('free')))
  })
}

// 'busy' if something accepts a connection; anything else means nobody is
// listening there. A timeout counts as busy: something is holding the port.
function probeConnect(port, host) {
  return new Promise(resolve => {
    const sock = connect({ port, host })
    sock.unref()
    const done = (r) => { clearTimeout(t); sock.destroy(); resolve(r) }
    const t = setTimeout(() => done('busy'), CONNECT_TIMEOUT_MS)
    sock.once('connect', () => done('busy'))
    sock.once('error', () => done('free'))
  })
}

// Connect first, then listen: run together, a connect could reach our own
// short-lived probe listener and call the port busy.
async function isFree(port) {
  const connects = await Promise.all(LOOPBACK.map(h => probeConnect(port, h)))
  if (connects.includes('busy')) return false
  for (const h of LOOPBACK) {
    if ((await probeListen(port, h)) === 'busy') return false
  }
  return true
}

// Resolves to a free, now-reserved port, or null if none is left.
export async function pickPort() {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    if (reserved.has(port)) continue
    reserved.add(port) // claim before the async probe so concurrent picks can't share it
    if (await isFree(port)) return port
    reserved.delete(port)
  }
  return null
}

export function releasePort(port) {
  reserved.delete(port)
}

// Read-only view for tests and diagnostics.
export function reservedPorts() {
  return new Set(reserved)
}

// node_modules is linked (junction) rather than copied: an install per agent
// is slow and heavy. The link is local-excluded, so git never stages it.
//
// DANGER: links in a worktree (node_modules, or any an agent makes or renames)
// point at the user's real folders, and git and recursive deletes walk
// through them and delete the target's contents. Anything that removes a
// worktree MUST call removeAllLinks(wtPath) first and stop if it throws.
// removeDepsLink only handles the top-level node_modules and is not enough.
// Calling removeAllLinks again just before a recursive delete narrows the
// window in which a new link could appear, but cannot close it (a process can
// still create one between the walk and the delete).

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
      const p = join(dir, name)
      const st = lstatOrNull(p)
      if (!st) continue
      if (dir === wtPath && name.toLowerCase() === '.git') {
        // A worktree's .git is a plain file. Anything else (a link, a real
        // folder) is not something we understand, so refuse to remove.
        if (!st.isFile()) throw new Error(`${p} is not a regular file, refusing to remove this worktree`)
        continue
      }
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
