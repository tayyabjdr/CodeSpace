// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}))

vi.mock('../src/main/pty-manager.js', () => ({
  createSession: vi.fn(),
  writeSession: vi.fn(),
  resizeSession: vi.fn(),
  killSession: vi.fn()
}))

import { ipcMain } from 'electron'
import { createSession, writeSession, resizeSession, killSession } from '../src/main/pty-manager.js'
import { registerHandlers } from '../src/main/ipc-handlers.js'

describe('ipc-handlers', () => {
  let mockWindow

  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow = { webContents: { send: vi.fn() } }
  })

  function getHandler(method, channel) {
    return ipcMain[method].mock.calls.find(c => c[0] === channel)?.[1]
  }

  it('registers pty:create, pty:write, pty:resize, pty:kill', () => {
    registerHandlers(mockWindow)
    expect(ipcMain.handle).toHaveBeenCalledWith('pty:create', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('pty:write', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('pty:resize', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('pty:kill', expect.any(Function))
  })

  it('pty:create returns ptyId', async () => {
    const mockProc = { onData: vi.fn(), onExit: vi.fn() }
    createSession.mockReturnValue({ id: 'abc-123', proc: mockProc })
    registerHandlers(mockWindow)

    const handler = getHandler('handle', 'pty:create')
    const result = await handler({}, { shell: 'powershell' })

    expect(createSession).toHaveBeenCalledWith('powershell')
    expect(result).toEqual({ ptyId: 'abc-123' })
  })

  it('pty:create forwards proc data to renderer via pty:data:<id>', async () => {
    const mockProc = { onData: vi.fn(), onExit: vi.fn() }
    createSession.mockReturnValue({ id: 'abc-123', proc: mockProc })
    registerHandlers(mockWindow)

    const handler = getHandler('handle', 'pty:create')
    await handler({}, { shell: 'powershell' })

    const dataCallback = mockProc.onData.mock.calls[0][0]
    dataCallback('output text')
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:data:abc-123', 'output text')
  })

  it('pty:create forwards exit code to renderer via pty:exit:<id>', async () => {
    const mockProc = { onData: vi.fn(), onExit: vi.fn() }
    createSession.mockReturnValue({ id: 'abc-123', proc: mockProc })
    registerHandlers(mockWindow)

    const handler = getHandler('handle', 'pty:create')
    await handler({}, { shell: 'powershell' })

    const exitCallback = mockProc.onExit.mock.calls[0][0]
    exitCallback({ exitCode: 0 })
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('pty:exit:abc-123', 0)
  })

  it('pty:write calls writeSession', () => {
    registerHandlers(mockWindow)
    const handler = getHandler('on', 'pty:write')
    handler({}, { ptyId: 'abc-123', data: 'ls\n' })
    expect(writeSession).toHaveBeenCalledWith('abc-123', 'ls\n')
  })

  it('pty:resize calls resizeSession', () => {
    registerHandlers(mockWindow)
    const handler = getHandler('on', 'pty:resize')
    handler({}, { ptyId: 'abc-123', cols: 120, rows: 40 })
    expect(resizeSession).toHaveBeenCalledWith('abc-123', 120, 40)
  })

  it('pty:kill calls killSession', () => {
    registerHandlers(mockWindow)
    const handler = getHandler('on', 'pty:kill')
    handler({}, { ptyId: 'abc-123' })
    expect(killSession).toHaveBeenCalledWith('abc-123')
  })
})
