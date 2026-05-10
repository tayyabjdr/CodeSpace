# Settings Tier 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings modal covering appearance, notifications, updates, and an agent dangerous-flag toggle. Replace the redundant "+ New Workspace" sidebar footer button with a gear + version row.

**Architecture:** Single source of truth in main process (`userData/settings.json`), loaded once at boot, mirrored in a thin renderer cache. Renderer is the only writer — no main→renderer push channel. All controls map to existing app behavior or thin new IPC; no live re-application of settings to running PTYs.

**Tech Stack:** Electron, Node fs/promises, React, vitest (jsdom), electron-updater, node-pty.

**Spec:** `docs/superpowers/specs/2026-05-10-settings-tier-1-design.md`

---

## File Structure

**New files (main):**
- `src/main/settings-store.js` — load/save/validate `userData/settings.json` with corrupt-file recovery.
- `src/main/settings-handlers.js` — IPC for `settings:get`, `settings:set`, `app:version`, `updates:check`, `window:flash`.

**New files (renderer):**
- `src/renderer/settings-store.js` — boot-time fetch + in-memory cache + subscribe API. Drop-in replacement for `volume-store.js`.
- `src/renderer/components/Toggle.jsx` + `Toggle.css` — shared on/off switch.
- `src/renderer/components/SettingsModal.jsx` + `SettingsModal.css` — the modal.

**New tests:**
- `tests/main/settings-store.test.js`
- `tests/renderer/settings-migration.test.js`

**Modified files:**
- `src/main/index.js` — load settings before creating window; pass to `setupAutoUpdater`; register settings handlers.
- `src/main/auto-updater.js` — gate `autoDownload`/`autoInstallOnAppQuit` on settings; expose runtime updater for `settings:set` side effect; expose `checkNow()`.
- `src/main/pty-manager.js` — read dangerous-flag from settings store at spawn time.
- `src/main/ipc-handlers.js` — leave as-is (new IPC lives in `settings-handlers.js`).
- `src/preload/index.js` — expose `getSettings`, `setSettings`, `getAppVersion`, `checkForUpdates`, `flashWindow`.
- `src/renderer/components/VolumeControl.jsx` — read/write via new settings store.
- `src/renderer/done-sound.js` — read volume from new settings store.
- `src/renderer/done-tracker.js` — call `flashWindow()` on done if setting on.
- `src/renderer/App.jsx` — modal open/closed state; new-pane spawn uses settings default font size.
- `src/renderer/components/Sidebar.jsx` + `Sidebar.css` — replace `sb-new-btn` with footer row (gear + version).

**Deleted at end (after migration verified):**
- `src/renderer/volume-store.js` — kept temporarily; deleted in Task 8 once migration is in.

---

## Conventions

- Conventional Commits per existing log (e.g. `feat(settings): ...`, `fix(...)`).
- No comments unless explaining a non-obvious WHY (per CLAUDE.md).
- Use `--cs-*` design tokens; no infinite animations.
- Use `fs.promises` (matches `workspaces-store.js`).
- Vitest is configured (`npm test` / `npm run test:watch`); jsdom is the test environment.

---

## Task 1: Main settings store

**Files:**
- Create: `src/main/settings-store.js`
- Create: `tests/main/settings-store.test.js`

- [ ] **Step 1.1: Write the failing tests**

Create `tests/main/settings-store.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync } from 'fs'

let dir
vi.mock('electron', () => ({
  app: { getPath: () => dir }
}))

import { loadSettings, saveSettings, getCached, mergeAndSave, DEFAULTS } from '../../src/main/settings-store.js'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cs-settings-'))
})

describe('settings-store', () => {
  it('returns defaults when file is missing', async () => {
    const s = await loadSettings()
    expect(s).toEqual(DEFAULTS)
  })

  it('round-trips a saved settings object', async () => {
    const next = { ...DEFAULTS, appearance: { defaultPaneFontSize: 18 } }
    await saveSettings(next)
    const reloaded = await loadSettings()
    expect(reloaded.appearance.defaultPaneFontSize).toBe(18)
  })

  it('quarantines a corrupt file and returns defaults', async () => {
    const path = join(dir, 'settings.json')
    await fs.writeFile(path, '{ not json', 'utf8')
    const s = await loadSettings()
    expect(s).toEqual(DEFAULTS)
    const files = await fs.readdir(dir)
    expect(files.some(f => f.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('fills missing keys with defaults from a partial file', async () => {
    const path = join(dir, 'settings.json')
    await fs.writeFile(path, JSON.stringify({ version: 1, appearance: {} }), 'utf8')
    const s = await loadSettings()
    expect(s.notifications.doneSoundVolume).toBe(DEFAULTS.notifications.doneSoundVolume)
    expect(s.agents.dangerouslySkipPermissions).toBe(DEFAULTS.agents.dangerouslySkipPermissions)
  })

  it('mergeAndSave deep-merges a patch and persists', async () => {
    await saveSettings(DEFAULTS)
    const next = await mergeAndSave({ notifications: { doneSoundVolume: 30 } })
    expect(next.notifications.doneSoundVolume).toBe(30)
    expect(next.notifications.taskbarFlashOnDone).toBe(DEFAULTS.notifications.taskbarFlashOnDone)
    expect(getCached().notifications.doneSoundVolume).toBe(30)
  })

  it('clamps defaultPaneFontSize into 10..22', async () => {
    await saveSettings({ ...DEFAULTS, appearance: { defaultPaneFontSize: 99 } })
    const s = await loadSettings()
    expect(s.appearance.defaultPaneFontSize).toBe(22)
  })

  it('clamps doneSoundVolume into 0..100', async () => {
    await saveSettings({ ...DEFAULTS, notifications: { ...DEFAULTS.notifications, doneSoundVolume: 250 } })
    const s = await loadSettings()
    expect(s.notifications.doneSoundVolume).toBe(100)
  })
})
```

