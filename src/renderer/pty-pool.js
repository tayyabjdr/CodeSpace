// Decouples PTY lifecycle from xterm mount lifecycle.
// Each PTY has a single live IPC subscription; data is fanned out to any
// currently-attached listener and appended to a recent-output ring so a
// remounted xterm sees recent context immediately.

const RING_BYTES = 64 * 1024

const buffers = new Map()       // ptyId -> string
const liveListeners = new Map() // ptyId -> Set<(data: string) => void>
const exitListeners = new Map() // ptyId -> Set<(code: number) => void>
const exitCodes = new Map()     // ptyId -> number (if exited)
const cleanups = new Map()      // ptyId -> () => void (IPC unsubscribe)

function ensureSubscription(ptyId) {
  if (cleanups.has(ptyId)) return
  buffers.set(ptyId, '')
  const offData = window.electronAPI.onPtyData(ptyId, data => {
    const cur = buffers.get(ptyId) ?? ''
    const next = cur + data
    buffers.set(ptyId, next.length > RING_BYTES ? next.slice(-RING_BYTES) : next)
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

export async function createPty(shell, cwd) {
  const { ptyId } = await window.electronAPI.createPty(shell, cwd)
  ensureSubscription(ptyId)
  return ptyId
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
