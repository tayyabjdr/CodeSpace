import { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, session } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { registerHandlers } from './ipc-handlers.js'
import { killAllSessions } from './pty-manager.js'
import { loadWorkspaces, saveWorkspaces, consumeCorruptBackupNotice } from './workspaces-store.js'

// Dev runs alongside an installed CodeSpace.app — same productName means
// the same %APPDATA%\CodeSpace userData folder, so the two would clobber
// each other's workspaces.json. Redirect dev to an isolated dir.
if (process.env['ELECTRON_RENDERER_URL']) {
  const devUserData = join(app.getPath('appData'), 'CodeSpace-dev')
  mkdirSync(devUserData, { recursive: true })
  app.setPath('userData', devUserData)
  app.setPath('sessionData', devUserData)
}

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
      nodeIntegration: false,
      sandbox: true
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

app.whenReady().then(() => {
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

  createWindow()
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
