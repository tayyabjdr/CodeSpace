// Centralised "Claude is done" detector.
//
// Why this lives outside any React component: the silence timer and the
// awaiting-response flag must survive a TerminalPane unmount. When the user
// switches workspaces, hidden panes unmount but their PTYs keep streaming.
// If the silence detector were per-pane (its previous home), notifications
// for a hidden workspace would never fire. We attach to the PTY pool here
// once per (termId, ptyId) and keep listening regardless of mount state.

import * as ptyPool from './pty-pool.js'
import { DONE_SILENCE_MS } from './constants.js'
import { playDoneSound } from './done-sound.js'
import { getSettings } from './settings-store.js'

const subs = new Map()           // termId -> { ptyId, detach }
const awaiting = new Set()       // termId — Enter pressed, response pending
const doneSet = new Set()        // termId — currently flagged done
const silenceTimers = new Map()  // termId -> timeout handle
const listeners = new Set()      // subscribers for done-state changes
const doneListeners = new Set()  // (termId) => void — fires when a turn finishes

let isAttended = () => false     // (termId) => bool — set from App

// Frozen snapshot of doneSet. Re-built on each notify so useSyncExternalStore
// gets a stable reference between notifications (React calls getSnapshot
// multiple times per render and warns if the result keeps changing).
let doneSnapshot = new Set()

export function setAttendedCheck(fn) { isAttended = fn }

export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function onDone(cb) {
  doneListeners.add(cb)
  return () => doneListeners.delete(cb)
}

function notify() {
  doneSnapshot = new Set(doneSet)
  for (const cb of listeners) cb()
}

export function isDone(termId) {
  return doneSet.has(termId)
}

export function getDoneTermIds() {
  return doneSnapshot
}

export function noteUserInput(termId, data) {
  if (typeof data !== 'string') return
  if (data.includes('\r') || data.includes('\n')) {
    awaiting.add(termId)
  }
}

export function noteFocus(termId) {
  if (!doneSet.has(termId)) return
  doneSet.delete(termId)
  clearTimeout(silenceTimers.get(termId))
  silenceTimers.delete(termId)
  notify()
}

function trackTerm(termId, ptyId) {
  const detach = ptyPool.attach(ptyId, {
    onData: () => {
      if (!awaiting.has(termId)) return
      clearTimeout(silenceTimers.get(termId))
      silenceTimers.set(termId, setTimeout(() => {
        awaiting.delete(termId)
        silenceTimers.delete(termId)
        if (!isAttended(termId)) {
          doneSet.add(termId)
          playDoneSound()
          if (getSettings().notifications.taskbarFlashOnDone) {
            window.electronAPI?.flashWindow?.()
          }
          notify()
        }
        for (const cb of doneListeners) {
          try { cb(termId) } catch (err) { console.warn('[done-tracker] listener threw:', err) }
        }
      }, DONE_SILENCE_MS))
    }
  })
  subs.set(termId, { ptyId, detach })
}

function untrackTerm(termId) {
  const existing = subs.get(termId)
  if (existing) existing.detach()
  subs.delete(termId)
  awaiting.delete(termId)
  const wasDone = doneSet.delete(termId)
  clearTimeout(silenceTimers.get(termId))
  silenceTimers.delete(termId)
  if (wasDone) notify()
}

// App calls this with the current set of (termId -> ptyId) across every
// workspace. Adds new subscriptions, removes ones whose terminal disappeared
// or whose ptyId changed.
export function syncTracked(map) {
  for (const [termId, ptyId] of map) {
    const existing = subs.get(termId)
    if (existing && existing.ptyId === ptyId) continue
    if (existing) existing.detach()
    trackTerm(termId, ptyId)
  }
  for (const termId of [...subs.keys()]) {
    if (!map.has(termId)) untrackTerm(termId)
  }
}
