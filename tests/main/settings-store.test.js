import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync } from 'fs'

let dir
vi.mock('electron', () => ({
  app: { getPath: () => dir }
}))

import { loadSettings, saveSettings, getCached, mergeAndSave, DEFAULTS } from '../../src/main/settings-store.js'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-settings-'))
})

describe('settings-store', () => {
  it('returns defaults when file is missing', async () => {
    const s = await loadSettings()
    expect(s).toEqual(DEFAULTS)
  })

  it('round-trips a saved settings object', async () => {
    const next = { ...DEFAULTS, appearance: { defaultPaneFontSize: 18 } }
    await saveSettings(next)
    const reloaded = await loadSettings()
    expect(reloaded.appearance.defaultPaneFontSize).toBe(18)
  })

  it('quarantines a corrupt file and returns defaults', async () => {
    const path = join(dir, 'settings.json')
    await fs.writeFile(path, '{ not json', 'utf8')
    const s = await loadSettings()
    expect(s).toEqual(DEFAULTS)
    const files = await fs.readdir(dir)
    expect(files.some(f => f.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('fills missing keys with defaults from a partial file', async () => {
    const path = join(dir, 'settings.json')
    await fs.writeFile(path, JSON.stringify({ version: 1, appearance: {} }), 'utf8')
    const s = await loadSettings()
    expect(s.notifications.doneSoundVolume).toBe(DEFAULTS.notifications.doneSoundVolume)
    expect(s.agents.dangerouslySkipPermissions).toBe(DEFAULTS.agents.dangerouslySkipPermissions)
  })

  it('mergeAndSave deep-merges a patch and persists', async () => {
    await saveSettings(DEFAULTS)
    const next = await mergeAndSave({ notifications: { doneSoundVolume: 30 } })
    expect(next.notifications.doneSoundVolume).toBe(30)
    expect(next.notifications.taskbarFlashOnDone).toBe(DEFAULTS.notifications.taskbarFlashOnDone)
    expect(getCached().notifications.doneSoundVolume).toBe(30)
  })

  it('clamps defaultPaneFontSize into 10..22', async () => {
    await saveSettings({ ...DEFAULTS, appearance: { defaultPaneFontSize: 99 } })
    const s = await loadSettings()
    expect(s.appearance.defaultPaneFontSize).toBe(22)
  })

  it('clamps doneSoundVolume into 0..100', async () => {
    await saveSettings({ ...DEFAULTS, notifications: { ...DEFAULTS.notifications, doneSoundVolume: 250 } })
    const s = await loadSettings()
    expect(s.notifications.doneSoundVolume).toBe(100)
  })
})
