// Decouples PTY lifecycle from xterm mount lifecycle.
// Each PTY has a single live IPC subscription; data is fanned out to any
// currently-attached listener and appended to a recent-output ring so a
// remounted xterm sees recent context immediately.

const RING_BYTES = 64 * 1024
// Only slice down once the buffer exceeds 1.5× — slicing on every chunk is
// expensive when output is bursty. We trade a slightly larger memory ceiling
// for far fewer string allocations.
const RING_TRIM_AT = Math.floor(RING_BYTES * 1.5)

const buffers = new Map()       // ptyId -> string
const liveListeners = new Map() // ptyId -> Set<(data: string) => void>
const exitListeners = new Map() // ptyId -> Set<(code: number) => void>
const exitCodes = new Map()     // ptyId -> number (if exited)
const cleanups = new Map()      // ptyId -> () => void (IPC unsubscribe)

const pendingCreates = new Map() // token -> Promise<ptyId>
const cancelledTokens = new Set()

// Claude CLI runs on Bun; spawning many instances in the same tick has been
// observed to panic Bun's HTTP client thread init on Windows. Space spawns
// out by ~200ms so each one gets its own initialization window.
let lastSpawnAt = 0
const MIN_SPAWN_GAP_MS = 200

function ensureSubscription(ptyId) {
  if (cleanups.has(ptyId)) return
  buffers.set(ptyId, '')
  const offData = window.electronAPI.onPtyData(ptyId, data => {
    const cur = buffers.get(ptyId) ?? ''
    const next = cur + data
    buffers.set(ptyId, next.length > RING_TRIM_AT ? next.slice(-RING_BYTES) : next)
    const set = liveListeners.get(ptyId)
    if (set) for (const fn of set) fn(data)
  })
  const offExit = window.electronAPI.onPtyExit(ptyId, code => {
    exitCodes.set(ptyId, code)
    const set = exitListeners.get(ptyId)
    if (set) for (const fn of set) fn(code)
  })
  cleanups.set(ptyId, () => { offData(); offExit() })
}

export async function createPty(shell, cwd, token, cols, rows) {
  // Reserve our slot in the spawn queue synchronously so concurrent callers
  // each get their own delayed start time.
  const now = Date.now()
  const wait = Math.max(0, lastSpawnAt + MIN_SPAWN_GAP_MS - now)
  lastSpawnAt = Math.max(lastSpawnAt, now) + (wait > 0 ? MIN_SPAWN_GAP_MS : 0)

  const p = (wait > 0
    ? new Promise(r => setTimeout(r, wait)).then(() => {
        if (token && cancelledTokens.has(token)) {
          cancelledTokens.delete(token)
          const err = new Error('PTY creation cancelled')
          err.cancelled = true
          throw err
        }
        return window.electronAPI.createPty(shell, cwd, cols, rows)
      })
    : window.electronAPI.createPty(shell, cwd, cols, rows)
  ).then((res) => {
    // Main may decline to spawn (Claude not installed, cwd missing, etc.).
    if (res?.error) {
      const err = new Error(res.error)
      err.code = res.error
      err.detail = res
      throw err
    }
    const ptyId = res.ptyId
    if (token && cancelledTokens.has(token)) {
      cancelledTokens.delete(token)
      window.electronAPI.killPty(ptyId)
      const err = new Error('PTY creation cancelled')
      err.cancelled = true
      throw err
    }
    ensureSubscription(ptyId)
    return ptyId
  })
  if (token) {
    pendingCreates.set(token, p)
    p.finally(() => pendingCreates.delete(token)).catch(() => {})
  }
  return p
}

// Mark an in-flight createPty so that when it resolves, the new PTY is
// killed immediately. Safe to call when no creation is pending — no-op.
export function cancelCreate(token) {
  if (!token) return
  if (pendingCreates.has(token)) cancelledTokens.add(token)
}

export function attach(ptyId, { onData, onExit }) {
  ensureSubscription(ptyId)
  if (onData) {
    const replay = buffers.get(ptyId)
    if (replay) onData(replay)
    if (!liveListeners.has(ptyId)) liveListeners.set(ptyId, new Set())
    liveListeners.get(ptyId).add(onData)
  }
  if (onExit) {
    if (exitCodes.has(ptyId)) onExit(exitCodes.get(ptyId))
    if (!exitListeners.has(ptyId)) exitListeners.set(ptyId, new Set())
    exitListeners.get(ptyId).add(onExit)
  }
  return () => {
    if (onData) liveListeners.get(ptyId)?.delete(onData)
    if (onExit) exitListeners.get(ptyId)?.delete(onExit)
  }
}

export function killPty(ptyId) {
  window.electronAPI.killPty(ptyId)
  cleanups.get(ptyId)?.()
  cleanups.delete(ptyId)
  buffers.delete(ptyId)
  liveListeners.delete(ptyId)
  exitListeners.delete(ptyId)
  exitCodes.delete(ptyId)
}

export function writePty(ptyId, data) {
  window.electronAPI.writePty(ptyId, data)
}

export function resizePty(ptyId, cols, rows) {
  window.electronAPI.resizePty(ptyId, cols, rows)
}

export function getRing(ptyId) {
  return buffers.get(ptyId) ?? ''
}
