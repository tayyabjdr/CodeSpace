// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node-pty', () => ({
  default: { spawn: vi.fn() }
}))

import pty from 'node-pty'
import { createSession, writeSession, resizeSession, killSession } from '../src/main/pty-manager.js'

describe('pty-manager', () => {
  let mockProc

  beforeEach(() => {
    vi.clearAllMocks()
    mockProc = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 1234
    }
    pty.spawn.mockReturnValue(mockProc)
  })

  it('createSession spawns powershell.exe and returns id and proc', () => {
    const { id, proc } = createSession('powershell')
    expect(pty.spawn).toHaveBeenCalledWith(
      'powershell.exe',
      [],
      expect.objectContaining({ cols: 80, rows: 24 })
    )
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(proc).toBe(mockProc)
  })

  it('createSession spawns cmd.exe when shell is cmd', () => {
    createSession('cmd')
    expect(pty.spawn).toHaveBeenCalledWith('cmd.exe', [], expect.any(Object))
  })

  it('createSession defaults to powershell for unknown shell', () => {
    createSession('zsh')
    expect(pty.spawn).toHaveBeenCalledWith('powershell.exe', [], expect.any(Object))
  })

  it('writeSession writes data to the proc', () => {
    const { id } = createSession('powershell')
    writeSession(id, 'ls\n')
    expect(mockProc.write).toHaveBeenCalledWith('ls\n')
  })

  it('writeSession is a no-op for unknown id', () => {
    writeSession('nonexistent', 'data')
    expect(mockProc.write).not.toHaveBeenCalled()
  })

  it('resizeSession resizes the proc', () => {
    const { id } = createSession('powershell')
    resizeSession(id, 120, 40)
    expect(mockProc.resize).toHaveBeenCalledWith(120, 40)
  })

  it('killSession kills the proc and removes it', () => {
    const { id } = createSession('powershell')
    killSession(id)
    expect(mockProc.kill).toHaveBeenCalled()
    writeSession(id, 'test')
    expect(mockProc.write).not.toHaveBeenCalled()
  })
})
