# Auto-update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Existing CodeSpace installs auto-find new versions on GitHub Releases, download silently, and prompt the user to restart when ready.

**Architecture:** One main-process module (`src/main/auto-updater.js`) wraps `electron-updater`. Two new IPC channels surface "update ready" to the renderer and "install now" back. A small `<UpdateToast />` component handles the user-facing prompt. Build config gains a `publish` block + `release` script for manual cuts. No tests for the updater path — `electron-updater` is I/O-heavy; manual smoke test only.

**Tech Stack:** Electron 31, `electron-updater` 6.x (new dep), React 18, electron-builder NSIS target, GitHub Releases as the update host.

**Spec:** `docs/superpowers/specs/2026-05-08-auto-update-design.md`.

---

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `package.json` | modify | Add `electron-updater` dep, `publish` block under `build`, `release` script |
| `src/main/auto-updater.js` | new | Wrap `electron-updater`: schedule check, forward `update-downloaded`, expose `update:install` IPC |
| `src/main/index.js` | modify | Call `setupAutoUpdater(win)` after `createWindow()` returns |
| `src/preload/index.js` | modify | Expose `onUpdateReady(cb)` and `installUpdate()` on the `electronAPI` bridge |
| `src/renderer/components/UpdateToast.jsx` | new | Bottom-right toast that subscribes to `update:ready` and offers Restart/Later |
| `src/renderer/components/UpdateToast.css` | new | Toast styling using existing design tokens |
| `src/renderer/App.jsx` | modify | Render `<UpdateToast />` once at the top of the app tree |

---

## Notes for the engineer

- **No TDD here.** `electron-updater` makes real HTTP calls and writes installers to disk; mocking it meaningfully isn't worth it. The verification at each task is "the build still compiles and the app still launches." The end-to-end smoke test (Task 8) is what proves the feature works.
- **Don't run `npm run release` while developing this.** That actually publishes a real GitHub release. Use `npm run build` for verification.
- **Dev mode is exempt.** The auto-updater module returns early when `process.env.ELECTRON_RENDERER_URL` is set (electron-vite dev server), so `npm run dev` will never trigger a real update check. Test the wiring in dev; test the actual update flow in a packaged build (Task 8).
- **Commit frequently.** Each task ends with a commit so the branch history reads cleanly.

---

## Task 1: Add `electron-updater` dependency and `publish` config

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `electron-updater` to dependencies**

Open `package.json`. In the `dependencies` block, add `electron-updater` between `@anthropic-ai/sdk` and the next entry (alphabetical):

```json
"dependencies": {
  "@anthropic-ai/sdk": "^0.95.1",
  "@codemirror/autocomplete": "^6.20.1",
  ... (existing entries unchanged) ...
  "electron-updater": "^6.3.0",
  "node-pty": "^1.0.0",
  "strip-ansi": "^7.2.0"
}
```

- [ ] **Step 2: Add `release` script**

In the `scripts` block of `package.json`, add a new line after `"package"`:

```json
"scripts": {
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "preview": "electron-vite preview",
  "package": "electron-builder",
  "release": "electron-vite build && electron-builder --publish always",
  "test": "vitest run",
  "test:watch": "vitest",
  "postinstall": "electron-rebuild -f -w node-pty"
}
```

- [ ] **Step 3: Add `publish` block inside `build`**

In the `build` block, add a `publish` array. Place it after `"productName"` and before `"win"`:

```json
"build": {
  "appId": "com.controlDeck.codespace",
  "productName": "CodeSpace",
  "publish": [{
    "provider": "github",
    "owner": "tayyabjdr",
    "repo": "CodeSpace"
  }],
  "win": {
    "target": "nsis",
    "icon": "build/icon.ico"
  },
  ... (rest unchanged) ...
}
```

- [ ] **Step 4: Install the new dependency**

Run: `npm install`

Expected: `npm` adds `electron-updater` to `package-lock.json` and installs it under `node_modules/`. `electron-rebuild` runs as part of `postinstall` for `node-pty` — that's normal, ignore its output unless it errors.

If `electron-rebuild` fails on Windows, that's the known native-build issue documented in `CLAUDE.md` ("Windows quirks"). It's pre-existing and not caused by this task.

- [ ] **Step 5: Verify the dependency is installed**

Run: `node -e "console.log(require('electron-updater').autoUpdater ? 'ok' : 'missing')"`

