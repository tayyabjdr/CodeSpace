import { app, ipcMain } from 'electron'

// How long we wait for the renderer to acknowledge the prompt request before
// assuming it is frozen and closing anyway. A guard that can trap the user in
// a running app is worse than no guard.
export const CLOSE_PROMPT_TIMEOUT_MS = 1500

/**
 * Intercept window close so the renderer can confirm first.
 *
 * Covers every close path at once: the titlebar X (which routes through
 * win:close), Alt+F4, taskbar right-click, and the taskbar hover-preview X.
 */
export function installCloseGuard(win, { timeoutMs = CLOSE_PROMPT_TIMEOUT_MS } = {}) {
  let allowClose = false
  let promptTimer = null

  const clearTimer = () => {
    if (promptTimer) {
      clearTimeout(promptTimer)
      promptTimer = null
    }
  }

  win.on('close', (e) => {
    if (allowClose) return
    const wc = win.webContents
    // Nothing can draw the dialog, so don't block the close.
    if (!wc || wc.isDestroyed() || wc.isCrashed()) return

    e.preventDefault()
    if (win.isMinimized()) win.restore()
    win.focus()
    wc.send('win:close-requested')

    clearTimer()
    promptTimer = setTimeout(() => {
      promptTimer = null
      allowClose = true
      win.close()
    }, timeoutMs)
  })

  // The renderer received the request, so it is alive and pumping IPC.
  ipcMain.on('win:closePrompted', clearTimer)

  ipcMain.on('win:confirmClose', () => {
    clearTimer()
    allowClose = true
    win.close()
  })

  // Programmatic quits must not hit the dialog. Without this,
  // autoUpdater.quitAndInstall() would stall on the confirmation.
  app.on('before-quit', () => {
    clearTimer()
    allowClose = true
  })
}
