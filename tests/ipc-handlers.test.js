// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  },
  shell: { showItemInFolder: vi.fn() }
}))

vi.mock('../src/main/editor-fs.js', () => ({
  readFile:   vi.fn(),
  writeFile:  vi.fn(),
  pathExists: vi.fn()
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
import * as editorFs from '../src/main/editor-fs.js'

describe('ipc-handlers', () => {
  let mockWindow

  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow = { webContents: { send: vi.fn(), on: vi.fn(), isDestroyed: vi.fn(() => false) }, isDestroyed: vi.fn(() => false) }
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

    expect(createSession).toHaveBeenCalledWith('powershell', undefined, undefined, undefined)
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

describe('editor IPC channels', () => {
  let mockWindow

  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow = { webContents: { send: vi.fn(), on: vi.fn(), isDestroyed: vi.fn(() => false) }, isDestroyed: vi.fn(() => false) }
  })

  function getHandler(method, channel) {
    return ipcMain[method].mock.calls.find(c => c[0] === channel)?.[1]
  }

  it('registers editor:readFile, writeFile, pathExists, revealInFolder', () => {
    registerHandlers(mockWindow)
    expect(ipcMain.handle).toHaveBeenCalledWith('editor:readFile', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('editor:writeFile', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('editor:pathExists', expect.any(Function))
    expect(ipcMain.on).toHaveBeenCalledWith('editor:revealInFolder', expect.any(Function))
  })

  it('editor:readFile delegates to editor-fs.readFile', async () => {
    editorFs.readFile.mockResolvedValue({ ok: true, content: 'x', encoding: 'utf8' })
    registerHandlers(mockWindow)
    const handler = getHandler('handle', 'editor:readFile')
    const result = await handler({}, 'C:\\path\\file.txt')
    expect(editorFs.readFile).toHaveBeenCalledWith('C:\\path\\file.txt')
    expect(result).toEqual({ ok: true, content: 'x', encoding: 'utf8' })
  })

  it('editor:writeFile delegates to editor-fs.writeFile', async () => {
    editorFs.writeFile.mockResolvedValue({ ok: true })
    registerHandlers(mockWindow)
    const handler = getHandler('handle', 'editor:writeFile')
    const result = await handler({}, 'C:\\file.txt', 'content')
    expect(editorFs.writeFile).toHaveBeenCalledWith('C:\\file.txt', 'content')
    expect(result).toEqual({ ok: true })
  })

  it('editor:pathExists delegates to editor-fs.pathExists', async () => {
    editorFs.pathExists.mockResolvedValue(true)
    registerHandlers(mockWindow)
    const handler = getHandler('handle', 'editor:pathExists')
    const result = await handler({}, 'C:\\file.txt')
    expect(result).toBe(true)
  })
})
