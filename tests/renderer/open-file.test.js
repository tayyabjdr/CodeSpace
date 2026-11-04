import { describe, it, expect, vi } from 'vitest'
import { checkOpenable } from '../../src/renderer/open-file.js'

describe('checkOpenable', () => {
  it('accepts a text file the probe is happy with', async () => {
    const probeFile = vi.fn(async () => ({ ok: true }))
    expect(await checkOpenable('/src/App.jsx', { probeFile })).toBe(null)
    expect(probeFile).toHaveBeenCalledWith('/src/App.jsx')
  })

  it('rejects a known binary extension without asking the main process', async () => {
    const probeFile = vi.fn()
    expect(await checkOpenable('/pics/logo.png', { probeFile })).toBe('not-text')
    expect(probeFile).not.toHaveBeenCalled()
  })

  it('passes the probe refusal through', async () => {
    const probeFile = vi.fn(async () => ({ ok: false, reason: 'too-large' }))
    expect(await checkOpenable('/logs/huge.log', { probeFile })).toBe('too-large')
  })

  it('reports a folder as such', async () => {
    const probeFile = vi.fn(async () => ({ ok: false, reason: 'directory' }))
    expect(await checkOpenable('/src', { probeFile })).toBe('directory')
  })

  it('degrades to unknown when the probe throws', async () => {
    const probeFile = vi.fn(async () => { throw new Error('ipc gone') })
    expect(await checkOpenable('/src/App.jsx', { probeFile })).toBe('unknown')
  })

  it('degrades to unknown when the probe answers with nothing', async () => {
    const probeFile = vi.fn(async () => undefined)
    expect(await checkOpenable('/src/App.jsx', { probeFile })).toBe('unknown')
  })

  it('rejects an empty path', async () => {
    const probeFile = vi.fn()
    expect(await checkOpenable('', { probeFile })).toBe('not-text')
    expect(await checkOpenable(null, { probeFile })).toBe('not-text')
    expect(probeFile).not.toHaveBeenCalled()
  })
})
