import { app, BrowserWindow, Menu, ipcMain, dialog, clipboard } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { registerHandlers } from './ipc-handlers.js'
import { loadWorkspaces, saveWorkspaces } from './workspaces-store.js'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 600,
    center: true,
    frame: false,
    backgroundColor: '#0a0b0d',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerHandlers(win)

  ipcMain.on('win:minimize', () => win.minimize())
  ipcMain.on('win:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize())
  ipcMain.on('win:close', () => win.close())
  ipcMain.on('win:ensureMaximized', () => { if (!win.isMaximized()) win.maximize() })
  ipcMain.on('win:ensureRestored', () => {
    if (win.isMaximized()) win.unmaximize()
    win.setSize(1400, 900)
    win.center()
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:getDesktopPath', () => join(homedir(), 'Desktop'))

  ipcMain.handle('workspaces:load', () => loadWorkspaces())
  ipcMain.handle('workspaces:save', (_event, state) => saveWorkspaces(state))

  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  ipcMain.on('clipboard:writeText', (_event, text) => clipboard.writeText(text ?? ''))

  return win
}

// Swallow node-pty's known Windows resize-after-exit errors instead of
// letting Electron pop a JavaScript error dialog.
process.on('uncaughtException', (err) => {
  const msg = err?.message ?? ''
  if (msg.includes('Cannot resize a pty that has already exited') ||
      msg.includes('Cannot write to a pty that has already exited') ||
      msg.includes('Cannot kill a pty that has already exited') ||
      msg.includes('AttachConsole failed')) {
    return
  }
  console.error('Uncaught exception:', err)
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
