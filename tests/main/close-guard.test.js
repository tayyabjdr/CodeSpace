// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: { on: vi.fn() }
}))

import { app, ipcMain } from 'electron'
import { installCloseGuard } from '../../src/main/close-guard.js'

function makeWin() {
  const handlers = {}
  return {
    handlers,
    on: vi.fn((event, fn) => { handlers[event] = fn }),
    close: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    isMinimized: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isCrashed: vi.fn(() => false)
    }
  }
}

// The guard registers via ipcMain.on / app.on; pull the callbacks back out.
function ipcHandler(channel) {
  const call = ipcMain.on.mock.calls.find(c => c[0] === channel)
  return call?.[1]
}
function appHandler(event) {
  const call = app.on.mock.calls.find(c => c[0] === event)
  return call?.[1]
}
function fireClose(win) {
  const event = { preventDefault: vi.fn() }
  win.handlers.close(event)
  return event
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('installCloseGuard', () => {
  it('blocks the first close and asks the renderer to prompt', () => {
    const win = makeWin()
    installCloseGuard(win)
    const event = fireClose(win)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledWith('win:close-requested')
    expect(win.close).not.toHaveBeenCalled()
  })

  it('restores and focuses a minimized window before prompting', () => {
    const win = makeWin()
    win.isMinimized.mockReturnValue(true)
    installCloseGuard(win)
    fireClose(win)
    expect(win.restore).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('closes for real once the renderer confirms', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    ipcHandler('win:confirmClose')()
    expect(win.close).toHaveBeenCalledTimes(1)
    const second = fireClose(win)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  it('lets a programmatic quit through without prompting', () => {
    const win = makeWin()
    installCloseGuard(win)
    appHandler('before-quit')()
    const event = fireClose(win)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('does not trap the user when the renderer has crashed', () => {
    const win = makeWin()
    win.webContents.isCrashed.mockReturnValue(true)
    installCloseGuard(win)
    const event = fireClose(win)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(win.webContents.send).not.toHaveBeenCalled()
  })

  it('does not trap the user when the renderer is destroyed', () => {
    const win = makeWin()
    win.webContents.isDestroyed.mockReturnValue(true)
    installCloseGuard(win)
    const event = fireClose(win)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('closes anyway when the renderer never acks', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    expect(win.close).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)
    expect(win.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the window open once the renderer acks', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    ipcHandler('win:closePrompted')()
    vi.advanceTimersByTime(10000)
    expect(win.close).not.toHaveBeenCalled()
  })

  it('prompts again on a later close after the user cancelled', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    ipcHandler('win:closePrompted')()
    // User cancels: no IPC at all, the guard just stays armed.
    const second = fireClose(win)
    expect(second.preventDefault).toHaveBeenCalled()
    expect(win.webContents.send).toHaveBeenCalledTimes(2)
  })

  it('honours a custom timeout', () => {
    const win = makeWin()
    installCloseGuard(win, { timeoutMs: 50 })
    fireClose(win)
    vi.advanceTimersByTime(50)
    expect(win.close).toHaveBeenCalledTimes(1)
  })

  it('does not throw when win:confirmClose arrives after window is destroyed', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    win.isDestroyed.mockReturnValue(true)
    // Should not throw when calling the handler on a destroyed window
    expect(() => {
      ipcHandler('win:confirmClose')()
    }).not.toThrow()
    expect(win.close).not.toHaveBeenCalled()
  })

  it('does not throw when timeout fires after window is destroyed', () => {
    const win = makeWin()
    installCloseGuard(win)
    fireClose(win)
    win.isDestroyed.mockReturnValue(true)
    // Should not throw when timeout fires on a destroyed window
    expect(() => {
      vi.advanceTimersByTime(1500)
    }).not.toThrow()
    expect(win.close).not.toHaveBeenCalled()
  })
})
