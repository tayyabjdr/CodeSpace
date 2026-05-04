import { ipcMain } from 'electron'
import { createSession, writeSession, resizeSession, killSession } from './pty-manager.js'

export function registerHandlers(mainWindow) {
  ipcMain.handle('pty:create', async (_event, { shell, cwd }) => {
    const { id, proc } = createSession(shell, cwd)
    proc.onData(data => {
      mainWindow.webContents.send(`pty:data:${id}`, data)
    })
    proc.onExit(({ exitCode }) => {
      mainWindow.webContents.send(`pty:exit:${id}`, exitCode)
    })
    return { ptyId: id }
  })

  ipcMain.on('pty:write', (_event, { ptyId, data }) => {
    writeSession(ptyId, data)
  })

  ipcMain.on('pty:resize', (_event, { ptyId, cols, rows }) => {
    resizeSession(ptyId, cols, rows)
  })

  ipcMain.on('pty:kill', (_event, { ptyId }) => {
    killSession(ptyId)
  })
}
