import { ipcMain, shell } from 'electron'
import { statSync } from 'fs'
import { isAbsolute } from 'path'
import { createSession, writeSession, resizeSession, killSession, isClaudeAvailable } from './pty-manager.js'
import * as editorFs from './editor-fs.js'

function isValidCwd(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return false
  if (!isAbsolute(cwd)) return false
  try {
    return statSync(cwd).isDirectory()
  } catch {
    return false
  }
}

function assertAbsPath(p) {
  if (typeof p !== 'string' || !isAbsolute(p)) {
    throw new Error(`editor: path must be absolute, got: ${p}`)
  }
}

export function registerHandlers(mainWindow) {
  // ptyId -> [data-disposable, exit-disposable]
  const ptyDisposables = new Map()

  function disposeFor(ptyId) {
    const disposables = ptyDisposables.get(ptyId)
    if (!disposables) return
    for (const d of disposables) {
      try { d?.dispose?.() } catch {}
    }
    ptyDisposables.delete(ptyId)
  }

  ipcMain.handle('pty:create', async (_event, { shell, cwd, cols, rows }) => {
    if (shell === 'claude' && !isClaudeAvailable()) {
      return { error: 'claude-missing' }
    }
    const cwdValid = isValidCwd(cwd)
    if (cwd && !cwdValid) {
      return { error: 'cwd-missing', cwd }
    }
    const safeCwd = cwdValid ? cwd : undefined
    const { id, proc } = createSession(shell, safeCwd, cols, rows)

    const dataDisposable = proc.onData(data => {
      if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
      mainWindow.webContents.send(`pty:data:${id}`, data)
    })
    const exitDisposable = proc.onExit(({ exitCode }) => {
      if (!mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(`pty:exit:${id}`, exitCode)
      }
      disposeFor(id)
    })
    ptyDisposables.set(id, [dataDisposable, exitDisposable])

    return { ptyId: id }
  })

  ipcMain.on('pty:write', (_event, { ptyId, data }) => {
    writeSession(ptyId, data)
  })

  ipcMain.on('pty:resize', (_event, { ptyId, cols, rows }) => {
    resizeSession(ptyId, cols, rows)
  })

  ipcMain.on('pty:kill', (_event, { ptyId }) => {
    disposeFor(ptyId)
    killSession(ptyId)
  })

  ipcMain.handle('editor:readFile',   async (_event, absPath) => { assertAbsPath(absPath); return editorFs.readFile(absPath) })
  ipcMain.handle('editor:writeFile',  async (_event, absPath, content) => { assertAbsPath(absPath); return editorFs.writeFile(absPath, content) })
  ipcMain.handle('editor:pathExists', async (_event, absPath) => { assertAbsPath(absPath); return editorFs.pathExists(absPath) })
  ipcMain.on('editor:revealInFolder', (_event, absPath) => {
    try { shell.showItemInFolder(absPath) }
    catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[ipc] revealInFolder failed:', err)
      }
    }
  })

  // If the renderer goes away (window close, devtools reload, crash) drop
  // every subscription so we don't post events into a destroyed webContents.
  mainWindow.webContents.on('destroyed', () => {
    for (const ptyId of Array.from(ptyDisposables.keys())) {
      disposeFor(ptyId)
    }
  })
}