Expected output: `ok`

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps(auto-update): add electron-updater + publish config"
```

---

## Task 2: Create the main-process auto-updater module

**Files:**
- Create: `src/main/auto-updater.js`

- [ ] **Step 1: Create the module**

Create `src/main/auto-updater.js` with this exact content:

```js
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
```

Notes:
- `electron-updater` exports as CommonJS, so we destructure `autoUpdater` from the default import. ESM-style `import { autoUpdater } from 'electron-updater'` won't work reliably across versions.
- The `win.isDestroyed()` / `webContents.isDestroyed()` guard mirrors the pattern used in `src/main/index.js:60-64` for `sendMaximizeState`.
- We don't subscribe to `update-available` or `download-progress`. The spec says no progress UI, only the final "ready" toast.

- [ ] **Step 2: Verify the module imports cleanly**

Run: `node --input-type=module -e "import('./src/main/auto-updater.js').then(() => console.log('ok')).catch(e => { console.error(e); process.exit(1) })"`

Expected output: `ok`

If you see `SyntaxError: The requested module 'electron-updater' does not provide an export named 'autoUpdater'`, the destructure-from-default pattern is being interpreted differently — double-check Step 1's import lines exactly.

If you see `Error: Cannot find module 'electron'` — that's expected, electron isn't loadable outside an Electron context. The static import check above sidesteps that by not calling `setupAutoUpdater`. If this trips, skip this verification and rely on Task 7's full build.

- [ ] **Step 3: Commit**

```bash
git add src/main/auto-updater.js
git commit -m "feat(auto-update): main-process updater module"
```

---

## Task 3: Wire `setupAutoUpdater` into the main entry point

**Files:**
- Modify: `src/main/index.js`

- [ ] **Step 1: Add the import**

At the top of `src/main/index.js`, after the existing `import { loadWorkspaces, ... }` line (~line 7), add:

```js
import { setupAutoUpdater } from './auto-updater.js'
```

The full import block at the top of the file should now read:

```js
import { app, BrowserWindow, Menu, ipcMain, dialog, clipboard, session } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import { registerHandlers } from './ipc-handlers.js'
import { killAllSessions } from './pty-manager.js'
import { loadWorkspaces, saveWorkspaces, consumeCorruptBackupNotice } from './workspaces-store.js'
import { setupAutoUpdater } from './auto-updater.js'
```

- [ ] **Step 2: Capture the window reference and call the setup function**

Find the `app.whenReady().then(() => { ... })` block (~line 113). The current body ends with `createWindow()` (which returns a `BrowserWindow` but the value is discarded). Capture the return value and call `setupAutoUpdater`:

Before:
```js
app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // CSP — only outside dev mode, since Vite HMR needs eval/inline scripts.
  if (!process.env['ELECTRON_RENDERER_URL']) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      ... (CSP block unchanged) ...
    })
  }

  createWindow()
})
```

After:
```js
app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // CSP — only outside dev mode, since Vite HMR needs eval/inline scripts.
  if (!process.env['ELECTRON_RENDERER_URL']) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      ... (CSP block unchanged) ...
    })
  }

  const win = createWindow()
  setupAutoUpdater(win)
})
```

`createWindow()` already does `return win` at its last line (~line 93), so no change needed inside the function — only the caller captures the value.

- [ ] **Step 3: Verify the dev build still launches**

Run: `npm run dev`

Expected: app launches as before. No update toast appears (we're in dev mode and the module exits early). No new errors in the main-process console.

Quit the dev app (Ctrl+C in the terminal, or close the window).

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js
git commit -m "feat(auto-update): wire setupAutoUpdater into app startup"
```

---

## Task 4: Expose preload bridge methods

**Files:**
- Modify: `src/preload/index.js`

- [ ] **Step 1: Add `onUpdateReady` and `installUpdate` to the bridge**

Open `src/preload/index.js`. Inside the `api` object (~line 3), add two new methods. Place them after the `openExternal` line (~line 55), keeping the bridge surface contiguous:

Before:
```js
  agentName: {
    hasKey:    () => ipcRenderer.invoke('agentName:hasKey'),
    summarize: (tail) => ipcRenderer.invoke('agentName:summarize', tail),
  },

  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
}
```

After:
```js
  agentName: {
    hasKey:    () => ipcRenderer.invoke('agentName:hasKey'),
    summarize: (tail) => ipcRenderer.invoke('agentName:summarize', tail),
  },

  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),

  onUpdateReady: (callback) => {
    const handler = (_event, info) => callback(info)
    ipcRenderer.on('update:ready', handler)
    return () => ipcRenderer.removeListener('update:ready', handler)
  },

  installUpdate: () => ipcRenderer.invoke('update:install'),
}
```

