// Latest merge status per agent. App subscribes to electronAPI.merge.onStatus
// once and fans each event out here, so panes don't each hold an IPC listener.
// Every event gets a sequence number: panes key their "status changed" work
// on it, and the failure handoff fires once per event, never per render.

import { useSyncExternalStore } from 'react'

const statuses = new Map()       // agentId -> { ...payload, seq }
const listeners = new Set()      // store listeners (useSyncExternalStore)
const eventListeners = new Set() // (status) => void, once per event
let seq = 0

function notify() {
  for (const cb of listeners) cb()
}

export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function onMergeEvent(cb) {
  eventListeners.add(cb)
  return () => eventListeners.delete(cb)
}

export function getStatus(agentId) {
  return statuses.get(agentId) ?? null
}

export function handleStatus(payload) {
  if (!payload || typeof payload.agentId !== 'string') return
  const status = { ...payload, seq: ++seq }
  statuses.set(payload.agentId, status)
  notify()
  for (const cb of eventListeners) {
    try { cb(status) } catch (err) { console.warn('[merge-status] listener threw:', err) }
  }
}

// Returns an unsubscribe. Safe when the bridge has no merge API (tests, older
// preload): nothing subscribes and nothing breaks.
export function startMergeStatus(mergeApi = window.electronAPI?.merge) {
  if (typeof mergeApi?.onStatus !== 'function') return () => {}
  const off = mergeApi.onStatus(handleStatus)
  return typeof off === 'function' ? off : () => {}
}

export function forgetStatus(agentId) {
  if (statuses.delete(agentId)) notify()
}

export function useMergeStatus(agentId) {
  return useSyncExternalStore(subscribe, () => (agentId ? getStatus(agentId) : null))
}

export function _resetForTests() {
  statuses.clear()
  listeners.clear()
  eventListeners.clear()
  seq = 0
}
