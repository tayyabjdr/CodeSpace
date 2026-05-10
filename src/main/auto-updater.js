import { ipcMain, app } from 'electron'
import pkg from 'electron-updater'
import { getCached } from './settings-store.js'

const { autoUpdater } = pkg

// Delay before the first update check after launch. Keeps the updater's
// network activity from racing with PTY spawn at startup.
const FIRST_CHECK_DELAY_MS = 10_000

let initialized = false

function applySettings() {
  const enabled = getCached().updates.autoUpdate
  autoUpdater.autoDownload = enabled
  autoUpdater.autoInstallOnAppQuit = enabled
}

export function setupAutoUpdater(win) {
  ipcMain.handle('updates:check', async () => {
    if (!initialized) return { status: 'error', message: 'Updater disabled in dev' }
    try {
      const result = await autoUpdater.checkForUpdates()
      const available = result?.updateInfo?.version && result.updateInfo.version !== app.getVersion()
      if (autoUpdater.autoDownload && available) {
        return { status: 'downloading', version: result.updateInfo.version }
      }
      return { status: 'up-to-date', version: result?.updateInfo?.version }
    } catch (err) {
      return { status: 'error', message: err?.message ?? String(err) }
    }
  })

  // Skip the rest in dev mode — local builds never match a real release.
  if (process.env.ELECTRON_RENDERER_URL) return
  initialized = true

  applySettings()

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
    if (!getCached().updates.autoUpdate) return
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn('[auto-updater] check failed:', err?.message ?? err)
    })
  }, FIRST_CHECK_DELAY_MS)
}

export function reapplyAutoUpdaterSettings() {
  if (!initialized) return
  applySettings()
}