The `onUpdateReady` shape (handler that returns an unsubscribe) mirrors `onPtyData`, `onPtyExit`, and `onMaximizeChanged` in the same file.

- [ ] **Step 2: Verify the dev build still launches and the bridge exposes the new methods**

Run: `npm run dev`

In the app's renderer DevTools console, run:

```js
typeof window.electronAPI.onUpdateReady === 'function' &&
typeof window.electronAPI.installUpdate === 'function'
```

Expected output: `true`

Quit the dev app.

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.js
git commit -m "feat(auto-update): expose update IPC on preload bridge"
```

---

## Task 5: Create the `UpdateToast` component

**Files:**
- Create: `src/renderer/components/UpdateToast.jsx`
- Create: `src/renderer/components/UpdateToast.css`

- [ ] **Step 1: Create `UpdateToast.jsx`**

Create `src/renderer/components/UpdateToast.jsx` with this exact content:

```jsx
import { useEffect, useState } from 'react'
import './UpdateToast.css'

export default function UpdateToast() {
  const [ready, setReady] = useState(null)

  useEffect(() => {
    return window.electronAPI.onUpdateReady((info) => setReady(info))
  }, [])

  if (!ready) return null

  return (
    <div className="update-toast" role="status">
      <span className="update-toast-icon" aria-hidden="true">↻</span>
      <span className="update-toast-text">
        Update ready (v{ready.version})
      </span>
      <div className="update-toast-actions">
        <button
          className="update-toast-btn update-toast-btn-primary"
          onClick={() => window.electronAPI.installUpdate()}
        >
          Restart now
        </button>
        <button
          className="update-toast-btn"
          onClick={() => setReady(null)}
        >
          Later
        </button>
      </div>
    </div>
  )
}
```

Notes:
- The effect returns the unsubscribe function from `onUpdateReady` directly — that's the cleanup React calls on unmount.
- "Later" only dismisses the local UI state. The downloaded installer still applies on next quit because of `autoInstallOnAppQuit = true` in the main module.
- Guard against `window.electronAPI` being missing isn't needed here: `App.jsx`'s top-level `App()` already short-circuits to `<BridgeMissing />` when the bridge is absent, so this component only mounts when the bridge is live.

- [ ] **Step 2: Create `UpdateToast.css`**

Create `src/renderer/components/UpdateToast.css` with this exact content:

```css
.update-toast {
  position: fixed;
  right: 16px;
  bottom: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--cs-bg-elevated);
  border: 1px solid var(--cs-border);
  border-radius: 8px;
  color: var(--cs-text-primary);
  font-family: var(--cs-font-ui);
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
  z-index: 1000;
  animation: slideUp 220ms ease-out;
}

.update-toast-icon {
  color: var(--cs-cyan);
  font-size: 14px;
  line-height: 1;
}

.update-toast-text {
  color: var(--cs-text-primary);
  white-space: nowrap;
}

.update-toast-actions {
  display: flex;
  gap: 6px;
  margin-left: 4px;
}

.update-toast-btn {
  padding: 5px 10px;
  background: transparent;
  border: 1px solid var(--cs-border);
  border-radius: 5px;
  color: var(--cs-text-primary);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background var(--cs-transition), border-color var(--cs-transition);
}

.update-toast-btn:hover {
  background: var(--cs-bg-hover);
  border-color: var(--cs-border-hover);
}

.update-toast-btn-primary {
  background: rgba(103, 232, 249, 0.10);
  border-color: var(--cs-cyan-glow);
  color: var(--cs-cyan);
}

.update-toast-btn-primary:hover {
  background: rgba(103, 232, 249, 0.18);
  border-color: var(--cs-cyan);
}
```

Notes:
- Reuses the existing `slideUp` keyframe defined in `design-tokens.css:96-99`. Don't redefine it.
- `var(--cs-bg-elevated)`, `var(--cs-border)`, `var(--cs-border-hover)`, `var(--cs-bg-hover)`, `var(--cs-cyan)`, `var(--cs-cyan-glow)`, `var(--cs-transition)` are all defined in `design-tokens.css:1-63`. If any look unfamiliar, that file is the source of truth.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/UpdateToast.jsx src/renderer/components/UpdateToast.css
git commit -m "feat(auto-update): UpdateToast component"
```

---

## Task 6: Render `UpdateToast` in `App.jsx`

