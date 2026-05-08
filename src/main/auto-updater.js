import { ipcMain } from 'electron'
import pkg from 'electron-updater'

const { autoUpdater } = pkg

// Delay before the first update check after launch. Keeps the updater's
// network activity from racing with PTY spawn at startup. Empirically
// chosen — long enough for the user to see the UI, short enough that
// they're still here when the toast lands.
const FIRST_CHECK_DELAY_MS = 10_000

export function setupAutoUpdater(win) {
  // Skip in dev mode. electron-vite sets ELECTRON_RENDERER_URL when running
  // `npm run dev`, and we don't want a packaged-app updater check fighting
  // the local dev server (and almost certainly failing because the dev
  // build's version doesn't match a real release).
  if (process.env.ELECTRON_RENDERER_URL) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send('update:ready', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    // Silent — no UI on failure per design. Console-only so the dev can
    // see what happened when running a packaged build with devtools open.
    console.warn('[auto-updater]', err?.message ?? err)
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[auto-updater] check failed:', err?.message ?? err)
    })
  }, FIRST_CHECK_DELAY_MS)
}