- [ ] **Step 1.2: Run the tests to verify they fail**

Run: `npm test -- tests/main/settings-store.test.js`
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement settings-store**

Create `src/main/settings-store.js`:

```js
import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'

const FILENAME = 'settings.json'

export const DEFAULTS = {
  version: 1,
  appearance: {
    defaultPaneFontSize: 14
  },
  notifications: {
    doneSoundVolume: 50,
    taskbarFlashOnDone: true
  },
  updates: {
    autoUpdate: true
  },
  agents: {
    dangerouslySkipPermissions: true
  }
}

let cache = null

function filePath() {
  return join(app.getPath('userData'), FILENAME)
}

function clamp(n, min, max, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(min, Math.min(max, Math.round(v)))
}

function validate(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const a = r.appearance && typeof r.appearance === 'object' ? r.appearance : {}
  const n = r.notifications && typeof r.notifications === 'object' ? r.notifications : {}
  const u = r.updates && typeof r.updates === 'object' ? r.updates : {}
  const g = r.agents && typeof r.agents === 'object' ? r.agents : {}
  return {
    version: 1,
    appearance: {
      defaultPaneFontSize: clamp(a.defaultPaneFontSize, 10, 22, DEFAULTS.appearance.defaultPaneFontSize)
    },
    notifications: {
      doneSoundVolume: clamp(n.doneSoundVolume, 0, 100, DEFAULTS.notifications.doneSoundVolume),
      taskbarFlashOnDone: typeof n.taskbarFlashOnDone === 'boolean' ? n.taskbarFlashOnDone : DEFAULTS.notifications.taskbarFlashOnDone
    },
    updates: {
      autoUpdate: typeof u.autoUpdate === 'boolean' ? u.autoUpdate : DEFAULTS.updates.autoUpdate
    },
    agents: {
      dangerouslySkipPermissions: typeof g.dangerouslySkipPermissions === 'boolean' ? g.dangerouslySkipPermissions : DEFAULTS.agents.dangerouslySkipPermissions
    }
  }
}

async function quarantineCorrupt(path) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  try { await fs.rename(path, `${path}.corrupt-${ts}`) } catch {}
}

export async function loadSettings() {
  const path = filePath()
  let raw
  try {
    raw = await fs.readFile(path, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      cache = { ...DEFAULTS }
      return cache
    }
    cache = { ...DEFAULTS }
    return cache
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    await quarantineCorrupt(path)
    cache = { ...DEFAULTS }
    return cache
  }

  cache = validate(parsed)
  return cache
}

export async function saveSettings(state) {
  const safe = validate(state)
  const path = filePath()
  const tmp = `${path}.tmp`
  await fs.writeFile(tmp, JSON.stringify(safe, null, 2), 'utf8')
  await fs.rename(tmp, path)
  cache = safe
  return safe
}

export function getCached() {
  return cache ?? { ...DEFAULTS }
}

export async function mergeAndSave(patch) {
  const base = getCached()
  const merged = {
    ...base,
    appearance:    { ...base.appearance,    ...(patch?.appearance    ?? {}) },
    notifications: { ...base.notifications, ...(patch?.notifications ?? {}) },
    updates:       { ...base.updates,       ...(patch?.updates       ?? {}) },
    agents:        { ...base.agents,        ...(patch?.agents        ?? {}) }
  }
  return saveSettings(merged)
}
```

- [ ] **Step 1.4: Run the tests to verify they pass**