**Files:**
- Modify: `src/renderer/App.jsx`

- [ ] **Step 1: Add the import**

In `src/renderer/App.jsx`, after the `import EditorResizer from './components/EditorResizer.jsx'` line (~line 8), add:

```jsx
import UpdateToast from './components/UpdateToast.jsx'
```

- [ ] **Step 2: Render the toast at the top level**

Find the closing `</div>` of `.app` at the bottom of `AppInner`'s return statement (~line 743). The structure currently ends:

```jsx
      {pendingDirtyAction && activeWorkspace?.editor?.file && (
        <ConfirmDialog ... />
      )}
    </div>
  )
}
```

Insert `<UpdateToast />` as the last child before the closing `</div>` of `.app`:

```jsx
      {pendingDirtyAction && activeWorkspace?.editor?.file && (
        <ConfirmDialog ... />
      )}

      <UpdateToast />
    </div>
  )
}
```

This places the toast as a sibling of the modals/dialogs. It's `position: fixed`, so DOM placement only affects stacking order — fine as the last child.

- [ ] **Step 3: Verify it doesn't break the dev build**

Run: `npm run dev`

Expected:
- App launches normally.
- No toast appears (we're in dev; updater is bypassed, `update:ready` is never sent).
- No new console errors.

To confirm the toast actually renders, in the renderer DevTools console:

```js
// Simulate the IPC message that the updater would send.
require('electron').ipcRenderer._events['update:ready'] // ← will be undefined; the listener is registered on the renderer side via preload
```

Direct test: open DevTools and run

```js
// Manually fire the toast by calling the listener registered by UpdateToast.
// This works because the preload listens via ipcRenderer.on, and we can
// simulate by emitting from the main side. Skip if it's awkward — Task 8
// is the real verification.
```

If manual simulation is awkward, skip to Task 7 — Task 8's smoke test exercises this end-to-end.

Quit the dev app.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.jsx
git commit -m "feat(auto-update): mount UpdateToast in App"
```

---

## Task 7: Production build smoke test

**Files:** none modified.

- [ ] **Step 1: Run a clean production build**

Run: `npm run build`

Expected:
- `electron-vite build` completes for all three targets (main, preload, renderer).
- No errors mentioning `electron-updater`, `auto-updater.js`, `UpdateToast`, or any of the modified files.
- Output appears under `out/`.

If it fails with `Cannot find module 'electron-updater'`, recheck Task 1 step 4 (`npm install` actually ran).

- [ ] **Step 2: Verify the auto-updater bundle is included**

Run: `node -e "const fs = require('fs'); const main = fs.readFileSync('out/main/index.js', 'utf8'); console.log(main.includes('setupAutoUpdater') ? 'ok' : 'missing')"`

Expected output: `ok`

If `missing`, the import in `src/main/index.js` may have been tree-shaken or the build didn't pick up the new file. Recheck Task 3.

- [ ] **Step 3: No commit**

Build artifacts under `out/` are gitignored. Nothing to commit for this task.

---

## Task 8: End-to-end manual smoke test

**Files:** none modified. **This is the real verification of the feature.** Run before merging.

This task requires creating a real GitHub release. Skip if you'd rather defer to the first real ship; the build-time verification in Tasks 5 + 7 covers the wiring. Run this once, end-to-end, before relying on auto-update in production.

- [ ] **Step 1: Confirm prerequisites**

Make sure:
- The repo `tayyabjdr/CodeSpace` is **public** on GitHub. If it's private, end users can't fetch `latest.yml` anonymously — flip visibility on github.com → Settings → Danger Zone, or change `build.publish.repo` to a separate public releases repo (see spec).
- A GitHub PAT with `repo` scope is exported as `GH_TOKEN` in the shell you'll run `npm run release` from. Generate one at github.com/settings/tokens/new if needed. **Never commit the token.**

- [ ] **Step 2: Build and install v1.0.0 locally**

Confirm `package.json`'s `"version"` is `"1.0.0"`. Run:

```bash
npm run package
```

This produces an installer under `dist/` (electron-builder's default). Double-click the installer and complete the install. Launch the installed CodeSpace from the Start Menu — confirm it opens normally.

Quit the installed app.

- [ ] **Step 3: Bump version and publish v1.0.1**

In your dev checkout (separate from the installed app):

```bash
npm version patch
```

This bumps `package.json` to `1.0.1`, commits, and tags `v1.0.1`.

Then:

```bash
npm run release
```

Wait for it to finish. It builds the v1.0.1 installer and uploads `CodeSpace-Setup-1.0.1.exe` + `latest.yml` as assets to a **draft** release on GitHub.

Open https://github.com/tayyabjdr/CodeSpace/releases — the draft will be there. Click "Publish release".

- [ ] **Step 4: Watch the installed v1.0.0 pick it up**

Launch the installed v1.0.0 app (Start Menu, not your dev checkout). Open DevTools (`Ctrl+Shift+I` if it's enabled in production; if not, you'll be flying blind on logs but the toast itself is the visible signal).

Wait at least 15 seconds. Within that window:
1. The main-process console should log update events from `electron-updater` (visible only with devtools or by running the app from a terminal).
2. The installer for v1.0.1 downloads in the background.
3. A toast appears in the bottom-right: `↻ Update ready (v1.0.1) [ Restart now ] [ Later ]`.

If the toast doesn't appear within ~30 s:
- Check the system tray and `%APPDATA%/CodeSpace/logs/` for `electron-updater` logs.
- Confirm the GitHub release is **published**, not still in draft state.
- Confirm `latest.yml` is attached to the release (it should be — `--publish always` adds it).
- Confirm the repo is public. Try `curl -I https://github.com/tayyabjdr/CodeSpace/releases/latest/download/latest.yml` — must return `200` (or a redirect chain ending in `200`).

- [ ] **Step 5: Verify both buttons**

Click **Later**. Expected: toast disappears. Quit the app, relaunch — the v1.0.1 installer applies during quit, and the relaunched app is now v1.0.1. Confirm by checking the title bar (if version is shown) or via `Help → About` (if such a menu exists) — otherwise, on the next launch no new toast appears for v1.0.1, which is itself the confirmation.

Reinstall v1.0.0 from the installer in Step 2 to test **Restart now**: bump again to v1.0.2, publish, launch v1.0.0, wait for toast, click **Restart now**. App should quit immediately and relaunch on v1.0.2.

- [ ] **Step 6: Clean up (optional)**

If v1.0.1 / v1.0.2 were just smoke-test releases and you don't want them in your release history, delete them on github.com/tayyabjdr/CodeSpace/releases. Also delete the corresponding tags locally (`git tag -d v1.0.1 v1.0.2`) and remotely (`git push --delete origin v1.0.1 v1.0.2`). Resetting `package.json` back to your real working version (e.g., `1.0.0`) is fine since the bumps were test scaffolding.

If you want to keep them as your first real releases, leave everything in place.

- [ ] **Step 7: No commit**

Nothing to commit for this task — it's verification only.

---

## Self-review

Coverage check against the spec:

- [x] Spec §"Goal" → Tasks 2-6 build the wiring; Task 8 verifies it.
- [x] Spec §"User-visible behavior" silent + 10 s + toast → Task 2 (10 s timer, no progress UI) + Task 5 (toast).
- [x] Spec §"User-visible behavior" Restart now / Later → Task 5 (both buttons wired).
- [x] Spec §"User-visible behavior" dev mode skip → Task 2 (early return on `ELECTRON_RENDERER_URL`).
- [x] Spec §"Architecture" `setupAutoUpdater(win)` → Task 2.
- [x] Spec §"Architecture" preload methods → Task 4.
- [x] Spec §"Architecture" `<UpdateToast />` → Task 5.
- [x] Spec §"Architecture" wired in `app.whenReady` → Task 3.
- [x] Spec §"Build configuration" `publish` block + `release` script + dep → Task 1.
- [x] Spec §"Failure modes" silent on network errors → Task 2 (the two `.catch` paths + the `error` handler).
- [x] Spec §"Failure modes" PTY teardown on `quitAndInstall` → already handled by existing `will-quit` handler in `main/index.js`; no new code, called out in Task 2's commentary.
- [x] Spec §"Testing" no unit tests, manual smoke → Task 8.
- [x] Spec §"Release workflow" → Tasks 1 (script + config) + 8 (procedure).

Placeholder/ambiguity scan: clean. No "TBD", "TODO", or vague steps. Every code change shows the exact code. File paths and line ranges are concrete or clearly approximate (~).

Type/name consistency:
- `setupAutoUpdater` used identically in Tasks 2 and 3. ✓
- `update:ready` channel and `update:install` channel match across main (Task 2), preload (Task 4), and renderer (Task 5). ✓
- `onUpdateReady` / `installUpdate` bridge method names match between Task 4 (definition) and Task 5 (consumption). ✓
