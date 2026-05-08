# CodeSpace — improvement research (2026-05-08)

Research output for "what's worth building or fixing next". Not a plan; a
prioritized menu to choose from.

## Audit status (vs. 2026-05-05 prod-readiness audit)

Most ship-blockers are already fixed:

- [x] #1 Atomic `workspaces.json` write (tmp + rename) — `workspaces-store.js`
- [x] #2 Corrupt-JSON quarantine + banner notice
- [x] #3 `asarUnpack` for node-pty — `package.json`
- [x] #4 `before-quit` PTY cleanup with 600 ms grace — `main/index.js`
- [x] CSP + `sandbox: true` — `main/index.js`
- [x] `win:maximize-changed` event wired
- [x] Clipboard 1 MB cap

**Still open, surgical:**

- **#5 partial — `cwd` not validated.** `pty-manager.js:35` accepts any
  string. Add `path.isAbsolute(cwd) && fs.statSync(cwd).isDirectory()`
  before `pty.spawn`. A compromised renderer could otherwise pass UNC
  paths or traversal.
- **#6 in-flight create + delete races** in `App.jsx`.
- **#11 PTY exit listeners never disposed** in `ipc-handlers.js`.
- **#16 AudioContext per ding** in `TerminalPane.jsx` — Chrome caps ~6.
- **#19 hardcoded 80×24 initial size** — first banner always wraps.

## Three features that move the needle

### 1. Dispatch — broadcast a prompt to N panes

The killer feature. The grid is already a parallel-agent surface; right
now you click each pane, paste, send, repeat. With Dispatch, the grid
becomes the point of the product. See companion section below.

### 2. Session resume / `claude --resume`

Claude CLI persists conversations server-side. CodeSpace doesn't
surface that — app crash or quit loses all context. Capture session id
on spawn, persist `{ ptyId → sessionId }` in `workspaces.json`, on next
launch lazy-spawn with `claude --resume <id>`. Pane shows "↻ resumed"
badge for the first turn. Biggest single durability win.

### 3. Command palette (Ctrl+K)

App is keyboard-first but has no "do anything" surface. Switch
workspace, rename pane, dispatch prompt, open file, focus pane N,
mute/unmute. One small component, replaces a lot of future menu items.

## Strategic gaps

- **Zero tests.** `vitest` is wired, `tests/` is empty. `pty-pool`,
  `done-tracker`, `auto-namer`, `workspaces-store` are exactly where a
  silent regression breaks user data.
- **No settings panel.** Auto-rename API key is env-only. Second
  tunable knob and you'll want one.
- **No cost/usage visibility.** Auto-rename added a Haiku call per turn
  per pane. The SDK response in `auto-namer.js` already has the usage
  object — surface a per-workspace daily total in the sidebar.
- **No auto-update.** Shipping NSIS without `electron-updater` means
  every fix is a manual reinstall.
- **No drag-folder-onto-window** to create a workspace.

## Quick wins (~1 hr each)

- **Pin last response** in the pane header — capture chunk between last
  two prompt markers, stash in a sidebar list. Stops scrolling 4000-line
  buffers to find the answer you already saw.
- **Per-pane git-status badge** — `git status --porcelain` on 5 s timer.
- **Search across panes** — `Ctrl+Shift+F` over all live ring buffers.
- **Move magic numbers to `constants.js`** — 4000 ms done timer, 180 ms
  zoom debounce, 850 ms boot.
- **Dispose PTY exit listeners** (#11) + **module-level AudioContext**
  (#16). Small, real correctness wins.

## Recommendation, if picking one

Build Dispatch. Ships in a day, reframes the product from "many
terminals" to "parallel agent control surface." Everything else is
hardening or polish.
