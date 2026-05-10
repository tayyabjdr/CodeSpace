import { describe, it, expect, beforeEach, vi } from 'vitest'

const calls = []
beforeEach(() => {
  calls.length = 0
  localStorage.clear()
  globalThis.window = globalThis.window ?? {}
  window.electronAPI = {
    getSettings: vi.fn(async () => ({
      version: 1,
      appearance: { defaultPaneFontSize: 14 },
      notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
      updates: { autoUpdate: true },
      agents: { dangerouslySkipPermissions: true }
    })),
    setSettings: vi.fn(async (patch) => {
      calls.push(patch)
      return {
        version: 1,
        appearance: { defaultPaneFontSize: 14 },
        notifications: { doneSoundVolume: patch?.notifications?.doneSoundVolume ?? 50, taskbarFlashOnDone: true },
        updates: { autoUpdate: true },
        agents: { dangerouslySkipPermissions: true }
      }
    })
  }
})

describe('renderer settings-store migration', () => {
  it('pushes legacy localStorage volume into settings and clears the key', async () => {
    localStorage.setItem('codespace.volume.v1', JSON.stringify({ volume: 73 }))
    const { initSettings } = await import('../../src/renderer/settings-store.js?case=migrate')
    await initSettings()
    expect(calls).toEqual([{ notifications: { doneSoundVolume: 73 } }])
    expect(localStorage.getItem('codespace.volume.v1')).toBeNull()
  })

  it('is a no-op when no legacy value exists', async () => {
    const { initSettings } = await import('../../src/renderer/settings-store.js?case=none')
    await initSettings()
    expect(calls).toEqual([])
  })

  it('clears a corrupt legacy value without throwing', async () => {
    localStorage.setItem('codespace.volume.v1', '{not json')
    const { initSettings } = await import('../../src/renderer/settings-store.js?case=corrupt')
    await initSettings()
    expect(calls).toEqual([])
    expect(localStorage.getItem('codespace.volume.v1')).toBeNull()
  })
})
