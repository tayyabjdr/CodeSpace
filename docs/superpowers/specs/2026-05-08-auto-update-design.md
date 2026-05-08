# Auto-update — design

**Date:** 2026-05-08
**Status:** approved (brainstorm)
**Owner:** TJ

## Goal

Ship updates to existing CodeSpace installs without the user having to
download and reinstall. New versions arrive in the background; when an
update is ready the user sees a small toast and decides when to
restart.

## Non-goals

- A "Check for updates now" button or menu item.
- Stable / beta / canary channels.
- Delta updates.
- macOS / Linux builds (Windows-only app).
- CI-driven release publishing — releases are cut manually from a dev
  machine.
- Code signing of the installer (deferred; SmartScreen warning on first
  install is accepted for now).
- Telemetry on update success/failure.

## User-visible behavior

- App launches normally. No splash, no banner, no "checking for
  updates" UI.
- 10 seconds after launch, in the background, the app polls
  `latest.yml` on the GitHub release for `tayyabjdr/CodeSpace`.
- If a newer version is found, the installer is downloaded silently
  (no progress UI).
- When the download finishes, a toast appears in the bottom-right of
  the window:

  ```
  ┌──────────────────────────────────────┐
  │  ↻  Update ready (v1.0.2)            │
  │     [ Restart now ]   [ Later ]      │
  └──────────────────────────────────────┘
  ```

- **Restart now** → app calls `quitAndInstall()`. NSIS runs, app
  relaunches on the new version.
- **Later** → toast dismisses. The downloaded installer is applied
  automatically the next time the user quits and reopens the app
  (default `electron-updater` behavior on Windows).
- No internet / no release published yet / GitHub 5xx → silent.
  `console.warn` only. Retries on next launch.
- Dev mode (when `ELECTRON_RENDERER_URL` is set) → check is skipped
  entirely so local testing isn't disturbed.

## Architecture

One main-process module, a tiny renderer toast component, and config.

### Main: `src/main/auto-updater.js`

Wraps `electron-updater`. Single export `setupAutoUpdater(win)`:

```
setupAutoUpdater(win):
  if process.env.ELECTRON_RENDERER_URL                  → return  // dev
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) =>
    win.webContents.send('update:ready', { version: info.version })
  )
  autoUpdater.on('error', (err) =>
    console.warn('[auto-updater]', err.message)
  )
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall())
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000)
```

The 10-second delay keeps the updater's network activity from racing
with PTY spawn at startup.

### Preload: `src/preload/index.js`

Two new bridge methods on `window.electronAPI`:

- `onUpdateReady(cb)` → subscribes to the `update:ready` channel.
  Returns an unsubscribe function. Mirrors the existing
  `onPtyData`/`onMaximizeChanged` pattern.
- `installUpdate()` → invokes `ipcMain.handle('update:install')`.

### Renderer: `src/renderer/components/UpdateToast.jsx`

Self-contained component, rendered once at the top of `App.jsx`
(outside the workspaces conditional, so it's visible during onboarding
too):

```jsx
function UpdateToast() {
  const [ready, setReady] = useState(null)  // null | { version }
  useEffect(() =>
    window.electronAPI.onUpdateReady(info => setReady(info)),
  [])
  if (!ready) return null
  return (
    <div className="update-toast">
      <span className="update-toast-icon">↻</span>
      <span className="update-toast-text">
        Update ready (v{ready.version})
      </span>
      <button onClick={() => window.electronAPI.installUpdate()}>
        Restart now
      </button>
      <button onClick={() => setReady(null)}>Later</button>
    </div>
  )
}
```

Styling lives in `UpdateToast.css`:

- Position: `fixed` bottom-right with 16 px inset.
- Background: `var(--cs-bg-secondary)` with `var(--cs-border-soft)`.
- "Restart now" uses cyan accent treatment to mirror the editor
  toggle's open state.
- One-shot 200 ms fade-in on mount; no looping animation.

### Wiring in `src/main/index.js`

