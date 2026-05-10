const LEGACY_KEY = 'codespace.volume.v1'

const DEFAULTS = {
  version: 1,
  appearance: { defaultPaneFontSize: 14 },
  notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
  updates: { autoUpdate: true },
  agents: { dangerouslySkipPermissions: true }
}

let state = { ...DEFAULTS }
const listeners = new Set()
let initialized = false

function emit() {
  for (const fn of listeners) fn(state)
}

async function migrateLegacyVolume() {
  let raw
  try { raw = localStorage.getItem(LEGACY_KEY) } catch { return }
  if (!raw) return
  let volume
  try { volume = JSON.parse(raw)?.volume } catch {}
  try { localStorage.removeItem(LEGACY_KEY) } catch {}
  if (Number.isFinite(volume) && window.electronAPI?.setSettings) {
    await window.electronAPI.setSettings({ notifications: { doneSoundVolume: Number(volume) } })
  }
}

export async function initSettings() {
  if (initialized) return state
  initialized = true
  await migrateLegacyVolume()
  if (window.electronAPI?.getSettings) {
    state = await window.electronAPI.getSettings()
    emit()
  }
  return state
}

export function getSettings() {
  return state
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function setSettings(patch) {
  if (!window.electronAPI?.setSettings) return state
  state = await window.electronAPI.setSettings(patch)
  emit()
  return state
}

// Drop-in for volume-store: 0–100 maps to 0–0.4 gain.
export function getDoneSoundGain() {
  const v = state.notifications.doneSoundVolume
  if (!Number.isFinite(v) || v <= 0) return 0
  return 0.4 * (v / 100)
}