Run: `npm test -- tests/main/settings-store.test.js`
Expected: PASS, all 7 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add src/main/settings-store.js tests/main/settings-store.test.js
git commit -m "feat(settings): main-process settings store with validation"
```

---

## Task 2: Settings IPC handlers + main boot integration

**Files:**
- Create: `src/main/settings-handlers.js`
- Modify: `src/main/index.js`

- [ ] **Step 2.1: Implement IPC handlers**

Create `src/main/settings-handlers.js`:

```js
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
```

- [ ] **Step 2.2: Wire boot in main/index.js**

Modify `src/main/index.js`:

Add to imports near the top (next to existing `loadWorkspaces` import):
```js
import { loadSettings } from './settings-store.js'
import { registerSettingsHandlers } from './settings-handlers.js'
```

In the `app.whenReady()`/equivalent path, before `setupAutoUpdater(win)`, add:
```js
await loadSettings()
registerSettingsHandlers({ onSettingsChange: () => {} })
```

(Find the existing place where `setupAutoUpdater(win)` is called and add the two lines just before it. The `onSettingsChange` callback will be filled in in Task 3.)

- [ ] **Step 2.3: Verify the app still boots**

Run: `npm run dev`
Expected: App launches normally, no console errors. Quit the app.

- [ ] **Step 2.4: Commit**

```bash
git add src/main/settings-handlers.js src/main/index.js
git commit -m "feat(settings): IPC handlers + boot integration"
```

---

## Task 3: Wire auto-updater to settings

**Files:**
- Modify: `src/main/auto-updater.js`
- Modify: `src/main/index.js`

- [ ] **Step 3.1: Refactor auto-updater to read from settings + expose runtime hooks**

Replace `src/main/auto-updater.js` with:

```js
import { ipcMain } from 'electron'
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
  // Skip in dev mode — local builds never match a real release.
  if (process.env.ELECTRON_RENDERER_URL) return
  initialized = true

  applySettings()

  autoUpdater.on('update-downloaded', (info) => {
    if (win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send('update:ready', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    console.warn('[auto-updater]', err?.message ?? err)
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })

  ipcMain.handle('updates:check', async () => {
    if (!initialized) return { status: 'error', message: 'Updater disabled in dev' }
    try {
      const result = await autoUpdater.checkForUpdates()
      const available = result?.updateInfo?.version && result.updateInfo.version !== process.env.npm_package_version
      if (autoUpdater.autoDownload && available) {
        return { status: 'downloading', version: result.updateInfo.version }
      }
      return { status: 'up-to-date', version: result?.updateInfo?.version }
    } catch (err) {
      return { status: 'error', message: err?.message ?? String(err) }
    }
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
```

- [ ] **Step 3.2: Wire the change callback in main/index.js**

In `src/main/index.js`, update the import and the `registerSettingsHandlers` call:

Replace:
```js
import { setupAutoUpdater } from './auto-updater.js'
```
with:
```js
import { setupAutoUpdater, reapplyAutoUpdaterSettings } from './auto-updater.js'
```

Replace the previous `registerSettingsHandlers({ onSettingsChange: () => {} })` line with:
```js
registerSettingsHandlers({
  onSettingsChange: (after, before) => {
    if (after.updates.autoUpdate !== before.updates.autoUpdate) {
      reapplyAutoUpdaterSettings()
    }
  }
})
```

- [ ] **Step 3.3: Verify**

Run: `npm run dev`. App should boot normally; no console errors.

- [ ] **Step 3.4: Commit**

```bash
git add src/main/auto-updater.js src/main/index.js
git commit -m "feat(settings): gate auto-updater on settings.updates.autoUpdate"
```

---

## Task 4: PTY spawn reads dangerous flag from settings

**Files:**
- Modify: `src/main/pty-manager.js`

- [ ] **Step 4.1: Replace the static `claude` shell entry with a dynamic builder**

Edit `src/main/pty-manager.js`. Replace the existing `SHELLS` constant (lines 21–25) and the `createSession` function so the claude command is built at spawn time from settings:

```js
import pty from 'node-pty'
import { randomUUID } from 'crypto'
import { execFileSync } from 'child_process'
import { getCached } from './settings-store.js'

let claudeAvailable = null
function checkClaudeAvailable() {
  if (claudeAvailable !== null) return claudeAvailable
  try {
    execFileSync('where', ['claude.exe'], { stdio: 'ignore', windowsHide: true })
    claudeAvailable = true
  } catch {
    claudeAvailable = false
  }
  return claudeAvailable
}

export function isClaudeAvailable() {
  return checkClaudeAvailable()
}

function shellSpec(shell) {
  if (shell === 'cmd') return { file: 'cmd.exe', args: [] }
  if (shell === 'claude') {
    const skip = getCached().agents.dangerouslySkipPermissions
    const cmd = skip ? 'claude --dangerously-skip-permissions' : 'claude'
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', cmd] }
  }
  return { file: 'powershell.exe', args: [] }
}

const sessions = new Map()

export function createSession(shell = 'powershell', cwd, cols, rows) {
  const { file, args } = shellSpec(shell)
  const id = randomUUID()
  const skip = shell === 'claude' && getCached().agents.dangerouslySkipPermissions
  const env = skip
    ? { ...process.env, CLAUDE_DANGEROUSLY_SKIP_PERMISSIONS: '1' }
    : process.env
  const resolvedCwd = cwd || process.env.USERPROFILE || process.cwd()
  const safeCols = Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80
  const safeRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24
  const proc = pty.spawn(file, args, {
    name: 'xterm-color',
    cols: safeCols,
    rows: safeRows,
    cwd: resolvedCwd,
    env
  })

  if (shell === 'claude') {
    let trusted = false
    const disposable = proc.onData(data => {
      if (!trusted && data.includes('Yes, I trust this folder')) {
        trusted = true
        setTimeout(() => proc.write('\r'), 80)
        disposable.dispose()
      }
    })
  }

  proc._exited = false
  proc.onExit(() => { proc._exited = true })

  sessions.set(id, proc)
  return { id, proc }
}

export function writeSession(id, data) {
  const proc = sessions.get(id)
  if (!proc || proc._exited) return
  try { proc.write(data) } catch {}
}

export function resizeSession(id, cols, rows) {
  const proc = sessions.get(id)
  if (!proc || proc._exited) return
  try { proc.resize(cols, rows) } catch {}
}

export function killSession(id) {
  const proc = sessions.get(id)
  if (!proc) return
  sessions.delete(id)
  if (proc._exited) return
  proc._exited = true
  try {
    proc.kill()
  } catch {
    // node-pty's conpty cleanup on Windows can throw on stale consoles — ignore
  }
}

export function killAllSessions() {
  for (const id of Array.from(sessions.keys())) {
    killSession(id)
  }
}
```

- [ ] **Step 4.2: Verify**

Run: `npm run dev`. Create a workspace, spawn an agent, confirm Claude starts (auto-accepts the trust prompt). Quit.

- [ ] **Step 4.3: Commit**

```bash
git add src/main/pty-manager.js
git commit -m "feat(settings): build claude spawn args from dangerouslySkipPermissions setting"
```

---

## Task 5: Preload bridge

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 5.1: Expose new APIs**

Edit `src/preload/index.js`. Add the following entries to the `api` object (place them near `loadWorkspaces`/`saveWorkspaces` for grouping):

```js
  getSettings:     ()      => ipcRenderer.invoke('settings:get'),
  setSettings:     (patch) => ipcRenderer.invoke('settings:set', patch),
  getAppVersion:   ()      => ipcRenderer.invoke('app:version'),
  checkForUpdates: ()      => ipcRenderer.invoke('updates:check'),
  flashWindow:     ()      => ipcRenderer.invoke('window:flash'),
```

- [ ] **Step 5.2: Verify**

Run: `npm run dev`. Open dev tools console in the renderer. Run:
```js
await window.electronAPI.getSettings()
```
Expected: returns the full settings object with defaults.

- [ ] **Step 5.3: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(settings): expose settings + version + updates IPC on preload"
```

---

## Task 6: Renderer settings store + migration from volume-store

**Files:**
- Create: `src/renderer/settings-store.js`
- Create: `tests/renderer/settings-migration.test.js`

- [ ] **Step 6.1: Write failing migration tests**

Create `tests/renderer/settings-migration.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest'

const calls = []
beforeEach(() => {
  calls.length = 0
  localStorage.clear()
  globalThis.window = globalThis.window ?? {}
  window.electronAPI = {
    getSettings: vi.fn(async () => ({
      version: 1,
      appearance: { defaultPaneFontSize: 14 },
      notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
      updates: { autoUpdate: true },
      agents: { dangerouslySkipPermissions: true }
    })),
    setSettings: vi.fn(async (patch) => {
      calls.push(patch)
      return {
        version: 1,
        appearance: { defaultPaneFontSize: 14 },
        notifications: { doneSoundVolume: patch?.notifications?.doneSoundVolume ?? 50, taskbarFlashOnDone: true },
        updates: { autoUpdate: true },
        agents: { dangerouslySkipPermissions: true }
      }
    })
  }
})

describe('renderer settings-store migration', () => {
  it('pushes legacy localStorage volume into settings and clears the key', async () => {
    localStorage.setItem('codespace.volume.v1', JSON.stringify({ volume: 73 }))
    const { initSettings } = await import('../../src/renderer/settings-store.js?case=migrate')
    await initSettings()
    expect(calls).toEqual([{ notifications: { doneSoundVolume: 73 } }])
    expect(localStorage.getItem('codespace.volume.v1')).toBeNull()
  })

  it('is a no-op when no legacy value exists', async () => {
    const { initSettings } = await import('../../src/renderer/settings-store.js?case=none')
    await initSettings()
    expect(calls).toEqual([])
  })

  it('clears a corrupt legacy value without throwing', async () => {
    localStorage.setItem('codespace.volume.v1', '{not json')
    const { initSettings } = await import('../../src/renderer/settings-store.js?case=corrupt')
    await initSettings()
    expect(calls).toEqual([])
    expect(localStorage.getItem('codespace.volume.v1')).toBeNull()
  })
})
```

(The `?case=...` suffix forces a fresh module evaluation per test so the in-module init guard doesn't carry over.)

- [ ] **Step 6.2: Run tests to verify failure**

Run: `npm test -- tests/renderer/settings-migration.test.js`
Expected: FAIL — module not found.

- [ ] **Step 6.3: Implement renderer settings-store**

Create `src/renderer/settings-store.js`:

```js
const LEGACY_KEY = 'codespace.volume.v1'

const DEFAULTS = {
  version: 1,
  appearance: { defaultPaneFontSize: 14 },
  notifications: { doneSoundVolume: 50, taskbarFlashOnDone: true },
  updates: { autoUpdate: true },
  agents: { dangerouslySkipPermissions: true }
}

let state = { ...DEFAULTS }
const listeners = new Set()
let initialized = false

function emit() {
  for (const fn of listeners) fn(state)
}

async function migrateLegacyVolume() {
  let raw
  try { raw = localStorage.getItem(LEGACY_KEY) } catch { return }
  if (!raw) return
  let volume
  try { volume = JSON.parse(raw)?.volume } catch {}
  try { localStorage.removeItem(LEGACY_KEY) } catch {}
  if (Number.isFinite(volume) && window.electronAPI?.setSettings) {
    await window.electronAPI.setSettings({ notifications: { doneSoundVolume: Number(volume) } })
  }
}

export async function initSettings() {
  if (initialized) return state
  initialized = true
  await migrateLegacyVolume()
  if (window.electronAPI?.getSettings) {
    state = await window.electronAPI.getSettings()
    emit()
  }
  return state
}

export function getSettings() {
  return state
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function setSettings(patch) {
  if (!window.electronAPI?.setSettings) return state
  state = await window.electronAPI.setSettings(patch)
  emit()
  return state
}

// Drop-in for volume-store: 0–100 maps to 0–0.4 gain.
export function getDoneSoundGain() {
  const v = state.notifications.doneSoundVolume
  if (!Number.isFinite(v) || v <= 0) return 0
  return 0.4 * (v / 100)
}
```

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/settings-migration.test.js`
Expected: PASS, all 3 tests green.

- [ ] **Step 6.5: Commit**

```bash
git add src/renderer/settings-store.js tests/renderer/settings-migration.test.js
git commit -m "feat(settings): renderer settings store with volume-store migration"
```

---

## Task 7: Wire renderer to call initSettings on boot

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 7.1: Initialize settings before the first render path that needs them**

In `src/renderer/App.jsx`, add the import:
```js
import { initSettings } from './settings-store.js'
```

Find the existing `useEffect` that runs once on mount and loads workspaces. Add `initSettings()` to its body so it runs in parallel with workspaces loading. If the existing effect uses an `async` IIFE, add an `await initSettings()` at the top of it. If there is no such effect yet for settings init, add a new `useEffect(() => { initSettings() }, [])` near the existing mount effects.

(Keep this minimal — the in-module `initialized` guard ensures it's safe to call multiple times.)

- [ ] **Step 7.2: Verify**

Run: `npm run dev`. Open dev tools, confirm no warnings about settings. In the console:
```js
await window.electronAPI.getSettings()
```
Expected: settings object returned.

- [ ] **Step 7.3: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(settings): initialize renderer settings store on app boot"
```

---

## Task 8: Migrate VolumeControl + done-sound to new settings store

**Files:**
- Modify: `src/renderer/components/VolumeControl.jsx`
- Modify: `src/renderer/done-sound.js`
- Delete: `src/renderer/volume-store.js`

- [ ] **Step 8.1: Identify current usages**

Run: `Grep` for `volume-store` to confirm consumers.

Expected: `VolumeControl.jsx` and `done-sound.js` are the only importers.

- [ ] **Step 8.2: Update VolumeControl.jsx**

In `src/renderer/components/VolumeControl.jsx`, replace any import of `volume-store` with the new settings-store, and rewrite the value/setter wiring to use the new API:

Replace:
```js
import { getState, setVolume, subscribe } from '../volume-store.js'
```
with:
```js
import { getSettings, setSettings, subscribe } from '../settings-store.js'
```

Replace the read of `getState().volume` with `getSettings().notifications.doneSoundVolume`, and replace `setVolume(v)` calls with `setSettings({ notifications: { doneSoundVolume: v } })`. The `subscribe` callback now receives the full settings object — read `.notifications.doneSoundVolume` from it.

- [ ] **Step 8.3: Update done-sound.js**

In `src/renderer/done-sound.js`, replace the import and the gain read:

Replace:
```js
import { getDoneSoundGain } from './volume-store.js'
```
with:
```js
import { getDoneSoundGain } from './settings-store.js'
```

(`getDoneSoundGain` is exported from the new module with the same signature and semantics.)

- [ ] **Step 8.4: Delete volume-store**

```bash
rm src/renderer/volume-store.js
```

- [ ] **Step 8.5: Verify**

Run: `npm run dev`. Open the app. Adjust the volume in the title-bar control. Trigger a "done" event in a pane (Enter, then 4s of silence). Confirm the sound plays at the chosen volume. Reload (Ctrl+R) and confirm the volume value persists.

- [ ] **Step 8.6: Commit**

```bash
git add src/renderer/components/VolumeControl.jsx src/renderer/done-sound.js
git rm src/renderer/volume-store.js
git commit -m "refactor(settings): migrate VolumeControl + done-sound off volume-store"
```

---

## Task 9: Done-tracker calls flashWindow on done

**Files:**
- Modify: `src/renderer/done-tracker.js`

- [ ] **Step 9.1: Read the current done-tracker**

Run: `Read src/renderer/done-tracker.js`. Identify the function that fires when a pane transitions to "done". (It is the same site that triggers the done sound today.)

- [ ] **Step 9.2: Add settings-gated flash call**

At the top of `src/renderer/done-tracker.js`, add:
```js
import { getSettings } from './settings-store.js'
```

In the function that fires on done (alongside the existing sound trigger), add:
```js
if (getSettings().notifications.taskbarFlashOnDone) {
  window.electronAPI?.flashWindow?.()
}
```

(Place it next to the existing sound call — the two notifications are siblings.)

- [ ] **Step 9.3: Verify**

Run: `npm run dev`. Spawn an agent. Click outside the window so it is unfocused. Trigger a "done" event in the pane. Expected: window flashes in the Windows taskbar; clicking the window restores normal state.

- [ ] **Step 9.4: Commit**

```bash
git add src/renderer/done-tracker.js
git commit -m "feat(notifications): flash taskbar on done when setting is on"
```

---

## Task 10: Default pane font size from settings

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 10.1: Find where new panes get their initial font size**

Run: `Grep` for `fontSize` in `src/renderer/App.jsx`. Identify the spot where a new terminal entry is created (the `terminals: [...]` push when a workspace spawns or a `+` is clicked).

- [ ] **Step 10.2: Replace the hardcoded default with the settings value**

At the top of `App.jsx` add (if not already present from Task 7):
```js
import { getSettings } from './settings-store.js'
```

Replace the hardcoded `fontSize: 14` (or whatever literal is currently used) at the new-pane construction site with:
```js
fontSize: getSettings().appearance.defaultPaneFontSize
```

Existing panes are unaffected — they keep their persisted/per-pane size.

- [ ] **Step 10.3: Verify**

Run: `npm run dev`. Open dev tools console:
```js
await window.electronAPI.setSettings({ appearance: { defaultPaneFontSize: 18 } })
```
Then in the app: spawn a new agent. Expected: the new pane renders with 18px font; existing panes are unchanged.

Reset for next task:
```js
await window.electronAPI.setSettings({ appearance: { defaultPaneFontSize: 14 } })
```

- [ ] **Step 10.4: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(settings): new panes use defaultPaneFontSize from settings"
```

---

## Task 11: Toggle component

**Files:**
- Create: `src/renderer/components/Toggle.jsx`
- Create: `src/renderer/components/Toggle.css`

- [ ] **Step 11.1: Implement Toggle**

Create `src/renderer/components/Toggle.jsx`:

```jsx
import './Toggle.css'

export default function Toggle({ checked, onChange, ariaLabel, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`cs-toggle${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`}
      onClick={() => !disabled && onChange?.(!checked)}
    >
      <span className="cs-toggle-thumb" />
    </button>
  )
}
```

Create `src/renderer/components/Toggle.css`:

```css
.cs-toggle {
  --w: 34px;
  --h: 20px;
  --pad: 2px;
  position: relative;
  width: var(--w);
  height: var(--h);
  border-radius: 999px;
  background: var(--cs-bg-elev-1);
  border: 1px solid var(--cs-border-subtle);
  cursor: pointer;
  padding: 0;
  transition: background-color 200ms ease, border-color 200ms ease;
}
.cs-toggle:hover { border-color: var(--cs-border-default); }
.cs-toggle.on {
  background: var(--cs-cyan);
  border-color: var(--cs-cyan);
}
.cs-toggle.disabled { opacity: 0.5; cursor: not-allowed; }
.cs-toggle-thumb {
  position: absolute;
  top: var(--pad);
  left: var(--pad);
  width: calc(var(--h) - var(--pad) * 2 - 2px);
  height: calc(var(--h) - var(--pad) * 2 - 2px);
  border-radius: 999px;
  background: var(--cs-text-primary);
  transition: transform 200ms ease;
}
.cs-toggle.on .cs-toggle-thumb {
  transform: translateX(calc(var(--w) - var(--h)));
  background: #0a0b0d;
}
.cs-toggle:focus-visible {
  outline: 2px solid var(--cs-cyan);
  outline-offset: 2px;
}
```

- [ ] **Step 11.2: Verify tokens exist**

Confirm `--cs-bg-elev-1`, `--cs-border-subtle`, `--cs-border-default`, `--cs-cyan`, `--cs-text-primary` are defined in `src/renderer/design-tokens.css`. If any token name does not exist, substitute the closest existing token rather than inventing a new one.

- [ ] **Step 11.3: Commit**

```bash
git add src/renderer/components/Toggle.jsx src/renderer/components/Toggle.css
git commit -m "feat(ui): shared Toggle switch component"
```

---

## Task 12: SettingsModal component

**Files:**
- Create: `src/renderer/components/SettingsModal.jsx`
- Create: `src/renderer/components/SettingsModal.css`
- Modify: `src/renderer/App.jsx`

- [ ] **Step 12.1: Implement SettingsModal**

Create `src/renderer/components/SettingsModal.jsx`:

```jsx
import { useEffect, useState } from 'react'
import Toggle from './Toggle.jsx'
import { getSettings, setSettings, subscribe } from '../settings-store.js'
import './SettingsModal.css'

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22]

const RELEASES_URL = (v) => `https://github.com/tayyabjdr/CodeSpace/releases/tag/v${v}`

export default function SettingsModal({ open, onClose }) {
  const [s, setS] = useState(getSettings())
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState(null)

  useEffect(() => subscribe(setS), [])

  useEffect(() => {
    if (!open) return
    setUpdateStatus(null)
    window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const update = (patch) => setSettings(patch)

  const onCheckUpdates = async () => {
    setUpdateStatus({ status: 'checking' })
    const res = await window.electronAPI?.checkForUpdates?.()
    setUpdateStatus(res ?? { status: 'error', message: 'No response' })
  }

  return (
    <div className="cs-settings-backdrop" onMouseDown={onClose}>
      <div
        className="cs-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="cs-settings-header">
          <h2>Settings</h2>
          <button type="button" className="cs-settings-close" aria-label="Close" onClick={onClose}>×</button>
        </header>

        <section>
          <h3>Appearance</h3>
          <Row label="Default pane font size">
            <select
              value={s.appearance.defaultPaneFontSize}
              onChange={(e) => update({ appearance: { defaultPaneFontSize: Number(e.target.value) } })}
            >
              {FONT_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Row>
        </section>

        <section>
          <h3>Notifications</h3>
          <Row label="Done sound volume">
            <input
              type="range"
              min={0}
              max={100}
              value={s.notifications.doneSoundVolume}
              onChange={(e) => update({ notifications: { doneSoundVolume: Number(e.target.value) } })}
            />
            <span className="cs-settings-value">{s.notifications.doneSoundVolume}%</span>
          </Row>
          <Row label="Flash taskbar on done">
            <Toggle
              checked={s.notifications.taskbarFlashOnDone}
              onChange={(v) => update({ notifications: { taskbarFlashOnDone: v } })}
              ariaLabel="Flash taskbar on done"
            />
          </Row>
        </section>

        <section>
          <h3>Updates</h3>
          <Row label="Version">
            {version ? (
              <a
                href="#"
                className="cs-settings-link"
                onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal?.(RELEASES_URL(version)) }}
              >v{version}</a>
            ) : <span className="cs-settings-value">—</span>}
          </Row>
          <Row label="Auto-update">
            <Toggle
              checked={s.updates.autoUpdate}
              onChange={(v) => update({ updates: { autoUpdate: v } })}
              ariaLabel="Auto-update"
            />
          </Row>
          <div className="cs-settings-row cs-settings-actions">
            {updateStatus?.status === 'downloading' && <span className="cs-settings-value">Downloading v{updateStatus.version}…</span>}
            {updateStatus?.status === 'up-to-date' && <span className="cs-settings-value">Up to date</span>}
            {updateStatus?.status === 'error' && <span className="cs-settings-value error">Couldn't check for updates</span>}
            {updateStatus?.status === 'checking' && <span className="cs-settings-value">Checking…</span>}
            <button type="button" className="cs-settings-btn" onClick={onCheckUpdates}>Check for updates</button>
          </div>
        </section>

        <section>
          <h3>Agents</h3>
          <Row
            label="Skip permission prompts"
            caption="Runs claude with --dangerously-skip-permissions"
          >
            <Toggle
              checked={s.agents.dangerouslySkipPermissions}
              onChange={(v) => update({ agents: { dangerouslySkipPermissions: v } })}
              ariaLabel="Skip permission prompts"
            />
          </Row>
        </section>
      </div>
    </div>
  )
}

function Row({ label, caption, children }) {
  return (
    <div className="cs-settings-row">
      <div className="cs-settings-label">
        <span>{label}</span>
        {caption && <span className="cs-settings-caption">{caption}</span>}
      </div>
      <div className="cs-settings-control">{children}</div>
    </div>
  )
}
```

Create `src/renderer/components/SettingsModal.css`:

```css
.cs-settings-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: cs-fade-in 160ms ease;
}
@keyframes cs-fade-in { from { opacity: 0 } to { opacity: 1 } }

.cs-settings-modal {
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  background: var(--cs-bg-elev-1);
  border: 1px solid var(--cs-border-default);
  border-radius: 10px;
  color: var(--cs-text-primary);
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.5);
  font-family: var(--cs-font-ui), system-ui, sans-serif;
}

.cs-settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--cs-border-subtle);
}
.cs-settings-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.cs-settings-close {
  background: transparent;
  border: none;
  color: var(--cs-text-dim);
  font-size: 18px;
  width: 24px;
  height: 24px;
  cursor: pointer;
  border-radius: 4px;
}
.cs-settings-close:hover { color: var(--cs-text-primary); background: var(--cs-bg-elev-2); }

.cs-settings-modal section {
  padding: 14px 18px;
  border-bottom: 1px solid var(--cs-border-subtle);
}
.cs-settings-modal section:last-child { border-bottom: none; }
.cs-settings-modal h3 {
  margin: 0 0 12px 0;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cs-text-secondary);
}

