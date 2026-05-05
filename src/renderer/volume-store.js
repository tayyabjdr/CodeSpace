// Global "done sound" volume + mute state, persisted to localStorage.
// Read by playDoneSound() in TerminalPane and by the toolbar UI.

const STORAGE_KEY = 'codespace.volume.v1'

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { volume: 50, muted: false }
    const parsed = JSON.parse(raw)
    return {
      volume: clamp(Number(parsed.volume), 0, 100, 50),
      muted: parsed.muted === true
    }
  } catch {
    return { volume: 50, muted: false }
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
  // Adjusting the slider auto-unmutes — matches the mockup interaction.
  const muted = state.muted && next === state.volume ? state.muted : false
  if (next === state.volume && muted === state.muted) return
  state = { volume: next, muted }
  persist()
  emit()
}

export function setMuted(m) {
  const next = !!m
  if (next === state.muted) return
  state = { ...state, muted: next }
  persist()
  emit()
}

export function subscribe(callback) {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

// Effective playback amplitude for the AudioContext gain node.
// Maps 0–100 → 0–0.4. A pure sine sounds noticeably quieter than a real
// notification dingdone; 0.4 at 100% lands in the typical UI-sound range
// (~0.3–0.5). 50% default ≈ 0.2, comfortably audible without being startling.
export function getDoneSoundGain() {
  if (state.muted || state.volume === 0) return 0
  return 0.4 * (state.volume / 100)
}
