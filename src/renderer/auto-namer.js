// src/renderer/auto-namer.js
//
// On every Claude "turn finished" event from done-tracker, ask the main
// process to summarize the tail of that pane's PTY ring. Manual names
// pin a pane and disable auto-rename.

import stripAnsi from 'strip-ansi'
import * as ptyPool from './pty-pool.js'
import * as doneTracker from './done-tracker.js'

const TAIL_BYTES = 4096

const subs = new Set()                  // (termId, name) => void
const inFlight = new Set()              // termId
const lastTail = new Map()              // termId -> string (suppress no-op renames)
const ptyIdByTerm = new Map()           // termId -> ptyId
const isPinned = new Map()              // termId -> boolean (manual name set)

let keyCheckPromise = null
function ensureKeyCheck() {
  if (!keyCheckPromise) {
    keyCheckPromise = window.electronAPI.agentName.hasKey()
      .catch(() => false)
  }
  return keyCheckPromise
}

export function subscribe(cb) {
  subs.add(cb)
  return () => subs.delete(cb)
}

function notify(termId, name) {
  for (const cb of subs) {
    try { cb(termId, name) } catch (err) { console.warn('[auto-namer] subscriber threw:', err) }
  }
}

// App calls this whenever the (termId -> ptyId) map changes — same shape as
// done-tracker.syncTracked. Also receives the manual-name flag per term.
export function syncTracked(termMap, pinnedSet) {
  ptyIdByTerm.clear()
  for (const [termId, ptyId] of termMap) ptyIdByTerm.set(termId, ptyId)
  isPinned.clear()
  for (const termId of pinnedSet) isPinned.set(termId, true)
  // Drop stale state for terms that no longer exist.
  for (const termId of [...lastTail.keys()]) {
    if (!ptyIdByTerm.has(termId)) {
      lastTail.delete(termId)
      inFlight.delete(termId)
    }
  }
}

function sanitize(name) {
  if (typeof name !== 'string') return ''
  let s = name.trim()
  s = s.replace(/^["'`]+|["'`]+$/g, '')
  s = s.replace(/[.!?]+$/, '')
  if (s.length > 40) s = s.slice(0, 40).trim()
  return s
}

async function handleDone(termId) {
  if (isPinned.get(termId)) return
  if (inFlight.has(termId)) return
  const ptyId = ptyIdByTerm.get(termId)
  if (!ptyId) return
  if (!(await ensureKeyCheck())) return

  const ring = ptyPool.getRing(ptyId)
  if (!ring) return
  const tail = stripAnsi(ring).slice(-TAIL_BYTES).trim()
  if (!tail) return
  if (lastTail.get(termId) === tail) return
  lastTail.set(termId, tail)

  inFlight.add(termId)
  try {
    const res = await window.electronAPI.agentName.summarize(tail)
    if (res?.ok && res.name) {
      const clean = sanitize(res.name)
      if (clean) notify(termId, clean)
    }
  } catch (err) {
    console.warn('[auto-namer] summarize threw:', err)
  } finally {
    inFlight.delete(termId)
  }
}

doneTracker.onDone(handleDone)
