// Global "done sound" volume, persisted to localStorage. Volume === 0 IS
// muted — there is no separate mute flag.

const STORAGE_KEY = 'codespace.volume.v1'

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { volume: 50 }
    const parsed = JSON.parse(raw)
    return { volume: clamp(Number(parsed.volume), 0, 100, 50) }
  } catch {
    return { volume: 50 }
  }
}

function clamp(n, min, max, fallback) {
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

let state = loadInitial()
const listeners = new Set()

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

function emit() {
  for (const fn of listeners) fn(state)
}

export function getState() {
  return state
}

export function setVolume(v) {
  const next = clamp(Math.round(Number(v)), 0, 100, state.volume)
  if (next === state.volume) return
  state = { volume: next }
  persist()
  emit()
}

export function subscribe(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

// Effective playback amplitude for the AudioContext gain node.
// Maps 0–100 → 0–0.4. A pure sine sounds noticeably quieter than a real
// notification ding; 0.4 at 100% lands in the typical UI-sound range
// (~0.3–0.5). 50% default ≈ 0.2, comfortably audible without being startling.
export function getDoneSoundGain() {
  if (state.volume === 0) return 0
  return 0.4 * (state.volume / 100)
}