.cs-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
}
.cs-settings-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--cs-text-primary);
}
.cs-settings-caption {
  font-size: 11px;
  color: var(--cs-text-dim);
}
.cs-settings-control {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cs-settings-value {
  font-size: 12px;
  color: var(--cs-text-dim);
  font-variant-numeric: tabular-nums;
}
.cs-settings-value.error { color: #f87171; }
.cs-settings-actions {
  justify-content: flex-end;
}

.cs-settings-link {
  color: var(--cs-cyan);
  text-decoration: none;
}
.cs-settings-link:hover { text-decoration: underline; }

.cs-settings-btn {
  background: var(--cs-bg-elev-2);
  border: 1px solid var(--cs-border-default);
  color: var(--cs-text-primary);
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.cs-settings-btn:hover { border-color: var(--cs-cyan); }

.cs-settings-modal select,
.cs-settings-modal input[type="range"] {
  background: var(--cs-bg-elev-2);
  border: 1px solid var(--cs-border-subtle);
  color: var(--cs-text-primary);
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 4px;
}
.cs-settings-modal input[type="range"] {
  padding: 0;
  width: 140px;
}
```

(Token names referenced: `--cs-bg-elev-1`, `--cs-bg-elev-2`, `--cs-border-default`, `--cs-border-subtle`, `--cs-text-primary`, `--cs-text-secondary`, `--cs-text-dim`, `--cs-cyan`, `--cs-font-ui`. If any does not exist in `design-tokens.css`, substitute the closest existing token rather than inventing one.)

- [ ] **Step 12.2: Render the modal in App.jsx**

In `src/renderer/App.jsx`:

Add the import:
```js
import SettingsModal from './components/SettingsModal.jsx'
```

In the App component, add state:
```js
const [settingsOpen, setSettingsOpen] = useState(false)
```

Pass an opener down to `Sidebar`:
```js
<Sidebar
  /* ...existing props... */
  onOpenSettings={() => setSettingsOpen(true)}
/>
```

Render the modal at the top level of the returned JSX (just inside the outermost wrapper):
```jsx
<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
```

- [ ] **Step 12.3: Verify**

Run: `npm run dev`. The Sidebar prop will be wired in Task 13; for now, force-open the modal by temporarily setting `useState(true)` for `settingsOpen`. Confirm:
- All controls render
- Esc closes
- Click on backdrop closes
- Volume slider, font-size dropdown, all three toggles work and persist (reload Ctrl+R, values come back)
- "Check for updates" button shows a status (in dev mode it will show the dev-mode error — that's expected)
- Version row shows "—" in dev mode (no real version surfaced) — expected

After verification, restore `useState(false)`.

- [ ] **Step 12.4: Commit**

```bash
git add src/renderer/components/SettingsModal.jsx src/renderer/components/SettingsModal.css src/renderer/App.jsx
git commit -m "feat(settings): SettingsModal with appearance, notifications, updates, agents"
```

---

## Task 13: Sidebar footer — gear + version, remove "+ New Workspace"

**Files:**
- Modify: `src/renderer/components/Sidebar.jsx`
- Modify: `src/renderer/components/Sidebar.css`

- [ ] **Step 13.1: Update Sidebar.jsx**

In `src/renderer/components/Sidebar.jsx`:

Add gear glyph at the top alongside `PlusGlyph`:

```jsx
const GearGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
```

Update the component signature:
```js
export default function Sidebar({ workspaces, activeId, notifyingIds, onSelect, onCreate, onDelete, onOpenSettings }) {
```

Add a piece of state for the version label:
```js
import { useEffect, useRef, useState } from 'react'
// ...
const [version, setVersion] = useState('')
useEffect(() => {
  window.electronAPI?.getAppVersion?.().then(setVersion).catch(() => setVersion(''))
}, [])
```

Replace the existing footer button:
```jsx
      <button className="sb-new-btn" onClick={onCreate}>
        <PlusGlyph />
        <span>New Workspace</span>
      </button>
```
with:
```jsx
      <div className="sb-footer">
        <button
          type="button"
          className="sb-footer-btn"
          title="Settings"
          aria-label="Settings"
          onClick={onOpenSettings}
        >
          <GearGlyph />
        </button>
        {version && (
          <a
            href="#"
            className="sb-footer-version"
            title={`Release notes for v${version}`}
            onClick={(e) => {
              e.preventDefault()
              window.electronAPI?.openExternal?.(`https://github.com/tayyabjdr/CodeSpace/releases/tag/v${version}`)
            }}
          >
            v{version}
          </a>
        )}
      </div>
```

- [ ] **Step 13.2: Update Sidebar.css**

In `src/renderer/components/Sidebar.css`:

Remove the `.sb-new-btn` ruleset (and any `:hover`/`:focus` selectors specific to it). If a `flex-grow` or layout rule on `.sb-list` depends on the bottom button taking remaining space, leave the list layout intact — the new footer occupies the same slot.

Add:
```css
.sb-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-top: 1px solid var(--cs-border-subtle);
  flex-shrink: 0;
}
.sb-footer-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--cs-text-dim);
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 160ms ease, border-color 160ms ease, background-color 160ms ease;
}
.sb-footer-btn:hover {
  color: var(--cs-text-primary);
  border-color: var(--cs-border-subtle);
  background: var(--cs-bg-elev-1);
}
.sb-footer-version {
  font-size: 11px;
  color: var(--cs-text-dim);
  text-decoration: none;
  font-variant-numeric: tabular-nums;
}
.sb-footer-version:hover { color: var(--cs-cyan); }
```

- [ ] **Step 13.3: Wire the prop in App.jsx**

In `src/renderer/App.jsx`, the `<Sidebar />` render site already received the `onOpenSettings` prop in Task 12. Confirm it is still there.

- [ ] **Step 13.4: Verify**

Run: `npm run dev`. Confirm:
- The "+ New Workspace" button at the bottom of the sidebar is gone.
- A footer row shows a gear button and a `v0.0.0`-style version label (the dev version).
- Clicking the gear opens the Settings modal.
- Clicking the version label opens the GitHub release page in the default browser.
- The `+` button in the sidebar header still creates new workspaces (this is the canonical entry point now).

- [ ] **Step 13.5: Commit**

```bash
git add src/renderer/components/Sidebar.jsx src/renderer/components/Sidebar.css
git commit -m "feat(sidebar): replace + New Workspace footer with gear + version row"
```

---

## Task 14: Final manual verification

This task has no commit — it gates merge.

- [ ] **Step 14.1: Build a packaged-mode smoke test**

Run: `npm run build && npm run preview`
This runs the built app outside dev mode, so the auto-updater is live. Confirm:
- App boots, settings load (open the modal — values populate).
- Toggle auto-update off → in main console look for no warnings; toggle back on.
- Click "Check for updates" → status line shows either "Up to date" or "Downloading vX.Y.Z…".

Quit when done.

- [ ] **Step 14.2: Cross-setting matrix**

In `npm run dev`:

| Setting | Action | Expected |
|---|---|---|
| Default font size = 18 | Spawn a new pane | New pane uses 18px; existing panes unchanged |
| Done sound volume = 0 | Trigger done | No sound |
| Done sound volume = 80 | Trigger done | Loud sound |
| Flash taskbar = on | Unfocus window, trigger done | Taskbar flashes |
| Flash taskbar = off | Unfocus window, trigger done | No flash |
| Skip permission prompts = off | Spawn a new agent | Claude starts; no `--dangerously-skip-permissions` flag (verify by inspecting `pty.spawn` args via a temporary console.log if needed; remove the log before commit) |
| Skip permission prompts = on | Spawn a new agent | Claude starts with the flag |

- [ ] **Step 14.3: Restart persistence**

With non-default settings set:
- Quit the app completely.
- Open `%APPDATA%\CodeSpace\settings.json` and confirm the values match.
- Relaunch — values are still there.

- [ ] **Step 14.4: Migration smoke test**

If you can put a fresh user into a state with only the legacy `localStorage` value:
- In dev tools console (before any settings:set fires): `localStorage.setItem('codespace.volume.v1', JSON.stringify({ volume: 73 }))` then `location.reload()`.
- Open the Settings modal — the volume slider shows 73.
- Confirm `localStorage.getItem('codespace.volume.v1')` is now `null`.

---

## Out of scope (explicit non-goals from the spec)

- Keybindings UI
- Default workspace behavior (isolated-by-default toggle, default agent count, default parent dir)
- "Done" silence-threshold knob
- Terminal scrollback size, cursor style, bell behavior
- Telemetry opt-out
- Settings sync, import/export, reset-to-defaults
- Beta release channel
- Editing the full agent command or appending extra args
- Themes / font choices (only one of each is bundled)
