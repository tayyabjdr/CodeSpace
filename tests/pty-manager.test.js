// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node-pty', () => ({
  default: { spawn: vi.fn() }
}))

import pty from 'node-pty'
import { createSession, writeSession, resizeSession, killSession, killAllSessions, killAllAndWait } from '../src/main/pty-manager.js'

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

  it('createSession merges extraEnv', () => {
    createSession('powershell', undefined, 80, 24, { PORT: '4101' })
    const opts = pty.spawn.mock.calls.at(-1)[2]
    expect(opts.env.PORT).toBe('4101')
    expect(opts.env.PATH ?? opts.env.Path).toBeDefined() // still the inherited env
  })

  it('createSession turns on Claude fullscreen for claude panes only', () => {
    const before = process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_NO_FLICKER
    try {
      createSession('claude')
      expect(pty.spawn.mock.calls.at(-1)[2].env.CLAUDE_CODE_NO_FLICKER).toBe('1')
      createSession('powershell')
      expect(pty.spawn.mock.calls.at(-1)[2].env.CLAUDE_CODE_NO_FLICKER).toBeUndefined()
    } finally { if (before !== undefined) process.env.CLAUDE_CODE_NO_FLICKER = before }
  })

  it('createSession without extraEnv adds no PORT', () => {
    const before = process.env.PORT
    delete process.env.PORT
    try {
      createSession('powershell')
      expect(pty.spawn.mock.calls.at(-1)[2].env.PORT).toBeUndefined()
    } finally { if (before !== undefined) process.env.PORT = before }
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

  it('killAllAndWait kills every session, staggered, and resolves after they exit', async () => {
    vi.useFakeTimers()
    try {
      killAllSessions() // clear sessions left by earlier tests
      const make = () => {
        const exits = []
        const proc = {
          onData: vi.fn(), write: vi.fn(), resize: vi.fn(),
          onExit: vi.fn(cb => exits.push(cb)),
          kill: vi.fn(() => exits.forEach(cb => cb({ exitCode: 0 })))
        }
        return proc
      }
      const a = make(); const b = make()
      pty.spawn.mockReturnValueOnce(a).mockReturnValueOnce(b)
      createSession('powershell'); createSession('powershell')

      let done = null
      killAllAndWait({ staggerMs: 80, settleMs: 300 }).then(n => { done = n })
      await vi.advanceTimersByTimeAsync(0)
      expect(a.kill).toHaveBeenCalledTimes(1)
      expect(b.kill).not.toHaveBeenCalled() // staggered
      await vi.advanceTimersByTimeAsync(80)
      expect(b.kill).toHaveBeenCalledTimes(1)
      expect(done).toBeNull() // still settling
      await vi.advanceTimersByTimeAsync(300)
      expect(done).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('killAllAndWait gives up waiting on a session that never exits', async () => {
    vi.useFakeTimers()
    try {
      killAllSessions()
      const stuck = { onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn() }
      pty.spawn.mockReturnValueOnce(stuck)
      createSession('powershell')
      let done = null
      killAllAndWait({ staggerMs: 80, timeoutMs: 1000, settleMs: 0 }).then(n => { done = n })
      await vi.advanceTimersByTimeAsync(1079)
      expect(done).toBeNull()
      await vi.advanceTimersByTimeAsync(10)
      expect(done).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

