# CodeSpace — Production Readiness Audit

**Date:** 2026-05-05
**Source:** Two parallel deep-dive review agents (general-purpose) over the full codebase. Findings deduplicated and prioritized by real-world impact.

## 🔴 Ship-blockers

1. **Non-atomic `workspaces.json` write** — `src/main/workspaces-store.js:43`. Power loss / force-quit mid-write truncates the user's only copy. Fix: write to `.tmp`, then `fs.rename`.
2. **Corrupt JSON silently overwrites itself with empty** — `src/main/workspaces-store.js:27`. On parse error → rename to `.corrupt-<ts>` and surface a banner. Currently: silent data loss.
3. **node-pty native binary breaks inside asar** — `package.json` build config. Need `"asarUnpack": ["**/node_modules/node-pty/**"]` or prod build crashes on first PTY spawn.
4. **Missing `before-quit` PTY cleanup** — `src/main/index.js`. Orphans `powershell.exe` / `claude` processes when Electron exits before conpty teardown completes.
5. **Renderer can pass arbitrary `cwd` + `--dangerously-skip-permissions` baked in** — `src/main/pty-manager.js:7,21`. Validate `cwd` is an existing absolute directory before spawn; without this, a compromised renderer becomes a code-execution primitive.

## 🟠 High-impact bugs

6. **In-flight `createPty` + workspace delete = orphan PTY** — `src/renderer/App.jsx:144`. If user deletes a workspace whose PTY is still resolving, the create promise lands after teardown and never gets killed. Track pending creates or delay delete until in-flight resolves.
7. **`handlePtyReady` walks every workspace's terminals** — `src/renderer/App.jsx:254`. Should filter by active workspace. Wasteful; also incorrect if termIds ever collided.
8. **`activeWorkspace` identity churn re-fires the lazy-spawn effect** — `src/renderer/App.jsx:81`. Depend on primitives (`activeId`, `workspaces`) instead.
9. **Wheel zoom triggers full workspace re-render per tick** — `src/renderer/App.jsx:244`, `src/renderer/hooks/useTerminal.js:160`. Debounce at source or move `fontSize` to a ref + subscription.
10. **`uncaughtException` swallow too broad** — `src/main/index.js:59`. Substring match catches anything containing the keywords; tighten or you'll hide real crashes.
11. **PTY exit subscriptions in main never released** — `src/main/ipc-handlers.js:7`. Store the disposables, dispose on `pty:kill` and `webContents.destroyed`.
12. **`window.electronAPI` assumed defined everywhere** — guard once in preload bridge with a fallback screen.

## 🟡 Medium — fix before wide release

13. **Add CSP + `sandbox: true`** — `src/main/index.js:16`, `src/renderer/index.html`. Standard Electron hardening.
14. **`key={activeId}` on `.grid` defeats the pty-pool design** — `src/renderer/App.jsx:313`. Forces full xterm rebuild on every workspace switch. Drop the key, let React reconcile by `t.id`.
15. **Toolbar `isMaximized` desyncs from real window state** — wire `win:maximize-changed` events from main.
16. **AudioContext per "done" ding** — `src/renderer/components/TerminalPane.jsx:5`. Chrome caps ~6 live; long sessions throw. Module-level singleton.
17. **App-level Ctrl+T/W swallows keystrokes inside inputs** — `src/renderer/App.jsx:264`. Skip when `e.target` is an input/textarea.
18. **Confirm dialog Enter fires regardless of focused button** — `src/renderer/components/ConfirmDialog.jsx:19`. Scope listener to dialog or check focus.
19. **Hardcoded 80×24 PTY initial cols/rows** — `src/main/pty-manager.js:21`. First chunks of Claude's banner wrap; trust-prompt detection can break across cols. Pass renderer's measured cols/rows in `pty:create`.
20. **Persistence debounce too tight at 50 ms** — `src/renderer/App.jsx:78`. 500 ms is plenty and reduces write/quit collisions.
21. **Ring buffer `slice(-RING_BYTES)` per chunk** — `src/renderer/pty-pool.js:20`. Only slice when overflow > 1.5×, or use a chunk list.
22. **Sidebar live-count is stale for inactive workspaces** — `src/renderer/components/Sidebar.jsx`. Either compute from `agentCount` or hide the dot when not active.
23. **`electron.vite.config.js` doesn't disable source maps for prod** — leaks renderer maps into the asar.

## 🟢 Cleanup

24. Empty `<div className="titlebar-actions" />` — `src/renderer/components/Toolbar.jsx:52`.
25. `ipcMain.on('win:*')` registered inside `createWindow` — move to one-shot `whenReady`.
26. Magic numbers (4000ms done, 180ms zoom debounce, 50ms persist, 850ms boot) → `constants.js`.
27. Wire a cap on `clipboard:writeText` (e.g. 1 MB) — `src/main/index.js:52`.
28. Audit other dead CSS classes (`cd-mark` already removed).

## Recommended order for the next pass

Tackle items 1–5 (ship-blockers) in one go — small, surgical, and remove the most likely catastrophic failures. Then 6–7 (PTY orphan + handlePtyReady churn) before touching anything cosmetic. Items 13–23 can ride along in a "hardening" batch. The cleanup section is purely housekeeping.
