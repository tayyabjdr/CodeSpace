import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const FILENAME = 'settings.json'

export const DEFAULTS = {
  version: 1,
  appearance: {
    defaultPaneFontSize: 13
  },
  notifications: {
    doneSoundVolume: 50,
    taskbarFlashOnDone: true
  },
  updates: {
    autoUpdate: true
  },
  agents: {
    dangerouslySkipPermissions: true,
    codexDangerouslyBypassApprovals: true
  }
}

let cache = null

function filePath() {
  return join(app.getPath('userData'), FILENAME)
}

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, Math.round(v)))
}

function validate(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const a = r.appearance && typeof r.appearance === 'object' ? r.appearance : {}
  const n = r.notifications && typeof r.notifications === 'object' ? r.notifications : {}
  const u = r.updates && typeof r.updates === 'object' ? r.updates : {}
  const g = r.agents && typeof r.agents === 'object' ? r.agents : {}
  return {
    version: 1,
    appearance: {
      defaultPaneFontSize: clamp(a.defaultPaneFontSize, 10, 22, DEFAULTS.appearance.defaultPaneFontSize)
    },
    notifications: {
      doneSoundVolume: clamp(n.doneSoundVolume, 0, 100, DEFAULTS.notifications.doneSoundVolume),
      taskbarFlashOnDone: typeof n.taskbarFlashOnDone === 'boolean' ? n.taskbarFlashOnDone : DEFAULTS.notifications.taskbarFlashOnDone
    },
    updates: {
      autoUpdate: typeof u.autoUpdate === 'boolean' ? u.autoUpdate : DEFAULTS.updates.autoUpdate
    },
    agents: {
      dangerouslySkipPermissions: typeof g.dangerouslySkipPermissions === 'boolean' ? g.dangerouslySkipPermissions : DEFAULTS.agents.dangerouslySkipPermissions,
      codexDangerouslyBypassApprovals: typeof g.codexDangerouslyBypassApprovals === 'boolean' ? g.codexDangerouslyBypassApprovals : DEFAULTS.agents.codexDangerouslyBypassApprovals
    }
  }
}

async function quarantineCorrupt(path) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  try { await fs.rename(path, `${path}.corrupt-${ts}`) } catch {}
}

export async function loadSettings() {
  const path = filePath()
  let raw
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = { ...DEFAULTS }
      return cache
    }
    cache = { ...DEFAULTS }
    return cache
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    await quarantineCorrupt(path)
    cache = { ...DEFAULTS }
    return cache
  }

  cache = validate(parsed)
  return cache
}

export async function saveSettings(state) {
  const safe = validate(state)
  const path = filePath()
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(safe, null, 2), 'utf8')
  await fs.rename(tmp, path)
  cache = safe
  return safe
}

export function getCached() {
  return cache ?? { ...DEFAULTS }
}

export async function mergeAndSave(patch) {
  const base = getCached()
  const merged = {
    ...base,
    appearance:    { ...base.appearance,    ...(patch?.appearance    ?? {}) },
    notifications: { ...base.notifications, ...(patch?.notifications ?? {}) },
    updates:       { ...base.updates,       ...(patch?.updates       ?? {}) },
    agents:        { ...base.agents,        ...(patch?.agents        ?? {}) }
  }
  return saveSettings(merged)
}
