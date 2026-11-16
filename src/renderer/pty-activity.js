// When did each PTY last print something? Finish and the failure handoff both
// need "has this pane been quiet for 4000ms", the same threshold the
// done-tracker uses.
//
// Like done-tracker.js this lives outside React: a pane in a hidden workspace
// is unmounted, but its PTY keeps streaming and a failure handoff may still
// need to know whether it is quiet. App tracks every PTY once; panes read.

import { useEffect, useSyncExternalStore } from 'react'
import * as ptyPool from './pty-pool.js'
import { DONE_SILENCE_MS } from './constants.js'

const tracked = new Map() // ptyId -> { lastOutputAt, quiet, timer, detach, ms }
const listeners = new Set()
const inputAt = new Map() // ptyId -> last time the user typed or dropped into it

function notify() {
  for (const cb of listeners) cb()
}

export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function armQuietTimer(state) {
  clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    state.timer = null
    if (!state.quiet) { state.quiet = true; notify() }
  }, state.ms)
}

// Idempotent. Tracking starts "busy": we don't know what the PTY did before
// we were listening, so it has to earn its quiet like any other output.
export function track(ptyId, ms = DONE_SILENCE_MS) {
  if (!ptyId || tracked.has(ptyId)) return
  const state = { lastOutputAt: Date.now(), quiet: false, timer: null, detach: null, ms }
  tracked.set(ptyId, state)
  // attach() replays the ring buffer synchronously. That is old output, not
  // fresh activity, so ignore anything delivered during the call itself.
  let replaying = true
  state.detach = ptyPool.attach(ptyId, {
    onData: () => {
      if (replaying) return
      state.lastOutputAt = Date.now()
      armQuietTimer(state)
      if (state.quiet) { state.quiet = false; notify() }
    }
  })
  replaying = false
  armQuietTimer(state)
}

export function untrack(ptyId) {
  const state = tracked.get(ptyId)
  if (!state) return
  clearTimeout(state.timer)
  state.detach?.()
  tracked.delete(ptyId)
  inputAt.delete(ptyId)
  notify()
}

// App calls this with every live ptyId across all workspaces.
export function syncTracked(ptyIds) {
  const want = new Set(ptyIds)
  for (const id of want) track(id)
  for (const id of [...tracked.keys()]) if (!want.has(id)) untrack(id)
}

// Every keystroke, paste or drop into a pane. Kept apart from `tracked` so
// input counts even before output tracking has started.
export function noteInput(ptyId) {
  if (ptyId) inputAt.set(ptyId, Date.now())
}

export function lastInputAt(ptyId) {
  return inputAt.get(ptyId) ?? null
}

export function lastOutputAt(ptyId) {
  return tracked.get(ptyId)?.lastOutputAt ?? null
}

// Untracked or missing PTYs are never quiet, so nothing acts on them.
export function isQuiet(ptyId) {
  return tracked.get(ptyId)?.quiet ?? false
}

export function useQuiet(ptyId, ms = DONE_SILENCE_MS) {
  useEffect(() => { if (ptyId) track(ptyId, ms) }, [ptyId, ms])
  return useSyncExternalStore(subscribe, () => (ptyId ? isQuiet(ptyId) : false))
}

export function _resetForTests() {
  for (const id of [...tracked.keys()]) untrack(id)
  inputAt.clear()
  listeners.clear()
}