Inside the existing `app.whenReady().then(...)` block, after
`createWindow()` returns the window, call `setupAutoUpdater(win)`. The
`win` reference is what `auto-updater.js` uses to send IPC.

### Build configuration in `package.json`

Add `publish`:

```json
"publish": [{
  "provider": "github",
  "owner": "tayyabjdr",
  "repo": "CodeSpace"
}]
```

Add a `release` script:

```json
"release": "electron-vite build && electron-builder --publish always"
```

Add dependency: `electron-updater@^6`.

## Release workflow

Manual, from TJ's dev machine:

1. `npm version patch` (or `minor` / `major`) — bumps `package.json`,
   commits, tags.
2. Ensure `GH_TOKEN` is exported in the shell (a GitHub PAT with
   `repo` scope, owned by TJ). The token never ships with the app.
3. `npm run release` — builds, packages, uploads installer +
   `latest.yml` as assets to a draft GitHub release.
4. Open the draft release on GitHub, hit "Publish release".

Existing installs will pick it up on their next launch within 10 s.

## Repo visibility

The repo `tayyabjdr/CodeSpace` is currently private (returns 404 from
the public GitHub API). End users need anonymous access to
`latest.yml` and the installer asset.

**Two options at release time** (resolve before first release, not in
this implementation):

1. Make `tayyabjdr/CodeSpace` public.
2. Create a separate public repo, e.g. `tayyabjdr/CodeSpace-releases`,
   and point `publish.repo` at it. Source stays private; only built
   artifacts are public.

Option 2 is cleaner if there's any reason to keep source closed; it's
also reversible. The implementation is identical either way — only
the value of `publish.repo` differs.

## Failure modes

- **No network / DNS down**: `autoUpdater.checkForUpdates()` rejects;
  caught by the `.catch(() => {})` in the timeout. Silent.
- **Repo not public yet / `latest.yml` 404**: same path. Silent.
- **GitHub 5xx or rate limit**: same path. Retries next launch.
- **Corrupt download**: `electron-updater` verifies the SHA-512 in
  `latest.yml`; mismatched downloads are discarded and the user sees
  no toast.
- **User clicks Restart now while a Claude pane is mid-turn**:
  `quitAndInstall()` calls `app.quit()` which fires the existing
  `will-quit` handler in `main/index.js`. That already runs
  `killAllSessions()` with a 600 ms grace, so PTY teardown is
  consistent with manual quit. No new code needed.
- **Asar packaging**: `electron-builder` writes `app-update.yml` into
  the asar automatically when `publish` is set. No additional
  `asarUnpack` entry needed.

## Testing

`electron-updater` is I/O-heavy and hard to unit test meaningfully.
Approach:

- **No unit tests** for the updater path itself.
- **Manual smoke test** before the first real release:
  1. Build and install v1.0.0 locally.
  2. Bump to v1.0.1 on a branch, run `npm run release`.
  3. Launch the installed v1.0.0, wait 10 s, watch dev tools console
     and main-process logs.
  4. Confirm toast appears, Restart now installs v1.0.1, Later defers
     to next quit.

## Out of scope (deferred)

- Telemetry on update success/failure rates.
- Pre-release channels.
- "Check for updates now" UI surface (e.g., in a future Settings
  panel — would call the same main-process API).
- Code signing.
- macOS / Linux builds.
- GitHub Actions CI publishing on tag push.

## Open questions

Resolved at design time:

- Repo visibility for end-user downloads — to be decided before first
  release; either path leaves implementation identical.

## Files touched

- `src/main/auto-updater.js` — new
- `src/main/index.js` — call `setupAutoUpdater(win)` after window
  creation
- `src/preload/index.js` — expose `onUpdateReady`, `installUpdate`
- `src/renderer/components/UpdateToast.jsx` — new
- `src/renderer/components/UpdateToast.css` — new
- `src/renderer/App.jsx` — render `<UpdateToast />` at the top level
- `package.json` — add `electron-updater` dep, `publish` block,
  `release` script
