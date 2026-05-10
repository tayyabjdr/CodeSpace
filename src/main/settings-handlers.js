import { app, ipcMain, BrowserWindow } from 'electron'
import { getCached, mergeAndSave } from './settings-store.js'

export function registerSettingsHandlers({ onSettingsChange }) {
  ipcMain.handle('settings:get', () => getCached())

  ipcMain.handle('settings:set', async (_event, patch) => {
    const before = getCached()
    const after = await mergeAndSave(patch ?? {})
    try { onSettingsChange?.(after, before) } catch (err) {
      console.warn('[settings] onSettingsChange threw:', err?.message ?? err)
    }
    return after
  })

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('window:flash', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && !win.isDestroyed() && !win.isFocused()) {
      win.flashFrame(true)
    }
  })
}
