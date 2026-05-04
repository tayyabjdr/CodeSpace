import { app, BrowserWindow, Menu, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { registerHandlers } from './ipc-handlers.js'

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false,
    backgroundColor: '#0a0a0a',
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

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:getDesktopPath', () => join(homedir(), 'Desktop'))

  return win
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
