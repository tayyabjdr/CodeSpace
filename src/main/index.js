import { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, session, screen } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, readFileSync } from 'fs'
import { registerHandlers } from './ipc-handlers.js'
import { killAllSessions } from './pty-manager.js'
import { loadWorkspaces, saveWorkspaces, consumeCorruptBackupNotice } from './workspaces-store.js'
import { setupAutoUpdater, reapplyAutoUpdaterSettings } from './auto-updater.js'
import { loadSettings } from './settings-store.js'
import { registerSettingsHandlers } from './settings-handlers.js'

// Dev runs alongside an installed CodeSpace.app — same productName means
// the same %APPDATA%\CodeSpace userData folder, so the two would clobber
// each other's workspaces.json. Redirect dev to an isolated dir.
if (process.env['ELECTRON_RENDERER_URL']) {
  const devUserData = join(app.getPath('appData'), 'CodeSpace-dev')
  mkdirSync(devUserData, { recursive: true })
  app.setPath('userData', devUserData)
  app.setPath('sessionData', devUserData)
}

// Sync peek so we can decide window state BEFORE first paint — async
// loadWorkspaces() would land after the window is already on screen at
// 1400×900, causing a visible flash before maximize.
function hasPersistedWorkspaces() {
  try {
    const raw = readFileSync(join(app.getPath('userData'), 'workspaces.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.workspaces) && parsed.workspaces.length > 0
  } catch {
    return false
  }
}

function createWindow() {
  // In dev, electron.exe's default icon would otherwise show in the taskbar.
  // Setting BrowserWindow.icon overrides that. In production the icon is
  // already baked into the packaged .exe by electron-builder (build.win.icon),
  // so this path only matters for `npm run dev`.
  const devIconPath = process.env['ELECTRON_RENDERER_URL']
    ? join(__dirname, '../../build/icon.ico')
    : undefined

  const startMaximized = hasPersistedWorkspaces()

  // Construct at the work-area size so the post-show maximize() doesn't
  // trigger a visible resize — bounds already match what maximized will be.
  const initialBounds = startMaximized
    ? screen.getPrimaryDisplay().workArea
    : { width: 1400, height: 900 }

  const win = new BrowserWindow({
    ...initialBounds,
    minWidth: 720,
    minHeight: 600,
    center: !startMaximized,
    frame: false,
    show: false,
    // Default true makes Chromium paint one frame while hidden and then
    // hibernate the renderer waiting to be shown — on Windows 11 the renderer
    // then doesn't wake on win.show() for ~5.7s, freezing the task queue
    // (rAF, IPC responses, microtasks). Skipping the hidden paint avoids the
    // trap; we show on dom-ready below instead of ready-to-show (which is
    // suppressed when this is false).
    paintWhenInitiallyHidden: false,
    backgroundColor: '#0a0b0d',
    icon: devIconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep PTYs / terminals rendering at full rate when the app loses
      // focus; otherwise Chromium throttles background renderers to ~1Hz
      // and TUI output stutters.
      backgroundThrottling: false
    }
  })

  // Show on dom-ready: by then the inline <style> in index.html has parsed
  // and every layer (BrowserWindow backgroundColor, html/body, design tokens)
  // is dark, so there's no white flash. Waiting for ready-to-show is wrong
  // here — calling win.maximize() before loadFile (the original approach)
  // forces show on Windows and produces an empty pre-content flash, and
  // deferring show until ready-to-show creates the hibernation deadlock
  // described above. dom-ready is the sweet spot.
  win.webContents.once('dom-ready', () => {
    win.show()
    // Bounds already match the maximized work area, so this only flips
    // the OS maximize-state flag — no visible resize.
    if (startMaximized) win.maximize()
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
  win.on('focus', () => { if (!win.isDestroyed()) win.flashFrame(false) })
  ipcMain.on('win:ensureMaximized', () => { if (!win.isMaximized()) win.maximize() })
  ipcMain.on('win:ensureRestored', () => {
    if (win.isMaximized()) win.unmaximize()
    win.setSize(1400, 900)
    win.center()
  })

  const sendMaximizeState = () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('win:maximize-changed', win.isMaximized())
    }
  }
  win.on('maximize', sendMaximizeState)
  win.on('unmaximize', sendMaximizeState)

  ipcMain.handle('dialog:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('app:getDesktopPath', () => join(homedir(), 'Desktop'))

  ipcMain.handle('workspaces:load', async () => {
    const state = await loadWorkspaces()
    const corruptBackupPath = consumeCorruptBackupNotice()
    return { ...state, corruptBackupPath }
  })
  ipcMain.handle('workspaces:save', (_event, state) => saveWorkspaces(state))

  ipcMain.handle('clipboard:readText', () => clipboard.readText())
  // Cap at 1 MB so a misbehaving renderer can't push huge blobs into the OS
  // clipboard. Anything larger is silently dropped — this isn't a paste path
  // we expect to hit a megabyte through legitimate UI flow.
  const CLIPBOARD_WRITE_MAX_BYTES = 1024 * 1024
  ipcMain.on('clipboard:writeText', (_event, text) => {
    if (typeof text !== 'string') return
    if (text.length > CLIPBOARD_WRITE_MAX_BYTES) return
    clipboard.writeText(text)
  })

  return win
}

// Swallow node-pty's known Windows resize-after-exit / conpty fallback errors
// instead of letting Electron pop a JavaScript error dialog. We anchor the
// patterns to the start of the message so unrelated errors that happen to
// mention these phrases still surface.
const SWALLOWABLE_PTY_ERRORS = [
  /^Cannot resize a pty that has already exited/,
  /^Cannot write to a pty that has already exited/,
  /^Cannot kill a pty that has already exited/,
  /^AttachConsole failed/
]

process.on('uncaughtException', (err) => {
  const msg = err?.message ?? ''
  if (SWALLOWABLE_PTY_ERRORS.some(re => re.test(msg))) return
  console.error('Uncaught exception:', err)
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  // CSP — only outside dev mode, since Vite HMR needs eval/inline scripts.
  if (!process.env['ELECTRON_RENDERER_URL']) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "font-src 'self' data:; " +
            "img-src 'self' data:; " +
            "connect-src 'self'; " +
            "object-src 'none'; " +
            "base-uri 'self'; " +
            "frame-src 'none'"
          ]
        }
      })
    })
  }

  await loadSettings()
  registerSettingsHandlers({
    onSettingsChange: (after, before) => {
      if (after.updates.autoUpdate !== before.updates.autoUpdate) {
        reapplyAutoUpdaterSettings()
      }
    }
  })

  const win = createWindow()
  setupAutoUpdater(win)
})

app.on('window-all-closed', () => {
  app.quit()
})

// Conpty teardown is async — killAllSessions() returns immediately but the
// child workers can take a beat to actually exit. If we let Electron tear
// down right away we orphan claude.exe / powershell.exe processes. Hold the
// quit briefly so the conpty agents have time to exit cleanly.
let isQuitting = false
app.on('will-quit', (e) => {
  if (isQuitting) return
  isQuitting = true
  e.preventDefault()
  try { killAllSessions() } catch {}
  // 600ms is empirically enough for conpty to release on Windows; we still
  // cap it so a stuck PTY never blocks shutdown.
  setTimeout(() => app.exit(0), 600)
})
